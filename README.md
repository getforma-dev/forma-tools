# forma-tools

Build tooling for [Forma](https://getforma.dev) — a reactive framework for building web applications.

## Packages

| Package | Description |
|---------|-------------|
| [`@getforma/compiler`](packages/compiler) | TypeScript-to-FMIR compiler, Vite plugin, esbuild SSR plugin |
| [`@getforma/build`](packages/build) | Parameterized esbuild build pipeline with content hashing, compression, and manifest generation |

## Install

```bash
npm install @getforma/compiler
npm install @getforma/build
```

## Development

```bash
npm install
npm test        # run all workspace tests
npm run build   # build all packages
```

## License

MIT -- Copyright (c) 2026 Forma
