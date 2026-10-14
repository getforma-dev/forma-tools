/**
 * Watch mode and server-rendered pages (N7, L-31, FORMA-022).
 *
 * N7: an incremental rebuild reaches an updated page in under a second. v1
 * found watch mode rebuilt the bundles but wrote no FMIR module, so a page the
 * server renders never changed on an incremental rebuild (v1 6.4): without
 * code splitting no `.ir` was written at all and the dev manifest named none,
 * and with it the modules were re-emitted only when the BROWSER bundle's graph
 * changed, which a page's own SSR entry need not be part of. L-31: watch mode
 * rewrites the modules of the pages a change touches.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildConfig } from '../src/types';
import { watching } from './helpers/watch';

const temporary: string[] = [];
// The killed watcher's esbuild service can still write for a moment.
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));

/** Two server-rendered pages; only `home` renders `Greeting`. */
function site() {
  const root = mkdtempSync(join(tmpdir(), 'forma-watch-ir-')); temporary.push(root);
  const src = join(root, 'src'); const dist = join(root, 'dist'); mkdirSync(src);
  // `formajs` resolves to a stub for the browser bundle; the compiler reads
  // the source, so the stub is invisible to the FMIR it emits.
  writeFileSync(join(src, 'forma-stub.js'), 'export const h = () => {}; export const mount = () => {};\n');
  writeFileSync(join(src, 'Greeting.ts'), greeting('Hello from the first build'));
  writeFileSync(join(src, 'home.ts'), [
    `import { h, mount } from 'formajs';`,
    `import { Greeting } from './Greeting';`,
    `mount(() => h('main', { id: 'app' }, h('h1', null, 'Home'), Greeting()), '#app');`,
    '',
  ].join('\n'));
  writeFileSync(join(src, 'about.ts'), `import { h, mount } from 'formajs';\nmount(() => h('main', { id: 'app' }, h('h1', null, 'About')), '#app');\n`);
  const config: BuildConfig = {
    entryPoints: [{ entry: join(src, 'home.ts'), outfile: 'home.js' }, { entry: join(src, 'about.ts'), outfile: 'about.js' }],
    routes: { '/': { js: ['home'], css: [] }, '/about': { js: ['about'], css: [] } },
    outputDir: dist,
    formaAlias: join(src, 'forma-stub.js'),
    ssr: true,
  };
  return { src, dist, config };
}

function greeting(text: string): string {
  return `import { h } from 'formajs';\nexport function Greeting() { return h('p', { class: 'greeting' }, ${JSON.stringify(text)}); }\n`;
}

const ir = (dist: string, page: string) => readFileSync(join(dist, `${page}.ir`)).toString('latin1');
const inode = (dist: string, file: string) => statSync(join(dist, file), { bigint: true }).ino;
/** How many times the compiler has emitted `page`'s module (its own log line). */
const emissions = (output: string, page: string) => output.split(`IR emitted (real): ${page}.ir`).length - 1;

