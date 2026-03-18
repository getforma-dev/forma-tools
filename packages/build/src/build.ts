/**
 * @getforma/build — Build Pipeline
 *
 * Parameterized build pipeline extracted from the GateWASM admin build.ts.
 * Handles: esbuild bundling, CSS generation, font copying, SSR IR emission,
 * island registry generation, WASM builds, content hashing, compression,
 * manifest generation, service worker generation, and budget warnings.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, extname, basename } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';

import type {
  BuildConfig,
  BuildResult,
  AssetManifest,
  RouteManifest,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hash a file and return an 8-char hex prefix. */
function contentHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// CSS Generation
// ---------------------------------------------------------------------------

function generateCss(
  config: BuildConfig,
): void {
  if (!config.cssEntries || config.cssEntries.length === 0) return;

  for (const entry of config.cssEntries) {
    const inputs = Array.isArray(entry.input) ? entry.input : [entry.input];
    const outPath = join(config.outputDir, entry.outfile);

    if (entry.tailwind && inputs.length > 0) {
      // Run @tailwindcss/cli on the first input (use execFileSync to avoid shell injection)
      execFileSync(
        'npx',
        ['@tailwindcss/cli', '-i', inputs[0], '-o', outPath, '--minify'],
        { stdio: 'inherit' },
      );
    } else {
      // Concatenate all input CSS files
      const cssConcat = inputs
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');
      writeFileSync(outPath, cssConcat);
    }
  }
}

// ---------------------------------------------------------------------------
// Font Copying
// ---------------------------------------------------------------------------

function copyFonts(config: BuildConfig): void {
  if (!config.fontDir || !existsSync(config.fontDir)) return;

  for (const fontFile of readdirSync(config.fontDir)) {
    if (fontFile.endsWith('.woff2')) {
      cpSync(join(config.fontDir, fontFile), join(config.outputDir, fontFile));
    }
  }
}

// ---------------------------------------------------------------------------
// Island Registry Generation
// ---------------------------------------------------------------------------

function generateIslandRegistries(
  config: BuildConfig,
): string[] {
  const generatedRegistries: string[] = [];

  for (const entry of config.entryPoints) {
    const pageName = basename(entry.outfile, '.js');
    const islandMetaPath = join(config.outputDir, `${pageName}.islands.json`);

    if (!existsSync(islandMetaPath)) continue;

    const islands = JSON.parse(readFileSync(islandMetaPath, 'utf8')) as Array<{
      id: number;
      name: string;
    }>;
    if (islands.length === 0) continue;

    const registrySource = [
      `// Auto-generated island registry for ${pageName}`,
      `// Islands discovered: ${islands.map((i) => i.name).join(', ')}`,
      `import { activateIslands } from '@getforma/core';`,
      `import PageComponent from '../${entry.entry}';`,
      ``,
      `// Map all micro-islands to the page's root component`,
      `const registry = {`,
      ...islands.map((i) => `  '${i.name}': PageComponent,`),
      `};`,
      ``,
      `activateIslands(registry);`,
      ``,
    ].join('\n');

    const registryPath = join(config.outputDir, `${pageName}.islands.js`);
    writeFileSync(registryPath, registrySource);
    generatedRegistries.push(pageName);

    console.log(
      `   Island registry: ${pageName}.islands.js (${islands.length} islands)`,
    );
  }

  if (generatedRegistries.length > 0) {
    console.log(
      `   Generated ${generatedRegistries.length} island registry entry points`,
    );
  }

  return generatedRegistries;
}

// ---------------------------------------------------------------------------
// WASM Build
// ---------------------------------------------------------------------------

