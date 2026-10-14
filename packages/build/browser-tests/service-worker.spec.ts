import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { serviceWorkerSource } from '../src/service-worker';

test('a controlled page upgrades its old worker and reads rebuilt CSS/JS on every reload', async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), 'forma-worker-browser-'));
  const jsPath = join(directory, 'app.js');
  const cssPath = join(directory, 'app.css');
  function rebuild(label: string, color: string) {
    writeFileSync(jsPath, `document.querySelector('main').textContent = ${JSON.stringify(label)};`);
    writeFileSync(cssPath, `main { color: ${color}; }`);
  }
  rebuild('before-change', 'rgb(255, 0, 0)');
  // The formerly emitted worker: unchanged URLs and one forever cache.
  let worker = `
    self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => {
      if (!new URL(event.request.url).pathname.startsWith('/_assets/')) return;
      event.respondWith(caches.open('forma-dev').then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        await cache.put(event.request, response.clone());
        return response;
      }));
    });`;
  const server = createServer((request, response) => {
    if (request.url === '/sw.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
      response.end(worker);
    } else if (request.url === '/_assets/app.js' || request.url === '/_assets/app.css') {
      const javascript = request.url.endsWith('.js');
      response.writeHead(200, {
        'Content-Type': javascript ? 'text/javascript' : 'text/css',
        'Cache-Control': 'public, max-age=3600',
      });
      response.end(readFileSync(javascript ? jsPath : cssPath));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><link rel="stylesheet" href="/_assets/app.css"><main></main><script src="/_assets/app.js"></script>');
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server port');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      }
      await caches.open('unrelated-app');
    });
    await page.reload();
    await expect(page.locator('main')).toHaveText('before-change');
    rebuild('after-change', 'rgb(0, 0, 255)');
    // Prove the defect before replacing the worker. The files changed on disk.
    await page.reload();
    await expect(page.locator('main')).toHaveText('before-change');
    await expect(page.locator('main')).toHaveCSS('color', 'rgb(255, 0, 0)');

    worker = serviceWorkerSource('forma-dev', [], true);
    await page.evaluate(async () => {
      const changed = new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      await (await navigator.serviceWorker.getRegistration())!.update();
      await changed;
    });
    await page.reload();
    await expect(page.locator('main')).toHaveText('after-change');
    await expect(page.locator('main')).toHaveCSS('color', 'rgb(0, 0, 255)');
    expect(await page.evaluate(() => caches.keys())).toEqual(['unrelated-app']);
    rebuild('another-rebuild', 'rgb(0, 128, 0)');
    await page.reload();
    await expect(page.locator('main')).toHaveText('another-rebuild');
    await expect(page.locator('main')).toHaveCSS('color', 'rgb(0, 128, 0)');
    expect(await page.evaluate(() => caches.keys())).toEqual(['unrelated-app']);
  } finally {
    await page.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
