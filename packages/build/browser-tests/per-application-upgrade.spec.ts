// SR28's lifecycle half (FORMA-130, DR-25): a per-application worker in a real
// browser, through upgrade, rollback and upgrade again, with two tabs open.
//
// Two builds, A and B, of application "ledger" are deployed in turn on one
// origin. The server keeps both builds' hashed assets, as two instances during
// a rolling deploy do (and as retention, DR-29, does after it), and answers
// `/sw.js` and the page from whichever build is deployed. The page registers
// `/sw.js` as forma-server does for an application that enabled its worker.
//
// What must hold, from the contract in forma-server's `sw` module:
//  - the new worker waits while any tab of the old one is open, and a reload
//    alone does not end that; an old tab keeps reading its build's assets;
//  - when no tab uses the old worker, the new one takes over and deletes the
//    old build's cache (and Forma's v1 names), never an unrelated cache or a
//    second application's;
//  - the first page that registers is not taken over (no clients.claim()).
import { createServer } from 'node:http';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { appCacheName, serviceWorkerSource } from '../src/service-worker';

type Build = 'A' | 'B';
const BUILDS: Record<Build, { cache: string; asset: string; worker: string }> = {
  A: build('A', 'aaaaaaaaaaaa', 'aaaaaaaa'),
  B: build('B', 'bbbbbbbbbbbb', 'bbbbbbbb'),
};
function build(label: Build, buildHash: string, assetHash: string) {
  const asset = `/_assets/app.${assetHash}.js`;
  const cache = appCacheName('ledger', buildHash);
  return { cache, asset, worker: serviceWorkerSource(cache, [], false, [asset], 'ledger') };
}

const UNRELATED = 'unrelated-app';
const OTHER_APP = 'forma:other:0123456789ab';
const V1 = 'forma-0123456789ab-on-demand-v1';

async function state(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      active: registration?.active?.state ?? null,
      waiting: registration?.waiting !== null && registration?.waiting !== undefined,
      controlled: navigator.serviceWorker.controller !== null,
      caches: (await caches.keys()).sort(),
      text: document.querySelector('main')?.textContent ?? null,
    };
  });
}

/** Poll `page` (reloading it) until `ready` holds, or fail naming the last state. */
async function until(page: Page, ready: (s: Awaited<ReturnType<typeof state>>) => boolean, reload = true) {
  let last;
  for (let attempt = 0; attempt < 40; attempt++) {
    last = await state(page);
    if (ready(last)) return last;
    await page.waitForTimeout(250);
    if (reload) await page.reload();
  }
  throw new Error(`never reached the expected state; last: ${JSON.stringify(last)}`);
}

/** Close every tab, then open one: the waiting worker may now take over. */
async function freshTab(context: BrowserContext, origin: string) {
  for (const page of context.pages()) await page.close();
  const page = await context.newPage();
  await page.goto(origin + '/');
  return page;
}

test('a per-application worker waits for old tabs, then keeps only its own cache, through upgrade, rollback and upgrade', async ({ context }) => {
  test.setTimeout(90_000);
  let deployed: Build = 'A';
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const asset = (Object.keys(BUILDS) as Build[]).find((b) => BUILDS[b].asset === url);
    if (url === '/sw.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
      response.end(BUILDS[deployed].worker);
    } else if (asset) {
      // Both builds' assets stay available, as on two instances of a deploy.
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' });
      response.end(`document.querySelector('main').textContent = 'build ${asset}';`);
    } else if (url === '/seed') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><title>seed</title>');
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end(`<!doctype html><main></main><script type="module" src="${BUILDS[deployed].asset}"></script>`
        + `<script>navigator.serviceWorker.register('/sw.js');</script>`);
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server port');
    const origin = `http://127.0.0.1:${address.port}`;

    // Other caches on the origin before any worker: an unrelated one, a second
    // Forma application's, and a v1 name.
    const seed = await context.newPage();
    await seed.goto(origin + '/seed');
    await seed.evaluate(async (names) => {
      for (const name of names) await (await caches.open(name)).put('/seed', new Response('seed'));
    }, [UNRELATED, OTHER_APP, V1]);

    // -- Build A, two tabs ------------------------------------------------------
    const tab1 = await context.newPage();
    await tab1.goto(origin + '/');
    await tab1.evaluate(() => navigator.serviceWorker.ready);
    // The page that registered is not taken over: no clients.claim().
    expect((await state(tab1)).controlled).toBe(false);
    let s = await until(tab1, (x) => x.controlled && x.caches.includes(BUILDS.A.cache));
    expect(s.text).toBe('build A');
    // A's activation retired the v1 name and nothing else.
    expect(s.caches).toEqual([BUILDS.A.cache, OTHER_APP, UNRELATED].sort());
    const tab2 = await context.newPage();
    await tab2.goto(origin + '/');
    expect((await state(tab2)).controlled).toBe(true);

    // -- Upgrade to B: it waits while A's tabs are open --------------------------
    deployed = 'B';
    await tab1.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await until(tab1, (x) => x.waiting, false);
    // A reload alone does not end the wait, in either tab.
    await tab2.reload();
    await tab1.reload();
    await tab1.waitForTimeout(1_000);
    s = await state(tab1);
    expect(s.waiting).toBe(true);
    expect(s.caches).toContain(BUILDS.A.cache);
    expect(s.caches).not.toContain(BUILDS.B.cache);
    // An old tab still reads its build's asset, from A's cache.
    expect(await tab2.evaluate((asset) => fetch(asset).then((r) => r.text()), BUILDS.A.asset)).toContain("'build A'");

    // -- No tab on A: B takes over and keeps only its own cache ------------------
    let tab = await freshTab(context, origin);
    s = await until(tab, (x) => !x.waiting && x.controlled && x.caches.includes(BUILDS.B.cache));
    expect(s.caches).toEqual([BUILDS.B.cache, OTHER_APP, UNRELATED].sort());
    expect(s.text).toBe('build B');

    // -- Roll back to A: same rules ----------------------------------------------
    deployed = 'A';
    await tab.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    s = await until(tab, (x) => x.waiting, false);
    expect(s.caches).toContain(BUILDS.B.cache);
    tab = await freshTab(context, origin);
    s = await until(tab, (x) => !x.waiting && x.controlled && x.caches.includes(BUILDS.A.cache));
    expect(s.caches).toEqual([BUILDS.A.cache, OTHER_APP, UNRELATED].sort());

    // -- And upgrade to B again ---------------------------------------------------
    deployed = 'B';
    await tab.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    s = await until(tab, (x) => x.waiting, false);
    expect(s.caches).toContain(BUILDS.A.cache);
    tab = await freshTab(context, origin);
    s = await until(tab, (x) => !x.waiting && x.controlled && x.caches.includes(BUILDS.B.cache));
    expect(s.caches).toEqual([BUILDS.B.cache, OTHER_APP, UNRELATED].sort());
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
