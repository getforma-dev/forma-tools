/**
 * Serve the SSR e2e site that build.sh wrote to e2e/ssr/out/site/, the way a
 * Forma handler serves it: each page with the headers `render_page` produced
 * for it (the CSP carrying that page's nonce, `no-store`, the document security
 * headers), assets under /_assets/.
 *
 *   node e2e/ssr/serve.mjs [port]      (default 3458; see origin.ts)
 *
 *   /<case>/          the Phase 2 page (server-rendered by forma's walker)
 *   /<case>/csr       the same build, client-rendered (Phase 1)
 *   /_assets/<file>   the case bundles and modules
 *   /sw.js            an empty worker: render_page registers /sw.js on every page
 *   /__site           which site this server serves, and whether it is built:
 *                     regressions.spec.ts refuses to run against another
 *                     clone's server (Playwright reuses whatever answers on
 *                     the port)
 *   anything else     404 (the cases' API calls rely on it)
 *
 * The server starts even when the site has not been built, so the FormaJS-only
 * spec (e2e/full-stack.spec.ts) can run without cargo or a forma checkout; the
 * SSR spec then fails at its /__site check, naming build.sh.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(realpathSync(dirname(fileURLToPath(import.meta.url))), 'out', 'site');
const port = Number(process.argv[2] ?? 3458);

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.ir': 'application/octet-stream' };

/** Resolve a path under `root`, or null if it would leave it or does not exist. */
function inside(root, path) {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return existsSync(full) ? full : null;
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (path === '/__site') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ site, built: existsSync(join(site, '_assets')) }));
    return;
  }

  const page = /^\/([a-z0-9-]+)\/(csr)?$/.exec(path);
  if (page) {
    const name = page[2] ? 'csr' : 'index';
    const html = inside(site, `${page[1]}/${name}.html`);
    if (html) {
      const headers = JSON.parse(readFileSync(html.replace(/\.html$/, '.headers.json'), 'utf8'));
      res.writeHead(200, headers);
      res.end(readFileSync(html));
      return;
    }
  }

  if (path.startsWith('/_assets/')) {
    const file = inside(join(site, '_assets'), path.slice('/_assets/'.length));
    if (file) {
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(readFileSync(file));
      return;
    }
  }

  if (path === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end('// e2e: no-op worker\n');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found\n');
}).listen(port, '127.0.0.1', () => {
  console.log(`SSR e2e site ${site} on http://127.0.0.1:${port}/`);
});
