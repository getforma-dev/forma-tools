import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../src/build';
import { watching } from './helpers/watch';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-split-')); temporary.push(root);
  const src = join(root, 'src'); const dist = join(root, 'dist'); mkdirSync(src);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(src, 'shared.ts'), 'export const singleton = { value: "one runtime" };');
  writeFileSync(join(src, 'later.ts'), 'import { singleton } from "./shared"; export const later = singleton; export const label = "LAZY_FINANCIAL_TOOL";');
  writeFileSync(join(src, 'phone.ts'), 'import { singleton } from "./shared"; export const first = singleton; export const open = () => import("./later");');
  writeFileSync(join(src, 'desktop.ts'), 'import { singleton } from "./shared"; export const second = singleton;');
  const config = { entryPoints: [{ entry: join(src, 'phone.ts'), outfile: 'phone.js' }, { entry: join(src, 'desktop.ts'), outfile: 'desktop.js' }], outputDir: dist, routes: { '/phone': { js: ['phone'], css: [] }, '/desktop': { js: ['desktop'], css: [] } }, codeSplitting: true };
  return { src, dist, config };
}

const chunks = (dist: string) => readdirSync(dist).filter(file => /^chunk\..*\.js$/.test(file));
const listedChunks = (manifest: { assets: Record<string, string> }) => [...new Set(Object.values(manifest.assets))].filter(file => /^chunk\..*\.js$/.test(file));

