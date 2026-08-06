# @getforma/compiler

[![npm](https://img.shields.io/npm/v/@getforma/compiler)](https://www.npmjs.com/package/@getforma/compiler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Compiler and build plugins for [FormaJS](https://github.com/getforma-dev/formajs). Transforms `h()` calls into pre-compiled templates for faster rendering, handles `"use server"` function transforms, and emits FMIR binary for Rust SSR.

**This is an optimization layer — FormaJS works without it.** Add the compiler when you want faster initial renders or Rust-based SSR.

## Install

```bash
npm install -D @getforma/compiler
```

## Vite Plugin — `formaCompiler`

Transforms `h()` calls into `template()` + `cloneNode()` at build time. Instead of creating DOM elements one by one at runtime, the browser clones a pre-built template — significantly faster for complex component trees.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { formaCompiler } from "@getforma/compiler";

export default defineConfig({
  plugins: [formaCompiler()],
});
```

**Before (runtime):**
```ts
h("div", { class: "card" },
  h("h2", null, "Title"),
  h("p", null, () => description()),
)
```

**After (compiled):**
```ts
const _tmpl = template("<div class='card'><h2>Title</h2><p></p></div>");
const _root = _tmpl.cloneNode(true);
createEffect(() => { _root.querySelector("p").textContent = description(); });
```

### Options

```ts
formaCompiler({
  // Default: ["**/*.ts", "**/*.tsx"] — .js/.jsx are NOT transformed unless listed
  include: ["src/**/*.tsx"],
  // Default: ["**/node_modules/**"]
  exclude: ["**/generated/**"],
})
```

Patterns are matched against the module id with `\` normalized to `/` and any
Vite query suffix (`?v=hash`) dropped. A `**` segment matches any number of path
segments (including none) and `*` matches within one segment. A file is
transformed only if it matches an include pattern, no exclude pattern, and
imports from `formajs` / `forma/`.

## Server Functions — `formaServer`

Transforms functions with the `"use server"` directive into RPC stubs (client build) or registered endpoints (server build).

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { formaCompiler, formaServer } from "@getforma/compiler";

export default defineConfig({
  plugins: [
    formaCompiler(),
    formaServer({ mode: "client" }), // or "server"
  ],
});
```

**Source:**
```ts
async function createTodo(text: string) {
  "use server";
  return db.insert("todos", { text });
}
```

**Client output:**
```ts
import { $$serverFunction } from "@getforma/core/server";
const createTodo = $$serverFunction("/rpc/createTodo_a1b2c3");
```

**Server output:**
```ts
import { registerServerFunction } from "@getforma/core/server";
async function createTodo(text: string) {
  return db.insert("todos", { text });
}
registerServerFunction("/rpc/createTodo_a1b2c3", createTodo);
```

## esbuild SSR Plugin — `formaSsrPlugin`

Emits FMIR (Forma Module IR) binary files for Rust-based server-side rendering. Only needed with the full Forma stack (`forma-ir` + `forma-server`).

```ts
import { formaSsrPlugin } from "@getforma/compiler";

// Used by @getforma/build, not typically called directly
```

The plugin writes exactly one file per page: `<page>.ir`. The island table lives
inside that binary; callers who want it as data use `generateRealIr(entry)`,
which returns `{ binary, islands }`. (Through 0.2.0 the plugin also dropped a
`<page>.islands.json` sidecar into the output directory — build metadata in the
served asset tree, read by nothing but a since-removed `@getforma/build` step.)

### Build diagnostics

The compiler renders what it can prove and defers the rest to the client. The
deferral is the dangerous part: an unrecognised construct becomes an empty
island shell (or, for an unresolvable attribute value, an empty attribute), and
a page that *looks* built can be missing content. **Every such degradation now
warns**, naming the file, the construct, and what the page loses:

```
   IR: child a bare '&&' expression (not wrapped in a function) in src/HomePage.ts
       — emitted as an empty island shell, so it renders nothing server-side and
       only appears once the client bundle hydrates — wrap it in a function
       (`() => …`) for a reactive binding, or use createShow/createList for
       conditionals and lists
```

Warnings are emitted for: a dynamic tag (`h(tagName, ...)`); a child the walker
cannot translate (bare identifier, template literal, unwrapped ternary or `&&`);
a spread that will not statically unroll; each way a `createList` call can fail
to compile (too few arguments, a non-inline map function, a destructured or
missing row parameter, no visible return); a `createShow` branch that is not an
`h()` call; a component that cannot be resolved, is recursive, exceeds the
3-level inlining depth, is passed a prop that is not a literal, or has no
followable return; an island component whose content cannot be compiled; and a
`createSignal` whose initial value is not a literal (which is why it has no
named slot).

Bindings warn too, because a binding the compiler cannot evaluate is a page
whose server render disagrees with its client render:

- a **dynamic attribute** whose expression will not evaluate — the attribute is omitted server-side and appears only after hydration;
- a **dynamic text child** whose expression will not evaluate — it renders empty and fills in after hydration;
- a **conditional** whose condition will not evaluate — the server renders its ELSE branch, and if the client would render THEN, hydration adopts the wrong one *silently* (both branches have content, so neither mismatch-repair arm fires);
- a signal whose name is **also declared in another scope**, naming the `#N` slot it actually got.

A page the compiler fully understands prints nothing.

### What renders server-side

| Construct | SSR |
|---|---|
| `h('div', { class: 'x' }, 'text')` | Static markup |
| `h('div', { class: () => cls() }, () => text())` | Slot-backed attribute / text |
| `createShow` / a ternary inside `() => …` | `SHOW_IF` with both branches |
| `createList(src, keyFn, (row) => …)` | `LIST` + per-row `PROP`s |
| `h(Fragment, null, …)` / `Fragment(…)` | Children inline, no wrapper — every child kind, same as an element's |
| `Card({ title: 'Reports' })` | Inlined, with literal props substituted into the component body (`props.title` and destructured `{ title }`) |
| `h(Card, { title: 'Reports' })` (what JSX `<Card/>` compiles to) | Same as `Card({...})`: inlined when resolvable, otherwise an island **named `Card`** so the client registry can hydrate it |
| `...NAV.map(i => h('a', { href: i.href }, i.label))` over a module-level const | Unrolled, with row values substituted into attributes *and* children |
| Anything else | Empty island shell + a build warning (above) |

Component children (`h(Card, null, 'body')`) are not represented in the IR — the
compiler cannot know where a component places its children — and warn.

### How a component is found

Before the compiler can inline anything it has to answer "which function does
this module export under this name?". One resolver answers that for the SSR
root page, for `createSignal` default extraction, and for sub-component
inlining — they used to be three copies that disagreed.

| Form | Resolved? |
|---|---|
| `export function Card() {}` | Yes |
| `export const Card = () => …` / `= function () {}` | Yes |
| `export { Card }` | Yes — **this is what esbuild rewrites every `export function` in a `.tsx` file into** |
| `export { CardImpl as Card }` | Yes, following the alias to the declaration |
| `import { Card } from './card'; export { Card };` | Yes, following the import |
| `export default function Card() {}` | Yes, for a default import (`import Card from './card'`) or when the function's own name matches |
| `export { Card } from './card'` (index barrel) | Yes, following the re-export across files |
| `export * from './card'` (index barrel) | Yes, searching each spread module in order |
| `import { CardImpl as Card } from './card'` at the CALL site | Yes — looked up as `CardImpl` in the target module |
| A non-exported top-level `function Card() {}` | Only for a call in the **same file**; a name that arrived through an `import` is not importable and is refused |
| A helper declared **inside** another function | Only for a call in the same file, and only when the file declares that name exactly once |
| `export * as NS from './card'` / `import * as NS` | No — a namespace object is not a function. Warns. |
| `export { Button } from 'some-ui-kit'` | No — the compiler follows relative imports only, never package code. Warns. |
| A circular re-export chain | No — resolution stops and warns |

Anything in the "No" rows warns at build time naming the file, the construct
and the consequence. A root page that cannot be resolved falls back to
**placeholder IR** — `<div id="app"></div>`, no slots, no islands — so the page
server-renders empty; that is now said in the warning rather than left for the
reader to discover in the browser.

`.tsx`/`.jsx` files are transformed by esbuild before parsing, which is what
makes the `export { … }` specifier row load-bearing: under the old resolver
every JSX page compiled to placeholder IR and every `.tsx` island silently lost
its named signal slots and their SSR defaults.

### Slot Naming

Slot names are a **compile contract**: the server injects `SlotData` by name (via `forma_ir::SlotData::from_json`), so the compiler derives stable, human-meaningful names for every binding. Names are visible in the emitted `.ir` string table.

**Every slot name a page emits is unique.** The Rust loader builds one `HashMap<String, u16>` from the slot table, so two slots sharing a name silently collapse and the earlier one becomes permanently unreachable for injection. Uniqueness is enforced by the four page-wide occurrence registries described below (list, show, attr, text).

**Lists** (`createList`) derive a base name in this order:

1. **Source-derived** — from the data source expression: `createList(todos, ...)` → `todos`. Arrows, function expressions, calls, member access, and `!`-negation unwrap to the underlying name (`() => state.todos()` → `todos`, `function () { return todos(); }` → `todos`).
2. **Map-param fallback** — when the source has no derivable name (e.g. a literal `() => []`), the map function's first parameter is used: `(tile) => ...` → `tile` (unless named `_`).
3. **Positional** — `#N` (document order) when neither yields a name.

Slots are then `list:<base>:array`, `list:<base>:item`, and `list:<base>:<prop>`.

**Shows** (`createShow` and ternary conditionals) follow the same scheme with the base derived from the **condition**: `createShow(() => visible(), ...)` → `show:visible` (`!` unwraps, so `() => !hidden()` → `show:hidden`; both arrow and `function` forms unwrap, including block bodies), with the same positional fallback (`show:#2`).

**Dynamic attributes** (`class: () => cls()`) are named `attr:<key>` and **dynamic text children** (`h('p', null, () => msg())`) are named `text:<childIndex>`, where the index counts children of the immediate parent element from 0. Neither is derived from a page-unique source: two sibling elements can bind the same attribute key, and every element restarts its child indexing at 0 — so both run the same occurrence scheme over their own page-wide registry.

**Signals** are named after the getter: `const [count] = createSignal(0)` → slot `count`. Two different scopes declaring the same name run the same occurrence scheme (`count`, `count#2`) — see Signal scopes.

**Occurrence suffixes** are per-base in document order: the first occurrence of a base is unsuffixed, the second reuse of the same base gets `#2` (`show:visible`, `show:visible#2`; `attr:class`, `attr:class#2`; `text:0`, `text:0#2`; `count`, `count#2`), and so on. A name that occurs once on a page is **never** suffixed, so single-occurrence keys keep the spelling downstream consumers pin.

The five families keep separate registries, and each registry is **page-wide**: constructs inside island subtrees, inlined sub-components, list bodies and show branches dedup against the same namespace as page-level ones, in document order — two islands that each bind `visible` yield `show:visible` and `show:visible#2`, and a dynamic `class` inside a list body dedups against one on the page root, never a duplicate name.

A dynamic attribute or text child that binds a **signal in scope** (`() => count()`) reuses that signal's named slot instead and mints no `attr:`/`text:` name at all. Widening which signals are in scope therefore REMOVES `attr:`/`text:` names and renumbers the `#N` suffixes on the ones that remain — see the migration notes below.

**Slot ids are not addresses.** They are handed out in the order the walk reaches each construct, so adding a signal renumbers everything after it. Nothing on the wire depends on the value: the client matches hydration markers positionally (`adoptNode` advances to the next `f:sN`/`f:tN`/`f:lN` of the right kind) and `DYN_TEXT` carries an independent `marker_id`. Address slots by NAME.

**Migration.** All the changes below are in `[Unreleased]` — they are in the
repo and not yet on npm, where the current version is 0.2.0. `CHANGELOG.md` is
the authority for which release each one ships in; do not re-date them here
from memory.

- (unreleased) Signals in scopes the compiler previously did not read now get named slots, which **removes** the anonymous `attr:`/`text:` slots those bindings used to mint and renumbers the `#N` suffixes on the ones that remain. Measured over the shipped corpus: `dynamic-text` lost all four `text:*` names for four signal names, and `dynamic-attrs` lost `attr:value` (its `value: () => query()` binding now reuses `query`). Server code injecting a removed key fails **soft** — `SlotData::from_json` ignores unknown keys — so re-check every injected name against the emitted slot table after upgrading.
- (unreleased) `show:*` slots now carry an SSR default, so a conditional whose condition is statically truthy server-renders its THEN branch. Pages that were shipping the wrong branch (and staying wrong through hydration) change their rendered HTML.
- (unreleased) A page "twin" declaration of an island's signal is now a separate slot (`x` for the page's, `x#2` for the island's), and warns. Delete the twin.
- (unreleased) `createShow` slots were previously all named `show:createShow` (and ternary shows `show:<index>`) — server code injecting those keys must move to the name-keyed scheme above.
- (unreleased) Lists over literal sources were previously positional (`list:#N:array`) — where the map function has a named parameter they are now map-param-derived (`list:tile:array`). Unknown keys fail soft (silently ignored), so check names after upgrading.
- (0.2.0) Every `createList` previously emitted `list:array` / `list:item` / `list:<prop>`, so on a page with more than one list only the first was reachable by name. Slots are now `list:<base>:…` with the base derived as described above.

### Islands: slot ids and props injection

Island table entries in the emitted FMIR now carry the **real slot ids** referenced inside each island's SSR span (dynamic attrs, signal-bound text, list slots — including slots reused from page-level signals, and slots of islands nested inside the span). Previously `slot_ids` was always empty, and the Rust walker skips props emission for islands with empty `slot_ids`.

With `slot_ids` populated, `forma-ir` natively emits the `data-forma-props` attribute and the `__forma_islands` script block during SSR. Consumers who were hand-emitting that script block server-side can migrate to the native path and delete the hand-rolled emission.

**Island props key-space contract** — the slot-name families that can appear in an island's `slot_ids` (and therefore in its serialized `data-forma-props`):

| Family | Example | Included? |
|---|---|---|
| Named signal slots | `statusText` | Yes |
| Dynamic attributes | `attr:class` | Yes |
| Dynamic text | `text:0` | Yes |
| Show conditions | `show:visible` | Yes |
| List arrays | `list:todos:array` | Yes |
| List item props | `list:todos:title` | Yes |
| List item scratch | `list:todos:item` | **No** — excluded |

The per-item scratch slot (`list:<base>:item`) is working storage the LIST opcode overwrites on every row; after SSR it holds the **last rendered row**, so serializing it into `data-forma-props` would leak that row into the page. It is filtered out of `slot_ids` at emission time.

### Signal scopes

A `createSignal` becomes a **named slot carrying its SSR default** whenever the
signal is in lexical scope at the binding that reads it — and "in scope" is
decided by the same traversal that decides what gets inlined into the page:

> **If the walk inlined the code, its signals are in scope. If it did not, there
> is nothing to name.**

That covers every scope the walk enters, without a list to keep in sync:

| Where the signal is declared | Named slot? |
|---|---|
| Inside the exported root `*Page` component | Yes |
| At module scope in the root page **file** | Yes |
| At module scope in an island component file | Yes |
| Inside the exported island component | Yes |
| Inside an inlined sub-component (file-local or imported) | Yes |
| At module scope of an inlined sub-component's own file | Yes |
| In the entry file / mount callback of an inline `mount(() => {…})` | Yes |
| Below the top level of any of those (inside `if`, `try`, a loop, a block) | Yes |
| Inside a **nested function** that the walk does not inline | No — that function is its own scope, and gets its own frame if and when the walk inlines it |
| In a module reached only through an `import` of the signal itself | No — the walk never inlined that module's code. Warns. |

Lookup is lexical and searches **outward**: a component's own body shadows its
file's module scope, which shadows nothing else. A sub-component's signals are
NOT visible to the page around it, and two sibling components cannot see each
other's.

Only literal initial values yield a default: strings, numbers (including
negative ones), booleans, `null`, expression-less template literals, and a
module-level `const` that folds to a string (`createSignal(SEL_TOGGLE_OFF)`).
Anything else warns and yields no named slot (see Build diagnostics).

**Name collisions.** Two components can each declare `count`; they are
different signals at runtime and must not share a slot. The **first** scope the
walk enters that declares a name gets `count`, the next gets `count#2` — the
same occurrence scheme every other slot family uses (see Slot Naming). Order is
the walk's document order, so it does not depend on file system order. Every
suffixed name is reported at build time, because injecting `count` would
otherwise silently fill only the first.

One slot per **declaration site**, not per instance: a component inlined (or
islanded) twice shares its signals' slots. Their SSR defaults are identical by
construction, so name-addressed injection reaches every instance.

**Page "twin" declarations are now harmful.** Re-declaring an island's signal
in the Page component — the workaround for the old extractor — creates a
SECOND, unread slot and pushes the island's own signal to `count#2`. Delete the
twin; the island's own declaration is what the walk reads.

### Conditionals get an SSR default too

`createShow(() => visible(), …)` and a ternary inside `() => …` mint a
`show:<condition>` slot whose default is the branch the CLIENT would render on
first paint, evaluated from the signals in scope. Without it the slot is Null,
every conditional on the page server-rendered its ELSE branch, and hydration
did **not** repair a wrong branch whose two sides both produce content — the
page stayed wrong until the condition changed value.

The slot name and id are unchanged: shows keep their own `show:*` slot rather
than reusing the condition signal's, because servers inject shows by that name.
A condition the compiler cannot evaluate keeps the old behaviour (ELSE
server-side) and now warns.

### Static attributes from module constants

Module-level string constants fold into **static attributes**. A top-level `const` (plain or `export const`) whose initializer is a string literal, an expression-less template literal, a `+` concatenation chain, or a reference to an earlier string const is resolved at compile time:

```ts
const ICON_PATH = "M4 6h16M4 12h16" + "M4 18h16";

h("path", { d: ICON_PATH })   // → static d="..." attribute, no slot
```

The same constants also fold inside function-valued props when computing SSR defaults (`title: () => PREFIX + name()`).

Two safety rules limit folding:

- **Shadowing** — a module const whose name is *also declared in any nested scope* (a component-local `const cls = ...`, a function parameter, a catch binding) is never folded, even when the shadowing declaration is in an unrelated function. The walker has no scope tracking, so folding a shadowed name could bake the module value into a static attribute with no slot — unrecoverable client-side. Shadowed names fall through to the unresolvable-identifier warning below.
- **64KB limit** — FMIR string-table entries carry a u16 byte-length prefix, so a const that folds to more than 65535 UTF-8 bytes (e.g. a huge inline SVG path) is dropped from folding with a build warning. The binary emitter also hard-fails (with a descriptive error, caught and downgraded to the no-IR fallback) rather than ever writing a corrupt string table.

An attribute value that is a bare identifier or member expression the compiler **cannot** resolve statically now emits a build warning — SSR would render that attribute empty, which previously failed silently. Fix by inlining the literal, using a module-level `const`, or wrapping in a function for a reactive value.

## Component Analyzer

Parses entry points to extract component trees, signal defaults, and island boundaries for IR emission.

```ts
import { readFileSync } from "node:fs";
import { ComponentAnalyzer } from "@getforma/compiler";

// Every method takes SOURCE TEXT plus the filename it came from — the analyzer
// never reads the filesystem itself. The constructor's baseDir is the directory
// relative imports are resolved against by the caller.
const analyzer = new ComponentAnalyzer("src");

const entrySource = readFileSync("src/app.ts", "utf8");
const entry = analyzer.parseEntryPoint(entrySource, "src/app.ts");

const pageSource = readFileSync("src/HomePage.ts", "utf8");
const page = analyzer.parseComponentFile(pageSource, "src/HomePage.ts", entry.componentName);
```

Most projects want `generateRealIr(entryPointPath)` instead, which drives the
whole pipeline (analyzer + walker + emitter) and returns `{ binary, islands }`.

## When Do You Need This?

| Scenario | Need compiler? |
|----------|---------------|
| Learning FormaJS, building prototypes | No |
| Production app with Vite | Optional — adds faster rendering |
| `"use server"` functions (RPC) | Yes — transforms the directive |
| Rust SSR with `forma-server` | Yes — emits FMIR binary |
| HTML Runtime (`data-*` directives) | No — runtime handles everything |

## Peer Dependencies

- `vite >=5.0.0` (optional — for Vite plugins)
- `esbuild >=0.17.0` (optional — for esbuild SSR plugin)

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | **This package** — h() optimization, server transforms, IR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — bundling, hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format — parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR page rendering, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds a Rust server + TypeScript frontend project |

## License

MIT
