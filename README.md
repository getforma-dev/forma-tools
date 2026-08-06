# forma-tools

[![CI](https://github.com/getforma-dev/forma-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma-tools/actions/workflows/ci.yml)

Build tooling for [FormaJS](https://github.com/getforma-dev/formajs) — the reactive DOM library with fine-grained signals.

**These tools are optional.** FormaJS works without them. Add them when you want faster rendering (compiled templates), server functions (`"use server"`), or the full Rust SSR pipeline.

> **Where this sits.** One product, four repos:
>
> ```
> TS/JSX → @getforma/compiler → FMIR (binary) → forma-ir walker → HTML → @getforma/core adopts it
>          THIS REPO                            forma                    formajs
> ```
>
> **You are here:** the compiler that turns TypeScript components into the FMIR
> binary, and the build pipeline that ships it. Everything downstream reads
> what this repo emits, so a change here is usually a cross-repo change. New to
> the stack? Read
> **[the stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md)**
> first. Neighbours:
> [formajs](https://github.com/getforma-dev/formajs) (client runtime) ·
> [forma](https://github.com/getforma-dev/forma) (Rust parser, walker, server) ·
> [create-forma-app](https://github.com/getforma-dev/create-forma-app)
> (scaffolder).

## Documentation

| Document | What it is |
|---|---|
| [Stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md) | The pipeline end to end and the reasoning behind it. **Start here.** |
| [`packages/compiler/README.md`](packages/compiler/README.md) | The compiler: Vite plugin, server functions, SSR plugin, what renders server-side, and the slot-naming contract |
| [`packages/build/README.md`](packages/build/README.md) | The build pipeline: bundling, hashing, compression, manifest, IR emission |
| [`docs/README.md`](docs/README.md) | Index of this repo's documentation, including the cross-implementation corpus and the E2E suite |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, the gates, and what a reviewer will ask you |
| [FMIR format](https://github.com/getforma-dev/forma/blob/main/docs/FMIR-FORMAT.md) | The binary layout this compiler emits, and which bytes are frozen |

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
npm test                    # every workspace's unit tests
npm run emit:corpus         # re-emit the FMIR corpus the Rust parser checks
npm run test:e2e            # Playwright, against a real FormaJS build
npm run build --workspaces  # build all packages
```

What the compiler emits is checked by a second implementation, not only by this
repo's own readers: `npm run emit:corpus` runs the real compiler over
[`packages/compiler/tests/fixtures/ir-corpus/`](packages/compiler/tests/fixtures/ir-corpus/)
and `forma`'s `crates/forma-ir/tests/js_emitter_contract.rs` parses the result
and diffs the rendered HTML against committed goldens. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) before changing emitted bytes.

## License

MIT — Copyright (c) 2026 Forma
