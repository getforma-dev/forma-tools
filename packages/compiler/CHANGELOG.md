# Changelog

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
