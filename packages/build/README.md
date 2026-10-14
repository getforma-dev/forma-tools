# @getforma/build

[![npm](https://img.shields.io/npm/v/@getforma/build)](https://www.npmjs.com/package/@getforma/build)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Production build pipeline for [FormaJS](https://github.com/getforma-dev/formajs) applications. Handles esbuild bundling, CSS generation, content hashing, Brotli/gzip compression, asset manifest generation, SSR IR emission, and WASM compilation — all from a single config.

**This replaces writing your own build script.** If you're using Vite for development and need a production pipeline with content hashing and SSR, this is the tool.

## Install

```bash
npm install -D @getforma/build
```

This installs `esbuild` automatically. For SSR features (FMIR emission), also install the compiler:

```bash
npm install -D @getforma/compiler
```

## Quick Start

```ts
// build.ts
import { build } from "@getforma/build";

await build({
  entryPoints: [
    { entry: "src/app.tsx", outfile: "app.js" },
  ],
  routes: {
    "/": { js: ["app"], css: ["app"] },
  },
  outputDir: "dist",
});
```

```bash
npx tsx build.ts
```

This bundles your app with esbuild, content-hashes all assets, generates Brotli + gzip compressed versions, and writes an asset manifest.

### Optional shared ESM graph

Set `codeSplitting: true` to share one runtime across entries and preserve native
`import()` boundaries. Split JavaScript keeps esbuild's linked graph filenames
(`page.ABC12345.js`, `chunk.DEF67890.js`); do not rename those files afterward.
`manifest.assets` includes entries and chunks, while each route's `modulepreload`
contains only transitive static imports. Servers can preload those files without
fetching lazy tools. `total_size_br` includes static dependencies but not deferred
imports. Servers with legacy lowercase-hex hash detection should allow immutable
caching for these exact manifest-listed production files; development stays
network-only. `serverInlined` copies retain valid relative imports but are not
standalone scripts, so split ESM should normally be served as external modules.

With `ssr: true`, an entry can set `ssr: false` to keep only that route browser-only.
Watch builds keep stable entry URLs, regenerate chunk mappings, and remove old
successful-graph chunks after rebuilding instead of accumulating them on disk.

### Optional on-demand asset caching

Set `serviceWorker: 'on-demand'` to generate a worker that downloads nothing on
installation and caches eligible static assets only when the app requests them.
This preserves lazy imports and avoids cache warmup competing with first paint.
It accepts only exact content-hashed JS/CSS/WASM files from the build manifest,
with successful, non-redirected immutable asset responses. HTML, APIs, query
URLs, unknown assets and private/no-store responses never enter this cache.
CacheStorage denial and quota errors do not block successful network responses.
The worker is still registered by the application; generation does not register
it automatically. Unhashed fonts use the browser HTTP cache. The default remains
`serviceWorker: 'precache'`, and watch mode always uses the network-only worker.
Any other `serviceWorker` value is a config error.

### Per-application workers (`app`)

Name the application, with the same string its server passes to forma-server
0.2.2's `sw::ServiceWorker::for_app`:

```ts
await build({ ...config, app: 'ledger', serviceWorker: 'on-demand' });
```

```rust
forma_server::sw::configure(forma_server::sw::ServiceWorker::for_app("ledger")?.enabled())?;
```

With `app`, the production worker (either mode) follows forma-server's
cache-name contract (FORMA-130, DR-25):

- its cache is `forma:<app>:<build>`, `<build>` being the first 12 hex digits of
  the build hash, so each application and each build has its own;
- on activation it deletes only Forma's v1 cache names (`forma-dev`, `forma-`
  and 12 hex, either with `-on-demand-v1`) and its own application's older
  caches, never another application's (`forma:<other>:…`) or anything else;
- it never skips waiting and claims no page: a new build's worker waits until
  no tab uses the previous build's (a reload alone does not end that), so an
  open tab keeps its cache; it then deletes the previous build's cache.

`app` is 1 to 63 of `a-z`, `0-9` and `-`, starting with a letter or digit;
anything else is a config error naming it. forma-server serves this worker only
to an application that enables it; otherwise `/sw.js` is forma-server's
retiring worker, which deletes the same caches and unregisters. Without `app`,
the worker is 0.3.0's (shared `forma-` names, immediate takeover), kept for a
server not yet on forma-server 0.2.2; setting `serviceWorker` without `app` is
deprecated and warns once per build (`BUILD-802`), because from 3.0.0 a worker
is written only for a named `app`. The development worker ignores `app`.

## What It Does

| Step | What happens |
|------|-------------|
| **Validate** | Rejects an unknown `serviceWorker` value, an `app` name forma-server cannot take, two entries sharing an `outfile`, an `outfile` that is a path, a route naming an asset no entry produces, or a route missing its `js` or `css` list, before touching `outputDir` |
| **Bundle** | esbuild bundles each entry point with JSX transform (`jsxFactory: "h"`) |
| **CSS** | Runs Tailwind CLI or concatenates CSS files |
| **Hash** | SHA-256 content hash appended to filenames (`app.a1b2c3d4.js`) |
| **Compress** | Brotli (level 11) + gzip (level 9) for `.js` and `.css` |
| **Manifest** | Writes `manifest.json` mapping source filenames → hashed filenames |
| **SSR** | (Optional) Emits one `<page>.ir` FMIR binary per entry for Rust server-side rendering |
| **WASM** | (Optional, deprecated: removed in 3.0.0) Runs `wasm-pack build` for the Rust IR walker. A config that sets `wasm` warns `BUILD-803` once per build, and the step warns `BUILD-804` when it runs |
| **Budget** | Warns if route brotli size exceeds threshold (default 200KB) |
| **Swap in** | A production build writes all of the above into a staging directory beside `outputDir` (`.<name>.forma-staging-…`) and swaps it in only when every step has succeeded: a build that fails part way leaves `outputDir` exactly as the last good build left it, so the application never embeds half a build. Watch mode writes in place and replaces `manifest.json` and `sw.js` by rename, so a server reading them mid-rebuild never sees half a file |

## Configuration

```ts
import { build, type BuildConfig } from "@getforma/build";

const config: BuildConfig = {
  // Required
  entryPoints: [
    { entry: "src/home/app.tsx", outfile: "home.js" },
    { entry: "src/dashboard/app.tsx", outfile: "dashboard.js" },
  ],
  routes: {                          // each route needs both js and css; [] for none
    "/": { js: ["home"], css: ["home"] },
    "/dashboard": { js: ["dashboard"], css: ["dashboard"] },
  },
  outputDir: "dist",

  // Optional
  cssEntries: [
    // Tailwind: runs @tailwindcss/cli on the first input
    { input: "src/app.css", outfile: "app.css", tailwind: true },
    // Otherwise: concatenates the inputs in order
    { input: ["src/reset.css", "src/theme.css"], outfile: "dashboard.css" },
  ],
  fontDir: "src/fonts",              // Copy .woff2 files to dist
  ssr: true,                          // Enable FMIR emission
  ssrEntryPoints: {                   // page name (outfile minus .js) -> entry
    home: "src/home/app.tsx",         // the file with mount()/activateIslands()
    dashboard: "src/dashboard/app.tsx",
  },
  // strict: true,                   // Fail on every coded SSR diagnostic (or FORMA_STRICT=1); see below
  // diagnosticsJson: "ssr-diagnostics.json", // Also write them as JSON, outside outputDir
  wasm: { crateDir: "../crates/forma-ir" },  // Deprecated (removed in 3.0.0): build the WASM walker
  watch: false,                       // Rebuild on change; writes a dev manifest and, with ssr, each page's .ir
  budgetThreshold: 200_000,           // Warn at 200KB brotli per route
  formaAlias: "@getforma/core",       // What bare 'formajs' imports resolve to
  serverInlined: ["app.js"],          // Also keep the unhashed name on disk
};

await build(config);
```

## Output Structure

```
dist/
├── home.a1b2c3d4.js         # Content-hashed bundle
├── home.a1b2c3d4.js.br      # Brotli compressed
├── home.a1b2c3d4.js.gz      # Gzip compressed
├── home.e5f6g7h8.css
├── home.e5f6g7h8.css.br
├── dashboard.i9j0k1l2.js
├── home.m3n4o5p6.ir          # FMIR binary (if ssr: true)
├── forma_ir.q7r8s9t0.js      # WASM loader (if the deprecated wasm key is set)
├── forma_ir_bg.u1v2w3x4.wasm # WASM binary
├── inter.woff2                # Copied fonts (never hashed)
├── sw.js                      # Service worker (generated last, never hashed)
└── manifest.json              # Asset manifest (generated last, never compressed)
```

Nothing else is written. In particular an SSR build emits **only** `<page>.ir`
per entry: no island registry, no island metadata sidecar. (Through 0.1.9 it
also wrote `<page>.islands.js` and `<page>.islands.json`, which every consumer
had to delete by hand — see the CHANGELOG.)

## Asset Manifest

The manifest maps source filenames to content-hashed filenames:

```json
{
  "version": 1,
  "build_hash": "sha256-of-all-asset-names",
  "assets": {
    "home.js": "home.a1b2c3d4.js",
    "home.css": "home.e5f6g7h8.css",
    "home.ir": "home.m3n4o5p6.ir"
  },
  "routes": {
    "/": {
      "js": ["home.a1b2c3d4.js"],
      "css": ["home.e5f6g7h8.css"],
      "ir": "home.m3n4o5p6.ir",
      "total_size_br": 45230
    }
  }
}
```

The Rust server (`forma-server`) reads this manifest to serve assets with correct cache headers and resolve hashed filenames.

### Watch mode and server-rendered pages

With `ssr: true`, watch mode keeps each page's FMIR module current, so a page
the server renders changes on an incremental rebuild (N7). Each page is watched
over its own SSR entry's module graph (`ssrEntryPoints`, else its browser
entry), apart from the browser bundles: an edit re-runs the compiler for the
pages it touches and no others, including an SSR entry the browser bundle never
imports. A module is written as `<page>.ir`, replaced by rename and only when
its bytes change, and the dev manifest names it in the route's `ir`. A page
with an esbuild error (a syntax error, an import that does not resolve) keeps
its last good module and logs the error; when the compiler cannot emit a page's
module, it writes its placeholder, as a production build does. A module that
cannot be written is logged with its page. Each rewrite logs its time, for
example `IR rewritten: home.ir in 36 ms`.

