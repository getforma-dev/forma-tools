# Build diagnostics: the code catalogue

Every construct the compiler cannot represent in a server-rendered module is
reported with a stable code, the file, the line and the column, one line of why
and one of fix (FORMA-119; v2's DR-1, L-3, N12). This page lists every code.
The catalogue in `packages/compiler/src/diagnostics.ts` is the source; a test
keeps this page, the catalogue and the conformance fixtures equal.

## What a diagnostic looks like

A default build prints each one as a warning, one line, as at compiler 0.3.6,
with the code after `IR:` and the position after the file:

```
   IR: BUILD-101 call expression helpers.extra(...) in /app/src/home/app.tsx:12:11 — emitted as an empty island shell, so it renders nothing server-side and only appears once the client bundle hydrates
```

Apart from the exceptions below, no line is added or removed and the text
around the code and position is unchanged, so a gate that counts these lines per file (GateWASM's
`check-ir-degradations.mjs`) or matches their text (ksx Studio's
`build.mjs`) sees what it saw at 0.3.6. The exceptions are rare and
deliberate: three page-level lines that named no file now name the entry
(`inline return node is not a call expression`, `real emission failed`,
and the module-write failure, which now also starts with `IR:`); a literal
past 65,535 bytes is reported where it is written instead of as
`real emission failed`; BUILD-701 to BUILD-707 word, with the way out,
constructs that were reported as an unresolved component, a call or a text
child; and **BUILD-303 adds a line** where 0.3.6 printed none: a
`createList` whose source is a plain read (`rows`, `rows()`,
`() => rows()`) of a signal initialized with literal rows, which the server
renders empty unless a handler fills it. A gate that counts or matches these
lines sees one more line per such list (GateWASM `b750ca5` and ksx Studio
`0cb57e2` have none).

The line and column are where the author wrote the construct: in a `.tsx` or
`.jsx` file, which the compiler reads after esbuild has turned its JSX into
`h()` calls, the position is mapped back through the transform's source map.

## Strict mode, the JSON report, and the result

- **Strict mode** fails the build on every diagnostic but a note, after every
  page is compiled, with all of them at once: `build({ strict: true })`, or
  `FORMA_STRICT=1` in the environment when the config leaves `strict`
  unset. `build()` reads no command-line flag, as for `ssr` and `watch`:
  a build script that takes `--strict` maps it to the config (the
  create-forma-app templates do from create-app 0.6.2). It needs
  `@getforma/compiler` 0.3.7 or later; with an older compiler the build
  refuses rather than pass pages it never checked. In watch mode a page with
  an error keeps its last good module.
- **JSON**: `build({ diagnosticsJson: 'ssr-diagnostics.json' })` writes
  `{ version, strict, diagnostics }`, one object per diagnostic with its
  `code`, `severity` (`error`, `warning` or `note`), `page`, `file`,
  `line`, `column`, `message`, `why`, `fix` and, for BUILD-403, the
  `chain` (`component`, `file`, `line`, `column` per link). It is written
  whether or not the build fails, and its path must be outside `outputDir`,
  which the build replaces whole and serves: one inside is refused before
  anything is written, inside as the filesystem sees it (through real paths,
  so a symlink into `outputDir` counts; case-insensitively where the
  filesystem ignores case; `..` only as a whole segment). `version` is 1: a field may be added without
  changing it; renaming or removing one, or changing what one means,
  increments it.
- **The result**: `build()` returns the same list as `result.diagnostics`.
- **The plugin**: `formaSsrPlugin({ …, strict, onDiagnostics })` for a build
  that uses esbuild directly; under `strict` each diagnostic is an esbuild
  error at its file, line and column, with its why and fix as notes.
- **The compiler**: `collectDiagnostics(() => generateRealIr(entry))`, and
  `DIAGNOSTIC_CATALOGUE`, are exported.

The default stays a warning: without strict mode, every existing build
behaves as at 0.3.6. 3.0.0 makes strict the only mode (DR-1's migration,
step 3).

## Counting composition depth (L-26)

BUILD-403 names the chain from the page down to the component it refused, as
`(chain: HomePage > Layout > Card > Panel > Badge)` in the line and as
`chain` in the JSON, so an application's composition past the inlining limit
can be counted in strict mode: the number of BUILD-403 entries.

## Notes

A note is printed as every diagnostic is, but strict mode never fails on it.
They are BUILD-504, a construct DR-1's published subset admits (its reads
are reported where they are), and the deprecations, whose old paths keep
working in A2: BUILD-802 to BUILD-804 (build options and the wasm-pack step;
a build that still sets `wasm` passes in strict mode) and BUILD-901 (the
compiler's `transformServerFunctions`).

## Families

| Family | What it reports |
|---|---|
| BUILD-1xx | A subtree the compiler leaves to the browser (rule 11) |
| BUILD-2xx | An attribute or prop dropped or left empty |
| BUILD-3xx | Text, a conditional or a list the server renders empty or wrong |
| BUILD-4xx | A component the compiler does not inline |
| BUILD-5xx | A signal the compiler cannot name |
| BUILD-6xx | The page module: a placeholder, or a literal too long |
| BUILD-7xx | A construct adoption does not handle; `browserOnly()` is the way out |
| BUILD-8xx | The build package (reported by `@getforma/build`) |
| BUILD-9xx | The compiler's own deprecated entry points (logged when called) |

## The codes

## BUILD-1xx: A subtree the compiler leaves to the browser (rule 11)

### BUILD-101 Unrecognised call in the tree

**Why.** The call becomes an anonymous island (`island_<n>`) that no registry names: the server renders an empty shell and nothing fills it.

**Fix.** Write the subtree as h() calls, a component in a relative file, createShow or createList, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-101/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-101/pass/)):

