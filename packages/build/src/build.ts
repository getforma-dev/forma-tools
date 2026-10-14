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
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { serviceWorkerSource } from './service-worker.js';
import { splitGraph, type SplitGraph } from './split-graph.js';
import { createStagingDirectory, replaceDirectory, writeFileAtomic } from './output.js';

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
  preserved: Record<string, string> = {},
): Record<string, string> {
  const distDir = config.outputDir;
  const files = readdirSync(distDir);
  const assets: Record<string, string> = { ...preserved };
  const graphFiles = new Set(Object.values(preserved));
  const serverInlinedSet = new Set(config.serverInlined ?? []);

  for (const file of files) {
    if (graphFiles.has(file) || Object.hasOwn(preserved, file)) continue;
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
 * written. The first four checks close a silent failure mode; the fifth
 * turns a crash into a message:
 *
 *  - An unknown `serviceWorker` value (a near miss such as 'ondemand' in a
 *    JavaScript config) silently produced the precache worker.
 *  - Two entries sharing an `outfile` write one file, and the route serves
 *    whichever build finished last.
 *  - An `outfile` containing a path separator lands esbuild's output in a
 *    subdirectory, which the (non-recursive) hashing pass never sees. The asset
 *    was silently absent from the manifest and its route fell back to an
 *    unhashed name that 404s in production.
 *  - A route naming a JS/CSS base that no entry produces is a typo that
 *    manifests as a missing script tag on a deployed page, not at build time.
 *  - A route whose `js` or `css` is missing (a JavaScript config is not type
 *    checked) threw `TypeError: mapping.css is not iterable`, naming neither
 *    the route nor the key; a string there was read letter by letter.
 *
 * Verified by: packages/build/tests/build.test.ts > "rejects an unknown serviceWorker value, naming it"
 * Verified by: packages/build/tests/build.test.ts > "rejects two entryPoints that share an outfile"
 * Verified by: packages/build/tests/build.test.ts > "rejects a route that names an asset no entry produces"
 * Verified by: packages/build/tests/build.test.ts > "rejects a route without css, naming the route"
 * Verified by: packages/build/tests/build.test.ts > "rejects a route whose js is missing or not an array, naming each route"
 */
function validateConfig(config: BuildConfig): void {
  const problems: string[] = [];
  const entryNames = new Set<string>();

  const serviceWorker: unknown = config.serviceWorker;
  if (serviceWorker !== undefined && serviceWorker !== 'precache' && serviceWorker !== 'on-demand') {
    problems.push(
      `serviceWorker is '${String(serviceWorker)}': use 'precache' (the default) or 'on-demand'`,
    );
  }

  for (const entry of config.entryPoints) {
    if (entryNames.has(entry.outfile)) problems.push(`entryPoints: duplicate outfile '${entry.outfile}'`);
    entryNames.add(entry.outfile);
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

  const baseNames = (route: string, key: 'js' | 'css', value: unknown): string[] => {
    if (Array.isArray(value)) return value;
    problems.push(
      `routes['${route}'].${key} is ${value === undefined ? 'missing' : 'not an array'}: list the route's ${key.toUpperCase()} base names, or [] for none`,
    );
    return [];
  };

  for (const [route, mapping] of Object.entries(config.routes)) {
    for (const name of baseNames(route, 'js', mapping?.js)) {
      if (!jsBases.has(name)) {
        problems.push(
          `routes['${route}'].js names '${name}', but no entryPoint produces '${name}.js'`,
        );
      }
    }
    for (const name of baseNames(route, 'css', mapping?.css)) {
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
  staticDependencies: Record<string, string[]> = {},
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
    const modulepreload = [...new Set(jsFiles.flatMap(file => staticDependencies[file] ?? []))].filter(file => !jsFiles.includes(file));

    // Use route-level fonts if specified, otherwise all fonts
    const routeFonts = mapping.fonts ?? fonts;

    // Calculate total size using brotli sizes when available
    let totalSize = 0;
    for (const f of new Set([...jsFiles, ...modulepreload, ...cssFiles])) {
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
      ...(modulepreload.length ? { modulepreload } : {}),
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
  const onDemand = config.serviceWorker === 'on-demand';
  const swCacheName = `forma-${buildHash.slice(0, 12)}${onDemand ? '-on-demand-v1' : ''}`;
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

  const immutableUrls = onDemand ? [...new Set(Object.values(assets))]
    .filter(file => !file.includes('..') && /^[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{8}\.(?:js|css|wasm)$/.test(file))
    .sort().map(file => `/_assets/${file}`) : undefined;
  const swContent = serviceWorkerSource(swCacheName, precacheUrls, config.watch === true, immutableUrls);

  writeFileAtomic(join(distDir, 'sw.js'), swContent);
  console.log(`   SW generated: dist/sw.js (${config.watch ? 'network-only development' : `cache: ${swCacheName}`})`);
}

// ---------------------------------------------------------------------------
// Watch Mode: Server-Rendered Pages
// ---------------------------------------------------------------------------

/** `formaSsrPlugin` from `@getforma/compiler`, loaded only for SSR builds. */
type SsrPluginFactory = (opts: { page: string; outDir: string; entryPoint?: string }) => esbuild.Plugin;

/**
 * Keep each server-rendered page's FMIR module current in watch mode (N7,
 * L-31). v1 found watch mode rebuilt the bundles but wrote no module, so a
 * page the server renders never changed on an incremental rebuild.
 *
 * Each page gets its own esbuild watcher over its SSR entry (`ssrEntryPoints`,
 * else the browser entry) that writes nothing: it exists to know the page's
 * module graph and to rebuild when a file in it changes, so an edit re-runs
 * the compiler for exactly the pages it touches, including an SSR entry the
 * browser bundle never imports. Packages are left external, as the compiler
 * follows relative imports only. The compiler writes the module into a
 * private directory; it is published into the output by rename, and only when
 * its bytes changed, then `onPublished` updates the manifest. The time from
 * the rebuild's start to the published module is logged per page, for the
 * per-build report (DR-34, FORMA-118).
 *
 * Resolves once every page's first module is published (or has failed: a page
 * that does not compile keeps its last good module, and logs why).
 *
 * Verified by: packages/build/tests/watch-ir.test.ts > "rewrites a page's .ir when a component it renders changes, and no other page's"
 * Verified by: packages/build/tests/watch-ir.test.ts > "rewrites a page's .ir when only its SSR entry changes, in a code-splitting build"
 */
async function watchServerRenderedPages(
  config: BuildConfig,
  shared: esbuild.BuildOptions,
  ssrPlugin: SsrPluginFactory,
  onPublished: (page: string) => void,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'forma-ir-'));
  process.once('exit', () => rmSync(scratch, { recursive: true, force: true }));

  const firstBuilds: Promise<void>[] = [];
  for (const entry of config.entryPoints) {
    if (entry.ssr === false) continue;
    const page = basename(entry.outfile, '.js');
    const source = config.ssrEntryPoints?.[page] ?? entry.entry;
    const emitted = join(scratch, `${page}.ir`);
    const target = join(config.outputDir, `${page}.ir`);
    let started = 0;
    let firstBuilt!: () => void;
    firstBuilds.push(new Promise<void>((resolve) => { firstBuilt = resolve; }));

    const ctx = await esbuild.context({
      ...shared,
      entryPoints: [source],
      outdir: scratch,
      write: false,
      packages: 'external',
      sourcemap: false,
      logLevel: 'silent',
      plugins: [
        { name: 'forma-ir-clock', setup(builder) { builder.onStart(() => { started = performance.now(); }); } },
        ssrPlugin({ page, outDir: scratch, entryPoint: source }),
        {
          name: 'forma-ir-publish',
          setup(builder) {
            builder.onEnd((result) => {
              try {
                if (result.errors.length) {
                  console.warn(`   IR not rewritten for ${page}: ${result.errors[0]!.text} (the last good ${page}.ir stays)`);
                  return;
                }
                if (!existsSync(emitted)) return;
                const bytes = readFileSync(emitted);
                rmSync(emitted, { force: true });
                if (!existsSync(target) || !readFileSync(target).equals(bytes)) {
                  writeFileAtomic(target, bytes);
                  console.log(`   IR rewritten: ${page}.ir in ${Math.round(performance.now() - started)} ms`);
                }
                onPublished(page);
              } finally {
                firstBuilt();
              }
            });
          },
        },
      ],
    });
    // watch() runs the first build itself; waiting for its end (rather than
    // calling rebuild() first) emits each page once at startup, not twice.
    await ctx.watch();
  }
  await Promise.all(firstBuilds);
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
 *
 * A production build writes into a staging directory beside `outputDir` and
 * swaps it in only when every step has succeeded, so a build that fails part
 * way leaves the previous output exactly as it was, and nothing beside it
 * (L-21). The application embeds `outputDir` in its binary, and used to embed
 * half a build after a failure. Watch mode writes in place, as before.
 * Verified by: packages/build/tests/build.test.ts > "leaves the previous build byte-identical when a build fails after writing files"
 * Verified by: packages/build/tests/build.test.ts > "a failed first build leaves no output directory and nothing beside it"
 */
export async function build(config: BuildConfig): Promise<BuildResult> {
  // Validate before anything is written: a config error must not touch the
  // previous build's output on its way to failing.
  validateConfig(config);
  if (config.watch) return buildInto(config, config.outputDir);

  const staging = createStagingDirectory(config.outputDir);
  let result: BuildResult;
  try {
    result = await buildInto({ ...config, outputDir: staging }, config.outputDir);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  // Throws with the previous output restored if the swap itself fails.
  replaceDirectory(staging, config.outputDir);
  return result;
}

/**
 * The pipeline, writing into `config.outputDir`: the staging directory for a
 * production build, the output itself in watch mode. `shownDir` is the
 * directory named in log lines, the one the application reads.
 */
async function buildInto(config: BuildConfig, shownDir: string): Promise<BuildResult> {
  const distDir = config.outputDir;
  const createdDir = !existsSync(distDir);

  // ── Clean output directory (watch mode; a staging directory is new) ──
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
    let formaSsrPlugin: SsrPluginFactory | undefined;

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

    let graph: SplitGraph | undefined;
    const splitOptions: esbuild.BuildOptions = {
      ...shared,
      entryPoints: config.entryPoints.map(entry => ({ in: entry.entry, out: basename(entry.outfile, '.js') })),
      outdir: distDir,
      splitting: true,
      metafile: true,
      entryNames: config.watch ? '[name]' : '[name].[hash]',
      chunkNames: 'chunk.[hash]',
      assetNames: 'asset.[hash]',
      plugins: config.ssr && formaSsrPlugin ? config.entryPoints.filter(entry => entry.ssr !== false).map(entry => formaSsrPlugin!({
        page: basename(entry.outfile, '.js'),
        outDir: distDir,
        entryPoint: config.ssrEntryPoints?.[basename(entry.outfile, '.js')] ?? entry.entry,
      })) : [],
    };

    // ── Build entries ─────────────────────────────────────────────────
    if (config.watch) {
      // Watch mode. The dev manifest maps each name to itself: the split
      // graph's files (with code splitting) and each server-rendered page's
      // `.ir`. Whoever changes either rewrites it.
      const irAssets: Record<string, string> = {};
      let lastManifest = '';
      const writeDevManifest = () => {
        const { manifest, warnings } = generateManifest(config, { ...graph?.assets, ...irAssets }, false, graph?.staticDependencies);
        manifest.build_hash = 'dev';
        const text = JSON.stringify(manifest, null, 2) + '\n';
        // Replaced by rename: the application's server reads this file while
        // the watcher rewrites it. Unchanged content is not rewritten, so a
        // server restarted on a change to the output is not restarted for
        // nothing.
        if (text !== lastManifest) writeFileAtomic(join(distDir, 'manifest.json'), text);
        lastManifest = text;
        return { manifest, warnings };
      };

      // Server-rendered pages: each page's module is watched over its SSR
      // entry's own module graph, apart from the browser bundles (L-31).
      if (formaSsrPlugin) {
        await watchServerRenderedPages(config, shared, formaSsrPlugin, (page) => {
          irAssets[`${page}.ir`] = `${page}.ir`;
          writeDevManifest();
        });
      }

      if (config.codeSplitting && config.entryPoints.length) {
        let previousFiles = new Set<string>();
        const ctx = await esbuild.context({
          ...splitOptions,
          // Not the SSR plugins: the pages' modules are watched above.
          plugins: [{
            name: 'forma-split-manifest',
            setup(builder) {
              builder.onEnd(result => {
                if (result.errors.length || !result.metafile) return;
                graph = splitGraph(result.metafile, config.entryPoints, distDir);
                // Only remove outputs belonging to the previous successful
                // graph. CSS/fonts/IR and failed-build diagnostics stay intact.
                for (const file of previousFiles) if (!graph.files.has(file)) rmSync(join(distDir, file), { force: true });
                previousFiles = graph.files;
                writeDevManifest();
              });
            },
          }],
        });
        // Ensure the first complete graph exists before returning a dev manifest.
        await ctx.rebuild();
        await ctx.watch();
      } else for (const entry of config.entryPoints) {
        const ctx = await esbuild.context({
          ...shared,
          entryPoints: [entry.entry],
          outfile: join(distDir, entry.outfile),
        });
        await ctx.watch();
      }

      // The dev manifest, with identity mappings (unhashed filenames), so the
      // server can boot without a production build.
      const { manifest, warnings } = writeDevManifest();
      console.log(`\nDev manifest written: ${shownDir}/manifest.json`);

      // Generate a dev service worker so /sw.js doesn't 404
      generateServiceWorker(config, {}, 'dev', false);

      return {
        manifest,
        buildHash: 'dev',
        warnings,
      };
    }

    // ── Parallel production builds ────────────────────────────────────
    if (config.codeSplitting && config.entryPoints.length) {
      const result = await esbuild.build(splitOptions);
      if (!result.metafile) throw new Error('Split build did not return its module graph.');
      graph = splitGraph(result.metafile, config.entryPoints, distDir);
      for (const entry of config.entryPoints) {
        if (config.serverInlined?.includes(entry.outfile)) cpSync(join(distDir, graph.assets[entry.outfile]), join(distDir, entry.outfile));
      }
    } else await Promise.all(
      config.entryPoints.map((entry) => {
        const buildOptions: esbuild.BuildOptions = {
          ...shared,
          entryPoints: [entry.entry],
          outfile: join(distDir, entry.outfile),
        };

        if (config.ssr && entry.ssr !== false && formaSsrPlugin) {
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
    const assets = hashAssets(config, graph?.assets);
    console.log(`   ${Object.keys(assets).length} assets hashed`);

    // ── Compression ───────────────────────────────────────────────────
    compressAssets(distDir);

    // ── Manifest generation ───────────────────────────────────────────
    const { manifest, warnings } = generateManifest(config, assets, wasmBuilt, graph?.staticDependencies);

    writeFileSync(
      join(distDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    console.log(
      `\nManifest written: ${shownDir}/manifest.json (build_hash: ${manifest.build_hash.slice(0, 12)}...)`,
    );

    // ── Service worker generation ─────────────────────────────────────
    generateServiceWorker(config, assets, manifest.build_hash, wasmBuilt);

    return {
      manifest,
      buildHash: manifest.build_hash,
      warnings,
    };
  } catch (err) {
    // Watch mode: remove the output directory if this build created it. A
    // production build's caller removes the staging directory.
    if (createdDir && existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
    }
    throw err;
  }
}
