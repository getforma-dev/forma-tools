# Changelog

## [Unreleased]

### Changed
- **Watch builds with `ssr: true` now give Phase 2 rendering in development.** Without `codeSplitting` (the default) the dev manifest named no `.ir`, so `forma-server` rendered each page client-side (Phase 1); it now names each page's module, and the server renders the page as production does. `forma-server` loads the modules when the application starts, so until it restarts it serves the module it loaded, under the rebuilt bundle: restart it on a change under `outputDir`. FORMA-166 tracks the server half.
- **Release and CI install with `npm ci` (DR-32, FORMA-010; the package is unchanged).** `release.yml`, `ci.yml` and `compat.yml` install exactly what `package-lock.json` records instead of running `npm install`; `compat.yml` still installs the newest `@getforma/core` on top, deliberately. Each `uses:` names the commit its tag or branch pointed to on 2026-10-14, with the ref in a comment, and every CI job declares `contents: read`; `release.yml` keeps its workflow-level `contents: read` and `id-token: write`.
- **Only the release's publish job can mint the publish credential (SR43, L-34, L-42, FORMA-134; the package is unchanged).** `release.yml` splits into `test`, `pack` and `publish`. Tests and builds run in jobs without `id-token: write`; `pack` restores no cache, packs the tagged package with `npm pack --ignore-scripts` and records its SHA-256; `publish`, the only job holding `id-token: write`, restores no cache and installs nothing, checks the downloaded tarball against that record (whose own hash travels as a job output) and runs `npm publish <tarball> --provenance --access public --ignore-scripts`. A `build-v*` release now also runs the compiler's suite, as CI does. The tags stay the only trigger. CI's new `release-workflow` job runs actionlint (binary checked against a pinned SHA-256), `scripts/check-release-workflow.rb --self-test` and `scripts/test-release-artifacts.sh`.

### Fixed
- **Watch mode keeps server-rendered pages' FMIR modules current (N7, L-31).** Watch mode rebuilt the bundles but, without `codeSplitting`, wrote no `.ir` at all and the dev manifest named none, so a page the server renders never changed on an incremental rebuild (v1 6.4). With `codeSplitting`, every page's module was re-emitted on every browser rebuild, written in place, and never re-emitted for an edit to an SSR entry the browser bundle does not import. Now each server-rendered page gets its own esbuild watcher over its SSR entry (`ssrEntryPoints`, else the browser entry; packages external, nothing written), so an edit re-runs the compiler for exactly the pages whose module graph it touches. The module is published as `<page>.ir` by rename, only when its bytes changed, and the dev manifest names it in the route's `ir`. A page with an esbuild error (a syntax error, an import that does not resolve) keeps its last good module and logs the first error; a compiler emission failure writes the compiler's placeholder module, as a production build does. A module that cannot be published (a file Windows will not release, a full disk) is logged with its page; the page watchers print nothing through esbuild, so this was silent. Each rewrite logs its time (`IR rewritten: home.ir in 36 ms`); those times join the per-build report when it exists (DR-34, FORMA-118). Measured on an Apple M1 Pro, Node 22, 20 pages, 20 edits to a component one page renders: from the file write to the new `.ir` on disk p50 63 ms and max 200 ms without code splitting, p50 40 ms and max 144 ms with it; the other 19 pages were not re-emitted. The server must reread the module: `forma-server` loads modules at startup, so restart it on a change under `outputDir` (see the README). Tests: `tests/watch-ir.test.ts` > "rewrites a page's .ir when a component it renders changes, and no other page's" (failed before this change: the dev manifest named no `.ir`) "rewrites a page's .ir when only its SSR entry changes, in a code-splitting build" (failed before this change: the module kept its first content) and "logs a page's module it could not publish, naming the page, and recovers".
- **A build that fails part way leaves the previous output exactly as it was (L-21).** The build emptied `outputDir` first and then wrote into it step by step, so a failure in a late step (a wasm-pack compile error, a Tailwind error, a disk-full write) left the last good build deleted and part of the new one in its place, and an application that embeds `outputDir` then shipped half a build. A production build now writes into a staging directory beside `outputDir` (`.<name>.forma-staging-<pid>-<hex>`, on the same filesystem) and swaps it in only when every step has succeeded; on failure the staging directory is removed and `outputDir` is untouched, byte for byte. The swap is two renames (no platform renames a directory over a non-empty one); if the second fails, the first is undone. On Windows a rename refused because another process holds a handle (EPERM, EACCES, EBUSY: a virus scanner, the indexer, an editor) is retried for up to 5 s before the build fails, with `outputDir` restored. An `outputDir` that is a mount point (EBUSY or EXDEV on the rename, such as a container volume) has its contents replaced in place instead, with a warning, since the build being swapped in is already complete; if that copy fails, the error says `outputDir` may be partial. Staging directories left by a killed build are removed by the next one, except a previous output: a build that stops between the swap's two renames (a Ctrl-C during a Windows retry) leaves no `outputDir` and the last good build beside it, so the next build first moves that back (the newest, if several) and says so. A swap that can neither move the new build in nor restore the previous one names where the previous one is, and the next build moves it back. Validation still runs before anything is written. Watch mode still writes in place. Tests: `tests/build.test.ts` > "leaves the previous build byte-identical when a build fails after writing files" (failed before this change: the output held the failed build's unhashed `app.js` and `main.css`), "a failed first build leaves no output directory and nothing beside it", "a successful build replaces the previous output whole"; `tests/output.test.ts` (the swap's failure paths, with an injected failing rename or copy), among them "puts back the previous output a build killed between its two renames left aside, the newest if several", "names where the previous output is when it cannot be put back either, and the next build puts it back" and "says the output may be partial when a mount point's copy fails".
- **Watch mode replaces `manifest.json` and `sw.js` by rename instead of rewriting them in place.** A reader between the truncate and the write saw an empty or partial file: with a code-splitting watch build of 41 entries, a reader polling `manifest.json` through 51 rebuilds failed to parse it 13 to 20 times per run before this change, and 0 times after. This was the intermittent failure of the test "updates the watched graph and removes obsolete chunks instead of accumulating them", which also now waits for the manifest state it asserts rather than reading once after a chunk appears on disk. Test: `tests/code-splitting.test.ts` > "replaces the watched manifest by rename, so a reader never sees half of it".

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