```tsx
<div>{helpers.extra()}</div>
```

### BUILD-102 Unrecognised child expression

**Why.** A child the compiler cannot represent (a bare ternary, a bare `&&`, an identifier, a template literal, an object) becomes an anonymous island the server renders empty.

**Fix.** Wrap a reactive child in a function (`() => …`), use createShow for a conditional and createList for rows, or fold the value into a module-level const.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-102/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-102/pass/)):

```tsx
<p>{caption}</p>
```

### BUILD-103 Dynamic tag

**Why.** `h(expr, …)` with a tag the compiler cannot read becomes an anonymous island the server renders empty.

**Fix.** Use a literal tag name, or a component the compiler can follow.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-103/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-103/pass/)):

```tsx
{h(tag, null, 'section body')}
```

### BUILD-104 Spread child that does not unroll

**Why.** A spread child is unrolled only as `...CONST.map(item => h(…))` over a module-level array of object literals; anything else becomes an anonymous island the server renders empty.

**Fix.** Unroll a module-level const array of object literals, or render runtime rows with createList(source, keyFn, (row) => h(…)).

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-104/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-104/pass/)):

```tsx
{h('ul', null, ...rows.map((r) => h('li', null, r.name)))}
```

### BUILD-105 Spread over a table that is not static

**Why.** The spread names a table the compiler cannot read (imported from a package, built at run time, or shadowed by a nested declaration), so it becomes an anonymous island the server renders empty.

**Fix.** Declare the table as a literal `const` of object literals in the module it is imported from, with no nested declaration of the same name, or use createList.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-105/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-105/pass/)):

```tsx
{h('ul', null, ...ROWS.map((r) => h('li', null, r.name)))}
```

### BUILD-106 createShow branch the compiler cannot follow

**Why.** A createShow branch that is not `() => h(…)` (or a direct h() call) becomes an anonymous island the server renders empty.

**Fix.** Write the branch inline as `() => h(…)`.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-106/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-106/pass/)):

```tsx
{createShow(() => open(), renderPanel, () => <p>closed</p>)}
```

### BUILD-107 createList the compiler cannot walk

**Why.** A createList without all three arguments, with a map function that is not inline, takes no named row parameter or returns nothing visible becomes a `createList` island the server renders empty.

**Fix.** Write `createList(source, keyFn, (row) => h(…))` with the map function inline and the row parameter named, reading `row.field`.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-107/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-107/pass/)):

```tsx
<ul>{createList(todos, (r) => r.id)}</ul>
```

## BUILD-2xx: An attribute or prop dropped or left empty

### BUILD-201 Props passed as something other than an object literal

**Why.** None of the attributes the element carries are rendered on the server.

**Fix.** Pass the attributes as an object literal on the h('tag', { … }) call.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-201/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-201/pass/)):

