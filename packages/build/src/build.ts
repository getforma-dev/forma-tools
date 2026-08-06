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
import { join, extname, basename, dirname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

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

/**
 * Locate the consuming project's installed @tailwindcss/cli entry script,
 * resolving from the current working directory. Returns null if the package
 * is not installed locally.
 */
function resolveTailwindCli(): string | null {
  try {
    const projectRequire = createRequire(join(process.cwd(), 'package.json'));
    const pkgPath = projectRequire.resolve('@tailwindcss/cli/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tailwindcss;
    if (!bin) return null;
    const cliPath = join(dirname(pkgPath), bin);
    return existsSync(cliPath) ? cliPath : null;
  } catch {
    return null;
  }
}

/**
 * Run @tailwindcss/cli on an input file. Prefers the locally installed CLI
 * script executed with the current Node binary — no shell on any platform,
 * so paths with spaces survive and nothing is exposed to shell injection.
 * Falls back to npx for projects that rely on it fetching the CLI on demand —
 * through spawnTool, because npx is a .cmd shim on Windows (see its doc
 * comment for why that needs a shell).
 */
function runTailwind(input: string, outPath: string): void {
  const args = ['-i', input, '-o', outPath, '--minify'];

  const cli = resolveTailwindCli();
  if (cli) {
    execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
    return;
  }

  spawnTool('npx', ['@tailwindcss/cli', ...args], { stdio: 'inherit' });
}

function generateCss(
  config: BuildConfig,
): void {
  if (!config.cssEntries || config.cssEntries.length === 0) return;

  for (const entry of config.cssEntries) {
    const inputs = Array.isArray(entry.input) ? entry.input : [entry.input];
    const outPath = join(config.outputDir, entry.outfile);

    if (entry.tailwind && inputs.length > 0) {
      runTailwind(inputs[0], outPath);
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
// WASM Build
// ---------------------------------------------------------------------------

/**
 * Spawn a developer tool that may be installed either as a native executable
 * or as an npm `.cmd`/`.ps1` shim.
 *
 * `execFileSync` calls CreateProcess, which can only run a real PE image — a
 * `.cmd` shim (which is what `npm i -g` writes on Windows for wasm-pack, npx,
 * tsc and friends) fails with ENOENT/EINVAL. Windows therefore goes through a
 * shell, where arguments are NOT escaped for us, so each one is quoted; `"`
 * cannot appear in a Windows path, which makes that quoting sufficient. POSIX
 * keeps the no-shell path, where a path with spaces is safe as-is.
 * Verified by: packages/build/tests/build.test.ts > "runs a .cmd-shimmed wasm-pack (the Windows npm install shape)"
 */
function spawnTool(
  command: string,
  args: string[],
  options: { stdio: 'inherit' | 'pipe' },
): void {
  const windows = process.platform === 'win32';
  execFileSync(
    windows ? `"${command}"` : command,
    windows ? args.map((a) => `"${a}"`) : args,
    { ...options, shell: windows },
  );
}

function buildWasm(
  config: BuildConfig,
): boolean {
  if (!config.wasm) return false;

  // Probe separately from the build so a COMPILE failure is never reported as
  // "wasm-pack not found" — that message sent people looking for a missing
  // tool while the real error was in their crate.
  try {
    spawnTool('wasm-pack', ['--version'], { stdio: 'pipe' });
  } catch {
    console.warn(
      'Warning: wasm-pack not found — skipping WASM build. SSR pipeline works without it.',
    );
    return false;
  }

  console.log('   Building WASM walker...');
  spawnTool(
    'wasm-pack',
    ['build', '--target', 'web', '--release', config.wasm.crateDir, '--', '--features', 'wasm'],
    { stdio: 'inherit' },
  );

  // Copy wasm outputs to outputDir
  const wasmPkgDir = join(config.wasm.crateDir, 'pkg');
  const wasmFile = 'forma_ir_bg.wasm';
  const wasmLoader = 'forma_ir.js';

  if (!existsSync(join(wasmPkgDir, wasmFile))) {
    throw new Error(
      `wasm-pack reported success but ${join(wasmPkgDir, wasmFile)} does not exist — check that the crate at ${config.wasm.crateDir} builds the forma-ir cdylib`,
    );
  }

  cpSync(join(wasmPkgDir, wasmFile), join(config.outputDir, wasmFile));
  cpSync(join(wasmPkgDir, wasmLoader), join(config.outputDir, wasmLoader));
  console.log(`   WASM built: ${wasmFile}`);
  return true;
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
// Config Validation
// ---------------------------------------------------------------------------

/**
 * Reject configurations whose output cannot be correct, BEFORE anything is
 * written. Both checks close a silent failure mode:
 *
 *  - An `outfile` containing a path separator lands esbuild's output in a
 *    subdirectory, which the (non-recursive) hashing pass never sees. The asset
 *    was silently absent from the manifest and its route fell back to an
 *    unhashed name that 404s in production.
 *  - A route naming a JS/CSS base that no entry produces is a typo that
 *    manifests as a missing script tag on a deployed page, not at build time.
 *
 * Verified by: packages/build/tests/build.test.ts > "rejects a route that names an asset no entry produces"
 */
function validateConfig(config: BuildConfig): void {
  const problems: string[] = [];

  for (const entry of config.entryPoints) {
    if (/[\\/]/.test(entry.outfile)) {
      problems.push(
        `entryPoints: outfile '${entry.outfile}' contains a path separator — outfile is a bare filename inside outputDir`,
      );
    }
    if (!entry.outfile.endsWith('.js')) {
      problems.push(
        `entryPoints: outfile '${entry.outfile}' must end in .js (routes and the SSR page name are derived from it)`,
      );
    }
  }

  const jsBases = new Set(
    config.entryPoints.map((e) => basename(e.outfile, '.js')),
  );
  const cssBases = new Set(
    (config.cssEntries ?? []).map((e) => basename(e.outfile, '.css')),
  );

  for (const [route, mapping] of Object.entries(config.routes)) {
    for (const name of mapping.js) {
      if (!jsBases.has(name)) {
        problems.push(
          `routes['${route}'].js names '${name}', but no entryPoint produces '${name}.js'`,
        );
      }
    }
    for (const name of mapping.css) {
      if (!cssBases.has(name)) {
        problems.push(
          `routes['${route}'].css names '${name}', but no cssEntry produces '${name}.css'`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `@getforma/build: invalid config\n  - ${problems.join('\n  - ')}`,
    );
  }
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
  // Validate before the clean: a config error must not destroy the previous
  // build's output on its way to failing.
  validateConfig(config);

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

      // Generate a dev manifest with identity mappings (unhashed filenames)
      // so the server can boot without a production build
      const { manifest, warnings } = generateManifest(config, {}, false);
      manifest.build_hash = 'dev';

      writeFileSync(
        join(distDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      );
      console.log(`\nDev manifest written: ${distDir}/manifest.json`);

      // Generate a dev service worker so /sw.js doesn't 404
      generateServiceWorker(config, {}, 'dev', false);

      return {
        manifest,
        buildHash: 'dev',
        warnings,
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
