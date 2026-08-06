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

## What It Does

| Step | What happens |
|------|-------------|
| **Validate** | Rejects an `outfile` that is a path, or a route naming an asset no entry produces, before touching `outputDir` |
| **Bundle** | esbuild bundles each entry point with JSX transform (`jsxFactory: "h"`) |
| **CSS** | Runs Tailwind CLI or concatenates CSS files |
| **Hash** | SHA-256 content hash appended to filenames (`app.a1b2c3d4.js`) |
| **Compress** | Brotli (level 11) + gzip (level 9) for `.js` and `.css` |
| **Manifest** | Writes `manifest.json` mapping source filenames → hashed filenames |
| **SSR** | (Optional) Emits one `<page>.ir` FMIR binary per entry for Rust server-side rendering |
| **WASM** | (Optional) Runs `wasm-pack build` for the Rust IR walker |
| **Budget** | Warns if route brotli size exceeds threshold (default 200KB) |

## Configuration

```ts
import { build, type BuildConfig } from "@getforma/build";

const config: BuildConfig = {
  // Required
  entryPoints: [
    { entry: "src/home/app.tsx", outfile: "home.js" },
    { entry: "src/dashboard/app.tsx", outfile: "dashboard.js" },
  ],
  routes: {
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
  wasm: { crateDir: "../crates/forma-ir" },  // Build WASM walker
  watch: false,                       // Rebuild on change; writes a dev manifest
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
├── forma_ir.q7r8s9t0.js      # WASM loader (if wasm configured)
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