```tsx
{h('div', props, 'x')}
```

### BUILD-202 Spread props

**Why.** The attributes inside `{...rest}` are not rendered on the server.

**Fix.** List the attributes explicitly on the h() call.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-202/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-202/pass/)):

```tsx
<div {...rest}>x</div>
```

### BUILD-203 Prop key the compiler cannot name

**Why.** A computed key, or a key that is neither an identifier nor a string, drops its attribute from the server-rendered HTML.

**Fix.** Use a plain identifier or string key.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-203/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-203/pass/)):

```tsx
{h('div', { [attrName]: 'v' }, 'x')}
```

### BUILD-204 Method-valued prop

**Why.** An object method (`{ title() { … } }`) has no binding form, so the attribute is not rendered on the server.

**Fix.** Write it as an arrow property (`title: () => …`) for a reactive binding.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-204/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-204/pass/)):

```tsx
{h('div', { title() { return 'x'; } }, 'y')}
```

### BUILD-205 dangerouslySetInnerHTML

**Why.** Raw markup is not rendered from the module: the element ships empty until the browser runs.

**Fix.** Render the content as h() children, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-205/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-205/pass/)):

```tsx
<div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />
```

### BUILD-206 Reactive attribute the compiler cannot evaluate

**Why.** The attribute is omitted from the server-rendered HTML and appears only once the browser activates the page.

**Fix.** Initialize the signals it reads with literal defaults, or fold the value into a module-level const.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-206/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-206/pass/)):

```tsx
<a href={() => docsHref()}>Docs</a>
```

### BUILD-207 Attribute value the compiler cannot evaluate

**Why.** The attribute is omitted from the server-rendered HTML, and adoption does not re-apply a value that is not a function, so it never appears.

**Fix.** Inline the literal, use a module-level const, or wrap the value in a function (`() => …`) for a reactive binding.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-207/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-207/pass/)):

```tsx
<button title={'Enable ' + lookupName()}>Go</button>
```

## BUILD-3xx: Text, a conditional or a list the server renders empty or wrong

### BUILD-301 Text the compiler cannot evaluate

**Why.** The text renders empty on the server and fills in only once the browser activates the page.

**Fix.** Initialize the signals it reads with literal defaults so the server can render them.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-301/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-301/pass/)):

```tsx
<p>{() => format(count())}</p>
```

### BUILD-302 Conditional the compiler cannot evaluate

**Why.** The server renders the ELSE branch; if the browser would render the THEN branch, adoption keeps the wrong one until the condition changes value.

**Fix.** Initialize the signals the condition reads with literal defaults.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-302/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-302/pass/)):

```tsx
<div>{() => isOpen() ? <p>open</p> : <p>closed</p>}</div>
```

### BUILD-303 List over a signal initialized with literal rows

**Why.** The list's source is a plain read (`rows`, `rows()`, `() => rows()`) of a signal initialized with literal rows, which have no slot, so the server renders the list empty unless a handler fills `list:<name>:array`, while the browser renders the rows. A derived source over literal rows (`() => rows().filter(…)`) is not detected in A2.

**Fix.** Start the signal empty (`createSignal([])`) and fill it from the server (the handler sets `list:<name>:array`; an island seeds the signal from its props), or unroll a module-level const with `...CONST.map(…)`.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-303/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-303/pass/)):

```tsx
<ul>{createList(items, (r) => r.id, (r) => <li>{r.n}</li>)}</ul>
```

## BUILD-4xx: A component the compiler does not inline

### BUILD-401 Component imported from a package

**Why.** The compiler follows relative imports only, so the component becomes an empty island shell under its own name that nothing fills on the server.

**Fix.** Compile the component's source in the application (a relative import), or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-401/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-401/pass/)):

```tsx
<div><Fancy /></div>
```

### BUILD-402 Component the compiler cannot find

**Why.** No relative import or declaration in the calling file resolves the name, so it becomes an empty island shell that nothing fills on the server.

**Fix.** Import the component from a relative path, or declare it in the calling file.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-402/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-402/pass/)):

```tsx
<div><Widget /></div>
```

### BUILD-403 Composition past the inlining limit of 3

**Why.** Components are inlined three levels deep; the fourth level becomes an empty island shell. The diagnostic names the chain from the page down.

