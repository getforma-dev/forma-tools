/**
 * The Vite plugins' compiled path in A2 (L-23, FORMA-019): deprecated, and
 * no longer a way around core's attribute guard.
 *
 * FORMA-007's review ran probes against published core 2.0.1: `formaCompiler`
 * wrote `href="javascript:alert(1)"` where runtime `h()` drops it, baked a
 * static `ONCLICK` and a static `javascript:` href into the template, and ran
 * a lowercase `onclick` handler at render. Core's guard (`isUnsafeAttrWrite`:
 * an `on…` attribute, or a URL attribute whose scheme can run script) is not
 * exported, so the compiler routes such an element to runtime `h()`, which
 * applies it, on the first render and on every reactive update. The browser
 * half, with core itself: e2e/compiled-url-guard.spec.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileFormaJSX } from '../src/transform';

/** A module whose only `h()` call is `<tag props>`; url, link and fn are runtime values. */
function compileOne(tag: string, props: string) {
  return compileFormaJSX(
    `import { h } from 'formajs';\nexport const view = (url, link, fn) => h('${tag}', { ${props} }, 'x');\n`,
    '/proj/src/view.ts',
  );
}

describe('compiled output leaves unsafe-attribute writes to core (L-23)', () => {
  it.each([
    // URL attributes whose value is not known at compile time (core's URL_ATTRS).
    ['a', 'href: url'],
    ['a', 'href: () => link()'],
    ['img', 'src: url'],
    ['form', 'action: url'],
    ['button', 'formaction: url'],
    ['video', 'poster: url'],
    ['object', 'data: url'],
    ['td', 'background: url'],
    ['a', "'xlink:href': url"],
    ['a', 'HREF: url'],
    // Literal URLs with a scheme: core decides which schemes are safe.
    ['a', "href: 'javascript:alert(1)'"],
    ['a', "href: ' java\\tscript:alert(1)'"],
    ['iframe', "src: 'data:text/html,<script>alert(1)</script>'"],
    ['a', "href: 'https://example.com/'"],
    // Inline handlers: an `on…` attribute that is not a compiled `onX` listener.
    ['div', "ONCLICK: 'alert(1)'"],
    ['div', "onclick: 'alert(1)'"],
    ['div', 'onclick: fn'],
  ])('leaves <%s %s> to runtime h()', (tag, props) => {
    // Nothing else in the module compiles, so the module is left as written.
    expect(compileOne(tag, props)).toBeNull();
  });

  it.each([
    ['a', "href: '/about'"],
    ['a', "href: '#top'"],
    ['a', "href: '?page=2'"],
    ['img', "src: 'logo.png'"],
    ['a', 'title: url'],
    ['button', 'onClick: fn'],
  ])('still compiles <%s %s>: no scheme, or not a guarded attribute', (tag, props) => {
    // Two-sided: the guard routes only what core would check.
    expect(compileOne(tag, props)?.code).toContain('_$template(');
  });

  it('keeps compiling the rest of the tree around such an element', () => {
    const out = compileFormaJSX(
      `import { h } from 'formajs';\nexport const view = (url) => h('nav', { class: 'menu' }, h('a', { href: url }, 'Home'), h('a', { href: '/about' }, 'About'));\n`,
      '/proj/src/nav.ts',
    )!;
    // The nav and the static link are in the template; the dynamic link is
    // inserted as a runtime h() child, so no compiled code writes its href.
    expect(out.code).toContain('_$template("<nav class=\\"menu\\"><!><a href=\\"/about\\">About</a></nav>")');
    expect(out.code).toMatch(/h\('a', \{\s*href: url\s*\}, 'Home'\)/);
    expect(out.code).not.toMatch(/setAttribute\("href"/);
  });
});

describe('the Vite plugins are deprecated (L-23)', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['formaCompiler', 'together with the compiled template path'],
    ['formaServer', 'together with server functions'],
  ] as const)('%s logs its deprecation once, naming 3.0.0', async (name, reason) => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugins = await import('../src/vite-plugin');
    plugins[name]();
    plugins[name]();
    const ours = warn.mock.calls.filter(([message]) => String(message).includes(`${name} is deprecated`));
    expect(ours).toHaveLength(1);
    expect(ours[0]![0]).toContain('removed in 3.0.0');
    expect(ours[0]![0]).toContain(reason);
  });
});
