import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { build } from '../src/build';
import * as publicApi from '../src/index';
import type { BuildConfig, AssetManifest } from '../src/types';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  mkdirSync,
  readdirSync,
  chmodSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------
//
// This replaces ten "exports X type" tests that assigned an object literal to a
// typed const and asserted a field of the literal they had just written. Vitest
// strips types without checking them, so those ran as `expect('app.js').toBe(
// 'app.js')` — they passed with build.ts deleted. Types are checked by
// `tsc --noEmit` in CI; what a runtime test can pin is the VALUE surface.

describe('@getforma/build public API', () => {
  it('exports exactly the documented runtime surface', () => {
    // Two-sided: a dropped export fails, and so does an undocumented addition.
    expect(Object.keys(publicApi).sort()).toEqual(['build']);
    expect(typeof publicApi.build).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Functional tests — actually run build() against temp directories
// ---------------------------------------------------------------------------

describe('@getforma/build — functional', () => {
  let tmpRoot: string;
  let srcDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-test-'));
    srcDir = join(tmpRoot, 'src');
    outDir = join(tmpRoot, 'dist');
    mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ---- Test 1: Full pipeline produces manifest.json ----------------------
  it('full pipeline produces manifest.json with expected fields', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: {
        '/': { js: ['app'], css: [] },
      },
      outputDir: outDir,
    };

    const result = await build(config);

    // manifest.json must exist on disk
    const manifestPath = join(outDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    );

    // Required top-level fields
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('build_hash');
    expect(manifest).toHaveProperty('assets');
    expect(manifest).toHaveProperty('routes');

    expect(manifest.version).toBe(1);
    expect(typeof manifest.build_hash).toBe('string');
    expect(manifest.build_hash.length).toBeGreaterThan(0);

    // The original "app.js" should be hashed to "app.<8hex>.js"
    const hashedAppJs = manifest.assets['app.js'];
    expect(hashedAppJs).toBeDefined();
    expect(hashedAppJs).toMatch(/^app\.[0-9a-f]{8}\.js$/);

    // Result object should agree with disk manifest
    expect(result.manifest.build_hash).toBe(manifest.build_hash);
    expect(result.warnings).toEqual([]);
  }, 15_000);

  // ---- Test 2: Content-hashed filenames exist on disk --------------------
  it('content-hashed filenames actually exist on disk', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const greeting = "hello";\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    const hashedFilename = manifest.assets['app.js'];
    expect(hashedFilename).toBeDefined();

    // The hashed file must actually exist on disk
    const hashedPath = join(outDir, hashedFilename);
    expect(existsSync(hashedPath)).toBe(true);

    // The ORIGINAL unhashed name should NOT exist (it was renamed)
    expect(existsSync(join(outDir, 'app.js'))).toBe(false);
  }, 15_000);

  // ---- Test 3: Compressed files are generated ----------------------------
  it('generates .br and .gz compressed files for JS output', async () => {
    // Use enough content so compressed versions are smaller than original.
    // Generate valid TS with unique variable names so esbuild doesn't error.
    const entryFile = join(srcDir, 'app.ts');
    const lines = Array.from({ length: 200 }, (_, i) =>
      `export const var_${i} = "some repeated content for compression testing ${i}";`,
    );
    writeFileSync(entryFile, lines.join('\n') + '\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    const hashedJs = manifest.assets['app.js'];
    expect(hashedJs).toBeDefined();

    // .br and .gz should exist alongside the hashed file
    expect(existsSync(join(outDir, `${hashedJs}.br`))).toBe(true);
    expect(existsSync(join(outDir, `${hashedJs}.gz`))).toBe(true);
  }, 15_000);

  // ---- Test 4: Font copying works ----------------------------------------
  it('copies .woff2 font files from fontDir to outputDir', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    // Create a fake font dir with a .woff2 file
    const fontDir = join(tmpRoot, 'fonts');
    mkdirSync(fontDir, { recursive: true });
    writeFileSync(join(fontDir, 'inter.woff2'), 'fake-woff2-data');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      fontDir,
    };

    await build(config);

    // The font file should be copied to the output directory
    expect(existsSync(join(outDir, 'inter.woff2'))).toBe(true);
    expect(readFileSync(join(outDir, 'inter.woff2'), 'utf8')).toBe(
      'fake-woff2-data',
    );

    // The manifest's route should reference the font
    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.routes['/'].fonts).toContain('inter.woff2');
  }, 15_000);

  // ---- Test 5: Multiple entry points get separate hashed files -----------
  it('multiple entry points produce separate hashed assets', async () => {
    const appFile = join(srcDir, 'app.ts');
    const dashFile = join(srcDir, 'dashboard.ts');
    writeFileSync(appFile, 'export const app = "app";\n');
    writeFileSync(dashFile, 'export const dash = "dashboard";\n');

    const config: BuildConfig = {
      entryPoints: [
        { entry: appFile, outfile: 'app.js' },
        { entry: dashFile, outfile: 'dashboard.js' },
      ],
      routes: {
        '/': { js: ['app'], css: [] },
        '/dashboard': { js: ['dashboard'], css: [] },
      },
      outputDir: outDir,
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    // Both assets should be present and hashed
    const hashedApp = manifest.assets['app.js'];
    const hashedDash = manifest.assets['dashboard.js'];

    expect(hashedApp).toBeDefined();
    expect(hashedDash).toBeDefined();
    expect(hashedApp).toMatch(/^app\.[0-9a-f]{8}\.js$/);
    expect(hashedDash).toMatch(/^dashboard\.[0-9a-f]{8}\.js$/);

    // They should have DIFFERENT hashes (different content)
    expect(hashedApp).not.toBe(hashedDash);

    // Both hashed files should exist on disk
    expect(existsSync(join(outDir, hashedApp))).toBe(true);
    expect(existsSync(join(outDir, hashedDash))).toBe(true);

    // Routes should reference the correct hashed files
    expect(manifest.routes['/'].js).toEqual([hashedApp]);
    expect(manifest.routes['/dashboard'].js).toEqual([hashedDash]);
  }, 15_000);

  // ---- Test 6: Tailwind entries run the locally installed CLI ------------
  it('runs a locally installed @tailwindcss/cli via node (no npx, no shell)', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const cssFile = join(srcDir, 'main.css');
    writeFileSync(cssFile, '.a { color: red; }\n');

    // Fake @tailwindcss/cli installed in the project's node_modules — the
    // build must resolve it from cwd and run its bin script with
    // process.execPath, which works identically on POSIX and Windows.
    const cliDir = join(tmpRoot, 'node_modules', '@tailwindcss', 'cli');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(
      join(cliDir, 'package.json'),
      JSON.stringify({
        name: '@tailwindcss/cli',
        version: '0.0.0-test',
        bin: { tailwindcss: './cli.mjs' },
      }),
    );
    writeFileSync(
      join(cliDir, 'cli.mjs'),
      [
        `import { readFileSync, writeFileSync } from 'node:fs';`,
        `const args = process.argv.slice(2);`,
        `const input = args[args.indexOf('-i') + 1];`,
        `const output = args[args.indexOf('-o') + 1];`,
        `writeFileSync(output, '/* built-by-fake-tailwind */\\n' + readFileSync(input, 'utf8'));`,
      ].join('\n'),
    );

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: ['main'] } },
      cssEntries: [{ input: cssFile, outfile: 'main.css', tailwind: true }],
      outputDir: outDir,
    };

    // Resolution starts from cwd, so run the build from the fake project root
    const prevCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await build(config);
    } finally {
      process.chdir(prevCwd);
    }

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    const hashedCss = manifest.assets['main.css'];
    expect(hashedCss).toBeDefined();
    expect(hashedCss).toMatch(/^main\.[0-9a-f]{8}\.css$/);

    const cssOut = readFileSync(join(outDir, hashedCss), 'utf8');
    expect(cssOut).toContain('/* built-by-fake-tailwind */');
    expect(cssOut).toContain('.a { color: red; }');

    expect(manifest.routes['/'].css).toEqual([hashedCss]);
  }, 15_000);

  // ---- Test 7: Build creates output directory if it doesn't exist --------
  it('creates outputDir if it does not already exist', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    // Point to a deeply nested dir that doesn't exist yet
    const deepOutDir = join(tmpRoot, 'nested', 'deep', 'dist');
    expect(existsSync(deepOutDir)).toBe(false);

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: deepOutDir,
    };

    await build(config);

    // The directory should now exist with manifest inside
    expect(existsSync(deepOutDir)).toBe(true);
    expect(existsSync(join(deepOutDir, 'manifest.json'))).toBe(true);
  }, 15_000);

  // ---- Test 8: serverInlined keeps the unhashed copy ----------------------
  it('keeps an unhashed copy of a serverInlined asset and hashes it too', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      serverInlined: ['app.js'],
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    // Both names exist and hold identical bytes — the server inlines the
    // unhashed one, the browser fetches the hashed one.
    expect(existsSync(join(outDir, 'app.js'))).toBe(true);
    expect(readFileSync(join(outDir, manifest.assets['app.js']!), 'utf8')).toBe(
      readFileSync(join(outDir, 'app.js'), 'utf8'),
    );
    // The route still points at the hashed name, not the inlined copy.
    expect(manifest.routes['/']!.js).toEqual([manifest.assets['app.js']]);
  }, 15_000);

  // ---- Test 9: budget warnings ------------------------------------------
  it('reports a budget warning on the result AND still writes the manifest', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(
      entryFile,
      Array.from({ length: 400 }, (_, i) => `export const v${i} = "${i}-${'x'.repeat(40)}";`).join('\n'),
    );

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      budgetThreshold: 128,
    };

    const result = await build(config);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Budget exceeded: /');
    // A budget warning is advisory: the build still completes.
    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.routes['/']!.total_size_br).toBeGreaterThan(128);
    expect(manifest.routes['/']!.budget_warn_threshold).toBe(128);
  }, 15_000);

  // ---- Test 10/11: config validation ------------------------------------
  it('rejects a route that names an asset no entry produces', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');
    writeFileSync(join(outDir, '..', 'sentinel'), 'x'); // outDir does not exist yet

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      // 'dashboard' is a typo for 'app', and 'main' has no cssEntry.
      routes: { '/': { js: ['dashboard'], css: ['main'] } },
      outputDir: outDir,
    };

    await expect(build(config)).rejects.toThrow(
      /routes\['\/'\]\.js names 'dashboard'[\s\S]*routes\['\/'\]\.css names 'main'/,
    );
    // Validation runs BEFORE the output directory is cleaned, so a config typo
    // never destroys the previous build.
    expect(existsSync(outDir)).toBe(false);
  }, 15_000);

  it('rejects an outfile that is a path rather than a filename', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const config: BuildConfig = {
      // esbuild would happily write dist/pages/app.js, but the hashing pass
      // only reads the top level of outputDir — the asset would vanish from
      // the manifest and the route would 404 in production.
      entryPoints: [{ entry: entryFile, outfile: 'pages/app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    await expect(build(config)).rejects.toThrow(/contains a path separator/);
  }, 15_000);

  // ---- Test 12: WASM build through a .cmd-shimmed tool -------------------
  it('runs a .cmd-shimmed wasm-pack (the Windows npm install shape)', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const crateDir = join(tmpRoot, 'crate');
    const pkgDir = join(crateDir, 'pkg');
    mkdirSync(crateDir, { recursive: true });

    // `npm i -g wasm-pack` installs a .cmd shim on Windows, which
    // CreateProcess (execFileSync without a shell) cannot exec — the exact
    // shape of dogfood finding #1, where the tailwind step spawned npx.cmd.
    // Without shell:true this build reports "wasm-pack not found" and silently
    // ships no WASM.
    const binDir = join(tmpRoot, 'bin');
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

    const prevPath = process.env.PATH;
    process.env.PATH = binDir + delimiter + prevPath;
    try {
      await build({
        entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
        routes: { '/': { js: ['app'], css: [] } },
        outputDir: outDir,
        wasm: { crateDir },
      });
    } finally {
      process.env.PATH = prevPath;
    }

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    // The tool ran, its outputs were copied, hashed, and wired into the manifest.
    expect(manifest.wasm).toBeDefined();
    expect(manifest.wasm!.binary).toMatch(/^forma_ir_bg\.[0-9a-f]{8}\.wasm$/);
    expect(manifest.wasm!.loader).toMatch(/^forma_ir\.[0-9a-f]{8}\.js$/);
    expect(existsSync(join(outDir, manifest.wasm!.binary))).toBe(true);
    expect(readFileSync(join(outDir, manifest.wasm!.binary), 'utf8').trim())
      .toBe('fake-wasm-binary');
  }, 20_000);
});