**Fix.** Flatten the chain so the component sits at depth 3 or less, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-403/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-403/pass/)):

```tsx
<D />
```

### BUILD-404 Recursive component

**Why.** A component inside its own subtree is not inlined: it becomes an empty island shell.

**Fix.** Render the recursion with createList over data, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-404/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-404/pass/)):

```tsx
return <ul><Tree /></ul>;
```

### BUILD-405 Component passed a prop the compiler cannot evaluate

**Why.** A component is inlined only with literal props, so it becomes an empty island shell.

**Fix.** Pass literal values (strings, numbers, booleans, null) as props.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-405/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-405/pass/)):

```tsx
<Card title={computeTitle()} />
```

### BUILD-406 Component the compiler cannot follow

**Why.** The component has no return the compiler can follow to an h() call, or its file failed to parse, so it becomes an empty island shell.

**Fix.** Return the h() tree directly from the component (an expression body or a top-level `return h(…)`).

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-406/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-406/pass/)):

```tsx
<Empty />
```

### BUILD-407 Children passed to a component

**Why.** The compiler cannot place a component's children: they are not in the server-rendered HTML and appear only after the browser renders the component.

**Fix.** Pass the content as props, or render it inside the component.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-407/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-407/pass/)):

```tsx
<Card><b>bold</b></Card>
```

### BUILD-408 Registered island whose content the compiler cannot compile

**Why.** The island is registered, so its empty shell activates in the browser, but the server renders a hole where it will appear (or truncates its content at the failure).

**Fix.** Make the island resolvable (a relative import, returning its h() tree), or declare it with browserOnly() so the empty host is intended.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-408/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-408/pass/)):

```tsx
<LiveChart />
```

## BUILD-5xx: A signal the compiler cannot name

### BUILD-501 Signal default the compiler cannot evaluate

**Why.** The signal gets no named slot, so bindings to it land in anonymous slots that render empty on the server and cannot be set by name.

**Fix.** Initialize it with a string, number, boolean or null literal, or a module-level string const.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-501/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-501/pass/)):

```tsx
const [rows] = createSignal(loadRows());
```

### BUILD-502 Signal declared twice in one scope

**Why.** Two declarations with different defaults share one slot; the first owns it, so the server renders its default.

**Fix.** Declare the signal once.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-502/fail/app.ts) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-502/pass/)):

```ts
const [mode] = createSignal('b');
```

### BUILD-503 Signal name taken by another scope

**Why.** Two scopes declare the same signal name, so this one's slot is renamed (`name#2`); a server setting the plain name fills the other one.

**Fix.** Declare the signal once and import it, or set the renamed slot by its exact name.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-503/fail/app.ts) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-503/pass/)):

```ts
const [count] = createSignal(7);
```

### BUILD-504 Signal initialized with an array or object literal (note)

**Why.** The signal gets no named slot, so its literal value does not reach the server. DR-1 admits literal arrays and objects, so this is a note, never an error. A read in text, an attribute or a conditional is reported where it is (BUILD-301, 206, 302), and a createList whose source is a plain read of literal rows (`rows`, `rows()`, `() => rows()`) as BUILD-303; a derived source such as `createList(() => rows().filter(…))` is not detected in A2.

**Fix.** Act on the diagnostic at each read. A createList over `createSignal([])` needs nothing: both sides start empty.

**In strict mode.** A note: never an error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-504/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-504/pass/)):

```tsx
const [rows] = createSignal([] as Array<{ id: number; name: string }>);
```

## BUILD-6xx: The page module: a placeholder, or a literal too long

### BUILD-601 No mount() call in the entry

**Why.** The compiler cannot find the page, so it writes a placeholder module: the server renders an empty `<div id="app">` and nothing shows until the browser runs.

**Fix.** Call mount(() => …, '#app') or activateIslands({ … }) at the top level of the SSR entry, or declare the route `ssr: false`.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-601/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-601/pass/)):

```tsx
import { h } from '@getforma/core';
```

### BUILD-602 Page component the compiler cannot resolve

**Why.** The page component named in mount() cannot be found or read, so the compiler writes a placeholder module and the server renders an empty `<div id="app">`.

**Fix.** Import the page component from a relative path that exports it as a function.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-602/fail/page.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-602/pass/)):

