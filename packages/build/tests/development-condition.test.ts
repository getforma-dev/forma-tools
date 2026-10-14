/**
 * Watch mode is a development build: it resolves each package's `development`
 * export condition (FORMA-169).
 *
 * `@getforma/core` points the condition at a build of every entry that keeps
 * its development warnings; without it, an application built from npm never
 * sees one. These cases use stand-in packages, one per condition that
 * matters, so they say which file each build resolved without depending on
 * core's release: `development` (selected in watch mode only), `module`
 * (esbuild adds it by itself only while no custom conditions are set, so
 * listing `development` alone would drop it) and `browser` (esbuild adds it by
 * platform whatever the list says). Each package's file exports its name; the
 * application exports what it imported, and the test imports the bundle.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../src/build';
import type { BuildConfig } from '../src/types';
import { watching } from './helpers/watch';

const temporary: string[] = [];
// A watched build's esbuild service can still be writing for a moment after
// its process is killed, so removal retries ENOTEMPTY.
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));

/** A package in the fixture's node_modules whose `exports` is `conditions`, each file exporting its own name. */
function stand_in(root: string, name: string, conditions: Record<string, string>): void {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', exports: { '.': { import: Object.fromEntries(Object.entries(conditions).map(([condition, file]) => [condition, `./${file}`])) } } }));
  for (const [condition, file] of Object.entries(conditions)) {
    writeFileSync(join(dir, file), `export default ${JSON.stringify(`${name}:${condition}`)};\n`);
  }
}

function fixture(codeSplitting: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'forma-development-')); temporary.push(root);
  const src = join(root, 'src'); const dist = join(root, 'dist'); mkdirSync(src);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  // Shaped as @getforma/core's branches are: development, then default.
  stand_in(root, 'dual-build', { development: 'dev.js', default: 'prod.js' });
  stand_in(root, 'module-first', { module: 'module.js', default: 'main.js' });
  stand_in(root, 'browser-first', { browser: 'browser.js', default: 'node.js' });
  writeFileSync(join(src, 'app.ts'), [
    "import dual from 'dual-build';",
    "import moduleFirst from 'module-first';",
    "import browserFirst from 'browser-first';",
    'export const resolved = [dual, moduleFirst, browserFirst, process.env.NODE_ENV];',
    '',
  ].join('\n'));
  const config: BuildConfig = {
    entryPoints: [{ entry: join(src, 'app.ts'), outfile: 'app.js' }],
    routes: { '/': { js: ['app'], css: [] } },
    outputDir: dist,
    codeSplitting,
  };
  return { dist, config };
}

/** What the bundle at `file` resolved, by importing it. */
async function resolvedBy(file: string): Promise<string[]> {
  // A fresh URL per import, so a rewritten file is not served from the cache.
  return (await import(`${pathToFileURL(file).href}?${Date.now()}`)).resolved;
}

describe('watch mode resolves the development export condition (FORMA-169)', () => {
  it('watch mode resolves the development condition and keeps module and browser, with and without code splitting', async () => {
    for (const codeSplitting of [false, true]) {
      const { dist, config } = fixture(codeSplitting);
      await watching(config, async ({ manifest }) => {
        // Watch mode writes the dev manifest after its first build, under the
        // entry's own name. (`manifest()` also fails the test if the child died.)
        await vi.waitFor(() => {
          expect(manifest().build_hash).toBe('dev');
          expect(existsSync(join(dist, 'app.js'))).toBe(true);
        }, { timeout: 10_000 });
        // Retried: the first build may still be writing the bundle.
        await vi.waitFor(async () => {
          expect(await resolvedBy(join(dist, 'app.js')), `codeSplitting: ${codeSplitting}`).toEqual([
            'dual-build:development',
            'module-first:module',
            'browser-first:browser',
            'development',
          ]);
        }, { timeout: 10_000 });
      });
    }
  }, 60_000);

  it('a production build resolves the production files, with module and browser, as it did', async () => {
    for (const codeSplitting of [false, true]) {
      const { dist, config } = fixture(codeSplitting);
      const result = await build(config);
      expect(await resolvedBy(join(dist, result.manifest.assets['app.js']!)), `codeSplitting: ${codeSplitting}`).toEqual([
        'dual-build:default',
        'module-first:module',
        'browser-first:browser',
        'production',
      ]);
    }
  }, 60_000);
});
