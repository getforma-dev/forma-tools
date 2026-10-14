/**
 * `previewFrame`: the build copies core's preview-frame runtime into the
 * application's assets as `forma-runtime.js` (FORMA-175; DR-14 tier (c), L-27,
 * L-44).
 *
 * forma-server's `PreviewFrame::load` (FORMA-125) reads the manifest's
 * `assets["forma-runtime.js"]` at start, refuses a runtime it cannot inline
 * (FRAME-103: empty, not UTF-8, `</script`, `<!--`, a carriage return or a
 * NUL) and allows the rest by the SHA-256 of its bytes. Core ships that
 * runtime as `dist/formajs-frame.global.js` (FORMA-128); its
 * `dist/forma-runtime.js` is a CDN alias of the auto-mounting runtime, which
 * shares the target name and must never be copied.
 *
 * These cases use a stand-in `@getforma/core` in the fixture's node_modules,
 * so each says which file the build read. The end-to-end lane
 * (e2e/frame/) builds against a core packed from formajs and loads the result
 * in forma-server and Chromium.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIAGNOSTIC_CATALOGUE } from '@getforma/compiler';

import { build } from '../src/build';
import type { BuildConfig, BuildDiagnostic } from '../src/types';
import { watching } from './helpers/watch';

/** A frame runtime as core ships it: one classic script, LF only, UTF-8 beyond ASCII. */
const FRAME = '"use strict";\n(() => {\n  // é, ✓ and 𝄞: bytes beyond ASCII, copied as they are\n  const label = "<\\/script> written escaped, and <!- not a comment";\n  window.__formaFrame = label;\n})();\n';
/** Core's CDN alias of the auto-mounting runtime, which shares the target's name. */
const CDN_ALIAS = '(() => { /* the auto-mounting runtime: never the frame */ })();\n';

const temporary: string[] = [];
let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// A watched build's esbuild service can still be writing for a moment after
// its process is killed, so removal retries ENOTEMPTY.
afterEach(() => {
  vi.restoreAllMocks();
  temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
});

interface Core {
  version?: string;
  /** `null`: core ships no frame runtime (older than 2.1.0). */
  frame?: string | Uint8Array | null;
}

/** An application with one page, and, unless `core` is undefined, a stand-in @getforma/core. */
function fixture(core?: Core, extra: Partial<BuildConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forma-preview-frame-')); temporary.push(root);
  const src = join(root, 'src'); const dist = join(root, 'dist');
  mkdirSync(src);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(src, 'app.ts'), 'export const page = "home";\n');
  let frameFile = '';
  if (core) {
    const dir = join(root, 'node_modules', '@getforma', 'core');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@getforma/core', version: core.version ?? '2.1.0', exports: { '.': './dist/index.js' } }));
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const core = 1;\n');
    writeFileSync(join(dir, 'dist', 'forma-runtime.js'), CDN_ALIAS);
    frameFile = join(dir, 'dist', 'formajs-frame.global.js');
    const frame = core.frame === undefined ? FRAME : core.frame;
    if (frame !== null) writeFileSync(frameFile, frame);
  }
  const config: BuildConfig = {
    entryPoints: [{ entry: join(src, 'app.ts'), outfile: 'app.js' }],
    routes: { '/': { js: ['app'], css: [] } },
    outputDir: dist,
    ...extra,
  };
  return { root, src, dist, frameFile, config };
}