```tsx
import { h } from '@getforma/core';
```

### BUILD-603 Page root that is not an h() call

**Why.** The page returns something other than an h() call, so the compiler writes a placeholder module and the server renders an empty `<div id="app">`.

**Fix.** Return the page tree as h() calls (or JSX).

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-603/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-603/pass/)):

```tsx
return 'just text';
```

### BUILD-604 Literal past 65,535 bytes

**Why.** FMIR's string table and slot defaults hold at most 65,535 bytes per entry, so the page cannot be encoded and the compiler writes a placeholder module.

**Fix.** Load content that long at run time (a handler-filled slot or a fetch), or split it into smaller literals.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-604/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-604/pass/)):

```tsx
<p>{C + C + C + C + C + C + C}</p>
```

### BUILD-605 Module const past 65,535 bytes

**Why.** A module-level const that folds to more than 65,535 bytes is not folded, so every use of it is reported where it is read.

**Fix.** Keep folded constants under 65,535 bytes, or load the content at run time.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-605/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-605/pass/)):

```tsx
export const D = C + C + C + C + C + C + C;
```

### BUILD-606 Module emission failed

**Why.** The compiler failed while emitting the page (or writing its module) and fell back to a placeholder module. This is a defect in the compiler or an input it does not expect.

**Fix.** Report it with the message; until it is fixed, declare the route `ssr: false`.

**In strict mode.** An error.

No page triggers it on purpose: it is tested by an unwritable output directory and an unreadable entry (`packages/compiler/tests/diagnostics-conformance.test.ts` > "BUILD-606").

## BUILD-7xx: A construct adoption does not handle; `browserOnly()` is the way out

### BUILD-701 Plain array child (`.map()` without createList)

**Why.** A `.map()` returning elements is not adopted. As a child, the server renders an empty island shell and the rows never appear after activation; in a reactive child (`() => rows.map(…)`), the server renders empty text and after activation the page shows the elements as text (`[object HTMLLIElement]`).

**Fix.** Render rows with createList(source, keyFn, (row) => h(…)), unroll a module-level const with ...CONST.map(…), or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-701/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-701/pass/)):

```tsx
<ul>{items.map((i) => <li>{i}</li>)}</ul>
```

### BUILD-702 createErrorBoundary in a server-rendered component

**Why.** Adoption has no handling for createErrorBoundary: the server renders an empty shell where it stands, and on a mount() root activation throws (`insertBefore`: parameter 1 is not of type 'Node'), so nothing after it activates.

**Fix.** Move the boundary out of the server-rendered tree, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-702/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-702/pass/)):

```tsx
{createErrorBoundary(() => <p>ok</p>, () => <p>failed</p>)}
```

### BUILD-703 createSwitch in a server-rendered component

**Why.** Adoption has no handling for createSwitch: the server renders an empty shell where it stands, and on a mount() root activation throws (`insertBefore`: parameter 1 is not of type 'Node'), so nothing after it activates.

**Fix.** Use createShow for each case, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-703/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-703/pass/)):

```tsx
{createSwitch(() => tab(), [{ match: 'a', render: () => <p>a</p> }])}
```

### BUILD-704 createPortal in a server-rendered component

**Why.** Adoption has no handling for createPortal: the server renders an empty shell where it stands; activation goes on past it, but the portal's content never appears.

**Fix.** Create the portal from an effect after activation, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-704/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-704/pass/)):

```tsx
{createPortal(() => <p>overlay</p>, document.body)}
```

### BUILD-705 createSuspense in a server-rendered component

**Why.** Adoption has no handling for createSuspense: the server renders an empty shell where it stands, and on a mount() root activation throws (`insertBefore`: parameter 1 is not of type 'Node'), so nothing after it activates.

**Fix.** Render the loaded state from server data, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-705/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-705/pass/)):

```tsx
{createSuspense(() => <p>loading</p>, () => <p>loaded</p>)}
```

### BUILD-706 browserOnly() prop the compiler cannot evaluate

**Why.** A browser-only island's server output is its empty host with its declared props; a prop the compiler cannot evaluate to a string, number, boolean or null (a function, a spread, an array, a run-time value) is not among them, so the component never receives it.

**Fix.** Pass a literal or a module-level const, or read the value in the browser.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-706/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-706/pass/)):

