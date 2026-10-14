/**
 * formaCompiler's output and core's attribute guard, in a browser (FORMA-019,
 * L-23).
 *
 * The acceptance test: a module compiled by `compileFormaJSX` (the transform
 * behind the Vite plugin `formaCompiler`) with `href: url`, where `url` is
 * `javascript:alert(1)`, writes no `href`. Before FORMA-019 the compiled code
 * set the attribute itself with `setAttribute`, skipping core's URL guard,
 * which runtime `h()` applies (FORMA-007's review, probes against core
 * 2.0.1). The module is compiled by THIS checkout's compiler (built by
 * `npm run build`, which e2e/ssr/build.sh runs) and run against the FormaJS
 * build that e2e/sync-fixtures.sh copies into e2e/fixtures.
 *
 * The compile-side contract (which attributes are left to runtime h()) is in
 * packages/compiler/tests/vite-plugin-deprecation.test.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const repo = join(__dirname, '..');

const SOURCE = `
import { h, createSignal } from 'formajs';

const unsafe = 'javascript:alert(1)';
const safe = '/about';
const [link, setLink] = createSignal('/start');

export const view = h('nav', { id: 'nav' },
  h('a', { id: 'unsafe', href: unsafe }, 'unsafe'),
  h('a', { id: 'safe', href: safe }, 'safe'),
  h('a', { id: 'reactive', href: () => link() }, 'reactive'),
  h('a', { id: 'literal', href: 'javascript:alert(3)' }, 'literal'),
  h('div', { id: 'handler', ONCLICK: 'window.__ran = true' }, 'handler'),
);
export { setLink };
`;

/** The compiled module, bundled as a script that reads FormaJS from its global. */
async function compiledScript(): Promise<string> {
  const { compileFormaJSX } = await import(pathToFileURL(join(repo, 'packages/compiler/dist/index.js')).href);
  const compiled = compileFormaJSX(SOURCE, '/app/src/nav.ts');
  // compileFormaJSX returns null when it compiles nothing; the nav is still
  // compiled, so this test always runs compiler output.
  expect(compiled?.code).toContain('_$template(');
  const bundled = await build({
    stdin: {
      contents: `${compiled.code}\ndocument.body.appendChild(view);\nwindow.setLink = setLink;\n`,
      loader: 'ts',
      resolveDir: repo,
    },
    bundle: true,
    format: 'iife',
    write: false,
    plugins: [{
      name: 'formajs-global',
      setup(builder) {
        builder.onResolve({ filter: /^(formajs|@getforma\/core)$/ }, () => ({ path: 'formajs', namespace: 'formajs-global' }));
        builder.onLoad({ filter: /.*/, namespace: 'formajs-global' }, () => ({ contents: 'module.exports = globalThis.FormaJS;', loader: 'js' }));
      },
    }],
  });
  return bundled.outputFiles[0]!.text;
}

test('a compiled module writes no javascript: href from a variable, and keeps safe ones (FORMA-019)', async ({ page }) => {
  const script = await compiledScript();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: readFileSync(join(__dirname, 'fixtures', 'formajs.global.js'), 'utf8') });
  await page.addScriptTag({ content: script });

  // The acceptance: no href from a variable holding javascript:.
  await expect(page.locator('#unsafe')).toHaveText('unsafe');
  await expect(page.locator('#unsafe')).not.toHaveAttribute('href');
  // Two-sided: a safe URL, from a variable or a literal, is written.
  await expect(page.locator('#safe')).toHaveAttribute('href', '/about');
  await expect(page.locator('#reactive')).toHaveAttribute('href', '/start');

  // A reactive href is checked on every update, not only the first render.
  await page.evaluate(() => (window as any).setLink('javascript:alert(2)'));
  await expect(page.locator('#reactive')).not.toHaveAttribute('href');
  await page.evaluate(() => (window as any).setLink('/next'));
  await expect(page.locator('#reactive')).toHaveAttribute('href', '/next');

  // A literal javascript: URL and an inline handler string are not baked
  // into the template either.
  await expect(page.locator('#literal')).not.toHaveAttribute('href');
  await expect(page.locator('#handler')).not.toHaveAttribute('onclick');
  await page.click('#handler');
  expect(await page.evaluate(() => (window as any).__ran)).toBeUndefined();
});