/** Every file under `dir`, by relative path, as base64. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = readFileSync(path).toString('base64');
    }
  };
  walk(dir, '');
  return files;
}

const sha256 = (bytes: Uint8Array, encoding: 'hex' | 'base64') => createHash('sha256').update(bytes).digest(encoding);

async function refusal(config: BuildConfig): Promise<Error & { diagnostics?: BuildDiagnostic[] }> {
  const error = await build(config).then(() => undefined, (e: unknown) => e as Error & { diagnostics?: BuildDiagnostic[] });
  expect(error, 'the build should have failed').toBeInstanceOf(Error);
  return error!;
}

describe('previewFrame: core\'s frame runtime as the manifest\'s forma-runtime.js (FORMA-175)', () => {
  it('copies core\'s dist/formajs-frame.global.js unchanged as a hashed forma-runtime.<hash>.js and names it in the manifest\'s assets', async () => {
    const { dist, frameFile, config } = fixture({});
    const result = await build({ ...config, previewFrame: true });

    const core = readFileSync(frameFile);
    const name = `forma-runtime.${sha256(core, 'hex').slice(0, 8)}.js`;
    expect(result.manifest.assets['forma-runtime.js']).toBe(name);
    const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
    expect(manifest.assets['forma-runtime.js']).toBe(name);

    // The bytes are core's, unchanged: no minify, no transform, no line
    // endings rewritten, so the SHA-256 forma-server computes for the frame's
    // script-src is the one of core's file.
    const written = readFileSync(join(dist, name));
    expect(written.equals(core)).toBe(true);
    expect(sha256(written, 'base64')).toBe(sha256(Buffer.from(FRAME, 'utf8'), 'base64'));
    // Never core's file of the target's name, the CDN alias that auto-mounts.
    expect(written.toString('utf8')).not.toBe(CDN_ALIAS);
    // Only under its hashed name: no unhashed copy, and no route loads it.
    expect(existsSync(join(dist, 'forma-runtime.js'))).toBe(false);
    expect(manifest.routes['/'].js).toEqual([result.manifest.assets['app.js']]);
    expect(logs.join('\n')).toContain('Preview frame runtime: forma-runtime.js from @getforma/core 2.1.0');
  }, 30_000);

  it('with previewFrame off or unset the output is byte-identical, names no runtime, and reads no core', async () => {
    // Unset, without a core at all: the build as it was before the setting.
    const unset = fixture(undefined);
    await build(unset.config);
    const before = snapshot(unset.dist);

    const off = fixture(undefined);
    await build({ ...off.config, previewFrame: false });
    // A core whose frame runtime would be refused: not read when off.
    const installed = fixture({ frame: '</script>' });
    await build(installed.config);

    expect(snapshot(off.dist)).toEqual(before);
    expect(snapshot(installed.dist)).toEqual(before);
    const manifest = JSON.parse(readFileSync(join(unset.dist, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.assets)).toEqual(['app.js']);
    expect(Object.keys(before).filter(file => file.startsWith('forma-runtime'))).toEqual([]);
  }, 30_000);

  it('BUILD-805: a core without the frame runtime (older than 2.1.0) fails the build, naming its version, and leaves the previous output as it was', async () => {
    const { root, dist, config } = fixture({ version: '2.0.3', frame: null });
    await build(config);
    const good = snapshot(dist);
    const beside = readdirSync(root).sort();

    const error = await refusal({ ...config, previewFrame: true });
    expect(error.message).toMatch(/^@getforma\/build: BUILD-805 /);
    expect(error.message).toContain('@getforma/core 2.0.3');
    expect(error.message).toContain('dist/formajs-frame.global.js');
    expect(error.message).toContain('2.1.0');
    // Core's CDN alias of that name is there, and is not taken instead.
    expect(error.diagnostics).toHaveLength(1);
    expect(error.diagnostics![0]).toMatchObject({ code: 'BUILD-805', severity: 'error', page: '' });
    expect(snapshot(dist)).toEqual(good);
    expect(readdirSync(root).sort()).toEqual(beside);
  }, 30_000);

  it('BUILD-805: no @getforma/core where the entry can import it', async () => {
    const { dist, config } = fixture(undefined);
    const error = await refusal({ ...config, previewFrame: true });
    expect(error.message).toMatch(/^@getforma\/build: BUILD-805 /);
    expect(error.message).toContain('@getforma/core is not installed');
    expect(existsSync(dist)).toBe(false);
  }, 30_000);

  const refused: Array<[string, string | Uint8Array, RegExp]> = [
    ['</script', 'var a = "</script>";\n', /contains "<\/script"/],
    ['</script in any case', 'var a = "</ScRiPt >";\n', /contains "<\/script"/],
    ['<!--', 'var a = "<!-- x";\n', /contains "<!--"/],
    ['a CRLF line ending', 'var a = 1;\r\nvar b = 2;\n', /contains a carriage return/],
    ['a lone carriage return', 'var a = 1;\rvar b = 2;\n', /contains a carriage return/],
    ['a NUL', 'var a = "\0";\n', /contains a NUL/],
    ['nothing', '', /is empty/],
    ['only whitespace', ' \n\t\n', /is empty/],
    ['bytes that are not UTF-8', Uint8Array.from([0x76, 0x61, 0x72, 0x20, 0xff, 0xfe, 0x0a]), /is not UTF-8/],
  ];

  it.each(refused)('BUILD-806: a runtime with %s fails the build with its code, before anything is written', async (_, frame, reason) => {
    const { root, dist, frameFile, config } = fixture({});
    await build(config);
    const good = snapshot(dist);
    const beside = readdirSync(root).sort();
    writeFileSync(frameFile, frame);

    const error = await refusal({ ...config, previewFrame: true });
    expect(error.message).toMatch(/^@getforma\/build: BUILD-806 /);
    expect(error.message).toMatch(reason);
    expect(error.message).toContain('https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md');
    expect(error.diagnostics![0]).toMatchObject({ code: 'BUILD-806', severity: 'error', file: frameFile });
    expect(snapshot(dist)).toEqual(good);
    expect(readdirSync(root).sort()).toEqual(beside);
  }, 30_000);

  it('BUILD-806 names the line and column of what it refuses', async () => {
    const { frameFile, config } = fixture({ frame: 'var a = 1;\nvar b = "x</script>";\n' });
    const error = await refusal({ ...config, previewFrame: true });
    expect(error.diagnostics![0]).toMatchObject({ code: 'BUILD-806', file: frameFile, line: 2, column: 11 });
    expect(error.message).toContain(`${frameFile}:2:11`);
  }, 30_000);

  it('a refused runtime is the JSON report\'s one diagnostic, so a report from an earlier build is not left standing', async () => {
    const { root, config } = fixture({ frame: '<!--' });
    const report = join(root, 'diagnostics.json');
    writeFileSync(report, JSON.stringify({ version: 1, strict: false, diagnostics: [] }));
    await refusal({ ...config, previewFrame: true, diagnosticsJson: report });
    const json = JSON.parse(readFileSync(report, 'utf8'));
    expect(json.diagnostics.map((d: BuildDiagnostic) => [d.code, d.severity])).toEqual([['BUILD-806', 'error']]);
  }, 30_000);

  it('refuses a previewFrame that is not a boolean, and an entry that takes forma-runtime.js, before anything is written', async () => {
    const { dist, config } = fixture({});
    await expect(build({ ...config, previewFrame: 'yes' as unknown as boolean })).rejects.toThrow(
      /previewFrame is "yes": use true to copy @getforma\/core's preview-frame runtime, or false/,
    );
    await expect(build({
      ...config,
      previewFrame: true,
      entryPoints: [{ entry: config.entryPoints[0]!.entry, outfile: 'forma-runtime.js' }],
      routes: { '/': { js: ['forma-runtime'], css: [] } },
    })).rejects.toThrow(/entryPoints: outfile 'forma-runtime.js' is the preview frame runtime's name/);
    expect(existsSync(dist)).toBe(false);
    // Off, an entry of that name is the application's to choose, as before.
    await build({ ...config, entryPoints: [{ entry: config.entryPoints[0]!.entry, outfile: 'forma-runtime.js' }], routes: { '/': { js: ['forma-runtime'], css: [] } } });
  }, 30_000);

  it('watch mode writes it as forma-runtime.js, unchanged, and the dev manifest names it, with and without code splitting', async () => {
    for (const codeSplitting of [false, true]) {
      const { dist, frameFile, config } = fixture({});
      await watching({ ...config, codeSplitting, previewFrame: true }, async ({ manifest, output }) => {
        await vi.waitFor(() => {
          expect(manifest().build_hash).toBe('dev');
          expect(manifest().assets['forma-runtime.js'], output()).toBe('forma-runtime.js');
        }, { timeout: 10_000 });
        expect(readFileSync(join(dist, 'forma-runtime.js')).equals(readFileSync(frameFile))).toBe(true);
      });
    }
  }, 60_000);

  it('watch mode refuses a runtime it cannot inline, with its code, and leaves the previous output as it was', async () => {
    // Watch mode writes in place: the refusal comes before its clean step.
    const { dist, config } = fixture({ frame: 'a\r\n' });
    await build(config);
    const good = snapshot(dist);
    await watching({ ...config, previewFrame: true }, async ({ output }) => {
      await vi.waitFor(() => expect(output()).toContain('BUILD-806'), { timeout: 10_000 });
    });
    expect(snapshot(dist)).toEqual(good);
  }, 30_000);

  it('BUILD-805 and BUILD-806 carry the catalogue\'s why and fix', async () => {
    const missing = await refusal({ ...fixture(undefined).config, previewFrame: true });
    const refusedRuntime = await refusal({ ...fixture({ frame: '<!--' }).config, previewFrame: true });
    for (const d of [missing.diagnostics![0]!, refusedRuntime.diagnostics![0]!]) {
      const entry = DIAGNOSTIC_CATALOGUE.find(e => e.code === d.code);
      expect(entry, d.code).toBeDefined();
      expect(d.why).toBe(entry!.why);
      expect(d.fix).toBe(entry!.fix);
    }
  }, 30_000);
});
