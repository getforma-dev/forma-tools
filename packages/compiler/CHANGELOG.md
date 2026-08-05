# Changelog

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
