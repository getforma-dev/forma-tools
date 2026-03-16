# forma-tools

[![CI](https://github.com/getforma-dev/forma-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma-tools/actions/workflows/ci.yml)

Build tooling for [FormaJS](https://github.com/getforma-dev/formajs) — the reactive DOM library with fine-grained signals.

**These tools are optional.** FormaJS works without them. Add them when you want faster rendering (compiled templates), server functions (`"use server"`), or the full Rust SSR pipeline.

## Packages

| Package | npm | What it does |
|---------|-----|-------------|
| [`@getforma/compiler`](packages/compiler) | [![npm](https://img.shields.io/npm/v/@getforma/compiler)](https://www.npmjs.com/package/@getforma/compiler) | Vite plugin that compiles `h()` → `template()` + `cloneNode()`. Server function transforms. esbuild SSR plugin for FMIR emission. |
| [`@getforma/build`](packages/build) | [![npm](https://img.shields.io/npm/v/@getforma/build)](https://www.npmjs.com/package/@getforma/build) | Production build pipeline — esbuild bundling, content hashing, Brotli/gzip compression, asset manifest, SSR IR emission. |

## When Do You Need These?

| You want to... | Install |
|----------------|---------|
| Use FormaJS with Vite (no compilation) | Nothing — just `@getforma/core` |
| Faster rendering via compiled templates | `npm install -D @getforma/compiler` |
| `"use server"` RPC functions | `npm install -D @getforma/compiler` |
| Production build with hashing + compression | `npm install -D @getforma/build` |
| Rust SSR with `forma-server` | `npm install -D @getforma/build` |

`@getforma/build` depends on `@getforma/compiler` — installing build gives you both.

## Quick Start

### With Vite (compiler only)

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { formaCompiler } from "@getforma/compiler";

export default defineConfig({
  plugins: [formaCompiler()],
});
```

### Production build pipeline

```ts
// build.ts
import { build } from "@getforma/build";

await build({
  entryPoints: [{ entry: "src/app.tsx", outfile: "app.js" }],
  routes: { "/": { js: ["app.js"], css: ["app.css"] } },
  outputDir: "dist",
});
```

```bash
npx tsx build.ts
```

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | **This repo** — Vite plugin, server transforms, IR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | **This repo** — production pipeline, bundling, hashing, compression |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format — parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR page rendering, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds a Rust server + TypeScript frontend project |

See the full stack at [getforma.dev](https://getforma.dev).

## Development

```bash
git clone https://github.com/getforma-dev/forma-tools.git
cd forma-tools
npm install
npm test                    # run all workspace tests (162 tests)
npm run build --workspaces  # build all packages
```

## License

MIT — Copyright (c) 2026 Forma
