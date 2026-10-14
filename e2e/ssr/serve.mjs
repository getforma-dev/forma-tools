/**
 * Serve the SSR e2e site that build.sh wrote to e2e/ssr/out/site/, the way a
 * Forma handler serves it: each page with the headers `render_page` produced
 * for it (the CSP carrying that page's nonce, `no-store`, the document security
 * headers), assets under /_assets/.
 *
 *   node e2e/ssr/serve.mjs [port]      (default 3458)
 *
 *   /<case>/          the Phase 2 page (server-rendered by forma's walker)
 *   /<case>/csr       the same build, client-rendered (Phase 1)
 *   /_assets/<file>   the case bundles and modules
 *   /sw.js            an empty worker: render_page registers /sw.js on every page
 *   anything else     404 (the cases' API calls rely on it)
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), 'out', 'site');
const port = Number(process.argv[2] ?? 3458);

if (!existsSync(join(site, '_assets'))) {
  console.error(`serve: ${site} has not been built; run e2e/ssr/build.sh first`);
  process.exit(1);
}

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.ir': 'application/octet-stream' };

/** Resolve a path under `root`, or null if it would leave it. */
function inside(root, path) {
  const full = normalize(join(root, path));
  return full.startsWith(root + '/') && existsSync(full) ? full : null;
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

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
  console.log(`SSR e2e site on http://127.0.0.1:${port}/`);
});
