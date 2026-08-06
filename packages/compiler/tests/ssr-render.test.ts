/**
 * The property, not the mechanism: the markup the server sends must be the
 * markup the client builds.
 *
 * Slot names and default bytes are how that is achieved; they are not the
 * thing that was broken. A missing default is a perfectly well-formed slot
 * table, and the tests that read slot tables all passed while these pages
 * shipped wrong. Each case below compiles a real project off disk with the
 * real `generateRealIr`, renders the emitted FMIR under its own slot defaults
 * (what a server sends before it injects anything), and compares it to the
 * markup the same source produces on the client.
 *
 * The expected markup is written out literally rather than derived, because
 * deriving it from the same source the compiler read would just restate the
 * compiler's opinion. It is what `@getforma/core` renders for these trees:
 * a text binding becomes its value, an attribute binding becomes
 * `key="value"` (bare for a true boolean, absent for a false one), and a
 * conditional renders the branch its condition selects.
 *
 * The renderer used here covers only the opcodes it can reproduce exactly and
 * throws on anything else; the authority on FMIR rendering is the Rust walker,
 * which renders these same corpus fixtures in
 * `forma/crates/forma-ir/tests/js_emitter_contract.rs`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { renderDefaults, ZWSP } from './helpers/render';

let tmpDir: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'forma-ssr-render-'));
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Compile a project off disk and render its SSR HTML from the slot defaults.
 * Hydration markers are stripped: they are wire contract, and what is under
 * test here is the content between them.
 */
