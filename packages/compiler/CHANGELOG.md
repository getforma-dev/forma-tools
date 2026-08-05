# Changelog

## [Unreleased]

### Fixed
- **Duplicate `attr:` and `text:` slot names on any page that binds the same attribute key twice, or has two dynamic text children at the same child index** — the per-page `#n` occurrence registry introduced for list and show slots was never extended to the other two slot-name families. `h('div', { id: () => a() }, h('span', { id: () => b() }))` emitted two slots both named `attr:id`; two sibling `<span>`s each with a single dynamic text child emitted two slots both named `text:0`. The Rust loader builds `name_to_slot: HashMap<String, u16>` by inserting every name (`forma-ir/src/slot.rs`), so duplicates collapse last-insert-wins and the earlier slot becomes permanently unreachable for server-side `SlotData` injection — silently, with no build error. `attr:` and `text:` now run the same page-wide occurrence registry as list and show, created eagerly on the root walk context and shared by reference into island subtrees, inlined sub-components, list bodies and show branches. First occurrence keeps its exact former spelling (`attr:id`, `text:0`); later ones get `#2`, `#3`. See the migration note in the README — server code that injected a duplicated key was addressing the LAST occurrence and must now use the suffixed key for it.
- **Duplicate slot names when the first list/show sat inside a nested walk context** — the per-page list/show name registries were created lazily on the *current* context, but island subtrees, inlined sub-components, and list bodies walk spread copies of it. If the first `createList`/`createShow` for a given base name lived inside such a copy, the registry died with the copy and a later sibling recreated it, minting duplicate names (`list:todos:array` twice, `show:visible` twice) that collapse in the Rust name→id map (last-insert-wins) — and the outcome was document-order dependent. Registries are now created eagerly on the root walk context and normalized at the walk entry points, so suffixes (`#2`, ...) are page-wide in document order regardless of nesting.
- **Island slot-capture stack now stays balanced when an island subtree walk throws** — a resolution failure mid-walk used to leak the capture set, making an enclosing island record the failed inner island's (wrong) slot ids.
- **Per-item list scratch slots (`list:<base>:item`) are excluded from island `slot_ids`** — they hold the LAST rendered row after SSR, so serializing them into `data-forma-props` leaked that row into the page. All other families (named signals, `attr:*`, `text:*`, `show:*`, `list:*:array`, `list:*:<prop>`) are still captured; the key-space contract is documented in the README.
- **`export const` declarations are now visible to module-level extraction** — string-constant folding, file-constant arrays (Rule 9 unroll), and module-level island `createSignal` defaults previously only saw bare `const` statements and silently ignored exported ones.
- **Island signal-default conflict warnings name the actual declarer** — merging is first-wins, so the kept default may come from an *earlier island* rather than the root; the warning previously always credited the root.
- **Island signal defaults merge on the inline mount path** — entries using a block-body `mount(() => { ... return h(...); })` plus `activateIslands({...})` never merged island signals (and never populated island names at all); the `activateIslands` registry is now scanned on every entry-point pattern and the merge is shared between the named and inline paths.
- **Sub-component constant re-extraction falls back to empty maps on parse failure** — it previously fell back to the *parent* file's constants, resolving the child's identifiers against the wrong module scope.
- **`function` expressions derive binding names** — `createShow(function () { return visible(); }, ...)` now yields `show:visible` (previously silently positional); block-body arrows unwrap too. Applies to list sources as well.
- **Module consts shadowed in any nested scope are no longer folded** — a component-local `const cls = computeClass()` shadowing a module `const cls = 'icon'` used to bake the module value into a static attribute with no slot, unrecoverable client-side. Shadowed names now take the correctable dynamic-attribute path with the existing build warning. The check is deliberately over-conservative (any nested declaration or parameter of the same name suppresses folding).
- **64KB string guards** — a folded const over 65535 UTF-8 bytes is dropped from folding with a warning (FMIR string-table entries have a u16 length prefix), and the binary emitter now throws a descriptive error instead of silently wrapping the length and corrupting the string/slot tables; `generateRealIr` catches that and falls back to no-IR with a warning.

