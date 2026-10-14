/**
 * Build the preview-frame lane's application with THIS working tree's
 * `@getforma/build`, against the `@getforma/core` build.sh installed into
 * e2e/frame/app from a packed tarball (FORMA-175).
 *
 *   node e2e/frame/build-app.mjs
 *
 * Writes, for the Rust server in server/ to embed:
 *
 *   out/dist-on/        `previewFrame: true`: the manifest names
 *                       `forma-runtime.js`, which forma-server's
 *                       `PreviewFrame::load` must accept;
 *   out/dist-off/       the same build without it, which names no runtime
 *                       (forma-server: FRAME-101);
 *   out/dist-tampered/  dist-on with TAMPER appended to the runtime, which
 *                       forma-server must refuse (FRAME-103), as the build
 *                       refuses a core whose runtime holds it (BUILD-806,
 *                       checked by frame.spec.ts);
 *   out/lane.json       what frame.spec.ts checks the server against.
 *
 * Fails loudly unless the build copied core's `dist/formajs-frame.global.js`
 * byte for byte, and never core's `dist/forma-runtime.js` (the CDN alias of
 * the auto-mounting runtime, which shares the target's name).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const app = join(here, 'app');
const out = join(here, 'out');
const core = join(app, 'node_modules', '@getforma', 'core');

/** Appended to the runtime to make one neither the build nor forma-server may inline. */
const TAMPER = '\n/* </script> */\n';

function fail(message) {
  console.error(`frame build-app: ${message}`);
  process.exit(1);
}

if (!existsSync(join(repo, 'packages', 'build', 'dist', 'index.js'))) fail('packages/build/dist is missing; run `npm run build` first');
if (!existsSync(join(core, 'package.json'))) fail(`${core} is missing; run e2e/frame/build.sh, which installs the packed core`);

const { build } = await import(join(repo, 'packages/build/dist/index.js'));
const sha256 = (bytes, encoding) => createHash('sha256').update(bytes).digest(encoding);

const config = (outputDir, extra = {}) => ({
  entryPoints: [{ entry: join(app, 'src', 'app.ts'), outfile: 'app.js' }],
  routes: { '/': { js: ['app'], css: [] } },
  outputDir,
  ...extra,
});

for (const dir of ['dist-on', 'dist-off', 'dist-tampered']) rmSync(join(out, dir), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const on = await build(config(join(out, 'dist-on'), { previewFrame: true }));
const asset = on.manifest.assets['forma-runtime.js'];
if (!asset) fail(`previewFrame: true wrote no assets["forma-runtime.js"]: ${JSON.stringify(on.manifest.assets)}`);
const frame = readFileSync(join(core, 'dist', 'formajs-frame.global.js'));
const written = readFileSync(join(out, 'dist-on', asset));
if (!written.equals(frame)) fail(`${asset} is not core's dist/formajs-frame.global.js byte for byte`);
const cdnAlias = join(core, 'dist', 'forma-runtime.js');
if (existsSync(cdnAlias) && readFileSync(cdnAlias).equals(written)) fail(`${asset} is core's dist/forma-runtime.js, the CDN alias`);
if (asset !== `forma-runtime.${sha256(frame, 'hex').slice(0, 8)}.js`) fail(`${asset} is not named by its content hash`);

const off = await build(config(join(out, 'dist-off')));
if ('forma-runtime.js' in off.manifest.assets) fail('the build without previewFrame names a runtime');

cpSync(join(out, 'dist-on'), join(out, 'dist-tampered'), { recursive: true });
appendFileSync(join(out, 'dist-tampered', asset), TAMPER);

const corePackage = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
const lane = {
  core: { version: corePackage.version, dir: core, frameSha256: sha256(frame, 'base64'), frameBytes: frame.length },
  on: { dist: join(out, 'dist-on'), asset, manifest: on.manifest },
  off: { dist: join(out, 'dist-off'), manifest: off.manifest },
  tamper: TAMPER,
};
writeFileSync(join(out, 'lane.json'), JSON.stringify(lane, null, 2) + '\n');
console.log(`frame build-app: @getforma/core ${corePackage.version}: ${asset} (${frame.length} bytes, sha256-${lane.core.frameSha256})`);
