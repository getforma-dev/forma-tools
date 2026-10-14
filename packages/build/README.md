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

### Watch mode is a development build

Watch mode resolves each package's `development` export condition, as Vite's
dev server does: it passes esbuild `conditions: ['development', 'module']`
(`module` because listing any condition drops esbuild's automatic one) and
defines `process.env.NODE_ENV` as `"development"`. `@getforma/core` points the
condition at a build that keeps its development warnings (hydration
mismatches, dropped props, the `FORMA_W_DEPRECATED_` codes), so they reach
the browser console while you develop. A production build passes neither: it
resolves the files it always did and logs none of them.

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
  Error: @getforma/build strict mode (strict: true or FORMA_STRICT=1): 2 SSR diagnostics are errors; without it they are warnings:
  /app/src/home/app.tsx:12:11  BUILD-101  call expression helpers.extra(...) in /app/src/home/app.tsx:12:11 — emitted as an empty island shell, …
      why: The call becomes an anonymous island (`island_<n>`) that no registry names: …
      fix: Write the subtree as h() calls, a component in a relative file, …
  ```

  `build()` reads no command-line flag, as for `ssr` and `watch`: a build
  script that takes `--strict` maps it to the config.

  ```ts
  // `|| undefined` leaves `strict` unset without the flag, so FORMA_STRICT=1
  // still applies; `false` would turn strict mode off whatever the variable says.
  await build({ /* … */ ssr: isSsr, strict: process.argv.includes("--strict") || undefined });
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
  serves; one inside is refused before anything is written, inside as the
  filesystem sees it (through real paths, so a symlink into `outputDir`
  counts; case-insensitively where the filesystem ignores case). A field may be
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

## Raw-entry lint (`forma-raw-lint`)

Raw HTML and the other ways out of escaping and Forma's policy are named, so
review and CI can find every one (DR-19, L-37). `forma-raw-lint` is the check
an application runs in CI (SR8): it fails on any use of those exits that its
allowlist does not list with an owner and an end date, and on any listed entry
past its end date. The allowlist becomes the inventory of the application's
raw entries.

```bash
npx forma-raw-lint src crates
```

```yaml
# .github/workflows/ci.yml
- run: npx forma-raw-lint --report raw-entries.json src crates
```

It reads TypeScript, JavaScript (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
`.mjs`, `.cjs`; not `.d.ts`), Rust (`.rs`) and HTML (`.html`, `.htm`) under
the files and directories it is given, skipping `node_modules`, `target` and
any file or directory whose name starts with `.`. Skips and `--exclude` are
applied before anything is read. A symbolic link is followed; one that leads
nowhere or loops is a `BUILD-814` (exclude it if it is not source), and a
file reached by two paths is read once. It needs nothing beyond this package:
an application that does not build with `@getforma/build` (a Rust-only one,
or one that uses `@getforma/core` alone) runs it with
`npx -p @getforma/build forma-raw-lint …`.

```
--allowlist <file>  The allowlist (default: ./forma-raw-allowlist.json, if it exists)
--root <dir>        What paths are relative to (default: the allowlist's directory, else .)
--exclude <glob>    Do not scan matching files or directories (**, *, ?); repeatable
--today <date>      Check end dates against this day, YYYY-MM-DD (default: today, UTC)
--json              Print the report as JSON instead of text
--report <file>     Also write the JSON report to this file
--exits             List the exits an entry's "exit" can name
```

**Exit codes.** 0, it passes; 1, a raw entry not on the allowlist
(`BUILD-810`), an entry past its end date (`BUILD-811`) or a source file it
cannot parse (`BUILD-814`); 2, a usage error or an allowlist it cannot use
(`BUILD-812`). An entry that lists fewer uses than its count, or none
(`BUILD-813`), is a note. The codes
are in the build diagnostics catalogue, [`docs/DIAGNOSTICS.md`](https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md).

```text
BUILD-810 error body_prefix in src/server/mod.rs:772:9 (in index_handler): body_prefix: body_prefix set to a value not traced to RawHtml::trusted (a string still works in 0.2.x); not on the allowlist
forma-raw-lint: 6 raw entries in 123 files: 5 listed, 1 not on the allowlist; 0 allowlist entries past the end date; 0 allowlist entries listing fewer uses than they say. Fail.
```

### The allowlist

`forma-raw-allowlist.json`, version 1:

```json
{
  "version": 1,
  "entries": [
    {
      "path": "src/server/mod.rs",
      "symbol": "index_handler",
      "exit": "body_prefix",
      "owner": "studio",
      "until": "2027-01-31",
      "reason": "the hand-written app shell; moves to RawHtml::trusted (appendix E)"
    },
    {
      "path": "client/pages/DocsPage.ts",
      "line": 751,
      "exit": "dangerouslySetInnerHTML",
      "owner": "docs",
      "until": "2027-01-31",
      "reason": "sanitised search snippets; wrap in trustedHtml under kmd's policy"
    }
  ]
}
```

Each entry has:

- `path`: the file, relative to the allowlist's directory, with `/`.
- `line` or `symbol`, exactly one: the line, or the innermost named function,
  method, class, `impl` or module, as the lint prints it after `in`
  (`FormaStage.update`, `RawHtml::from_static`). A symbol survives edits
  around it; a line pins one use.
- `exit`: one of the names below.
- `owner`: who answers for it.
- `until`: `YYYY-MM-DD`, the last day the entry is valid. The day after, the
  run fails until the owner removes the raw entry or renews the date.
- `reason`: why it is raw, and where it is going.
- `count` (optional, default 1): how many uses of that exit the entry lists.
  A second use in the same function is not on the allowlist until the count
  says so, and an entry that lists fewer uses than its count is a `BUILD-813`
  note, so a count never leaves room for an unreviewed use.

An unknown field, a missing one, an exit the lint does not know or a date
that is not a real day stops the run with `BUILD-812`, naming the entry and
the field. The `--json` report's `rawEntries` lists every raw entry found,
listed or not, with its file, line, column, symbol and exit: the list an
allowlist starts from.

### The exits

TypeScript and JavaScript, inline scripts in HTML included:

| Exit | What the lint finds |
|---|---|
| `trustedHtml` | Each call of `trustedHtml()`, under any name it is imported or destructured as (`@getforma/core`, `./runtime`, the CDN's `FormaRuntime`), and each reference to it that is not a call, or that exports it under another name. |
| `dangerouslySetInnerHTML` | Any `__html` key, wherever it is written, whose value is not a `trustedHtml(…)` call or a `const` in scope bound to one (a string still works in 2.x and warns in development); and the prop itself set to a value the lint cannot read as `{ __html: … }`: by JSX, `h()`, a quoted or computed key (a `const` holding the name included), shorthand, `obj.prop =`, `obj['prop'] =` or `Reflect.set(obj, 'prop', …)`. |
| `setHTMLUnsafe` | Core's `setHTMLUnsafe(el, markup)` given markup not traced to `trustedHtml()`. |
| `template` | Core's `template(markup)`, likewise. |
| `templateMany` | Core's `templateMany(markup)`, likewise. |
| `reconcile` | The runtime's `reconcile(el, markup)`, likewise. |
| `srcdoc` | A `srcdoc` prop, attribute or property (any case) set to a value not traced to `trustedHtml()`: JSX, `h()`, a quoted or computed key, `setAttr`/`setAttribute(…, 'srcdoc', …)` (a template literal or a `const` holding the name included), `.srcdoc =`, `['srcdoc'] =`, `Reflect.set` and `Object.defineProperty`. |
| `core-reexport` | `export * from '@getforma/core'` (or a subpath, or `export * as x from …`): every raw sink of core's behind the application's own module, where the lint does not follow its importers. A named re-export of a sink (`export { reconcile } from '@getforma/core/runtime'`, or a sink imported from core and exported) is reported under the sink's own exit. |
| `h('script')` | A `script` element built by core's `h()`: `h('script', …)` (any case), under a name `h` is imported as, on core's namespace, or JSX `<script>`. Its `src` runs under `'strict-dynamic'`; it warns in development and 3.0.0 refuses it (FORMA-109). |

Markup, in HTML files and in string literals in either language:

| Exit | What the lint finds |
|---|---|
| `data-bind:srcdoc` | The HTML runtime's `data-bind:srcdoc` binding, which no `trustedHtml()` can reach. |
| `list-row-srcdoc` | A `srcdoc` attribute whose value carries `{item`, a list row's binding, after character references (`&#123;`, `&lbrace;`) and string escapes (`\u{7b}`, `\x7b`) are decoded, as the runtime reads it. |
| `trusted-types-registry` | The string `@getforma/core#trusted-types`, the key of core's registry, through which the `forma` policy can mint without `trustedHtml()`. |

Rust:

| Exit | What the lint finds |
|---|---|
| `RawHtml::trusted` | Each `RawHtml::trusted`, path-qualified, as `<RawHtml>::trusted`, as `Self::trusted` in an `impl` for it, or through an alias of it from any file. |
| `RawHtml-alias` | `RawHtml` under another name: `use … RawHtml as X`, `type X = …RawHtml`, any `= RawHtml` (an associated type, a generic default). |
| `r#html` | The raw identifier `r#html`, the name of `RawHtml`'s private field. |
| `body_prefix` | A `body_prefix` other than `None` that is not `Some(&x)` (or `x.as_str()`, `&*x`) where `x`'s last binding in scope is `RawHtml::trusted(..)` or declared `RawHtml`, or `self.x` declared `RawHtml` by the `impl`'s own struct: a string still works in 0.2.x. |
| `config_json` | `config_json` set to anything but `None`: data's typed home. |
| `config_script` | `config_script` other than `None`: deprecated, handler text in a nonced script, removed in 3.0.0. |
| `into_parts_unchecked` | `PageResponse::into_parts_unchecked`. |
| `with_module_preloads` | `RenderCtx::with_module_preloads`, the typed home for `modulepreload` links. |
| `with_head_link` | `RenderCtx::with_head_link`, the typed home for head links. |
| `relax_trusted_types` | `PolicyExtensions::relax_trusted_types`, a route's Trusted Types relaxation. |

The three fields are found where a struct literal or an assignment sets
them (`field: v`, `x.field = v`), through an `Option` method that writes them
(`.replace`, `.insert`, `.get_or_insert`, `.get_or_insert_with`, `.as_mut`,
`.as_deref_mut`), and through a mutable borrow (`&mut c.body_prefix`, as
`mem::replace` takes).

A typed use is one raw entry, its constructor: `{ __html: trustedHtml(md) }`
lists `trustedHtml`, and `let shell = RawHtml::trusted(..)` with
`body_prefix: Some(&shell)` lists `RawHtml::trusted`.

### How it reads, and what it misses

TypeScript and JavaScript are parsed by esbuild, as the build parses them: a
file that does not parse fails the run (`BUILD-814`) rather than pass unseen
(a `.js` file is also tried as JSX and as TypeScript). The lint reads
esbuild's output, where types are gone, JSX is `h()` calls and comments are
dropped, so a name in a comment, a type, JSX text or a string is never read
as a use; positions are mapped back through esbuild's source map. Rust is a
token scan, not a parse: it knows Rust's lexical grammar (nested comments, raw
strings, byte and C strings, char literals against lifetimes, raw
identifiers) and pairs brackets, so a struct literal's fields, a struct's
declared fields, a `use` tree and a pattern are told apart. HTML is read in
one pass, tag by tag: a comment starts only in text, never inside a quoted
value; an inline script is parsed as JavaScript (one that does not parse is a
`BUILD-814`, and the rest of the file is still read); a script of another
type (`text/x-template`, `application/json`) is read as markup, as a string
literal is. A string literal's escapes are decoded before its markup is
read.

What it cannot see, and review must:

- A sink reached through core's module inside a callback
  (`import('@getforma/core').then((m) => m.template(s))`, or
  `.then(({ template }) => …)`). `template`, `templateMany`, `reconcile` and
  `setHTMLUnsafe` are followed from core's own module names and `FormaRuntime`:
  through named, namespace and default imports, `require` and `await import`,
  destructuring and aliases of the namespace (`const { template } = F`,
  `const G = F`), and bracket access (`F['template']`). `trustedHtml` is
  matched by name wherever it comes from.
- Provenance across files or through a function: a sink passes only when its
  argument is a `trustedHtml(…)` call or a `const` bound to one in scope (a
  parameter, `let`, `var` or any nearer binding of the same name shadows it,
  and only a `const` is trusted), and `body_prefix` only when the last binding
  of its name in scope makes or declares a `RawHtml` (a shadowing `let`, a
  parameter or a closure or pattern binding in between undoes it), or for
  `self.x` that the `impl`'s own struct declares `RawHtml`. Everything else is
  reported, so the lint errs toward an entry on the list.
- The registry key built at run time (`'@getforma/core' + '#trusted-types'`)
  or found with `Object.getOwnPropertySymbols`.
- A Rust name assembled by a macro (`paste!`), and `body_prefix` carried in by
  struct update (`PageConfig { ..base }`).
- Props built from data at run time (`JSON.parse('{"dangerouslySetInnerHTML": …}')`,
  a key assembled from variables): the lint reads the names written in the
  source.
- `h()` given a tag only known at run time (`h(tag, …)`).
- The browser's own sinks (`innerHTML`, `insertAdjacentHTML`, `document.write`,
  `Element.setHTMLUnsafe`, `document.createElement('script')`): not Forma's
  exits, and what Trusted Types refuses in the browser (DR-20).

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