The server must read the new module. `forma-server` loads the `.ir` modules
when the application starts (`load_ir_modules`), so restart it on a change
under `outputDir`, for example with `cargo watch`, until it rereads them in
development builds.

### SSR diagnostics and strict mode

Every construct the compiler cannot represent in a page's module is reported
with a stable code, file, line and column, one line of why and one of fix
([the catalogue](https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md),
one entry per code). By default they are warnings, printed as before, and the
build succeeds as before. `build()` returns them as `result.diagnostics`, each
with its `code`, `severity`, `page`, `file`, `line`, `column`, `message`, `why`
and `fix`.

- **Strict mode** (`strict: true`, or `FORMA_STRICT=1` in the environment
  when the config leaves `strict` unset) fails the build on every diagnostic
  but a note, after every page is compiled, with all of them at once:

  ```
  Error: @getforma/build --strict: 2 SSR diagnostics are errors (without --strict they are warnings):
  /app/src/home/app.tsx:12:11  BUILD-101  call expression helpers.extra(...) in /app/src/home/app.tsx:12:11 — emitted as an empty island shell, …
      why: The call becomes an anonymous island (`island_<n>`) that no registry names: …
      fix: Write the subtree as h() calls, a component in a relative file, …
  ```

  `build()` reads no command-line flag, as for `ssr` and `watch`: a build
  script that takes `--strict` maps it to the config.

  ```ts
  await build({ /* … */ ssr: isSsr, strict: process.argv.includes("--strict") });
  ```

  `strict: false` ignores `FORMA_STRICT`; a value of it other than `1`,
  `true`, `0`, `false` or empty is refused. A failed build leaves the previous
  output as it was. It needs `@getforma/compiler` 0.3.7 or later; with an older
  one the build refuses strict mode rather than pass pages it never checked. In
  watch mode a page with an error keeps its last good module and logs its
  first error. 3.0.0 makes strict the only mode.
