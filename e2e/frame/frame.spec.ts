/**
 * The preview frame end to end (FORMA-175, with FORMA-125 and FORMA-128).
 *
 * e2e/frame/build.sh packs @getforma/core from the FormaJS checkout, installs
 * the tarball into a fixture application, builds it with THIS repo's
 * @getforma/build (`previewFrame: true`, and without it), and builds a small
 * forma-server application (e2e/frame/server) that embeds the output and, at
 * start, calls `PreviewFrame::load` on it as an application does. This file
 * starts that server on a free port and checks the chain the setting exists
 * for: the build's `forma-runtime.js` is core's frame runtime byte for byte,
 * forma-server accepts it from the embedded output and allows it by its hash,
 * and in Chromium, under the frame's policy, it mounts a module the host sends
 * over the port. Off, nothing names a runtime and forma-server refuses the
 * frame (FRAME-101); a runtime neither may inline fails the build (BUILD-806)
 * and forma-server (FRAME-103).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const REPO = resolve(__dirname, '../..');
const SERVER = join(__dirname, 'server', 'target', 'debug', `forma-e2e-frame${process.platform === 'win32' ? '.exe' : ''}`);
const LANE = join(__dirname, 'out', 'lane.json');

/** What the server says of one embedded output at start. */
interface Loaded {
  ok: boolean;
  code?: string | null;
  error?: string;
  asset?: string | null;
  embeddedBytes?: number;
  debug?: string;
}
interface Report { origin: string; on: Loaded; off: Loaded; tampered: Loaded }
/** What build-app.mjs built (out/lane.json). */
interface Lane {
  core: { version: string; dir: string; frameSha256: string; frameBytes: number };
  on: { dist: string; asset: string; manifest: { assets: Record<string, string>; routes: unknown } };
  off: { dist: string; manifest: { assets: Record<string, string>; routes: unknown } };
  tamper: string;
}
type Received = { type: string; code?: string; message?: string; height?: number };

let server: ChildProcess | undefined;
let report: Report;
let lane: Lane;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64');
const coreFrame = () => readFileSync(join(lane.core.dir, 'dist', 'formajs-frame.global.js'));

test.beforeAll(async () => {
  expect(existsSync(LANE) && existsSync(SERVER), 'the preview-frame lane is not built; run e2e/frame/build.sh (npm run test:e2e does)').toBe(true);
  lane = JSON.parse(readFileSync(LANE, 'utf8'));
  // Port 0: the server takes a free port and names its origin, so clones of
  // this repo running the lane at once never meet.
  const child = spawn(SERVER, ['0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  server = child;
  const line = await new Promise<string>((resolveLine, reject) => {
    createInterface({ input: child.stdout! }).once('line', resolveLine);
    child.once('exit', (code) => reject(new Error(`forma-e2e-frame exited (${code}) before it listened`)));
  });
  report = JSON.parse(line);
});

test.afterAll(() => {
  server?.kill();
});

const received = (page: Page): Promise<Received[]> =>
  page.evaluate(() => (window as unknown as { received: Received[] }).received);

const send = (page: Page, message: unknown): Promise<void> =>
  page.evaluate((m) => (window as unknown as { send(m: unknown): void }).send(m), message);

test('the build\'s forma-runtime.js is core\'s frame runtime byte for byte, and forma-server\'s PreviewFrame::load accepts it from the embedded output', () => {
  const core = coreFrame();
  expect(lane.on.manifest.assets['forma-runtime.js']).toBe(lane.on.asset);
  expect(lane.on.asset).toMatch(/^forma-runtime\.[0-9a-f]{8}\.js$/);
  expect(readFileSync(join(lane.on.dist, lane.on.asset)).equals(core)).toBe(true);
  // Not core's CDN alias of the auto-mounting runtime, which shares the name.
  expect(readFileSync(join(lane.core.dir, 'dist', 'forma-runtime.js')).equals(core)).toBe(false);

  expect(report.on, report.on.error).toMatchObject({ ok: true, asset: lane.on.asset, embeddedBytes: core.length });
  // The hash forma-server computed over the bytes it embedded is the one of core's file.
  expect(report.on.debug).toContain(`runtime_sha256: "${sha256(core)}"`);
});

test('in Chromium the frame runs that runtime under its hash-only policy and mounts a module the host sends over the port', async ({ page }) => {
  const core = coreFrame();
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content.Security.Policy|Refused to|Trusted Type/i.test(message.text())) violations.push(message.text());
  });
  const frameResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/preview-frame');
  await page.goto(`${report.origin}/host`);

  const response = await frameResponse;
  expect(response.status()).toBe(200);
  const policy = response.headers()['content-security-policy'] ?? '';
  expect(policy).toContain(`script-src 'sha256-${sha256(core)}'`);
  expect(policy).toContain('sandbox allow-scripts');
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain(`frame-ancestors ${report.origin}`);
  // The runtime is in the document as it is, and is the document's one script.
  const document = await response.text();
  expect(document).toContain(`<script>${core.toString('utf8')}</script>`);
  expect(document.match(/<script/g)).toHaveLength(1);

  // `ready` comes only from the runtime, which runs only if its hash matched.
  await expect.poll(() => received(page)).toContainEqual({ type: 'ready' });
  await send(page, {
    type: 'module',
    html: `<div data-forma-state='{"n":0}'><button id="inc" data-on:click="{n++}">+</button><p id="n" data-text="{n}">-</p></div>`,
  });
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('#n')).toHaveText('0');
  await preview.locator('#inc').click();
  await expect(preview.locator('#n')).toHaveText('1');

  // Tier (c): no grants, so a module's data-fetch is refused before any request.
  await send(page, {
    type: 'module',
    html: `<div data-forma-state='{}'><div data-fetch="GET /api/me → me |error:failed"></div><p id="failed" data-text="{failed}">-</p></div>`,
  });
  await expect(preview.locator('#failed')).toHaveText('data-fetch denied: the mount grants no fetch');

  const frame = page.frames().find((f) => new URL(f.url()).pathname === '/preview-frame');
  expect(await frame!.evaluate(() => self.origin)).toBe('null');
  const messages = await received(page);
  expect(messages.filter((m) => m.type === 'ready')).toHaveLength(1);
  expect(messages.some((m) => m.type === 'resize' && typeof m.height === 'number' && m.height > 0)).toBe(true);
  expect(messages.filter((m) => m.type === 'error').map((m) => m.code)).toEqual(['FORMA_E_GRANT_FETCH']);
  expect(await page.evaluate(() => (window as unknown as { loads: number }).loads)).toBe(1);
  expect(violations).toEqual([]);
});