function buildWasm(
  config: BuildConfig,
): boolean {
  if (!config.wasm) return false;

  try {
    execFileSync('wasm-pack', ['--version'], { stdio: 'pipe' });

    console.log('   Building WASM walker...');
    execFileSync(
      'wasm-pack',
      ['build', '--target', 'web', '--release', config.wasm.crateDir, '--', '--features', 'wasm'],
      { stdio: 'inherit' },
    );

    // Copy wasm outputs to outputDir
    const wasmPkgDir = join(config.wasm.crateDir, 'pkg');
    const wasmFile = 'forma_ir_bg.wasm';
    const wasmLoader = 'forma_ir.js';

    if (existsSync(join(wasmPkgDir, wasmFile))) {
      cpSync(join(wasmPkgDir, wasmFile), join(config.outputDir, wasmFile));
      cpSync(join(wasmPkgDir, wasmLoader), join(config.outputDir, wasmLoader));
      console.log(`   WASM built: ${wasmFile}`);
      return true;
    }
  } catch {
    console.warn(
      'Warning: wasm-pack not found — skipping WASM build. SSR pipeline works without it.',
    );
  }

  return false;
}

// ---------------------------------------------------------------------------
// Content Hashing
// ---------------------------------------------------------------------------

function hashAssets(
  config: BuildConfig,
): Record<string, string> {
  const distDir = config.outputDir;
  const files = readdirSync(distDir);
  const assets: Record<string, string> = {};
  const serverInlinedSet = new Set(config.serverInlined ?? []);

  for (const file of files) {
    const ext = extname(file);
    // Only hash .js, .css, .wasm, .ir files; skip manifest.json, .woff2, etc.
    if (ext !== '.js' && ext !== '.css' && ext !== '.wasm' && ext !== '.ir')
      continue;

    const filePath = join(distDir, file);
    // Skip directories
    if (!statSync(filePath).isFile()) continue;

    const hash = contentHash(filePath);
    const base = basename(file, ext);
    const hashedName = `${base}.${hash}${ext}`;

    // Keep unhashed copy for files inlined by the server
    if (serverInlinedSet.has(file)) {
      cpSync(filePath, join(distDir, hashedName));
    } else {
      renameSync(filePath, join(distDir, hashedName));
    }
    assets[file] = hashedName;
  }

  return assets;
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

function compressAssets(distDir: string): number {
  const COMPRESSIBLE_EXTS = new Set(['.js', '.css']);
  let compressCount = 0;

  for (const file of readdirSync(distDir)) {
    const ext = extname(file);
    if (!COMPRESSIBLE_EXTS.has(ext)) continue;

    const filePath = join(distDir, file);
    if (!statSync(filePath).isFile()) continue;

    const content = readFileSync(filePath);

    // Brotli (level 11 — max compression)
    const br = brotliCompressSync(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    });
    if (br.length < content.length) {
      writeFileSync(`${filePath}.br`, br);
    }

    // Gzip (level 9 — max compression)
    const gz = gzipSync(content, { level: 9 });
    if (gz.length < content.length) {
      writeFileSync(`${filePath}.gz`, gz);
    }

    compressCount++;
  }

  console.log(`   ${compressCount} files compressed (brotli 11 + gzip 9)`);
  return compressCount;
}

// ---------------------------------------------------------------------------
// Manifest Generation
// ---------------------------------------------------------------------------

