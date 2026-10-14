/**
 * Build every SSR e2e case with the REAL build pipeline, exactly as an
 * application's `build.ts --ssr` does: `@getforma/build`'s `build()` with
 * `ssr: true`, which bundles the browser entry with esbuild and runs
 * `@getforma/compiler`'s SSR plugin to emit the page's `.ir` module.
 *
 *   node e2e/ssr/build-cases.mjs
 *
 * Inputs: `e2e/ssr/cases/<case>/app.tsx` (plus `slots.json`, read later by the
 * Rust renderer). `@getforma/core` resolves through the symlink build.sh puts at
 * `e2e/ssr/node_modules/@getforma/core` (the FormaJS checkout under test).
 *
 * Outputs: `e2e/ssr/out/build/<case>/` (the build's dist) and every hashed
 * asset copied into `e2e/ssr/out/site/_assets/`, where the pages rendered by
 * render/ reference them (`/_assets/<file>`).
 *
 * The SSR plugin's IR emission is non-fatal by design: when the compiler
 * cannot analyse a page it writes a PLACEHOLDER module and the page silently
 * becomes client-rendered. A placeholder case tests nothing, so this script
 * re-runs `generateRealIr` on each entry and fails unless the served module is
 * byte-identical to the real one, and unless the islands are exactly the ones
 * the case declares (`expectedIslands` below): an anonymous `island_<n>` shell
 * means the compiler gave up on part of the tree.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const casesDir = join(here, 'cases');
const outDir = join(here, 'out');
const buildDir = join(outDir, 'build');
const assetsDir = join(outDir, 'site', '_assets');

/** Islands each case must compile to, by name; every other case has none. */
const expectedIslands = {
  'browser-only': ['Chart'],
  'ledger-arrival': ['Arrival'],
};

function fail(message) {
  console.error(`build-cases: ${message}`);
  process.exit(1);
}

for (const pkg of ['build', 'compiler']) {
  if (!existsSync(join(repo, 'packages', pkg, 'dist', 'index.js'))) {
    fail(`packages/${pkg}/dist is missing; run \`npm run build\` first`);
  }
}
if (!existsSync(join(here, 'node_modules', '@getforma', 'core', 'package.json'))) {
  fail('e2e/ssr/node_modules/@getforma/core is missing; run e2e/ssr/build.sh, which links the FormaJS checkout');
}

const { build } = await import(join(repo, 'packages/build/dist/index.js'));
const { generateRealIr } = await import(join(repo, 'packages/compiler/dist/index.js'));

const cases = readdirSync(casesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (cases.length === 0) fail(`no cases in ${casesDir}`);
for (const name of Object.keys(expectedIslands)) {
  if (!cases.includes(name)) fail(`expectedIslands names ${name}, which is not a case`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

for (const name of cases) {
  const entry = join(casesDir, name, 'app.tsx');
  if (!existsSync(entry)) fail(`${name}: no app.tsx`);
  const dist = join(buildDir, name);

  // One page per case, built under its own name so the hashed files of all
  // cases can share one /_assets/ directory without colliding.
  const { manifest } = await build({
    entryPoints: [{ entry, outfile: `${name}.js` }],
    routes: { '/': { js: [name], css: [] } },
    outputDir: dist,
    ssr: true,
  });

  const route = manifest.routes['/'];
  if (!route?.ir) fail(`${name}: the build emitted no .ir module for route /`);

  const real = generateRealIr(entry);
  if (!real) fail(`${name}: the compiler fell back to a placeholder module (generateRealIr returned null)`);
  const served = readFileSync(join(dist, route.ir));
  if (Buffer.compare(served, Buffer.from(real.binary)) !== 0) {
    fail(`${name}: the served ${route.ir} is not the module generateRealIr emits for ${entry}`);
  }
  const islands = real.islands.map((island) => island.name).sort();
  const expected = [...(expectedIslands[name] ?? [])].sort();
  if (JSON.stringify(islands) !== JSON.stringify(expected)) {
    fail(`${name}: expected islands ${JSON.stringify(expected)}, the compiler emitted ${JSON.stringify(islands)}`);
  }

  for (const file of [...route.js, route.ir]) {
    copyFileSync(join(dist, file), join(assetsDir, file));
  }
  console.log(`built ${name}: ${route.js.join(', ')} + ${route.ir} (islands: ${islands.join(', ') || 'none'})`);
}