// ---------------------------------------------------------------------------
// SSR builds: the .ir is the only island artifact
// ---------------------------------------------------------------------------

describe('@getforma/build — SSR output', () => {
  let tmpRoot: string;
  let srcDir: string;
  let outDir: string;

  /**
   * A page with one registered island, wired the way the compiler requires:
   * `activateIslands({ StatusPanel })` in the entry, the root `*Page` component
   * imported from a relative path. Returns the entry file path.
   *
   * `formajs` is aliased to a local stub so esbuild can bundle without the real
   * runtime installed; the compiler reads the SOURCE, so the stub is invisible
   * to IR emission.
   */
  function writeIslandPage(): string {
    writeFileSync(
      join(srcDir, 'forma-stub.js'),
      [
        'export const h = () => {};',
        'export const mount = () => {};',
        'export const activateIslands = () => {};',
        'export const createSignal = (v) => [() => v, () => {}];',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(srcDir, 'StatusPanel.ts'),
      [
        `import { h, createSignal } from 'formajs';`,
        `export const [statusText, setStatusText] = createSignal('idle');`,
        `export function StatusPanel() {`,
        `  return h('section', { class: 'status' }, h('span', null, () => statusText()));`,
        `}`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(srcDir, 'HomePage.ts'),
      [
        `import { h } from 'formajs';`,
        `import { StatusPanel } from './StatusPanel';`,
        `export function HomePage() {`,
        `  return h('main', { id: 'app' }, h('h1', null, 'Home'), StatusPanel());`,
        `}`,
        '',
      ].join('\n'),
    );
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(
      entryFile,
      [
        `import { activateIslands } from 'formajs';`,
        `import { HomePage } from './HomePage';`,
        `import { StatusPanel } from './StatusPanel';`,
        `activateIslands({ StatusPanel });`,
        `export { HomePage };`,
        '',
      ].join('\n'),
    );
    return entryFile;
  }

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-ssr-'));
    srcDir = join(tmpRoot, 'src');
    outDir = join(tmpRoot, 'dist');
    mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('emits the .ir and NO island byproducts', async () => {
    const entryFile = writeIslandPage();

    await build({
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      formaAlias: join(srcDir, 'forma-stub.js'),
      ssr: true,
      ssrEntryPoints: { app: entryFile },
    });

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    // The page really does have an island, so this test is not vacuous: the
    // IR is bigger than the ~136-byte placeholder and the route is wired to it.
    const irName = manifest.assets['app.ir'];
    expect(irName).toMatch(/^app\.[0-9a-f]{8}\.ir$/);
    expect(manifest.routes['/']!.ir).toBe(irName);
    const ir = readFileSync(join(outDir, irName!));
    expect(String.fromCharCode(ir[0]!, ir[1]!, ir[2]!, ir[3]!)).toBe('FMIR');
    expect(ir.length).toBeGreaterThan(200);
    // Island table entry count (u16 at the islands section offset) is 1.
    const islandTableOffset = ir.readUInt32LE(40);
    expect(ir.readUInt16LE(islandTableOffset)).toBe(1);

    // …and NOTHING island-shaped is left in the output directory or the
    // manifest. The generated `<page>.islands.js` registry was unusable in
    // every dimension — an unbundled bare `@getforma/core` import, a
    // `../src/...` path that cannot resolve from the output directory, and a
    // mapping of every island to the page ROOT component — while
    // `<page>.islands.json` was build metadata nothing read. Both were hashed,
    // compressed and manifested, so consumers had to delete them by hand.
    const stray = readdirSync(outDir).filter((f) => f.includes('.islands.'));
    expect(stray).toEqual([]);
    expect(Object.keys(manifest.assets).filter((k) => k.includes('.islands.'))).toEqual([]);
  }, 30_000);

  it('emits one .ir per entry for a multi-route build', async () => {
    const entryFile = writeIslandPage();
    const secondEntry = join(srcDir, 'about.ts');
    writeFileSync(
      secondEntry,
      [
        `import { h, mount } from 'formajs';`,
        `mount(() => h('main', { id: 'app' }, h('h1', null, 'About')), '#app');`,
        '',
      ].join('\n'),
    );

    const manifestResult = await build({
      entryPoints: [
        { entry: entryFile, outfile: 'app.js' },
        { entry: secondEntry, outfile: 'about.js' },
      ],
      routes: {
        '/': { js: ['app'], css: [] },
        '/about': { js: ['about'], css: [] },
      },
      outputDir: outDir,
      formaAlias: join(srcDir, 'forma-stub.js'),
      ssr: true,
      ssrEntryPoints: { app: entryFile, about: secondEntry },
    });

    // Per-route IR, each addressed by its own hashed name — and still no
    // per-entry byproducts to clean up (the ksx ledger's #12: the scrub had to
    // be repeated for every entry).
    expect(manifestResult.manifest.routes['/']!.ir).toBe(
      manifestResult.manifest.assets['app.ir'],
    );
    expect(manifestResult.manifest.routes['/about']!.ir).toBe(
      manifestResult.manifest.assets['about.ir'],
    );
    expect(manifestResult.manifest.routes['/']!.ir)
      .not.toBe(manifestResult.manifest.routes['/about']!.ir);
    expect(readdirSync(outDir).filter((f) => f.includes('.islands.'))).toEqual([]);
  }, 30_000);
});
