# FMIR cross-implementation contract corpus

Each subdirectory is a complete miniature Forma app: `app.ts` (or `app.tsx`) is
the entry point (the file the esbuild SSR plugin points `generateRealIr` at),
plus the component files it imports. `npm run emit:corpus` runs the REAL
compiler over every case and writes `<case>.ir` — the same FMIR binary a
production build would ship.

These files are never imported by the TypeScript build or by any vitest suite;
they are read off disk exactly as the plugin reads a real page, so the corpus
exercises the shipped code path rather than a test-only re-implementation.

## Why this corpus exists

The compiler's binary output used to be pinned only by hand-written FMIR
readers inside the vitest suite. Those readers were written from the same
mental model as the emitter, so they agreed with it by construction —
including where both were wrong about what `forma-ir`'s parser actually
requires. Feeding the bytes to the real Rust consumer is the only check that
does not share that blind spot: over 32 binary mutation probes at audit time
the JS suite killed 22 and the Rust reader killed 22, but the union killed 27.
Five defect classes were invisible to the JS suite as it then stood, every one
of them "the emitted FMIR is mis-read by the real consumer":

| Probe | Defect | Case that catches it |
| --- | --- | --- |
| P09 | list array slot emitted `TYPE_TEXT` instead of `TYPE_ARRAY` | `list-same-source` |
| P14 | string length prefix counting UTF-16 units, not UTF-8 bytes | `unicode-emoji` |
| P21 | `DYN_TEXT` marker collision | `dynamic-text` |
| P29 | `DYN_ATTR` off-by-one on the slot id | `dynamic-attrs` |
| P30 | `SHOW_IF` branch-length swap | `ternary-asymmetric` |

`ir-roundtrip.test.ts` has since grown a slot-table assertion that also kills
P09, by pinning the literal `0x04` this emitter writes. That is a different
claim: it says the emitter wrote what its test author expected, not that the
consumer can iterate the result — both pass together if both are wrong about
the same byte. Only the Rust side turns the wrong byte into missing rows.

## Cases

| Case | Covers |
| --- | --- |
| `static-page` | static-only page: no slots, no islands, void tag |
| `dynamic-attrs` | `DYN_ATTR` on open and void tags; **two attrs sharing the `class` key**; two HTML **boolean** attributes over `TYPE_BOOL` slots |
| `dynamic-text` | `DYN_TEXT` children, several at the same child index under different parents |
| `ternary-asymmetric` | ternary `SHOW_IF` with branches of unequal length, in both directions |
| `create-show` | `createShow` with and without an else branch, twice over one condition |
| `list-same-source` | `createList` over the same source twice — `LIST` + `PROP`, array/item/prop slots |
| `nested-islands` | an island whose subtree contains another island, plus the same island again at page level |
| `unicode-emoji` | non-ASCII and emoji in text, static attrs and a signal default (UTF-8 length prefixes) |
| `jsx-page` | an **all-`.tsx`** app: entry, page, sibling sub-component and island, every one of them reaching the analyzer through esbuild's `export { X }` rewrite |
| `barrel-exports` | every component reached through an `index.ts` barrel: `export { X } from`, `export * from`, and `export { XImpl as X }` |
| `sub-component-scopes` | signals declared in the four scopes the old hand-written extractors did not look in, plus the same-name **collision** rule and a truthy `SHOW_IF` default |
| `eager-concat` | expressions evaluated EAGERLY — `'Player ' + name()` with no `() => …` wrapper — in **child** and **attribute** position, including a multi-operand concat mixing a string and a **number** |
| `imported-const-table` | Rule 9's spread unroll over tables declared in **another module** — inside a registered island, through an inert page↔island import cycle, and through a barrel that **aliases** the export |
| `imported-signal-defaults` | signal defaults declared in **another module** (the store.ts architecture): an href **ternary** folding an imported signal's `''` default into the attribute's SSR value, and page + island reading the same store signal — one through an **aliasing barrel** — sharing **one** slot |

### Why `eager-concat` exists