function generateManifest(
  config: BuildConfig,
  assets: Record<string, string>,
  wasmBuilt: boolean,
): { manifest: AssetManifest; warnings: string[] } {
  const distDir = config.outputDir;
  const BUDGET_THRESHOLD = config.budgetThreshold ?? 200_000;
  const warnings: string[] = [];

  // Build hash: SHA-256 of all hashed filenames sorted and joined
  const buildHash = createHash('sha256')
    .update(Object.values(assets).sort().join(','))
    .digest('hex');

  // Collect font files (stable names, not hashed)
  const fonts = readdirSync(distDir)
    .filter((f) => f.endsWith('.woff2'))
    .sort();

  // Build route manifest
  const routes: Record<string, RouteManifest> = {};

  for (const [route, mapping] of Object.entries(config.routes)) {
    const jsFiles = mapping.js.map(
      (name) => assets[`${name}.js`] ?? `${name}.js`,
    );
    const cssFiles = mapping.css.map(
      (name) => assets[`${name}.css`] ?? `${name}.css`,
    );

    // Use route-level fonts if specified, otherwise all fonts
    const routeFonts = mapping.fonts ?? fonts;

    // Calculate total size using brotli sizes when available
    let totalSize = 0;
    for (const f of [...jsFiles, ...cssFiles]) {
      const brPath = join(distDir, `${f}.br`);
      const origPath = join(distDir, f);
      if (existsSync(brPath)) {
        totalSize += statSync(brPath).size;
      } else if (existsSync(origPath)) {
        totalSize += statSync(origPath).size;
      }
    }
    // Add font sizes (uncompressed — woff2 is already compressed)
    for (const f of routeFonts) {
      const fp = join(distDir, f);
      if (existsSync(fp)) {
        totalSize += statSync(fp).size;
      }
    }

    const routeEntry: RouteManifest = {
      js: jsFiles,
      css: cssFiles,
      fonts: routeFonts,
      total_size_br: totalSize,
      budget_warn_threshold: BUDGET_THRESHOLD,
    };

    // If SSR mode, check for .ir files and add to route manifest
    if (config.ssr) {
      const pageName = mapping.js[0];
      if (pageName) {
        const irFile = `${pageName}.ir`;
        if (assets[irFile]) {
          routeEntry.ir = assets[irFile];
        }
      }
    }

    routes[route] = routeEntry;

    // Budget warning
    if (totalSize > BUDGET_THRESHOLD) {
      const kb = (totalSize / 1024).toFixed(1);
      const msg = `Budget exceeded: ${route} -> ${kb}KB (threshold: ${BUDGET_THRESHOLD / 1024}KB)`;
      warnings.push(msg);
      console.warn(`   Warning: ${msg}`);
    }
  }

  // Assemble manifest
  const manifest: AssetManifest = {
    version: 1,
    build_hash: buildHash,
    assets,
    routes,
  };

  if (wasmBuilt && assets['forma_ir.js'] && assets['forma_ir_bg.wasm']) {
    manifest.wasm = {
      loader: assets['forma_ir.js'],
      binary: assets['forma_ir_bg.wasm'],
    };
  }

  return { manifest, warnings };
}

// ---------------------------------------------------------------------------
// Service Worker Generation
// ---------------------------------------------------------------------------

function generateServiceWorker(
  config: BuildConfig,
  assets: Record<string, string>,
  buildHash: string,
  wasmBuilt: boolean,
): void {
  const distDir = config.outputDir;
  const swCacheName = `forma-${buildHash.slice(0, 12)}`;
  const fonts = readdirSync(distDir)
    .filter((f) => f.endsWith('.woff2'))
    .sort();

  // Precache: all CSS assets + all font files
  const precacheUrls = [
    ...Object.entries(assets)
      .filter(([orig]) => orig.endsWith('.css'))
      .map(([, hashed]) => `/_assets/${hashed}`),
    ...fonts.map((f) => `/_assets/${f}`),
  ];

  // Add WASM assets to precache if built
  if (wasmBuilt && assets['forma_ir.js'] && assets['forma_ir_bg.wasm']) {
    precacheUrls.push(`/_assets/${assets['forma_ir.js']}`);
    precacheUrls.push(`/_assets/${assets['forma_ir_bg.wasm']}`);
  }

  const swContent = `// Generated by @getforma/build — do not edit
const CACHE_NAME = '${swCacheName}';
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/_assets/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
`;

  writeFileSync(join(distDir, 'sw.js'), swContent);
  console.log(`   SW generated: dist/sw.js (cache: ${swCacheName})`);
}

// ---------------------------------------------------------------------------
// Main Build Function
// ---------------------------------------------------------------------------

/**
 * Run the Forma build pipeline.
 *
 * Orchestrates: clean, CSS generation, font copying, esbuild bundling
 * (with optional SSR IR emission), island registry generation, WASM build,
 * content hashing, compression, manifest generation, service worker
 * generation, and budget warnings.
 */