### Changed
- **Breaking: show slots now get condition-derived names** — every `createShow` previously emitted a slot literally named `show:createShow` (and ternary conditionals `show:<index>`), so at most one show per page was addressable by name. Shows now use the same naming scheme as lists: the base derives from the condition (`createShow(() => visible(), ...)` → `show:visible`; arrows, calls, member access, and `!`-negation unwrap), with a positional fallback (`show:#2`) and per-base `#n` occurrence suffixes in document order (first occurrence unsuffixed).
- **List slot names for literal sources now use the map parameter** — when the data source has no derivable name (e.g. `createList(() => [], ...)`), the map function's first parameter names the list (`(tile) => ...` → `list:tile:array`) instead of the positional `list:#N:array`; the positional fallback remains for `_`/unnamed params.
- **Migration**: server code injecting `"show:createShow"` must switch to the name-keyed scheme (`"show:visible"`); literal-source list keys change from `"list:#N:array"` to map-param-derived where a named param exists. Slot names are visible in the emitted `.ir` string table; unknown keys are silently ignored by `forma_ir::SlotData::from_json`, so stale keys fail soft — check names after upgrading.
- Sub-component and island subtrees now resolve file-level constants against their **own** module scope (re-extracted from the resolved source) instead of the root file's constants.

### Removed
- **`emitIr` is no longer exported** — it and its private `emitNode` helper were a second, divergent AST→opcode implementation with no consumer anywhere in this repo or the downstream ones: the real pipeline has always gone through `walkHTree`/`walkCallExpression`. `emitNode` predated the slot-name occurrency registries entirely (it minted raw `attr:<key>` / `text:<i>` names) and understood none of createShow, createList, islands, Fragments or sub-component resolution, so anything that had adopted it would have produced subtly wrong IR. Use `generateRealIr` (or `walkHTree` with an `IrEmitContext`) instead. `IrEmitContext` itself is unchanged and still exported.

### Added
- **Island table entries now carry real `slot_ids`** — every slot referenced inside an island's SSR span (dynamic attrs, signal-bound text, list slots, reused page-level signal slots, nested islands) is captured and written to the island table, which was previously always empty. The `forma-ir` Rust walker skips props emission for islands with empty `slot_ids`, so with this populated it natively emits `data-forma-props` and the `__forma_islands` script block — consumers hand-emitting that script block server-side can migrate to the native path.
- **Signal defaults are extracted from island component files** — both module-level `createSignal` declarations and declarations at the top of the exported island function. Module-level declaration in the island file is now the recommended single-source pattern; Page twin declarations are no longer required. Merging is first-wins (root Page authoritative); a conflicting default warns at build time.
- **Module-level string constants fold into static attributes** — a top-level `const` initialized with a string literal, expression-less template literal, `+` concatenation chain, or reference to an earlier string const resolves at compile time when used as an attribute value (`d: ICON_PATH` → static attr, no slot), and folds inside function-valued props when computing SSR defaults.
- **Build warning for statically unresolvable identifier attributes** — an attribute value that is a bare identifier or member expression the compiler cannot resolve now warns at build time instead of silently rendering the attribute empty in SSR.

## [0.2.0] - 2026-08-05

### Changed
- **Breaking: list slots now get unique, per-list names** — previously every `createList` emitted slots named `list:array` / `list:item` / `list:<prop>`, so on pages with more than one list only the first was reachable by name and server-side `SlotData` injection could not target the others. Each list now derives a base name from its data source (`createList(todos, ...)` → `todos`; arrows, calls, and member access unwrap to the underlying name), deduped per page with `#n` suffixes and a positional fallback (`#3`) when no name is derivable. Slots are emitted as `list:<base>:array`, `list:<base>:item`, and `list:<base>:<prop>`.
- **Migration**: server code injecting `"list:array"` must switch to the named key, e.g. `"list:todos:array"`. Slot names are visible in the emitted `.ir` string table; unknown keys are silently ignored by `forma_ir::SlotData::from_json`, so stale keys fail soft — check names after upgrading.

## [0.1.5] - 2026-03-16

### Added
- Contract tests (8 tests) verifying compiler-generated imports exist in @getforma/core
- Server transform import path explicitly tested — asserts `from "formajs/server"` not `from "formajs"`
- Weekly CI compat check workflow — verifies imports against latest @getforma/core every Monday

### Changed
- Extracted shared helpers (`isEventProp`, `isStaticLiteral`, `isUndefinedIdentifier`, `VOID_TAGS`) into `utils.ts` — eliminates 4x code duplication across transform.ts, ir-emit.ts, ir-walk.ts, ir-analyze.ts
- Added `engines: { node: ">=18" }` to package.json

## [0.1.4] - 2026-03-16

### Changed
- Stack table in README uses Frontend/Backend/Full Framework split with links

## [0.1.3] - 2026-03-16

### Changed
- Server transform generates imports from `"formajs/server"` instead of `"formajs"`
- README added with full documentation

## [0.1.2] - 2026-03-15

### Fixed
- Replaced collision-prone hashEndpoint with FNV-1a (32-bit)
- Concurrent SSR safety: module-level mutable counters moved to per-call scope