```tsx
<Chart data={rows()} />
```

### BUILD-707 browserOnly() called inside the tree

**Why.** browserOnly() wraps a component declaration; called in the tree, the compiler cannot name the island, so it becomes an empty shell nothing registers.

**Fix.** Declare `const X = browserOnly(Impl)` at the top level of a module, render `<X …/>`, and register X in activateIslands.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-707/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-707/pass/)):

```tsx
<div>{browserOnly(Panel)}</div>
```

### BUILD-708 browserOnly() component not registered

**Why.** The page activates islands from a registry that does not name this component, so its empty host never renders in the browser.

**Fix.** Add the component to the activateIslands({ … }) registry under the name it is rendered with.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-708/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-708/pass/)):

```tsx
<Chart />
```

## BUILD-8xx: The build package (reported by `@getforma/build`)

### BUILD-801 SSR build without @getforma/compiler

**Why.** The build was asked for server-rendered modules but cannot load @getforma/compiler, so it writes none.

**Fix.** Install @getforma/compiler (a peer dependency of @getforma/build), or turn `ssr` off.

**In strict mode.** An error.

Printed by the build itself as `Warning: BUILD-801 @getforma/compiler not available for SSR. Skipping IR emission.` (`packages/build/tests/strict-compiler.test.ts` > "reports SSR without @getforma/compiler with its code, and fails it under --strict").

### BUILD-802 `serviceWorker` without `app` (deprecated; note)

**Why.** The worker is 0.3.0's: its caches are shared by every Forma application on the origin, and it takes over open tabs at once. From 3.0.0 a worker is written only for a named app. A deprecation, not a construct the server cannot render, so --strict does not fail on it.

**Fix.** Set `app` to the name the server passes to forma-server's `sw::ServiceWorker::for_app`, for caches per application and build and a waiting upgrade.

**In strict mode.** A note: never an error.

Printed by the build itself, once per `build()`, as `Warning: BUILD-802 serviceWorker is set without app: …` and in `BuildResult.warnings` (FORMA-130); in the report as a note (`packages/build/tests/strict.test.ts` > "reports BUILD-802 (serviceWorker without app) as a note --strict does not fail on").

### BUILD-803 `wasm` in the config (deprecated; note)

**Why.** The `wasm` key goes in 3.0.0 with the WASM walker (forma-ir's `wasm` feature and `@getforma/core/wasm`). The old path keeps working in A2, so strict mode does not fail a build that still sets it.

**Fix.** Remove `wasm` from the config: islands re-render in the browser with h(), and forma-server renders pages.

**In strict mode.** A note: never an error.

Printed by the build itself (FORMA-131), on the console and in `BuildResult.warnings`; in the report as a note (`packages/build/tests/wasm-deprecation.test.ts` > "a strict build that still sets wasm passes, with BUILD-803 and BUILD-804 as notes in its report (FORMA-119)").

### BUILD-804 The wasm-pack step ran (deprecated; note)

**Why.** The wasm-pack step goes in 3.0.0: forma_ir.js, forma_ir_bg.wasm and the manifest's wasm entry go with the WASM walker. It still runs and ships the walker in A2, so strict mode does not fail on it.

**Fix.** Remove `wasm` from the config.

**In strict mode.** A note: never an error.

Printed by the build itself (FORMA-131), on the console and in `BuildResult.warnings`; in the report as a note (`packages/build/tests/wasm-deprecation.test.ts` > "a strict build that still sets wasm passes, with BUILD-803 and BUILD-804 as notes in its report (FORMA-119)").

## BUILD-9xx: The compiler's own deprecated entry points (logged when called)

### BUILD-901 `transformServerFunctions` called (deprecated; note)

**Why.** The "use server" transform goes in 3.0.0 with server functions and `@getforma/core/server` (DR-22). Logged once per process when it is called; `@getforma/build` never calls it, so it is never in a build's report.

**Fix.** Serve the call from a route in the application's Rust server.

**In strict mode.** A note: never an error.

Logged by `transformServerFunctions` on its first call in a process (FORMA-131; `packages/compiler/tests/server-transform-deprecation.test.ts` > "transformServerFunctions logs BUILD-901 once, naming 3.0.0"). Never in a build's report: `@getforma/build` does not call it.