export async function build(config: BuildConfig): Promise<BuildResult> {
  const distDir = config.outputDir;
  const createdDir = !existsSync(distDir);

  // ── Clean output directory ────────────────────────────────────────
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  try {
    // ── CSS generation ────────────────────────────────────────────────
    generateCss(config);

    // ── Font copying ──────────────────────────────────────────────────
    copyFonts(config);

    // ── esbuild shared config ─────────────────────────────────────────
    const shared: Partial<esbuild.BuildOptions> = {
      bundle: true,
      format: 'esm',
      target: 'es2022',
      alias: config.formaAlias
        ? { 'formajs': config.formaAlias }
        : {},
      minify: !config.watch,
      sourcemap: config.watch ? 'inline' : false,
      logLevel: 'info',
      jsx: 'transform',
      jsxFactory: 'h',
      jsxFragment: 'Fragment',
    };

    // ── Lazy-load SSR plugin only when needed ─────────────────────────
    let formaSsrPlugin:
      | ((opts: {
          page: string;
          outDir: string;
          entryPoint?: string;
        }) => esbuild.Plugin)
      | undefined;

    if (config.ssr) {
      console.log('SSR mode enabled — emitting IR files');
      try {
        const mod = await import('@getforma/compiler');
        formaSsrPlugin = mod.formaSsrPlugin;
      } catch {
        console.warn(
          'Warning: @getforma/compiler not available for SSR. Skipping IR emission.',
        );
      }
    }

    // ── Build entries ─────────────────────────────────────────────────
    if (config.watch) {
      // Watch mode
      for (const entry of config.entryPoints) {
        const ctx = await esbuild.context({
          ...shared,
          entryPoints: [entry.entry],
          outfile: join(distDir, entry.outfile),
        });
        await ctx.watch();
      }

      // In watch mode, return a minimal result
      return {
        manifest: {
          version: 1,
          build_hash: 'watch-mode',
          assets: {},
          routes: {},
        },
        buildHash: 'watch-mode',
        warnings: [],
      };
    }

    // ── Parallel production builds ────────────────────────────────────
    await Promise.all(
      config.entryPoints.map((entry) => {
        const buildOptions: esbuild.BuildOptions = {
          ...shared,
          entryPoints: [entry.entry],
          outfile: join(distDir, entry.outfile),
        };

        if (config.ssr && formaSsrPlugin) {
          const pageName = basename(entry.outfile, '.js');
          const ssrEntryPoint =
            config.ssrEntryPoints?.[pageName] ?? entry.entry;
          buildOptions.plugins = [
            ...(buildOptions.plugins || []),
            formaSsrPlugin({
              page: pageName,
              outDir: distDir,
              entryPoint: ssrEntryPoint,
            }),
          ];
        }

        return esbuild.build(buildOptions);
      }),
    );

    // ── Island registry generation ────────────────────────────────────
    if (config.ssr) {
      generateIslandRegistries(config);
    }

    // ── WASM build ────────────────────────────────────────────────────
    const wasmBuilt = buildWasm(config);

    // ── Content hashing ───────────────────────────────────────────────
    const assets = hashAssets(config);
    console.log(`   ${Object.keys(assets).length} assets hashed`);

    // ── Compression ───────────────────────────────────────────────────
    compressAssets(distDir);

    // ── Manifest generation ───────────────────────────────────────────
    const { manifest, warnings } = generateManifest(config, assets, wasmBuilt);

    writeFileSync(
      join(distDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    console.log(
      `\nManifest written: ${distDir}/manifest.json (build_hash: ${manifest.build_hash.slice(0, 12)}...)`,
    );

    // ── Service worker generation ─────────────────────────────────────
    generateServiceWorker(config, assets, manifest.build_hash, wasmBuilt);

    return {
      manifest,
      buildHash: manifest.build_hash,
      warnings,
    };
  } catch (err) {
    // Clean up output directory if we created it, to prevent stale partial output
    if (createdDir && existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
    }
    throw err;
  }
}
