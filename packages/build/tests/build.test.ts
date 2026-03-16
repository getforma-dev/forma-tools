import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { build } from '../src/build';
import type {
  BuildConfig,
  BuildEntry,
  BuildResult,
  CssEntry,
  RouteMapping,
  AssetManifest,
  RouteManifest,
} from '../src/types';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Type-only checks (existing)
// ---------------------------------------------------------------------------

describe('@getforma/build', () => {
  describe('type exports', () => {
    it('exports BuildConfig type', () => {
      const config: BuildConfig = {
        entryPoints: [],
        routes: {},
        outputDir: '/tmp/test-dist',
      };
      expect(config).toBeDefined();
      expect(config.outputDir).toBe('/tmp/test-dist');
    });

    it('exports BuildEntry type', () => {
      const entry: BuildEntry = {
        entry: 'src/app.ts',
        outfile: 'app.js',
      };
      expect(entry.entry).toBe('src/app.ts');
      expect(entry.outfile).toBe('app.js');
    });

    it('exports CssEntry type', () => {
      const css: CssEntry = {
        input: ['src/styles/main.css'],
        outfile: 'main.css',
        tailwind: true,
      };
      expect(css.tailwind).toBe(true);
    });

    it('exports RouteMapping type', () => {
      const route: RouteMapping = {
        js: ['app'],
        css: ['main'],
        fonts: ['inter.woff2'],
      };
      expect(route.js).toEqual(['app']);
    });

    it('exports AssetManifest type', () => {
      const manifest: AssetManifest = {
        version: 1,
        build_hash: 'abc123',
        assets: { 'app.js': 'app.abc123.js' },
        routes: {},
      };
      expect(manifest.version).toBe(1);
    });

    it('exports RouteManifest type', () => {
      const route: RouteManifest = {
        js: ['app.abc123.js'],
        css: ['main.def456.css'],
        fonts: ['inter.woff2'],
        total_size_br: 50000,
        budget_warn_threshold: 200000,
      };
      expect(route.total_size_br).toBe(50000);
    });

    it('exports BuildResult type', () => {
      const result: BuildResult = {
        manifest: {
          version: 1,
          build_hash: 'abc123',
          assets: {},
          routes: {},
        },
        buildHash: 'abc123',
        warnings: [],
      };
      expect(result.warnings).toEqual([]);
    });
  });

  describe('build function', () => {
    it('is exported and is an async function', () => {
      expect(typeof build).toBe('function');
    });

    it('accepts a minimal BuildConfig', () => {
      // Just verify the function signature accepts the config type
      // without actually running the build (that would need real files)
      const config: BuildConfig = {
        entryPoints: [
          { entry: 'src/app.ts', outfile: 'app.js' },
        ],
        routes: {
          '/': { js: ['app'], css: ['main'] },
        },
        outputDir: '/tmp/forma-build-test',
        budgetThreshold: 200_000,
      };
      expect(config).toBeDefined();
    });

    it('supports all optional config fields', () => {
      const config: BuildConfig = {
        entryPoints: [],
        routes: {},
        outputDir: '/tmp/test',
        cssEntries: [
          { input: 'src/main.css', outfile: 'main.css', tailwind: true },
          { input: ['a.css', 'b.css'], outfile: 'bundle.css' },
        ],
        formaAlias: './node_modules/@getforma/core/dist/index.js',
        fontDir: 'src/fonts',
        ssr: true,
        ssrEntryPoints: { 'login': 'src/login/app.ts' },
        wasm: { crateDir: '../crates/forma-ir' },
        watch: false,
        budgetThreshold: 150_000,
        serverInlined: ['tenant-login.js', 'forma-platform.css'],
      };
      expect(config.ssr).toBe(true);
      expect(config.budgetThreshold).toBe(150_000);
      expect(config.serverInlined).toHaveLength(2);
    });
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

  // ---- Test 6: Build creates output directory if it doesn't exist --------
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
});
