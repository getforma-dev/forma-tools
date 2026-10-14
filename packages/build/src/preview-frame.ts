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
 * With `previewFrame: true` the build copies the runtime from the
 * `@getforma/core` the application's entries import, so the frame runs the
 * same core as the application's bundles (DR-26):
 *
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
 *   inlined. Each fails the build, strict mode or not.
 *
 * Verified by: packages/build/tests/preview-frame.test.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

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
}

/** The two coded refusals, with the catalogue's why and fix (docs/DIAGNOSTICS.md). */
const CATALOGUE = {
  'BUILD-805': {
    why: "`previewFrame` is on, and the @getforma/core the entries import has no dist/formajs-frame.global.js (it ships from core 2.1.0), or none is installed: there is no runtime to copy, and forma-server would refuse to start the frame (FRAME-101).",
    fix: 'Install @getforma/core 2.1.0 or later where the entries import it, or turn `previewFrame` off.',
  },
  'BUILD-806': {
    why: "Core's dist/formajs-frame.global.js is empty, not UTF-8, or contains `</script`, `<!--`, a carriage return or a NUL: it is inlined as it is into the frame's `<script>` and allowed by its hash, so it would end early or not match its hash, and forma-server would refuse it (FRAME-103).",
    fix: 'Reinstall @getforma/core and leave the file as published: no editor, formatter, patch or CRLF checkout may rewrite it.',
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

/**
 * The directory of the `@getforma/core` a module in `from` imports, found as
 * Node finds a package (each `node_modules` from `from` up, then the global
 * folders), without reading its `exports`: core's `dist/` files are not
 * exports. Undefined when there is none.
 */
function coreDirectory(from: string): string | undefined {
  const paths = createRequire(join(from, 'noop.js')).resolve.paths('@getforma/core') ?? [];
  for (const nodeModules of paths) {
    const dir = join(nodeModules, '@getforma', 'core');
    if (existsSync(join(dir, 'package.json'))) return dir;
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

/**
 * Read and check the runtime `previewFrame` copies, before the build writes
 * anything. Throws BUILD-805 or BUILD-806 (a {@link FrameRuntimeError}),
 * writing it as the JSON report's one diagnostic when the config asks for
 * one, so a report from an earlier build is not left standing.
 *
 * Core is the one the first entry point imports (its directory, then each
 * parent's `node_modules`), else the working directory's.
 *
 * Verified by: packages/build/tests/preview-frame.test.ts > "copies core's dist/formajs-frame.global.js unchanged as a hashed forma-runtime.<hash>.js and names it in the manifest's assets"
 * Verified by: packages/build/tests/preview-frame.test.ts > "BUILD-805: a core without the frame runtime (older than 2.1.0) fails the build, naming its version, and leaves the previous output as it was"
 * Verified by: packages/build/tests/preview-frame.test.ts > "BUILD-806: a runtime with %s fails the build with its code, before anything is written"
 */
export function readFrameRuntime(config: BuildConfig, strict: boolean): FrameRuntime {
  try {
    return readChecked(config);
  } catch (error) {
    const diagnostics = (error as Partial<FrameRuntimeError>).diagnostics;
    if (config.diagnosticsJson && diagnostics) writeDiagnosticsJson(config.diagnosticsJson, strict, diagnostics);
    throw error;
  }
}

function readChecked(config: BuildConfig): FrameRuntime {
  const first = config.entryPoints[0];
  const from = first ? dirname(resolve(first.entry)) : process.cwd();
  const core = coreDirectory(from);
  if (!core) {
    throw refusal(
      'BUILD-805',
      `previewFrame is on, and @getforma/core is not installed where ${first ? first.entry : 'the working directory'} can import it: ` +
        `the preview frame's runtime is its ${FRAME_RUNTIME_SOURCE} (core ${FRAME_RUNTIME_SINCE} and later)`,
    );
  }
  const version = versionOf(join(core, 'package.json'));
  const source = join(core, ...FRAME_RUNTIME_SOURCE.split('/'));
  let bytes: Buffer;
  try {
    bytes = readFileSync(source);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw refusal(
      'BUILD-805',
      code === 'ENOENT'
        ? `@getforma/core ${version} at ${core} has no ${FRAME_RUNTIME_SOURCE}: the preview frame's runtime ships with core ${FRAME_RUNTIME_SINCE} and later ` +
          `(its dist/forma-runtime.js is the CDN alias of the auto-mounting runtime, never the frame's)`
        : `@getforma/core ${version}'s ${FRAME_RUNTIME_SOURCE} cannot be read (${code ?? 'error'}): ${source}`,
    );
  }
  const problem = inlineProblem(bytes);
  if (problem) {
    const at = problem.index !== undefined && problem.text !== undefined ? position(problem.text, problem.index) : {};
    throw refusal('BUILD-806', `@getforma/core ${version}'s ${FRAME_RUNTIME_SOURCE} ${problem.reason}`, { file: source, ...at });
  }
  return { bytes, source, version };
}
