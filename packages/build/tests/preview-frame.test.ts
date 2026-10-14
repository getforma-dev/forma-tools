/**
 * `previewFrame`: the build copies the preview-frame runtime of the
 * `@getforma/core` the bundles import into the application's assets as
 * `forma-runtime.js` (FORMA-175; DR-14 tier (c), DR-26, L-27, L-44).
 *
 * forma-server's `PreviewFrame::load` (FORMA-125) reads the manifest's
 * `assets["forma-runtime.js"]` at start, refuses a runtime it cannot inline
 * (FRAME-103: empty, not UTF-8, `</script`, `<!--`, a carriage return or a
 * NUL) and allows the rest by the SHA-256 of its bytes. Core ships that
 * runtime as `dist/formajs-frame.global.js` (FORMA-128); its
 * `dist/forma-runtime.js` is a CDN alias of the auto-mounting runtime, which
 * shares the target's name and must never be copied.
 *
 * These cases use stand-in cores, each marked with an id in its runtime
 * (`FRAME_<id>`) and in the module the bundles import (`CORE_<id>`), so each
 * says which core the frame copied and which the bundles contain; the
 * resolution cases are review-FORMA-175's scenarios. The end-to-end lane
 * (e2e/frame/) builds against a core packed from formajs and loads the result
 * in forma-server and Chromium.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DIAGNOSTIC_CATALOGUE } from '@getforma/compiler';

import { build } from '../src/build';
import type { AssetManifest, BuildConfig, BuildDiagnostic } from '../src/types';
import { buildInChild } from './helpers/child-build';
import { watching } from './helpers/watch';

/** A frame runtime as core ships it: one classic script, LF only, UTF-8 beyond ASCII, marked with its core's id. */
const frameOf = (id: string) => '"use strict";\n(() => {\n  // é, ✓ and 𝄞: bytes beyond ASCII, copied as they are\n  const label = "<\\/script> written escaped, and <!- not a comment";\n  window.__formaFrame = [label, "FRAME_' + id + '"];\n})();\n';
/** Core's CDN alias of the auto-mounting runtime, which shares the target's name. */
const CDN_ALIAS = '(() => { /* the auto-mounting runtime: never the frame */ })();\n';

const temporary: string[] = [];
let logs: string[];
let runners: string;

beforeAll(() => {
  runners = mkdtempSync(join(tmpdir(), 'forma-preview-frame-runner-'));
});
afterAll(() => rmSync(runners, { recursive: true, force: true }));

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

interface StandIn {
  id?: string;
  version?: string;
  /** `null`: the core ships no frame runtime (older than 2.1.0). */
  frame?: string | Uint8Array | null;
}

/** A stand-in @getforma/core at `dir`; returns its frame runtime's path. */
function standInCore(dir: string, core: StandIn = {}): string {
  const id = core.id ?? 'APP';
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@getforma/core', version: core.version ?? '2.1.0', type: 'module', exports: { '.': './dist/index.js' } }));
  // A nameless package.json inside the package, as some packages ship one: it does not end the package.
  writeFileSync(join(dir, 'dist', 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'dist', 'index.js'), `export const coreId = "CORE_${id}";\n`);
  writeFileSync(join(dir, 'dist', 'forma-runtime.js'), CDN_ALIAS);
  const frameFile = join(dir, 'dist', 'formajs-frame.global.js');
  const frame = core.frame === undefined ? frameOf(id) : core.frame;
  if (frame !== null) writeFileSync(frameFile, frame);
  return frameFile;
}

/** An entry that imports core (or, with `imports: false`, nothing). */
function page(file: string, imports = true, specifier = '@getforma/core'): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, imports ? `import { coreId } from '${specifier}';\nexport const page = coreId;\n` : 'export const page = "home";\n');
  return file;
}

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forma-preview-frame-')); temporary.push(dir);
  writeFileSync(join(dir, 'package.json'), '{"name":"application","private":true}');
  return dir;
}

