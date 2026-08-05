# Changelog

## [0.1.9] - 2026-08-05

### Fixed
- Tailwind CSS step no longer fails on Windows. `execFileSync('npx', ...)` cannot spawn the `npx.cmd` shim there — the build now resolves the locally installed `@tailwindcss/cli` and runs its entry script with the current Node executable (no shell on any platform, so paths with spaces are safe and nothing is exposed to shell injection). `npx` remains as a fallback for projects without a local install, spawned through a shell on Windows with quoted arguments.

### Added
- Functional test for the Tailwind CSS entry path (uses a fake locally installed `@tailwindcss/cli`, no network)

### Changed
- Optional `@getforma/compiler` peer range widened to `^0.1.0 || ^0.2.0`

## [0.1.5] - 2026-03-16

### Added
- 6 functional tests for the build pipeline (manifest structure, content hashing, compression, font copying, multi-entry, directory creation)
- Build failure cleanup — removes output directory if build fails and we created it

### Changed
- `@getforma/compiler` moved from `dependencies` to optional `peerDependencies` — non-SSR users no longer install Babel
- Added `engines: { node: ">=18" }` to package.json
- README route config examples fixed — routes expect base names without extension (`"app"` not `"app.js"`)

### Removed
- TODO comment from generated island registry code (was shipping in user output)

## [0.1.4] - 2026-03-16

### Changed
- Stack table in README uses Frontend/Backend/Full Framework split with links

## [0.1.3] - 2026-03-16

### Added
- README with full documentation

## [0.1.2] - 2026-03-15

### Fixed
- Build order in CI — compiler built before build package for DTS resolution
