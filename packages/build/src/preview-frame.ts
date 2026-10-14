/**
 * @getforma/build — the preview frame's runtime (FORMA-175; DR-14 tier (c),
 * L-27, L-44)
 *
 * Content nobody reviewed renders in forma-server's preview frame
 * (`PageResponse::frame`, FORMA-125): an opaque-origin document whose one
 * script is core's frame runtime (FORMA-128), written inline and allowed by
 * its SHA-256 hash. forma-server finds that runtime the way it finds every
 * asset: the manifest's `assets["forma-runtime.js"]` names the hashed file in
 * the application's embedded output, which `PreviewFrame::load` reads once at
 * start. Until a build writes it, the frame refuses to start (FRAME-101).
 *
 * With `previewFrame: true` the build copies the runtime of the
 * `@getforma/core` the application's bundles import, so the preview renders a
 * module with the same core the page mounts it with (DR-26):
 *
 * - **Which core: the one the bundles import.** Before anything is written,
 *   each entry is bundled in memory with the bundles' own esbuild options
 *   (`formaAlias`, whose target esbuild resolves from its working directory;
 *   tsconfig `paths`; watch mode's conditions; symbolic links to their real
 *   paths), and every file it loads is mapped to its package: a core is a
 *   directory whose package.json is named `@getforma/core`. When the bundles
 *   import cores whose frame runtimes differ (two entries from two packages, a
 *   library bundling its own core), the build refuses rather than pick one
 *   (BUILD-807). When they import none, the core installed where the build
 *   runs (the working directory, as Node finds a package) is copied.
 * - **The file is `dist/formajs-frame.global.js`**, never core's
 *   `dist/forma-runtime.js`, which shares the target's name but is the CDN
 *   alias of the auto-mounting runtime: inlined, it would bind the whole frame
 *   document with every power instead of rendering the host's module in tier
 *   (c) with none.
 * - **The bytes are copied unchanged**: no minify, no transform, no line
 *   endings rewritten. forma-server hashes the bytes it inlines; the browser
 *   hashes the script it parses. Any rewrite between core's build and the
 *   frame is a runtime that does not run.
 * - **It refuses what forma-server refuses** (FRAME-103), at build time, with
 *   a coded diagnostic, before anything is written: a runtime that is empty or
 *   not UTF-8, or contains `</script` or `<!--` in any case (they would end
 *   or confuse its element), a carriage return or a NUL (the HTML parser
 *   rewrites them before the script runs, so it would not match its hash).
 *   BUILD-805 when there is no runtime to copy, BUILD-806 when it cannot be
 *   inlined, BUILD-807 when the bundles import more than one. Each fails the
 *   build, strict mode or not.
 *
 * Verified by: packages/build/tests/preview-frame.test.ts
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

import { CATALOGUE_URL, writeDiagnosticsJson } from './diagnostics.js';
import type { BuildConfig, BuildDiagnostic } from './types.js';

/** The logical name forma-server's `FRAME_RUNTIME_ASSET` reads from the manifest's `assets`. */
export const FRAME_RUNTIME_ASSET = 'forma-runtime.js';

/** Where core ships the frame runtime, inside its package (FORMA-128). */
const FRAME_RUNTIME_SOURCE = 'dist/formajs-frame.global.js';

/** The first core that ships it. */
const FRAME_RUNTIME_SINCE = '2.1.0';

/** The runtime the build writes as `forma-runtime.js`, read and checked. */
export interface FrameRuntime {
  bytes: Buffer;
  /** Core's `dist/formajs-frame.global.js` it was read from. */
  source: string;
  /** That core's `version`, as its package.json says. */
  version: string;
  /** How that core was found, for the build's log line. */
  found: string;
}

/** The coded refusals, with the catalogue's why and fix (docs/DIAGNOSTICS.md). */
const CATALOGUE = {
  'BUILD-805': {
    why: "`previewFrame` is on, and the @getforma/core the bundles import has no dist/formajs-frame.global.js (it ships from core 2.1.0), or no core is found: there is no runtime to copy, and forma-server would refuse to start the frame (FRAME-101).",
    fix: 'Install @getforma/core 2.1.0 or later where the bundles import it from, or turn `previewFrame` off.',
  },
  'BUILD-806': {
    why: "Core's dist/formajs-frame.global.js is empty, not UTF-8, or contains `</script`, `<!--`, a carriage return or a NUL: it is inlined as it is into the frame's `<script>` and allowed by its hash, so it would end early or not match its hash, and forma-server would refuse it (FRAME-103).",
    fix: 'Reinstall @getforma/core and leave the file as published: no editor, formatter, patch or CRLF checkout may rewrite it.',
  },
  'BUILD-807': {
    why: "`previewFrame` is on, and the bundles import more than one @getforma/core, whose frame runtimes differ (entries from packages with their own cores, or a library bundling its own): the frame runs one runtime, so the build would have to pick the core it renders previews with, and the page could mount the module with another.",
    fix: 'Make every entry import one @getforma/core (one version in the workspace, `npm dedupe`, a library taking core as a peer dependency), or turn `previewFrame` off.',
  },
} as const;