/** An application with one page and, unless `core` is undefined, a stand-in core it imports. */
function fixture(core?: StandIn, extra: Partial<BuildConfig> = {}) {
  const dir = root();
  const dist = join(dir, 'dist');
  const entry = page(join(dir, 'src', 'app.ts'), core !== undefined);
  const frameFile = core ? standInCore(join(dir, 'node_modules', '@getforma', 'core'), core) : '';
  const config: BuildConfig = {
    entryPoints: [{ entry, outfile: 'app.js' }],
    routes: { '/': { js: ['app'], css: [] } },
    outputDir: dist,
    ...extra,
  };
  return { root: dir, dist, frameFile, config };
}

/** Which core the frame copied, and which cores each bundle contains. */
function cores(dist: string, manifest: AssetManifest): { frame?: string; bundles: Record<string, string[]> } {
  const runtime = manifest.assets['forma-runtime.js'];
  const frame = runtime ? /FRAME_(\w+)/.exec(readFileSync(join(dist, runtime), 'utf8'))?.[1] : undefined;
  const bundles: Record<string, string[]> = {};
  for (const [name, file] of Object.entries(manifest.assets)) {
    if (name === 'forma-runtime.js' || !file.endsWith('.js')) continue;
    bundles[name] = [...new Set([...readFileSync(join(dist, file), 'utf8').matchAll(/CORE_(\w+)/g)].map(m => m[1]!))].sort();
  }
  return { frame, bundles };
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

/** A link to a directory: a junction on Windows, which needs no privilege. */
function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'junction');
}

const sha256 = (bytes: Uint8Array, encoding: 'hex' | 'base64') => createHash('sha256').update(bytes).digest(encoding);

async function refusal(config: BuildConfig): Promise<Error & { diagnostics?: BuildDiagnostic[] }> {
  const error = await build(config).then(() => undefined, (e: unknown) => e as Error & { diagnostics?: BuildDiagnostic[] });
  expect(error, 'the build should have failed').toBeInstanceOf(Error);
  return error!;
}

