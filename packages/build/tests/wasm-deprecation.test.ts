/**
 * The `wasm` config key and the wasm-pack step are deprecated, and are removed
 * in 3.0.0 with the WASM walker (FORMA-131; DR-23). A config that sets the key
 * gets BUILD-803 once per build() call, on the console and in
 * BuildResult.warnings, as BUILD-802 does; the wasm-pack step, when it runs,
 * says BUILD-804, and that build's result lists it. What the build does is
 * unchanged: the step still runs and the manifest still names its outputs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from '../src/build';
import type { AssetManifest, BuildConfig } from '../src/types';

/** The console warnings that start with `code`. */
function logged(warn: { mock: { calls: unknown[][] } }, code: string): string[] {
  return warn.mock.calls.map((args) => String(args[0])).filter((line) => line.startsWith(`Warning: ${code} `));
}

/** The result's warnings that start with `code`. */
function listed(warnings: string[], code: string): string[] {
  return warnings.filter((line) => line.startsWith(`${code} `));
}

/**
 * A wasm-pack first on PATH that writes the two files a real one does into
 * `<crateDir>/pkg` (the shape of build.test.ts's .cmd-shim test).
 */
function fakeWasmPack(binDir: string, crateDir: string): void {
  const pkgDir = join(crateDir, 'pkg');
  mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(
      join(binDir, 'wasm-pack.cmd'),
      [
        '@echo off',
        'if "%~1"=="--version" ( echo wasm-pack 0.0.0-test & exit /b 0 )',
        `if not exist "${pkgDir}" mkdir "${pkgDir}"`,
        `> "${join(pkgDir, 'forma_ir_bg.wasm')}" echo fake-wasm-binary`,
        `> "${join(pkgDir, 'forma_ir.js')}" echo export const init = 1;`,
        'exit /b 0',
        '',
      ].join('\r\n'),
    );
  } else {
    const shim = join(binDir, 'wasm-pack');
    writeFileSync(
      shim,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "wasm-pack 0.0.0-test"; exit 0; fi',
        `mkdir -p "${pkgDir}"`,
        `echo fake-wasm-binary > "${join(pkgDir, 'forma_ir_bg.wasm')}"`,
        `echo "export const init = 1;" > "${join(pkgDir, 'forma_ir.js')}"`,
        '',
      ].join('\n'),
    );
    chmodSync(shim, 0o755);
  }
}

describe('the deprecated wasm key and wasm-pack step (FORMA-131)', () => {
  let tmpRoot: string;
  let config: BuildConfig;
  let prevPath: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'forma-wasm-deprecation-'));
    mkdirSync(join(tmpRoot, 'src'), { recursive: true });
    mkdirSync(join(tmpRoot, 'crate'), { recursive: true });
    writeFileSync(join(tmpRoot, 'src', 'app.ts'), 'export const x = 1;\n');
    config = {
      entryPoints: [{ entry: join(tmpRoot, 'src', 'app.ts'), outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: join(tmpRoot, 'dist'),
    };
    prevPath = process.env.PATH;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.PATH = prevPath;
    vi.restoreAllMocks();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('a config that sets wasm warns BUILD-803 once per build, naming 3.0.0', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No wasm-pack on PATH: the key alone is enough to warn.
    const emptyBin = join(tmpRoot, 'empty-bin');
    mkdirSync(emptyBin);
    process.env.PATH = emptyBin;

    const first = await build({ ...config, wasm: { crateDir: join(tmpRoot, 'crate') } });
    expect(logged(warn, 'BUILD-803')).toHaveLength(1);
    const second = await build({ ...config, wasm: { crateDir: join(tmpRoot, 'crate') } });
    expect(logged(warn, 'BUILD-803')).toHaveLength(2);

    for (const result of [first, second]) {
      const lines = listed(result.warnings, 'BUILD-803');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('the wasm key is deprecated');
      expect(lines[0]).toContain('removed in 3.0.0');
      expect(logged(warn, 'BUILD-803')[0]).toBe(`Warning: ${lines[0]}`);
      // The step did not run, so it did not warn.
      expect(listed(result.warnings, 'BUILD-804')).toEqual([]);
    }
    expect(logged(warn, 'BUILD-804')).toEqual([]);
    expect(warn.mock.calls.map((args) => String(args[0]))).toContain(
      'Warning: wasm-pack not found — skipping WASM build. SSR pipeline works without it.',
    );
  }, 20_000);

  it('the wasm-pack step warns BUILD-804 when it runs, and still ships the walker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crateDir = join(tmpRoot, 'crate');
    const binDir = join(tmpRoot, 'bin');
    fakeWasmPack(binDir, crateDir);
    process.env.PATH = binDir + delimiter + prevPath;

    const result = await build({ ...config, wasm: { crateDir } });

    const lines = logged(warn, 'BUILD-804');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('the wasm-pack step is deprecated');
    expect(lines[0]).toContain('removed in 3.0.0');
    expect(listed(result.warnings, 'BUILD-804')).toEqual([lines[0]!.slice('Warning: '.length)]);
    expect(listed(result.warnings, 'BUILD-803')).toHaveLength(1);
    // Deprecated, not changed: the step still ships the walker.
    const manifest: AssetManifest = JSON.parse(readFileSync(join(config.outputDir, 'manifest.json'), 'utf8'));
    expect(manifest.wasm?.binary).toMatch(/^forma_ir_bg\.[0-9a-f]{8}\.wasm$/);
    expect(manifest.wasm?.loader).toMatch(/^forma_ir\.[0-9a-f]{8}\.js$/);
  }, 20_000);

  it('a strict build that still sets wasm passes, with BUILD-803 and BUILD-804 as notes in its report (FORMA-119)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crateDir = join(tmpRoot, 'crate');
    const binDir = join(tmpRoot, 'bin');
    fakeWasmPack(binDir, crateDir);
    process.env.PATH = binDir + delimiter + prevPath;
    const report = join(tmpRoot, 'diagnostics.json');

    // The old path keeps working in A2: strict mode does not fail on it.
    const result = await build({ ...config, wasm: { crateDir }, strict: true, diagnosticsJson: report });

    const expected = [['BUILD-803', 'note', ''], ['BUILD-804', 'note', '']];
    expect(result.diagnostics.map((d) => [d.code, d.severity, d.page])).toEqual(expected);
    const json = JSON.parse(readFileSync(report, 'utf8'));
    expect(json.diagnostics.map((d: { code: string; severity: string; page: string }) => [d.code, d.severity, d.page])).toEqual(expected);
  }, 20_000);

  it('a config without wasm warns neither', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await build(config);

    expect(logged(warn, 'BUILD-803')).toEqual([]);
    expect(logged(warn, 'BUILD-804')).toEqual([]);
    expect(listed(result.warnings, 'BUILD-803')).toEqual([]);
    expect(listed(result.warnings, 'BUILD-804')).toEqual([]);
  }, 20_000);
});