type FrameCode = keyof typeof CATALOGUE;

/** A build refused for its preview-frame runtime: the message, and the diagnostic it reports. */
export type FrameRuntimeError = Error & { diagnostics: BuildDiagnostic[] };

function refusal(code: FrameCode, message: string, at: { file?: string; line?: number; column?: number } = {}): FrameRuntimeError {
  const diagnostic: BuildDiagnostic = {
    code,
    severity: 'error',
    page: '',
    file: at.file ?? '',
    line: at.line ?? 0,
    column: at.column ?? 0,
    message,
    why: CATALOGUE[code].why,
    fix: CATALOGUE[code].fix,
  };
  const where = diagnostic.file ? (diagnostic.line > 0 ? `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}: ` : `${diagnostic.file}: `) : '';
  const error = new Error(
    `@getforma/build: ${code} ${where}${message}\n    why: ${diagnostic.why}\n    fix: ${diagnostic.fix}\n` +
      `Each code, with its fix: ${CATALOGUE_URL}`,
  ) as FrameRuntimeError;
  error.name = 'FormaPreviewFrameError';
  error.diagnostics = [diagnostic];
  return error;
}

// ---------------------------------------------------------------------------
// Which core: the one the bundles import
// ---------------------------------------------------------------------------

/** One @getforma/core the bundles import: its real directory and the entries (outfiles) whose bundle imports it. */
interface BundledCore {
  dir: string;
  entries: string[];
}