/** Two entries in two packages, each with its own core (A 2.1.0, and B at `versionB`, whose runtime differs unless `sameRuntime`). */
function twoPackages(versionB: string, sameRuntime = false) {
  const dir = root();
  standInCore(join(dir, 'apps', 'a', 'node_modules', '@getforma', 'core'), { id: 'A' });
  standInCore(join(dir, 'apps', 'b', 'node_modules', '@getforma', 'core'), { id: 'B', version: versionB, ...(sameRuntime ? { frame: frameOf('A') } : {}) });
  const config: BuildConfig = {
    entryPoints: [
      { entry: page(join(dir, 'apps', 'a', 'src', 'a.ts')), outfile: 'a.js' },
      { entry: page(join(dir, 'apps', 'b', 'src', 'b.ts')), outfile: 'b.js' },
    ],
    routes: { '/a': { js: ['a'], css: [] }, '/b': { js: ['b'], css: [] } },
    outputDir: join(dir, 'dist'),
  };
  return { root: dir, dist: config.outputDir, config };
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
    expect(sha256(written, 'base64')).toBe(sha256(Buffer.from(frameOf('APP'), 'utf8'), 'base64'));
    // Never core's file of the target's name, the CDN alias that auto-mounts.
    expect(written.toString('utf8')).not.toBe(CDN_ALIAS);
    // Only under its hashed name: no unhashed copy, and no route loads it.
    expect(existsSync(join(dist, 'forma-runtime.js'))).toBe(false);
    expect(manifest.routes['/'].js).toEqual([result.manifest.assets['app.js']]);
    expect(logs.join('\n')).toContain('Preview frame runtime: forma-runtime.js from @getforma/core 2.1.0');
    expect(logs.join('\n')).toContain('the core the bundles import');
  }, 30_000);

  it('the runtime is inlined, never fetched: no compressed copies, and no entry in the on-demand worker\'s immutable list', async () => {
    const { dist, config } = fixture({});
    const result = await build({ ...config, previewFrame: true, serviceWorker: 'on-demand', app: 'demo' });
    const runtime = result.manifest.assets['forma-runtime.js']!;
    const files = readdirSync(dist);
    expect(files).toContain(runtime);
    expect(files.filter(file => file.startsWith(`${runtime}.`))).toEqual([]);
    // The application's bundle is listed, as before.
    const worker = readFileSync(join(dist, 'sw.js'), 'utf8');
    expect(worker).toContain(`/_assets/${result.manifest.assets['app.js']}`);
    expect(worker).not.toContain('forma-runtime');
  }, 30_000);

  it('with previewFrame off or unset the output is byte-identical, names no runtime, and reads no frame runtime', async () => {
    const unset = fixture({});
    await build(unset.config);
    const before = snapshot(unset.dist);

    const off = fixture({});
    await build({ ...off.config, previewFrame: false });
    // A core whose frame runtime would be refused: not read when off.
    const refusedRuntime = fixture({ frame: '</script>' });
    await build(refusedRuntime.config);

    expect(snapshot(off.dist)).toEqual(before);
    expect(snapshot(refusedRuntime.dist)).toEqual(before);
    const manifest = JSON.parse(readFileSync(join(unset.dist, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.assets)).toEqual(['app.js']);
    expect(Object.keys(before).filter(file => file.startsWith('forma-runtime'))).toEqual([]);
  }, 30_000);

  it('BUILD-805: a core without the frame runtime (older than 2.1.0) fails the build, naming its version, and leaves the previous output as it was', async () => {
    const { root: dir, dist, config } = fixture({ version: '2.0.3', frame: null });
    await build(config);
    const good = snapshot(dist);
    const beside = readdirSync(dir).sort();

    const error = await refusal({ ...config, previewFrame: true });
    expect(error.message).toMatch(/^@getforma\/build: BUILD-805 /);
    expect(error.message).toContain('@getforma/core 2.0.3');
    expect(error.message).toContain('(imported by app.js)');
    expect(error.message).toContain('dist/formajs-frame.global.js');
    expect(error.message).toContain('2.1.0');
    // Core's CDN alias of that name is there, and is not taken instead.
    expect(error.diagnostics).toHaveLength(1);
    expect(error.diagnostics![0]).toMatchObject({ code: 'BUILD-805', severity: 'error', page: '' });
    expect(snapshot(dist)).toEqual(good);
    expect(readdirSync(dir).sort()).toEqual(beside);
  }, 30_000);

  it('BUILD-805: the bundles import no core, and none is installed where the build runs', async () => {
    const { dist, config } = fixture(undefined);
    const error = await refusal({ ...config, previewFrame: true });
    expect(error.message).toMatch(/^@getforma\/build: BUILD-805 /);
    expect(error.message).toContain('the bundles import no @getforma/core, nor is one installed where the build runs');
    expect(existsSync(dist)).toBe(false);
  }, 30_000);

  it('when the bundles import no core, it copies the core installed where the build runs', async () => {
    const { root: dir, dist, config } = fixture(undefined);
    standInCore(join(dir, 'node_modules', '@getforma', 'core'), { id: 'INSTALLED' });
    const child = await buildInChild({ ...config, previewFrame: true }, dir, runners);
    expect(child.message, child.output).toBeUndefined();
    expect(cores(dist, child.manifest!)).toEqual({ frame: 'INSTALLED', bundles: { 'app.js': [] } });
    expect(child.output).toContain('installed where the build runs; the bundles import no core');
  }, 60_000);

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
    const { root: dir, dist, frameFile, config } = fixture({});
    await build(config);
    const good = snapshot(dist);
    const beside = readdirSync(dir).sort();
    writeFileSync(frameFile, frame);

    const error = await refusal({ ...config, previewFrame: true });
    expect(error.message).toMatch(/^@getforma\/build: BUILD-806 /);
    expect(error.message).toMatch(reason);
    expect(error.message).toContain('https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md');
    // The core as esbuild found it: its real path.
    expect(error.diagnostics![0]).toMatchObject({ code: 'BUILD-806', severity: 'error', file: realpathSync(frameFile) });
    expect(snapshot(dist)).toEqual(good);
    expect(readdirSync(dir).sort()).toEqual(beside);
  }, 30_000);

  it('BUILD-806 names the line and column of what it refuses', async () => {
    const { frameFile, config } = fixture({ frame: 'var a = 1;\nvar b = "x</script>";\n' });
    const error = await refusal({ ...config, previewFrame: true });
    expect(error.diagnostics![0]).toMatchObject({ code: 'BUILD-806', file: realpathSync(frameFile), line: 2, column: 11 });
    expect(error.message).toContain(`${realpathSync(frameFile)}:2:11`);
  }, 30_000);

  it('a refused runtime is the JSON report\'s one diagnostic, so a report from an earlier build is not left standing', async () => {
    const { root: dir, config } = fixture({ frame: '<!--' });
    const report = join(dir, 'diagnostics.json');
    writeFileSync(report, JSON.stringify({ version: 1, strict: false, diagnostics: [] }));
    await refusal({ ...config, previewFrame: true, diagnosticsJson: report });
    const json = JSON.parse(readFileSync(report, 'utf8'));
    expect(json.diagnostics.map((d: BuildDiagnostic) => [d.code, d.severity])).toEqual([['BUILD-806', 'error']]);
  }, 30_000);

  it('refuses a previewFrame that is not a boolean, and an entry that takes forma-runtime.js in any case, before anything is written', async () => {
    const { dist, config } = fixture({});
    await expect(build({ ...config, previewFrame: 'yes' as unknown as boolean })).rejects.toThrow(
      /previewFrame is "yes": use true to copy @getforma\/core's preview-frame runtime, or false/,
    );
    // The file systems of macOS and Windows ignore case: Forma-Runtime.js
    // would be the runtime's file, and the manifest would name the bundle.
    for (const outfile of ['forma-runtime.js', 'Forma-Runtime.js', 'FORMA-RUNTIME.js']) {
      for (const codeSplitting of [false, true]) {
        await expect(build({
          ...config,
          previewFrame: true,
          codeSplitting,
          entryPoints: [{ entry: config.entryPoints[0]!.entry, outfile }],
          routes: { '/': { js: [outfile.slice(0, -3)], css: [] } },
        })).rejects.toThrow(`entryPoints: outfile '${outfile}' is the preview frame runtime's name in the manifest (previewFrame)`);
      }
    }
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

  it('BUILD-805, BUILD-806 and BUILD-807 carry the catalogue\'s why and fix', async () => {
    const missing = await refusal({ ...fixture(undefined).config, previewFrame: true });
    const refusedRuntime = await refusal({ ...fixture({ frame: '<!--' }).config, previewFrame: true });
    const differing = await refusal({ ...twoPackages('2.1.1').config, previewFrame: true });
    const reported = [missing, refusedRuntime, differing].map(e => e.diagnostics![0]!);
    expect(reported.map(d => d.code)).toEqual(['BUILD-805', 'BUILD-806', 'BUILD-807']);
    for (const d of reported) {
      const entry = DIAGNOSTIC_CATALOGUE.find(e => e.code === d.code);
      expect(entry, d.code).toBeDefined();
      expect(d.why).toBe(entry!.why);
      expect(d.fix).toBe(entry!.fix);
    }
  }, 30_000);
});

