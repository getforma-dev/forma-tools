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

```
@getforma/core       → reactive DOM library (signals, h(), islands)
@getforma/compiler   → h() optimization, server transforms, IR emission
@getforma/build      → production pipeline (bundling, hashing, compression)
forma-ir             → Rust FMIR parser + walker
forma-server         → Rust/Axum SSR middleware
```

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