/** A package.json's `name`, or undefined when it has none or cannot be read. */
function nameOf(packageJson: string): string | undefined {
  try {
    const name: unknown = JSON.parse(readFileSync(packageJson, 'utf8')).name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The real directory of the @getforma/core package `file` belongs to, or
 * undefined when it belongs to another package or to none. A package is the
 * nearest directory above the file whose package.json has a `name` (a
 * nameless one, such as `{"type": "module"}` inside a `dist`, does not end
 * it); the walk stops at a `node_modules` directory. `cache` holds the answer
 * for every directory already walked.
 */
function coreOf(file: string, cache: Map<string, string | undefined>): string | undefined {
  const walked: string[] = [];
  let dir = dirname(file);
  let found: string | undefined;
  for (;;) {
    if (cache.has(dir)) {
      found = cache.get(dir);
      break;
    }
    walked.push(dir);
    const manifest = join(dir, 'package.json');
    const name = existsSync(manifest) ? nameOf(manifest) : undefined;
    if (name === '@getforma/core') {
      found = realpathSync(dir);
      break;
    }
    const parent = dirname(dir);
    if (name !== undefined || parent === dir || basename(dir) === 'node_modules') break;
    dir = parent;
  }
  for (const each of walked) cache.set(each, found);
  return found;
}

/**
 * The @getforma/core packages the bundles import, in entry order, each with
 * the entries that reach it: every entry is bundled in memory (nothing is
 * written) with the bundles' own esbuild options, and each file esbuild loads
 * is mapped to its package. The same options are what make the answer the
 * bundles': `formaAlias` (its target resolved from esbuild's working
 * directory), tsconfig `paths`, watch mode's `development` condition, and
 * symbolic links followed to their real paths, as esbuild follows them.
 *
 * An entry that does not bundle (a syntax error, an import that does not
 * resolve) fails here with esbuild's own error, as the bundle itself would,
 * before anything is written.
 *
 * Verified by: packages/build/tests/preview-frame.test.ts > "copies the core the bundles import: formaAlias resolved from the working directory, as esbuild resolves it"
 * Verified by: packages/build/tests/preview-frame.test.ts > "copies the core the bundles import: tsconfig paths to a vendored core"
 */
async function bundledCores(config: BuildConfig, shared: esbuild.BuildOptions): Promise<BundledCore[]> {
  const cache = new Map<string, string | undefined>();
  const perEntry = await Promise.all(config.entryPoints.map(async (entry) => {
    const loaded = new Set<string>();
    await esbuild.build({
      ...shared,
      entryPoints: [entry.entry],
      bundle: true,
      write: false,
      minify: false,
      sourcemap: false,
      metafile: false,
      logLevel: 'error',
      plugins: [{
        name: 'forma-frame-graph',
        setup(builder) {
          builder.onLoad({ filter: /.*/ }, (args) => {
            if (args.namespace === 'file') loaded.add(args.path);
            return undefined;
          });
        },
      }],
    });
    return { outfile: entry.outfile, loaded };
  }));
  const cores = new Map<string, BundledCore>();
  for (const { outfile, loaded } of perEntry) {
    for (const file of loaded) {
      const dir = coreOf(file, cache);
      if (dir === undefined) continue;
      const core = cores.get(dir) ?? { dir, entries: [] };
      if (!core.entries.includes(outfile)) core.entries.push(outfile);
      cores.set(dir, core);
    }
  }
  return [...cores.values()];
}

/**
 * The directory of the `@getforma/core` installed where a module in `from`
 * would find it, as Node finds a package (each `node_modules` from `from` up,
 * then the global folders), without reading its `exports`: core's `dist/`
 * files are not exports. Undefined when there is none.
 */
function coreDirectory(from: string): string | undefined {
  const paths = createRequire(join(from, 'noop.js')).resolve.paths('@getforma/core') ?? [];
  for (const nodeModules of paths) {
    const dir = join(nodeModules, '@getforma', 'core');
    if (existsSync(join(dir, 'package.json'))) return realpathSync(dir);
  }
  return undefined;
}

/** `version` from a package.json, or `(no version)` when it has none or cannot be read. */
function versionOf(packageJson: string): string {
  try {
    const version: unknown = JSON.parse(readFileSync(packageJson, 'utf8')).version;
    return typeof version === 'string' ? version : '(no version)';
  } catch {
    return '(no version)';
  }
}

// ---------------------------------------------------------------------------
// What forma-server can inline
// ---------------------------------------------------------------------------

// Rust's `str::trim` whitespace (the Unicode White_Space property), which
// forma-server's "empty" check uses: the same file is empty to both.
const ONLY_WHITESPACE = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

/** The 1-based line and column of `index` in `text`, a column counted in UTF-16 units. */
function position(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - before.lastIndexOf('\n') };
}

/**
 * Why forma-server would refuse these bytes as the frame's runtime
 * (`PreviewFrame::load`'s FRAME-103), in its order, or undefined: they must be
 * UTF-8, not only whitespace, and hold no `</script` or `<!--` in any ASCII
 * case, no carriage return and no NUL.
 */
function inlineProblem(bytes: Uint8Array): { reason: string; index?: number; text?: string } | undefined {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { reason: 'is not UTF-8' };
  }
  if (ONLY_WHITESPACE.test(text)) return { reason: 'is empty' };
  // ASCII case only, as the HTML tokenizer matches an end tag and forma-server
  // lowers the text (`to_ascii_lowercase`).
  const lower = text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
  for (const sequence of ['</script', '<!--']) {
    const index = lower.indexOf(sequence);
    if (index >= 0) {
      return {
        reason: `contains ${JSON.stringify(sequence)}, which would end or confuse its inline script; the runtime is inlined as it is, never rewritten`,
        index,
        text,
      };
    }
  }
  for (const [character, name] of [['\r', 'a carriage return'], ['\0', 'a NUL']] as const) {
    const index = text.indexOf(character);
    if (index >= 0) {
      return {
        reason: `contains ${name}, which the HTML parser rewrites before it runs the script, so the script would not match its hash; core's file has LF line endings as published`,
        index,
        text,
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Read and check
// ---------------------------------------------------------------------------

/**
 * Find, read and check the runtime `previewFrame` copies, before the build
 * writes anything. `shared` is the bundles' esbuild options. Throws BUILD-805,
 * BUILD-806 or BUILD-807 (a {@link FrameRuntimeError}), writing it as the
 * JSON report's one diagnostic when the config asks for one, so a report from
 * an earlier build is not left standing.
 *
 * Verified by: packages/build/tests/preview-frame.test.ts > "copies core's dist/formajs-frame.global.js unchanged as a hashed forma-runtime.<hash>.js and names it in the manifest's assets"
 * Verified by: packages/build/tests/preview-frame.test.ts > "BUILD-805: a core without the frame runtime (older than 2.1.0) fails the build, naming its version, and leaves the previous output as it was"
 * Verified by: packages/build/tests/preview-frame.test.ts > "BUILD-806: a runtime with %s fails the build with its code, before anything is written"
 * Verified by: packages/build/tests/preview-frame.test.ts > "BUILD-807: entries from two packages with cores whose runtimes differ fail the build, naming each core and its entries"
 */
export async function readFrameRuntime(config: BuildConfig, shared: esbuild.BuildOptions, strict: boolean): Promise<FrameRuntime> {
  try {
    return await readChecked(config, shared);
  } catch (error) {
    const diagnostics = (error as Partial<FrameRuntimeError>).diagnostics;
    if (config.diagnosticsJson && diagnostics) writeDiagnosticsJson(config.diagnosticsJson, strict, diagnostics);
    throw error;
  }
}

/** A core's frame runtime as read: its bytes, or undefined when the file does not exist. */
interface CoreRuntime extends BundledCore {
  version: string;
  source: string;
  bytes: Buffer | undefined;
}

function readRuntime(core: BundledCore): CoreRuntime {
  const version = versionOf(join(core.dir, 'package.json'));
  const source = join(core.dir, ...FRAME_RUNTIME_SOURCE.split('/'));
  try {
    return { ...core, version, source, bytes: readFileSync(source) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ...core, version, source, bytes: undefined };
    throw refusal('BUILD-805', `@getforma/core ${version}'s ${FRAME_RUNTIME_SOURCE} cannot be read (${code ?? 'error'}): ${source}`);
  }
}

/** A core as a message names it: version, directory, the entries that import it. */
function described(core: CoreRuntime): string {
  const entries = core.entries.length > 0 ? ` (imported by ${core.entries.join(', ')})` : '';
  return `@getforma/core ${core.version} at ${core.dir}${entries}`;
}

async function readChecked(config: BuildConfig, shared: esbuild.BuildOptions): Promise<FrameRuntime> {
  let bundled = await bundledCores(config, shared);
  let found = 'the core the bundles import';
  if (bundled.length === 0) {
    const installed = coreDirectory(process.cwd());
    if (!installed) {
      throw refusal(
        'BUILD-805',
        `previewFrame is on, and the bundles import no @getforma/core, nor is one installed where the build runs (${process.cwd()}): ` +
          `the preview frame's runtime is core's ${FRAME_RUNTIME_SOURCE} (core ${FRAME_RUNTIME_SINCE} and later)`,
      );
    }
    bundled = [{ dir: installed, entries: [] }];
    found = 'installed where the build runs; the bundles import no core';
  }

  const cores = bundled.map(readRuntime);
  const kinds = new Set(cores.map((core) => core.bytes ? createHash('sha256').update(core.bytes).digest('hex') : 'none'));
  if (kinds.size > 1) {
    throw refusal(
      'BUILD-807',
      `previewFrame is on, and the bundles import ${cores.length} copies of @getforma/core whose frame runtimes differ: ` +
        cores.map((core) => `${described(core)}${core.bytes ? '' : ', which has no frame runtime'}`).join('; ') +
        `. The frame runs one runtime, so the build does not pick one`,
    );
  }

  const [core] = cores as [CoreRuntime, ...CoreRuntime[]];
  if (!core.bytes) {
    throw refusal(
      'BUILD-805',
      `${described(core)} has no ${FRAME_RUNTIME_SOURCE}: the preview frame's runtime ships with core ${FRAME_RUNTIME_SINCE} and later ` +
        `(its dist/forma-runtime.js is the CDN alias of the auto-mounting runtime, never the frame's)`,
    );
  }
  const problem = inlineProblem(core.bytes);
  if (problem) {
    const at = problem.index !== undefined && problem.text !== undefined ? position(problem.text, problem.index) : {};
    throw refusal('BUILD-806', `@getforma/core ${core.version}'s ${FRAME_RUNTIME_SOURCE} ${problem.reason}`, { file: core.source, ...at });
  }
  if (cores.length > 1) found += `, the same runtime as the ${cores.length - 1} other ${cores.length === 2 ? 'copy' : 'copies'} they import`;
  return { bytes: core.bytes, source: core.source, version: core.version, found };
}