function ssr(files: Record<string, string>, entry = 'app.ts'): string {
  for (const [name, content] of Object.entries(files)) {
    const full = join(tmpDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const result = generateRealIr(join(tmpDir, entry));
  expect(result, 'the page fell back to placeholder IR').not.toBeNull();
  return renderDefaults(result!.binary, { stripMarkers: true });
}

const ENTRY = `
  import { mount } from 'formajs';
  import { Page } from './page';
  mount(() => Page(), '#app');
`;

/** A page whose whole body is one inlined sub-component call. */
function pageAround(call: string): string {
  return `
    import { h } from 'formajs';
    import { Sub } from './sub';
    export function Page() { return h('div', { id: 'app' }, ${call}); }
  `;
}

// ===========================================================================
// The critical one: a truthy conditional rendered its ELSE branch, forever
// ===========================================================================

describe('SSR renders the branch the client renders', () => {
  it('renders the THEN branch for a show whose condition defaults true', () => {
    // Measured before the fix: SSR emitted `<p class="off">ELSE</p>` and
    // hydration ADOPTED it — `adoptShowRegion` walks the client's THEN
    // descriptor against the server's ELSE <p>, the tags match, the node is
    // adopted, and the static class and text are never rewritten. Both
    // mismatch-repair arms test "one side has content and the other does not",
    // and here both do, so neither fires and nothing warns. The page showed
    // ELSE while the signal was `true`, until the signal changed value.
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal, createShow } from 'formajs';
        const [flag] = createSignal(true);
        export function Sub() {
          return h('section', null,
            createShow(() => flag(),
              () => h('p', { class: 'on' }, 'THEN'),
              () => h('p', { class: 'off' }, 'ELSE'),
            ),
          );
        }
      `,
    });

    expect(html).toBe('<div id="app"><section><p class="on">THEN</p></section></div>');
  });

  it('renders the THEN branch for a ternary whose condition defaults true', () => {
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        const [flag] = createSignal(true);
        export function Sub() {
          return h('section', null, () => flag() ? h('p', { class: 'on' }, 'THEN') : h('p', { class: 'off' }, 'ELSE'));
        }
      `,
    });

    expect(html).toBe('<div id="app"><section><p class="on">THEN</p></section></div>');
  });

  it('still renders the ELSE branch when the condition defaults false', () => {
    // The other polarity, so the fix is "render the right branch", not
    // "always render THEN".
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal, createShow } from 'formajs';
        const [flag] = createSignal(false);
        export function Sub() {
          return h('section', null,
            createShow(() => flag(), () => h('p', { class: 'on' }, 'THEN'), () => h('p', { class: 'off' }, 'ELSE')),
          );
        }
      `,
    });

    expect(html).toBe('<div id="app"><section><p class="off">ELSE</p></section></div>');
  });
});

// ===========================================================================
// Text and attributes from every scope the walk inlines
// ===========================================================================

describe('SSR renders the text and attributes the client renders', () => {
  it('renders text from a signal declared in an inlined sub-component body', () => {
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [label] = createSignal('Ready');
          return h('span', null, () => label());
        }
      `,
    });

    expect(html).toBe('<div id="app"><span>Ready</span></div>');
  });

  it('renders text from a signal at the module scope of the sub-component\'s own file', () => {
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        const [label] = createSignal('Ready');
        export function Sub() { return h('span', null, () => label()); }
      `,
    });

    expect(html).toBe('<div id="app"><span>Ready</span></div>');
  });

  it('renders text from a signal at the ROOT PAGE file\'s module scope', () => {
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': `
        import { h, createSignal } from 'formajs';
        const [label] = createSignal('Ready');
        export function Page() { return h('div', { id: 'app' }, h('span', null, () => label())); }
      `,
    });

    expect(html).toBe('<div id="app"><span>Ready</span></div>');
  });

  it('renders text from a signal declared inside a nested block', () => {
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': `
        import { h, createSignal } from 'formajs';
        export function Page() {
          if (globalThis.always !== 0) {
            const [label] = createSignal('Ready');
            return h('div', { id: 'app' }, h('span', null, () => label()));
          }
          return h('div', { id: 'app' });
        }
      `,
    });

    expect(html).toBe('<div id="app"><span>Ready</span></div>');
  });

  it('renders a ZERO, which "no default" and "default 0" cannot be told apart without', () => {
    // The numeric zero case is not cosmetic: an empty slot and a slot holding
    // 0 are indistinguishable once the default is lost, so the server rendered
    // a blank where the client renders `0`.
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [count] = createSignal(0);
          return h('b', null, () => count());
        }
      `,
    });

    expect(html).toBe('<div id="app"><b>0</b></div>');
  });

  it('renders a boolean attribute as present, not as disabled="false"', () => {
    // A control that is SUBMITTABLE before hydration and disabled after is a
    // correctness bug, not a flash.
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [busy] = createSignal(true);
          return h('button', { disabled: () => busy() }, 'go');
        }
      `,
    });

    expect(html).toBe('<div id="app"><button disabled>go</button></div>');
  });

  it('renders a computed class from a sub-component, in both polarities', () => {
    const open = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        const [open] = createSignal(true);
        export function Sub() { return h('span', { class: () => open() ? 'is-open' : 'is-closed' }, 'x'); }
      `,
    });
    expect(open).toBe('<div id="app"><span class="is-open">x</span></div>');

    rmSync(join(tmpDir, 'sub.ts'));
    const closed = ssr({
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        const [open] = createSignal(false);
        export function Sub() { return h('span', { class: () => open() ? 'is-open' : 'is-closed' }, 'x'); }
      `,
    });
    expect(closed).toBe('<div id="app"><span class="is-closed">x</span></div>');
  });

  it('renders a template-literal class with an embedded expression', () => {
    // The create-forma-app dashboard's sidebar. Its whole nav shipped with NO
    // class attribute, so every control was unstyled until the client ran.
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [collapsed] = createSignal(true);
          return h('nav', { class: () => \`sidebar \${collapsed() ? 'is-collapsed' : ''}\` }, 'menu');
        }
      `,
    });

    expect(html).toBe('<div id="app"><nav class="sidebar is-collapsed">menu</nav></div>');
  });
});

// ===========================================================================
// The boundary, stated as markup
// ===========================================================================

describe('what SSR still cannot render, stated exactly', () => {
  it('emits the placeholder text node when a binding cannot be evaluated', () => {
    // A signal whose initial value is not a literal has no default to render.
    // The zero-width space is deliberate — it gives the client a Text node to
    // bind to — and it is the honest output here, not a silent success.
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [label] = createSignal(loadLabel());
          return h('span', null, () => label());
        }
      `,
    });

    expect(html).toBe(`<div id="app"><span>${ZWSP}</span></div>`);
    // …and it says so, naming the file, the construct and the consequence.
    const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warned).toContain("signal 'label'");
    expect(warned).toContain('sub.ts');
    expect(warned).toContain('CallExpression');
  });

  it('omits an attribute whose value evaluates to the empty string', () => {
    // A documented limit of the binary format, not a walker choice: a slot
    // entry cannot distinguish an empty default from no default, so the server
    // omits `value` where the client writes `value=""`.
    const html = ssr({
      'app.ts': ENTRY,
      'page.ts': pageAround('Sub()'),
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [query] = createSignal('');
          return h('input', { type: 'search', value: () => query() });
        }
      `,
    });

    expect(html).toBe('<div id="app"><input type="search"></div>');
  });
});