Every other case binds its dynamic values through a function, which is the one
shape the walker had a fold for. Real pages also write the value directly:
`h('span', null, 'Player ' + name())`. The walker understood neither position,
and degraded them *differently*:

* **Child position** fell through to `emitIsland`, so the element shipped as an
  empty island shell — nothing server-side until the bundle hydrated. It warned,
  at least.
* **Attribute position** hit the props catch-all, which minted `attr:<key>` with
  **no default and no diagnostic**. The attribute went out with no value and the
  build log was clean. That is what stripped the tooltips off ksx's controls for
  the entire life of that UI, and it is why this case exists on the Rust side
  rather than only in the JS suite: an empty-default slot is a perfectly
  well-formed slot, so nothing short of rendering it shows the hole.

The `@page defaults` section is the whole point. It must read `Player Xbox`,
`title="Enable Xbox"` and `title="Slot 3 ready"` — that last one also pins that
a NUMERIC signal survives concatenation as `3`. An evaluator that lost the type
renders `Slot [object Object] ready` or `Slot  ready`, both of which are
otherwise valid FMIR that every structural assertion in the suite accepts.

### Why `sub-component-scopes` exists

Every other case declares its signals where the old pre-pass happened to look:
the root component's body, or a registered island's file. Signal defaults were
gathered by a pass that enumerated scopes BY HAND, one method per shape, while
the WALK independently decided what got inlined — so each time the walk learned
to inline something new, the extractor had to be taught it separately, and when
it was not the failure was silent.

This case declares its signals in the four places nobody had written a method
for: the root page FILE's module scope, an inlined file-local sub-component's
body, an inlined cross-file sub-component's module scope, and below the top
level of a scope (inside an `if`). It also declares `count` twice, in two
different components, which is the collision the `#N` occurrence suffix
resolves.

The `@page defaults` render is what makes it a real check. Before the fix, that
section of the golden was four zero-width spaces, a missing `class`, a missing
boolean attribute, and — the one that does not repair itself — `<p class="off">`
for a `createShow` whose condition defaults to `true`. Hydration adopts that
wrong branch silently: both branches produce a `<p>`, the tags match,
`adoptNode` takes the server's element, and neither mismatch-repair arm fires
because both arms test "one side has content and the other does not". The page
stays wrong until the signal changes value.

### Why `imported-const-table` exists

`...CONST.map(item => h(…))` is the compiler's escape hatch for a large static
vocabulary: it expands at BUILD time into plain markup, which is what makes a
122-option `<select>` affordable on a page that has twenty-five of them and
must still work with JavaScript off.

Every other case that uses it declares the table in the module being walked.
That was the only place the unroll could see one: `fileConstants` is
re-extracted per resolved file — correct, and precisely why an IMPORTED table
was invisible — so a spread over one degraded to an empty island shell. Nothing
server-side, nothing at all without JavaScript, and the build's only comment
was "use `createList` for runtime data" about a table that is as static as data
gets. ksx's map route hit it 34 times on one page, every one of them from a
`KEYS_*`/`FUNCTIONS` table its own page module declares.

The case reproduces that shape: `page.ts` declares the tables as bare `const` +
`export { … }` (the compile-time-twin form, neither `export const` nor a
re-export), the registered island `picker.ts` imports them back — an inert
cycle — and a third table arrives through a barrel that renames it
(`export { MOD_KEYS as MODIFIERS } from './modifiers'`). Rows are read in child
AND attribute position, and one row's value needs HTML escaping.

It is in `RESOLUTION_CASES` on the Rust side for the same reason `jsx-page` is:
the golden alone would not catch a relapse, because an island shell is a
perfectly valid module and `UPDATE_GOLDEN` would bless it. That assertion fails
on the minted `island_<n>` first.

### Why `imported-signal-defaults` exists

The store.ts architecture — signals declared in one module, read from pages
and islands — is the one Forma's own docs recommend, and the compiler could
not fold a single signal-backed binding across that file boundary: the scope
chain was built from each file's own program body, so an imported signal had
no binding, no named slot, and no SSR default. gatewasm measured 158 such
degradations across 17 files, including the login page's onboarding link
shipping with no `href` for months.