test('with previewFrame off the manifest names no runtime and forma-server refuses the frame with FRAME-101', () => {
  expect(Object.keys(lane.off.manifest.assets)).toEqual(['app.js']);
  expect(report.off).toMatchObject({ ok: false, code: 'FRAME-101' });
  // The setting adds the runtime and nothing else: the same bundle and routes.
  expect(lane.off.manifest.assets['app.js']).toBe(lane.on.manifest.assets['app.js']);
  expect(lane.off.manifest.routes).toEqual(lane.on.manifest.routes);
});

test('a runtime neither may inline: the build refuses it with BUILD-806, and forma-server refuses the same bytes with FRAME-103', async () => {
  expect(report.tampered).toMatchObject({ ok: false, code: 'FRAME-103' });

  // The packed core (with the dependency its bundle imports), its frame
  // runtime with the same bytes appended as the output forma-server refused,
  // imported by the application's page, as the build finds core.
  const root = mkdtempSync(join(tmpdir(), 'forma-frame-tampered-'));
  try {
    const core = join(root, 'node_modules', '@getforma', 'core');
    cpSync(lane.core.dir, core, { recursive: true });
    cpSync(join(lane.core.dir, '..', '..', 'alien-signals'), join(root, 'node_modules', 'alien-signals'), { recursive: true });
    appendFileSync(join(core, 'dist', 'formajs-frame.global.js'), lane.tamper);
    expect(readFileSync(join(core, 'dist', 'formajs-frame.global.js'))
      .equals(readFileSync(join(lane.on.dist, '..', 'dist-tampered', lane.on.asset)))).toBe(true);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'app.ts'), "import { createSignal } from '@getforma/core';\nexport const count = createSignal(0);\n");

    const { build } = await import(pathToFileURL(join(REPO, 'packages', 'build', 'dist', 'index.js')).href);
    const error = await build({
      entryPoints: [{ entry: join(root, 'src', 'app.ts'), outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: join(root, 'dist'),
      previewFrame: true,
    }).then(() => undefined, (e: unknown) => e as Error & { diagnostics?: Array<{ code: string }> });
    expect(error?.message).toMatch(/^@getforma\/build: BUILD-806 /);
    expect(error?.message).toContain('contains "</script"');
    expect(error?.diagnostics?.map((d) => d.code)).toEqual(['BUILD-806']);
    expect(existsSync(join(root, 'dist'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
