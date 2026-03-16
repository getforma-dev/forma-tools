# @getforma/compiler

[![npm](https://img.shields.io/npm/v/@getforma/compiler)](https://www.npmjs.com/package/@getforma/compiler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Compiler and build plugins for [FormaJS](https://github.com/getforma-dev/formajs). Transforms `h()` calls into pre-compiled templates for faster rendering, handles `"use server"` function transforms, and emits FMIR binary for Rust SSR.

**This is an optimization layer — FormaJS works without it.** Add the compiler when you want faster initial renders or Rust-based SSR.

## Install

```bash
npm install -D @getforma/compiler
```

## Vite Plugin — `formaCompiler`

Transforms `h()` calls into `template()` + `cloneNode()` at build time. Instead of creating DOM elements one by one at runtime, the browser clones a pre-built template — significantly faster for complex component trees.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { formaCompiler } from "@getforma/compiler";

export default defineConfig({
  plugins: [formaCompiler()],
});
```

**Before (runtime):**
```ts
h("div", { class: "card" },
  h("h2", null, "Title"),
  h("p", null, () => description()),
)
```

**After (compiled):**
```ts
const _tmpl = template("<div class='card'><h2>Title</h2><p></p></div>");
const _root = _tmpl.cloneNode(true);
createEffect(() => { _root.querySelector("p").textContent = description(); });
```

### Options

```ts
formaCompiler({
  // Include/exclude file patterns (default: all .ts/.tsx/.js/.jsx)
  include: ["src/**/*.tsx"],
  exclude: ["node_modules"],
})
```

## Server Functions — `formaServer`

Transforms functions with the `"use server"` directive into RPC stubs (client build) or registered endpoints (server build).

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { formaCompiler, formaServer } from "@getforma/compiler";

export default defineConfig({
  plugins: [
    formaCompiler(),
    formaServer({ mode: "client" }), // or "server"
  ],
});
```

**Source:**
```ts
async function createTodo(text: string) {
  "use server";
  return db.insert("todos", { text });
}
```

**Client output:**
```ts
import { $$serverFunction } from "@getforma/core/server";
const createTodo = $$serverFunction("/rpc/createTodo_a1b2c3");
```

**Server output:**
```ts
import { registerServerFunction } from "@getforma/core/server";
async function createTodo(text: string) {
  return db.insert("todos", { text });
}
registerServerFunction("/rpc/createTodo_a1b2c3", createTodo);
```

## esbuild SSR Plugin — `formaSsrPlugin`

Emits FMIR (Forma Module IR) binary files for Rust-based server-side rendering. Only needed with the full Forma stack (`forma-ir` + `forma-server`).

```ts
import { formaSsrPlugin } from "@getforma/compiler";

// Used by @getforma/build, not typically called directly
```

## Component Analyzer

Parses entry points to extract component trees, signal defaults, and island boundaries for IR emission.

```ts
import { ComponentAnalyzer } from "@getforma/compiler";

const analyzer = new ComponentAnalyzer();
const entry = analyzer.parseEntryPoint("src/app.tsx");
const component = analyzer.parseComponentFile(entry.importPath, entry.componentName);
```

## When Do You Need This?

| Scenario | Need compiler? |
|----------|---------------|
| Learning FormaJS, building prototypes | No |
| Production app with Vite | Optional — adds faster rendering |
| `"use server"` functions (RPC) | Yes — transforms the directive |
| Rust SSR with `forma-server` | Yes — emits FMIR binary |
| HTML Runtime (`data-*` directives) | No — runtime handles everything |

## Peer Dependencies

- `vite >=5.0.0` (optional — for Vite plugins)
- `esbuild >=0.17.0` (optional — for esbuild SSR plugin)

## Part of the Forma Stack

| Package | Language | Description |
|---|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | TypeScript | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | TypeScript | **This package** — h() optimization, server transforms, IR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | TypeScript | Production build pipeline — bundling, hashing, compression, manifest |
| [forma-ir](https://crates.io/crates/forma-ir) | Rust | FMIR binary format: parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Rust | Axum middleware for SSR, asset serving, CSP |

## License

MIT
