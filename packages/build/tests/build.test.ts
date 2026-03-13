import { describe, it, expect } from 'vitest';
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
