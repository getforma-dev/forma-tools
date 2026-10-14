# Changelog

## [Unreleased]

## [0.3.0] - 2026-10-14

Consolidated from the local, unpublished builds Ledger vendors as `0.2.1-ledger.1`, `0.2.2-ledger.1` and `0.2.2-ledger.2` (checkpoint `205b612`), plus the fixes made while preparing this release. None of those labels was published; the version is set at release.

### Changed
- **Config validation rejects two `entryPoints` that share an `outfile`.** A config that built under 0.2.0 now fails: both bundles were written to one file, and the route served whichever finished last.

### Fixed
- **Production workers delete and read only Forma caches.** Activation deleted every cache on the origin except the worker's own, including other applications', and lookups matched requests against all of them. The worker now reads only its own cache and deletes only caches named `forma-*` other than its own; caches named otherwise survive. Every worker mode still deletes all `forma-*` caches but its own, so Forma applications sharing an origin, which share that prefix, still delete each other's caches; per-application cache names are not part of this release. Content-hashed assets stay cache-first.
- **The default (precache) worker answers before it saves.** A fetched asset is returned at once and written to the cache in the background; a failed write, such as a quota error, is ignored, and when CacheStorage itself fails the worker answers from the network.
- **Development workers (watch mode) are network-only.** They bypass CacheStorage and the HTTP cache for stable asset URLs, take over from an old cache-first worker, and delete every `forma-*` cache, so rebuilt CSS and JavaScript appear on reload.
- Generated workers intercept only same-origin `GET` requests; cross-origin requests and writes pass through untouched.
- **A route without `css` (or `js`) fails with a message naming the route.** A JavaScript config, or TypeScript run without a type check, could omit either list, and validation threw `TypeError: mapping.css is not iterable`, naming neither the route nor the key. It now reports, for example, `routes['/'].css is missing: list the route's CSS base names, or [] for none`; a string in place of the list is reported as `not an array` rather than read letter by letter. Validation still runs before the output directory is touched.

### Added
- Opt-in `codeSplitting` builds one shared ESM graph, retains native dynamic imports, and preserves esbuild's linked content hashes. Chunks are compressed and included in the asset manifest without renaming their import targets.
- Routes expose static-only `modulepreload` dependencies and count those dependencies in byte budgets. Lazy chunks are excluded from initial preload and budget totals.
- `BuildEntry.ssr: false` keeps one entry browser-only in an otherwise SSR application. Split watch mode refreshes graph manifests and removes obsolete emitted chunks.
- Optional `serviceWorker: 'on-demand'` installs without downloading assets, so deferred tools remain deferred and installation does not compete with first paint. The option accepts only `'precache'` (the default) and `'on-demand'`; any other value is a config error naming it, for example `serviceWorker is 'ondemand': use 'precache' (the default) or 'on-demand'`.
- On-demand caching is restricted to exact content-hashed manifest JS/CSS/WASM URLs and successful, non-redirected immutable asset responses. Navigations, APIs, query URLs, private/no-store responses and unknown asset paths are excluded.
- CacheStorage and quota failures no longer turn a successful asset request into a failed page load in on-demand mode. Precache remains the default; watch mode remains network-only.
- Tests: generated-worker unit coverage (cache scoping, development takeover, on-demand eligibility, storage failures in both production modes); code-splitting builds (multi-entry singleton and dynamic import, linked invalidation, mixed SSR, server-inlined copies, watched graph, the on-demand allowlist); config validation for missing route lists, duplicate outfiles and the `serviceWorker` value; and a controlled-browser upgrade and rebuild regression, `npm run test:browser -w packages/build`.

## [0.2.0] - 2026-08-06

### Removed
- **Breaking: the generated island registry (`<page>.islands.js`) is gone.** It could not work in any configuration and every consumer had to delete it by hand. It was written *after* the esbuild pass, so it shipped unbundled with a bare `import { activateIslands } from '@getforma/core'` no browser can resolve; it imported the page component as `'../<entry>'` — a source path, relative to the *output* directory, that resolves from nowhere; and it mapped every island name to the page ROOT component, which is the clobber pattern the islands protocol exists to avoid. It was then hashed, brotli+gzip compressed and registered in `manifest.json`, so it reached production bundles as dead weight. The registry was redundant by construction as well as broken: the compiler only knows an island exists *because* the entry point already calls `activateIslands({ ... })` with the real components, so the user's own bundle registers exactly the right set. Nothing replaces it — delete any scrubbing step you added.
- **`<page>.islands.json` is no longer written** (from `@getforma/compiler`, whose SSR plugin emitted it). It was build metadata deposited in the *served* asset directory, its only consumer was the island registry above, and it was not hashed — so it lingered in `outputDir` and got embedded verbatim by asset-embedding servers. The island table it duplicated is inside the `.ir` binary, and `generateRealIr()` returns it to programmatic callers.

### Fixed
- **WASM builds work when `wasm-pack` is an npm shim on Windows.** The tool was spawned with `execFileSync` and no shell, which CreateProcess cannot use to run a `.cmd` — the same defect as the 0.1.9 tailwind/`npx` fix. The failure was silent: the ENOENT was caught by the same `catch` as the version probe and reported as "wasm-pack not found — skipping WASM build", so a Windows build quietly shipped no WASM.
- **A wasm-pack *compile* failure is no longer reported as "wasm-pack not found".** The version probe and the build are separate now: a missing tool still skips the step with a warning, while a build failure propagates. A run that reports success but produces no `forma_ir_bg.wasm` fails with the path it expected.

### Added
- **Config validation before the output directory is touched.** Two silent misconfigurations are now build errors: an `outfile` containing a path separator (esbuild wrote it into a subdirectory the hashing pass never reads, so the asset vanished from the manifest and its route 404'd in production), and a route naming a JS/CSS base that no entry produces (a typo that surfaced as a missing `<script>` on a deployed page). Validation runs *before* the clean, so a config error no longer destroys the previous build's output.

### Changed
- Test suite reassessed: the ten "exports X type" tests asserted fields of object literals they had just written — vitest strips types without checking them, so they passed with `build.ts` deleted. They are replaced by one two-sided export-surface test plus real coverage for `serverInlined`, budget warnings, SSR `.ir` wiring (single and multi-route), the WASM path, and config validation. 17 tests → 15, of which 15 can fail.

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