describe('watch mode rewrites the FMIR modules of the pages a change touches (N7, L-31)', () => {
  it("rewrites a page's .ir when a component it renders changes, and no other page's", async () => {
    const { src, dist, config } = site();
    await watching(config, async ({ manifest, output }) => {
      // The dev manifest names each page's module, so the server renders
      // Phase 2 in development as it does in production.
      await vi.waitFor(() => {
        const current = manifest();
        expect(current.routes['/'].ir).toBe('home.ir');
        expect(current.routes['/about'].ir).toBe('about.ir');
      }, { timeout: 10_000 });
      expect(ir(dist, 'home')).toContain('Hello from the first build');
      // The child's log reaches this process after the files it wrote do, so
      // the counts are waited for, not read once.
      await vi.waitFor(() => {
        expect(emissions(output(), 'home')).toBe(1);
        expect(emissions(output(), 'about')).toBe(1);
      }, { timeout: 10_000 });
      const home = inode(dist, 'home.ir');
      const about = inode(dist, 'about.ir');

      writeFileSync(join(src, 'Greeting.ts'), greeting('Hello after an edit'));

      await vi.waitFor(() => expect(ir(dist, 'home')).toContain('Hello after an edit'), { timeout: 10_000 });
      expect(ir(dist, 'home')).not.toContain('Hello from the first build');
      // Replaced by rename, so the server never reads half a module.
      expect(inode(dist, 'home.ir')).not.toBe(home);
      await vi.waitFor(() => {
        expect(emissions(output(), 'home')).toBe(2);
        expect(output()).toMatch(/IR rewritten: home\.ir in \d+ ms/);
      }, { timeout: 10_000 });
      // `about` does not render Greeting: its module is neither re-emitted
      // nor rewritten.
      expect(emissions(output(), 'about')).toBe(1);
      expect(inode(dist, 'about.ir')).toBe(about);
      expect(manifest().routes['/'].ir).toBe('home.ir');
      // No temporary file is left behind. One may be in flight: the browser
      // rebuild changes the route's size, so the manifest is rewritten too.
      await vi.waitFor(() => expect(readdirSync(dist).filter(file => file.endsWith('.tmp'))).toEqual([]), { timeout: 5000 });
    });
  }, 30_000);

  it("logs a page's module it could not publish, naming the page, and recovers", async () => {
    // The page watchers run with esbuild's logging off, so an exception while
    // publishing (a module Windows will not let go of, a full disk) became an
    // esbuild result error nobody printed: a stale page with no message.
    const { src, dist, config } = site();
    await watching(config, async ({ manifest, output }) => {
      await vi.waitFor(() => expect(manifest().routes['/'].ir).toBe('home.ir'), { timeout: 10_000 });
      // A directory where the module goes: publishing cannot read or replace it.
      rmSync(join(dist, 'home.ir'));
      mkdirSync(join(dist, 'home.ir'));
      writeFileSync(join(src, 'Greeting.ts'), greeting('Hello while home.ir is blocked'));
      // The page is named; the cause is the filesystem's (EISDIR here).
      await vi.waitFor(() => expect(output()).toMatch(/IR not written for home: \S/), { timeout: 10_000 });

      // The watcher survives: once the path is free, the next edit publishes.
      rmSync(join(dist, 'home.ir'), { recursive: true });
      writeFileSync(join(src, 'Greeting.ts'), greeting('Hello once home.ir is free'));
      await vi.waitFor(() => expect(ir(dist, 'home')).toContain('Hello once home.ir is free'), { timeout: 10_000 });
    });
  }, 30_000);

  it("rewrites a page's .ir when only its SSR entry changes, in a code-splitting build", async () => {
    // The SSR entry is a separate file the browser bundle never imports, so
    // only a watcher over the SSR entry's own graph sees an edit to it.
    const { src, dist, config } = site();
    writeFileSync(join(src, 'about-ssr.ts'), `import { h, mount } from 'formajs';\nmount(() => h('main', { id: 'app' }, h('h1', null, 'About, server-rendered')), '#app');\n`);
    await watching({ ...config, codeSplitting: true, ssrEntryPoints: { about: join(src, 'about-ssr.ts') } }, async ({ manifest }) => {
      await vi.waitFor(() => expect(manifest().routes['/about'].ir).toBe('about.ir'), { timeout: 10_000 });
      expect(ir(dist, 'about')).toContain('About, server-rendered');

      writeFileSync(join(src, 'about-ssr.ts'), `import { h, mount } from 'formajs';\nmount(() => h('main', { id: 'app' }, h('h1', null, 'About, edited')), '#app');\n`);

      await vi.waitFor(() => expect(ir(dist, 'about')).toContain('About, edited'), { timeout: 10_000 });
      expect(manifest().routes['/about'].ir).toBe('about.ir');
      expect(manifest().routes['/'].ir).toBe('home.ir');
    });
  }, 30_000);
});
