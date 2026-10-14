/**
 * `--strict` against the compiler the build finds (FORMA-119).
 *
 * - BUILD-801: SSR was asked for and @getforma/compiler cannot be loaded. The
 *   build keeps going without modules, as before, and now reports it with its
 *   code; `--strict` fails on it.
 * - A compiler that predates coded diagnostics (0.3.6) cannot tell the build
 *   what it degraded, so `--strict` refuses it rather than pass pages it never
 *   checked.
 *
 * The compiler module is replaced per test (vi.doMock), so this file stays
 * apart from the ones that use the real compiler.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { BuildConfig } from '../src/types';

let tmpRoot: string;
let warnings: string[];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-compiler-'));
  mkdirSync(join(tmpRoot, 'src'), { recursive: true });
  writeFileSync(join(tmpRoot, 'src', 'home.ts'), "export const home = 1;\n");
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('@getforma/compiler');
  vi.restoreAllMocks();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function config(extra: Partial<BuildConfig> = {}): BuildConfig {
  return {
    entryPoints: [{ entry: join(tmpRoot, 'src', 'home.ts'), outfile: 'home.js' }],
    routes: { '/': { js: ['home'], css: [] } },
    outputDir: join(tmpRoot, 'dist'),
    ssr: true,
    ...extra,
  };
}

describe('BUILD-801', () => {
  it('reports SSR without @getforma/compiler with its code, and fails it under --strict', async () => {
    vi.doMock('@getforma/compiler', () => { throw new Error('Cannot find package'); });
    const { build } = await import('../src/build');

    const result = await build(config());
    expect(warnings).toContain('Warning: BUILD-801 @getforma/compiler not available for SSR. Skipping IR emission.');
    expect(result.diagnostics.map((d) => [d.code, d.severity, d.page])).toEqual([['BUILD-801', 'warning', '']]);

    await expect(build(config({ strict: true }))).rejects.toThrow(/BUILD-801/);
  }, 30_000);
});

describe('a compiler without coded diagnostics', () => {
  it('is refused under --strict, and used as before without it', async () => {
    vi.doMock('@getforma/compiler', () => ({
      // The plugin 0.3.6 exports: it ignores `strict` and `onDiagnostics`.
      formaSsrPlugin: () => ({ name: 'forma-ssr-ir', setup() {} }),
    }));
    const { build } = await import('../src/build');

    await expect(build(config({ strict: true }))).rejects.toThrow(/--strict needs @getforma\/compiler 0\.3\.7 or later/);
    const result = await build(config());
    expect(result.diagnostics).toEqual([]);
  }, 30_000);
});