// review-FORMA-175's scenarios: the core the frame copies is the one the
// bundles contain, however the bundles reach it.
describe('previewFrame copies the core the bundles import (DR-26; review-FORMA-175)', () => {
  const one = (entry: string, outputDir: string): BuildConfig => ({
    entryPoints: [{ entry, outfile: 'app.js' }],
    routes: { '/': { js: ['app'], css: [] } },
    outputDir,
    previewFrame: true,
  });

  it('an application in a monorepo whose root has another core: the application\'s, as its bundle', async () => {
    const dir = root();
    standInCore(join(dir, 'node_modules', '@getforma', 'core'), { id: 'ROOT' });
    standInCore(join(dir, 'apps', 'web', 'node_modules', '@getforma', 'core'), { id: 'WEB' });
    const dist = join(dir, 'dist');
    const result = await build(one(page(join(dir, 'apps', 'web', 'src', 'app.ts')), dist));
    expect(cores(dist, result.manifest)).toEqual({ frame: 'WEB', bundles: { 'app.js': ['WEB'] } });
  }, 30_000);

  it('formaAlias resolved from the working directory, as esbuild resolves it: from the monorepo\'s root, the root\'s core', async () => {
    const dir = root();
    standInCore(join(dir, 'node_modules', '@getforma', 'core'), { id: 'ROOT' });
    standInCore(join(dir, 'apps', 'web', 'node_modules', '@getforma', 'core'), { id: 'WEB' });
    const entry = page(join(dir, 'apps', 'web', 'src', 'app.ts'), true, 'formajs');
    for (const [cwd, id] of [[dir, 'ROOT'], [join(dir, 'apps', 'web'), 'WEB']] as const) {
      const dist = join(dir, `dist-${id}`);
      const child = await buildInChild({ ...one(entry, dist), formaAlias: '@getforma/core' }, cwd, runners);
      expect(child.message, child.output).toBeUndefined();
      expect(cores(dist, child.manifest!)).toEqual({ frame: id, bundles: { 'app.js': [id] } });
    }
  }, 60_000);

  it('hoisted: the root\'s core only', async () => {
    const dir = root();
    standInCore(join(dir, 'node_modules', '@getforma', 'core'), { id: 'ROOT' });
    const dist = join(dir, 'dist');
    const result = await build(one(page(join(dir, 'apps', 'web', 'src', 'app.ts')), dist));
    expect(cores(dist, result.manifest)).toEqual({ frame: 'ROOT', bundles: { 'app.js': ['ROOT'] } });
  }, 30_000);

  it('a linked core (npm link, workspaces): the link\'s target, as its bundle', async () => {
    const dir = root();
    standInCore(join(dir, 'linked-core'), { id: 'LINKED' });
    link(join(dir, 'linked-core'), join(dir, 'apps', 'web', 'node_modules', '@getforma', 'core'));
    const dist = join(dir, 'dist');
    const result = await build(one(page(join(dir, 'apps', 'web', 'src', 'app.ts')), dist));
    expect(cores(dist, result.manifest)).toEqual({ frame: 'LINKED', bundles: { 'app.js': ['LINKED'] } });
  }, 30_000);

  it('tsconfig paths to a vendored core: the vendored core, as its bundle', async () => {
    const dir = root();
    standInCore(join(dir, 'node_modules', '@getforma', 'core'), { id: 'NODE' });
    standInCore(join(dir, 'vendor', 'core'), { id: 'VENDOR' });
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@getforma/core': ['./vendor/core/dist/index.js'] } } }));
    const dist = join(dir, 'dist');
    const result = await build(one(page(join(dir, 'src', 'app.ts')), dist));
    expect(cores(dist, result.manifest)).toEqual({ frame: 'VENDOR', bundles: { 'app.js': ['VENDOR'] } });
  }, 30_000);

  it('BUILD-807: entries from two packages with cores whose runtimes differ fail the build, naming each core and its entries', async () => {
    const { root: dir, dist, config } = twoPackages('2.1.1');
    const error = await refusal({ ...config, previewFrame: true });
    expect(error.message).toMatch(/^@getforma\/build: BUILD-807 /);
    expect(error.message).toContain('the bundles import 2 copies of @getforma/core whose frame runtimes differ');
    expect(error.message).toContain('@getforma/core 2.1.0 at ');
    expect(error.message).toContain(`${join('apps', 'a', 'node_modules', '@getforma', 'core')} (imported by a.js)`);
    expect(error.message).toContain('@getforma/core 2.1.1 at ');
    expect(error.message).toContain(`${join('apps', 'b', 'node_modules', '@getforma', 'core')} (imported by b.js)`);
    expect(error.diagnostics![0]).toMatchObject({ code: 'BUILD-807', severity: 'error' });
    expect(existsSync(dist)).toBe(false);
    expect(existsSync(dir)).toBe(true);
  }, 30_000);

  it('one version installed twice, with the same runtime, is one core to the frame: the build copies it', async () => {
    const { dist, config } = twoPackages('2.1.0', true);
    const result = await build({ ...config, previewFrame: true });
    expect(cores(dist, result.manifest)).toEqual({ frame: 'A', bundles: { 'a.js': ['A'], 'b.js': ['B'] } });
    expect(logs.join('\n')).toContain('the same runtime as the 1 other copy they import');
  }, 30_000);

  it('BUILD-807: a library that bundles its own older core (a pnpm layout), naming the core without a frame runtime', async () => {
    const dir = root();
    const store = join(dir, 'node_modules', '.pnpm');
    const current = join(store, '@getforma+core@2.1.0', 'node_modules', '@getforma', 'core');
    const older = join(store, '@getforma+core@2.0.3', 'node_modules', '@getforma', 'core');
    standInCore(current, { id: 'CURRENT' });
    standInCore(older, { id: 'OLDER', version: '2.0.3', frame: null });
    link(current, join(dir, 'node_modules', '@getforma', 'core'));
    const ui = join(store, '@acme+ui@1.0.0', 'node_modules', '@acme', 'ui');
    mkdirSync(ui, { recursive: true });
    writeFileSync(join(ui, 'package.json'), JSON.stringify({ name: '@acme/ui', version: '1.0.0', type: 'module', main: 'index.js' }));
    writeFileSync(join(ui, 'index.js'), "export { coreId as uiCore } from '@getforma/core';\n");
    link(older, join(store, '@acme+ui@1.0.0', 'node_modules', '@getforma', 'core'));
    link(ui, join(dir, 'node_modules', '@acme', 'ui'));
    const entry = join(dir, 'src', 'app.ts');
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, "import { coreId } from '@getforma/core';\nimport { uiCore } from '@acme/ui';\nexport const page = [coreId, uiCore];\n");

    const error = await refusal(one(entry, join(dir, 'dist')));
    expect(error.message).toMatch(/^@getforma\/build: BUILD-807 /);
    expect(error.message).toContain('@getforma/core 2.1.0');
    expect(error.message).toContain('@getforma/core 2.0.3');
    expect(error.message).toContain('which has no frame runtime');
  }, 30_000);

  it('BUILD-805: an old core next to the entry is refused, never another core in a parent directory', async () => {
    const dir = root();
    standInCore(join(dir, 'node_modules', '@getforma', 'core'), { id: 'ROOT' });
    standInCore(join(dir, 'apps', 'web', 'node_modules', '@getforma', 'core'), { id: 'OLD', version: '2.0.3', frame: null });
    const error = await refusal(one(page(join(dir, 'apps', 'web', 'src', 'app.ts')), join(dir, 'dist')));
    expect(error.message).toMatch(/^@getforma\/build: BUILD-805 /);
    expect(error.message).toContain('@getforma/core 2.0.3 at ');
    expect(error.message).toContain(join('apps', 'web', 'node_modules', '@getforma', 'core'));
  }, 30_000);
});
