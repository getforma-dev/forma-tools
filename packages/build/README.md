# @getforma/build

[![npm](https://img.shields.io/npm/v/@getforma/build)](https://www.npmjs.com/package/@getforma/build)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Production build pipeline for [FormaJS](https://github.com/getforma-dev/formajs) applications. Handles esbuild bundling, CSS generation, content hashing, Brotli/gzip compression, asset manifest generation, SSR IR emission, and WASM compilation — all from a single config.

**This replaces writing your own build script.** If you're using Vite for development and need a production pipeline with content hashing and SSR, this is the tool.

## Install

```bash
npm install -D @getforma/build
```

This automatically installs `@getforma/compiler` and `esbuild`.

## Quick Start

```ts
// build.ts
import { build } from "@getforma/build";

await build({
  entryPoints: [
    { entry: "src/app.tsx", outfile: "app.js" },
  ],
  routes: {
    "/": { js: ["app.js"], css: ["app.css"] },
  },
  outputDir: "dist",
});
```

```bash
npx tsx build.ts
```

This bundles your app with esbuild, applies the FormaJS compiler transforms, content-hashes all assets, generates Brotli + gzip compressed versions, and writes an asset manifest.

## What It Does

| Step | What happens |
|------|-------------|
| **Bundle** | esbuild bundles each entry point with JSX transform (`jsxFactory: "h"`) |
| **Compile** | `@getforma/compiler` transforms `h()` calls to `template()` + `cloneNode()` |
| **CSS** | Runs Tailwind CLI or concatenates CSS files |
| **Hash** | SHA-256 content hash appended to filenames (`app.a1b2c3d4.js`) |
| **Compress** | Brotli (level 11) + gzip (level 9) for `.js` and `.css` |
| **Manifest** | Writes `manifest.json` mapping source filenames → hashed filenames |
| **SSR** | (Optional) Emits FMIR binary for Rust server-side rendering |
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
    "/": { js: ["home.js"], css: ["home.css"] },
    "/dashboard": { js: ["dashboard.js"], css: ["dashboard.css"] },
  },
  outputDir: "dist",

  // Optional
  cssEntries: [
    { type: "tailwind", input: "src/app.css", output: "app.css" },
  ],
  fontDir: "src/fonts",              // Copy .woff2 files to dist
  ssr: true,                          // Enable FMIR emission
  ssrEntryPoints: {
    home: "src/home/HomeIsland.tsx",
    dashboard: "src/dashboard/DashboardIsland.tsx",
  },
  wasm: { crateDir: "../crates/forma-ir" },  // Build WASM walker
  budgetThreshold: 200_000,           // Warn at 200KB brotli per route
  formaAlias: "./node_modules/@getforma/core/dist/index.js",
  serverInlined: ["sw.js"],           // Files to keep unhashed copies of
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
├── inter.woff2                # Copied fonts
├── sw.js                      # Service worker (unhashed copy)
├── manifest.json              # Asset manifest
└── manifest.json.br
```

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
| Includes compiler? | — | Yes (dependency) |
| Content hashing | No | Yes |
| Compression | No | Yes (Brotli + gzip) |
| Manifest | No | Yes |
| SSR IR emission | Plugin only | Integrated |
| Install separately? | Yes | Yes (pulls in compiler) |

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