- **JSON** (`diagnosticsJson: "<path>"`): the build writes
  `{ version, strict, diagnostics }` to that path, also when strict mode fails
  it. The path must be outside `outputDir`, which the build replaces whole and
  serves; one inside is refused before anything is written. A field may be
  added to the report without a change of `version`; renaming or removing one,
  or changing what one means, increments it.

A browser-only subtree is declared with `browserOnly()` from `@getforma/core`
(see the compiler's README); a route the server never renders, with
`ssr: false` on its entry.

### Development service worker

Watch builds emit a network-only worker for stable `/_assets/` URLs. It bypasses
both CacheStorage and the browser's HTTP cache, immediately activates, and
deletes every cache named `forma-*`; caches named otherwise are left alone.
Production builds keep content-hashed assets cache-first in the worker's own
cache. If CacheStorage fails they answer from the network, and a failed cache
write (a quota error, say) never fails the response.

Without `app`, every worker mode deletes all `forma-*` caches except its own,
so Forma applications that share an origin delete each other's caches. With
`app`, the production worker's caches are named per application and build
(`forma:<app>:<build>`) and it deletes only its own application's (see
"Per-application workers" above).

When upgrading a running development app from the old cache-first worker,
rebuild the frontend, restart any server that embeds build output, then reload
so `/sw.js` updates. Reload once more after the new worker takes control if the
first navigation started under the old controller. No cache-clearing workaround
is needed for subsequent rebuilds. A server must actually serve the new asset
bytes; this worker change does not restart Rust or watch CSS on its behalf.

Run the controlled-page regressions with `npm run test:browser -w packages/build`
from the workspace root: the development worker's takeover, and a
per-application worker through upgrade, rollback and upgrade with two tabs open. It uses installed Chrome when bundled Chromium is
unavailable, or the explicit `FORMA_BROWSER_CHANNEL` override.

## When Do You Need This?

| Scenario | Need @getforma/build? |
|----------|----------------------|
| Learning / prototyping | No — use Vite |
| Production with Vite only | No — Vite handles it |
| Production with content hashing + compression | Yes |
| Rust SSR with `forma-server` | Yes — emits FMIR + manifest |
| Multiple route entry points | Yes — handles multi-page builds |

## Compiler vs Build

| | `@getforma/compiler` | `@getforma/build` |
|---|---|---|
| What it is | Vite/esbuild plugins | Full build pipeline |
| Use case | Add to existing Vite config | Replace your build script |
| `h()` → `template()` transform | Yes (Vite plugin) | No — bundles your source as written |
| Content hashing | No | Yes |
| Compression | No | Yes (Brotli + gzip) |
| Manifest | No | Yes |
| SSR IR emission | Plugin only | Integrated (loads the compiler when `ssr: true`) |
| Install | On its own | Alongside the compiler if you need SSR (optional peer dependency) |

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | Vite plugin — h() optimization, server transforms, IR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | **This package** — bundling, hashing, compression, manifest |

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