describe('Opt-in ESM code splitting', () => {
  it('generates opt-in on-demand workers from the real immutable output graph without install-time downloads', async () => {
    const { dist, config } = fixture(); const result = await build({ ...config, serviceWorker: 'on-demand' });
    const worker = readFileSync(join(dist, 'sw.js'), 'utf8');
    expect(worker).toContain('on-demand immutable assets only'); expect(worker).not.toContain('addAll');
    const allowed = JSON.parse(worker.match(/const ASSET_URLS = new Set\((\[.*\])\);/)![1]) as string[];
    expect(allowed.sort()).toEqual([...new Set(Object.values(result.manifest.assets))].filter(name => name.endsWith('.js')).map(name => '/_assets/' + name).sort());
    expect(allowed).not.toContain('/_assets/phone.js'); expect(allowed).not.toContain('/household');
  });
  it('keeps imports executable, lazy chunks deferred and the runtime singleton shared across routes', async () => {
    const { dist, config } = fixture(); const result = await build(config);
    const route = result.manifest.routes['/phone']; expect(route.js).toHaveLength(1);
    expect(route.js[0]).toMatch(/^phone\.[A-Z0-9]{8}\.js$/);
    expect(route.modulepreload).toHaveLength(1);
    const firstFiles = [...route.js, ...route.modulepreload!];
    expect(firstFiles.map(file => readFileSync(join(dist, file), 'utf8')).join('')).not.toContain('LAZY_FINANCIAL_TOOL');
    expect(readdirSync(dist).filter(file => file.endsWith('.js')).map(file => readFileSync(join(dist, file), 'utf8')).join('')).toContain('LAZY_FINANCIAL_TOOL');
    const phone = await import(pathToFileURL(join(dist, route.js[0])).href);
    const desktop = await import(pathToFileURL(join(dist, result.manifest.assets['desktop.js'])).href);
    expect(phone.first).toBe(desktop.second);
    const later = await phone.open(); expect(later.later).toBe(phone.first); expect(later.label).toBe('LAZY_FINANCIAL_TOOL');
    const size = (file: string) => { try { return statSync(join(dist, `${file}.br`)).size; } catch { return statSync(join(dist, file)).size; } };
    expect(route.total_size_br).toBe(firstFiles.reduce((sum, file) => sum + size(file), 0));
    for (const file of readdirSync(dist).filter(file => file.endsWith('.js') && file !== 'sw.js')) expect(Object.values(result.manifest.assets)).toContain(file);
  });
  it('invalidates linked entry URLs after a dynamic chunk changes and remains deterministic otherwise', async () => {
    const { src, config } = fixture(); const before = await build(config); const identical = await build(config);
    expect(identical.buildHash).toBe(before.buildHash);
    writeFileSync(join(src, 'later.ts'), 'import { singleton } from "./shared"; export const later = singleton; export const label = "CHANGED_FINANCIAL_TOOL";');
    const after = await build(config);
    expect(after.manifest.assets['phone.js']).not.toBe(before.manifest.assets['phone.js']);
    expect(after.manifest.assets['desktop.js']).toBe(before.manifest.assets['desktop.js']);
  });
  it('preserves explicitly server-inlined entry copies without overwriting graph manifest mappings', async () => {
    const { dist, config } = fixture(); const result = await build({ ...config, serverInlined: ['phone.js'] });
    expect(readFileSync(join(dist, 'phone.js'), 'utf8')).toBe(readFileSync(join(dist, result.manifest.assets['phone.js']), 'utf8'));
    expect(result.manifest.assets['phone.js']).toMatch(/^phone\.[A-Z0-9]{8}\.js$/);
  });
  it('still emits genuine SSR IR for each configured page while splitting the browser graph', async () => {
    const { src, dist, config } = fixture();
    writeFileSync(join(src, 'phone-ssr.tsx'), 'mount(() => <main><h1>Phone arrival</h1></main>, "#app");');
    writeFileSync(join(src, 'desktop-ssr.tsx'), 'mount(() => <main><h1>Desktop arrival</h1></main>, "#app");');
    const result = await build({ ...config, ssr: true, ssrEntryPoints: { phone: join(src, 'phone-ssr.tsx'), desktop: join(src, 'desktop-ssr.tsx') } });
    for (const [route, text] of [['/phone', 'Phone arrival'], ['/desktop', 'Desktop arrival']]) {
      const file = result.manifest.routes[route].ir; expect(file).toBeDefined();
      const ir = readFileSync(join(dist, file!)); expect(ir.subarray(0, 4).toString()).toBe('FMIR'); expect(ir.toString()).toContain(text);
    }
  });
  it('keeps private browser-decrypted routes Phase 1 in a mixed SSR application', async () => {
    const { src, dist, config } = fixture();
    writeFileSync(join(src, 'phone-ssr.tsx'), 'mount(() => <main>SSR phone shell</main>, "#app");');
    const result = await build({ ...config, entryPoints: config.entryPoints.map(entry => ({ ...entry, ...(entry.outfile === 'desktop.js' ? { ssr: false } : {}) })), ssr: true, ssrEntryPoints: { phone: join(src, 'phone-ssr.tsx') } });
    expect(result.manifest.routes['/phone'].ir).toBeDefined(); expect(result.manifest.routes['/desktop'].ir).toBeUndefined();
    expect(readdirSync(dist).filter(file => file.endsWith('.ir'))).toHaveLength(1);
  });
  it('updates the watched graph and removes obsolete chunks instead of accumulating them', async () => {
    const { src, dist, config } = fixture();
    await watching(config, async ({ manifest }) => {
      // Each read waits for the state it asserts: the watcher rewrites the
      // manifest after esbuild has written the chunks, so a chunk on disk does
      // not yet mean a manifest that lists it.
      const before = await vi.waitFor(() => { const current = manifest(); expect(current.routes['/phone'].modulepreload).toHaveLength(1); return current; }, { timeout: 5000 });
      const oldChunks = chunks(dist);
      expect(before.routes['/phone'].js).toEqual(['phone.js']);
      writeFileSync(join(src, 'later.ts'), 'import { singleton } from "./shared"; export const later = singleton; export const label = "WATCHED_CHANGE";');
      const after = await vi.waitFor(() => { const current = manifest(); expect(listedChunks(current).some(file => !oldChunks.includes(file))).toBe(true); return current; }, { timeout: 5000 });
      expect(after.routes['/phone'].js).toEqual(['phone.js']);
      // The obsolete chunk is removed before the manifest that drops it is
      // written, so the disk and the manifest now agree.
      expect(chunks(dist).sort()).toEqual(listedChunks(after).sort());
      expect(chunks(dist)).toHaveLength(oldChunks.length);
      expect(readFileSync(join(dist, 'sw.js'), 'utf8')).toContain('network-only');
    });
  }, 15_000);
  it('replaces the watched manifest by rename, so a reader never sees half of it', async () => {
    // The previous version of the test above failed intermittently reading
    // manifest.json while a rebuild rewrote it in place (truncate, then
    // write): a reader between the two saw an empty or partial file. A file
    // replaced by rename is a new file, so its inode changes; one rewritten in
    // place keeps it.
    const { src, dist, config } = fixture();
    await watching(config, async ({ manifest }) => {
      await vi.waitFor(() => expect(manifest().build_hash).toBe('dev'), { timeout: 5000 });
      const oldChunks = chunks(dist);
      const inode = () => statSync(join(dist, 'manifest.json'), { bigint: true }).ino;
      const first = inode();
      writeFileSync(join(src, 'later.ts'), 'import { singleton } from "./shared"; export const later = singleton; export const label = "RENAMED_MANIFEST";');
      await vi.waitFor(() => expect(listedChunks(manifest()).some(file => !oldChunks.includes(file))).toBe(true), { timeout: 5000 });
      expect(inode()).not.toBe(first);
      expect(readdirSync(dist).filter(file => file.endsWith('.tmp'))).toEqual([]);
    });
  }, 15_000);
});
