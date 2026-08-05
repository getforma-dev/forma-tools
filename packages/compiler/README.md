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
  // Include/exclude file patterns (default: all .ts/.tsx/.js/.jsx)
  include: ["src/**/*.tsx"],
  exclude: ["node_modules"],
})
```

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

### Slot Naming

Slot names are a **compile contract**: the server injects `SlotData` by name (via `forma_ir::SlotData::from_json`), so the compiler derives stable, human-meaningful names for every list and show binding. Names are visible in the emitted `.ir` string table.

**Lists** (`createList`) derive a base name in this order:

1. **Source-derived** — from the data source expression: `createList(todos, ...)` → `todos`. Arrows, function expressions, calls, member access, and `!`-negation unwrap to the underlying name (`() => state.todos()` → `todos`, `function () { return todos(); }` → `todos`).
2. **Map-param fallback** — when the source has no derivable name (e.g. a literal `() => []`), the map function's first parameter is used: `(tile) => ...` → `tile` (unless named `_`).
3. **Positional** — `#N` (document order) when neither yields a name.

Slots are then `list:<base>:array`, `list:<base>:item`, and `list:<base>:<prop>`.

**Shows** (`createShow` and ternary conditionals) follow the same scheme with the base derived from the **condition**: `createShow(() => visible(), ...)` → `show:visible` (`!` unwraps, so `() => !hidden()` → `show:hidden`; both arrow and `function` forms unwrap, including block bodies), with the same positional fallback (`show:#2`).

**Occurrence suffixes** are per-base in document order: the first occurrence of a base is unsuffixed, the second reuse of the same base gets `#2` (`show:visible`, `show:visible#2`, ...), and so on. Lists and shows keep separate registries. The registries are **page-wide**: lists/shows inside island subtrees, inlined sub-components, and list bodies dedup against the same namespace as page-level ones, in document order — two islands that each bind `visible` yield `show:visible` and `show:visible#2`, never a duplicate name.

**Migration** (0.2.x):
- `createShow` slots were previously all named `show:createShow` (and ternary shows `show:<index>`) — server code injecting those keys must move to the name-keyed scheme above.
- Lists over literal sources were previously positional (`list:#N:array`) — where the map function has a named parameter they are now map-param-derived (`list:tile:array`). Unknown keys fail soft (silently ignored), so check names after upgrading.

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

### Island signal defaults

Signal defaults are extracted from **island component files** as well as the page entry: both module-level `const [count, setCount] = createSignal(0)` declarations (plain or `export const`) and declarations at the top level of the exported island function are picked up.

The recommended pattern is **single-source**: declare the signal once at module scope in the island's own file. Page "twin" declarations (re-declaring the island's signal in the Page component so the compiler could see the default) are no longer required. When both exist, merging is first-wins with the root Page authoritative — identical twin declarations merge silently, and only a conflicting default warns at build time. The conflict warning names the declarer whose default actually won, which under first-wins may be an **earlier island** rather than the root.

Island signal merging runs on every entry-point pattern: `activateIslands`-only entries, named `mount(() => Page(), ...)` entries, and inline block-body `mount(() => { ... return h(...); }, ...)` entries — the `activateIslands({...})` registry is scanned in all cases.

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
import { ComponentAnalyzer } from "@getforma/compiler";

const analyzer = new ComponentAnalyzer();
const entry = analyzer.parseEntryPoint("src/app.tsx");
const component = analyzer.parseComponentFile(entry.importPath, entry.componentName);
```

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