The case is that shape: `store.ts` declares two signals with literal defaults,
`page.ts` folds one into an href ternary's SSR default and reads the other
directly, and the registered island `badge.ts` reads the SAME signal through a
barrel that aliases it. The slot table having exactly one `status` slot is the
point — `status#2` is the one-signal-two-slots hazard, where name-addressed
injection reaches the page's copy and leaves the island's stale.

It is in `RESOLUTION_CASES` on the Rust side too: a relapse leaves the island
a valid empty shell and the href slot defaultless, both of which a regenerated
golden would bless without the island-and-slots assertion failing first.

### Why `jsx-page` and `barrel-exports` exist

These two are not new opcodes — they are new *ways of reaching* the compiler,
and the compiler could not follow either one. The lookup that answers "which
function does this module export under this name?" existed in three
disagreeing copies, and all three read only `ExportNamedDeclaration.declaration`.
That is the one form esbuild never emits: it rewrites every
`export function Card() {}` in a `.tsx` file into

```js
function Card() { … }
export { Card };
```

so **every** `.tsx` page compiled to placeholder IR — `<div id="app"></div>`,
no slots, no islands, no server-rendered content — while the build printed one
misleading line (`could not find return h() tree`) and exited 0. Barrels failed
the same way, silently.

The old corpus could not have caught it: all 22 fixture files were `.ts`, every
one used `export function`, and `.tsx` appeared in the suite only as a
hand-written filename label on already-transformed source. The extension is the
entire trigger — it is what makes the compiler run esbuild over the file at all
— so a fixture that is not really on disk with that extension tests nothing.

`crates/forma-ir/tests/js_emitter_contract.rs` gives these two cases an extra
assertion (`resolution_cases_ship_named_islands_over_named_slots`): the islands
must carry their real component names rather than a minted `island_<n>`, must
carry non-empty slot ids, and the page must have slots named after its signals
carrying their defaults. The golden alone would not catch a relapse — a
degraded emit is still a valid, walkable module, and `UPDATE_GOLDEN` would
happily bless the empty div.

## What the consumer side asserts

`crates/forma-ir/tests/js_emitter_contract.rs` in the `forma` repo reads each
`.ir` and requires: `IrModule::parse` succeeds, slot **names** and slot **ids**
are each pairwise unique, `walk_to_html` succeeds, `walk_island` succeeds for
every island entry and returns a root carrying `data-forma-island`, and the
rendered HTML matches a committed golden.

The golden is four page renders plus one fragment per island, because uniform
slot data hides binding mix-ups:

| Section | Slot data | What it pins |
| --- | --- | --- |
| `page bools=true` | every Text slot a marker naming itself, every list 3 rows of named columns, Bools true | slot → output wiring; a swapped slot id changes the marker |
| `page bools=false` | same, Bools false | the OTHER side of every `SHOW_IF`, and boolean attrs when off |
| `page text-empty` | every Text slot `""` | empty is `attr=""`, not an omitted attribute |
| `page defaults` | `SlotData::new_from_defaults` | the slot table's own `default_bytes`, and Null → attribute omitted |

## Regenerating

```sh
npm run emit:corpus                    # writes packages/compiler/ir-corpus/*.ir
npm run emit:corpus -- <out-dir>       # or to a directory of your choosing
```

The `.ir` files and their golden HTML are committed in the `forma` repo under
`crates/forma-ir/tests/fixtures/js-emitter/`. After an intentional emitter
change, re-emit here, copy the `.ir` files over, and regenerate the goldens
with `UPDATE_GOLDEN=1 cargo test -p forma-ir --test js_emitter_contract`.

The `fmir-contract` job in this repo's CI does the same thing on every PR — it
checks out `forma`, emits the corpus over its committed fixtures, runs that
test, and fails if either the render or the bytes moved. So a compiler change
that makes FMIR unreadable fails the COMPILER's build, not just the consumer's.
