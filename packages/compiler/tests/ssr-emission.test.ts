/**
 * generateRealIr over REAL FILES ON DISK.
 *
 * This is the level the suite was blind at. 351 tests missed a defect that
 * broke every JSX project outright, for five reinforcing reasons:
 *
 *  1. No test ever put a `.tsx` file on disk. The esbuild transform that
 *     rewrites `export function Card()` into `export { Card }` is gated purely
 *     on the file EXTENSION, so it never ran in any test.
 *  2. `.tsx` appeared only as a filename LABEL on hand-written, already-
 *     transformed source strings — coverage that reads real and is not.
 *  3. Every fixture used the one export form the implementation supported.
 *  4. `generateRealIr` was barely exercised, and never for the negative.
 *  5. Nothing asserted that emission had NOT fallen back to the placeholder —
 *     and the fallback is silent by design: non-fatal, build stays green, an
 *     .ir file is still written. A test checking "an .ir exists and parses"
 *     passes on a 60-byte empty div.
 *
 * So every test here writes files to a temp directory, points the compiler at
 * them exactly as a build does, and asserts against the real output — starting
 * with "this is not the placeholder".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateRealIr, generatePlaceholderIr } from '../src/esbuild-ssr-plugin';
import { getIslands, getSlots, parseOpcodeList } from './helpers/fmir';

let tmpDir: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'forma-ssr-emission-'));
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a project (paths may contain directories) and return a file path. */
function writeProject(files: Record<string, string>, entry: string): string {
  for (const [name, content] of Object.entries(files)) {
    const full = join(tmpDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return join(tmpDir, entry);
}

/** All console.warn output as one string. */
function warnings(): string {
  return warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
}

/** The opcode shape `generatePlaceholderIr` produces: one empty div, nothing else. */
const PLACEHOLDER_SHAPE = parseOpcodeList(generatePlaceholderIr('page'));

/**
 * Emit and assert the result is REAL IR, not the placeholder the plugin
 * silently falls back to. `generateRealIr` returning null is that fallback —
 * and it is the ONLY signal, because the plugin then writes a perfectly valid
 * .ir file and the build stays green. Every test that asserts on emitted IR
 * goes through here so none of them can pass on an empty div.
 */
function emitReal(entryPath: string) {
  const result = generateRealIr(entryPath);
  expect(
    result,
    `generateRealIr returned null — the page would ship placeholder IR. Warnings:\n${warnings()}`,
  ).not.toBeNull();
  const ops = parseOpcodeList(result!.binary);
  expect(
    ops.length === PLACEHOLDER_SHAPE.length && ops[0]!.includes('data-forma-page'),
    'emitted IR is the placeholder empty-div shell',
  ).toBe(false);
  return result!;
}

const slotNames = (bin: Uint8Array) => getSlots(bin).map((s) => s.name);
const slotByName = (bin: Uint8Array, name: string) =>
  getSlots(bin).find((s) => s.name === name);

// ===========================================================================
// The .tsx path — 100% of JSX projects used to land on placeholder IR
// ===========================================================================

describe('generateRealIr — .tsx root pages', () => {
  const ENTRY = `
    import { mount } from 'formajs';
    import { Page } from './page';
    mount(() => Page(), '#app');
  `;

  it('compiles a .tsx page written in real JSX', () => {
    const entry = writeProject({
      'app.ts': ENTRY,
      'page.tsx': `
        import { h, createSignal } from 'formajs';
        export function Page() {
          const [headline] = createSignal('Live');
          return <main id="app"><h1>{() => headline()}</h1></main>;
        }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG main id="app"',
      'OPEN_TAG h1',
      'DYN_TEXT headline marker=0',
      'CLOSE_TAG h1',
      'CLOSE_TAG main',
    ]);
    expect(warnings()).toBe('');
  });

  it('gives a .tsx page the SAME IR as its byte-identical .ts twin', () => {
    // The A/B that pins the defect: only the extension differs, and only the
    // extension makes esbuild rewrite the export. They must agree.
    const body = `
      import { h, createSignal } from 'formajs';
      export function Page() {
        const [count] = createSignal(7);
        return h('div', { id: 'app' }, h('span', null, () => count()));
      }
    `;

    const tsEntry = writeProject({ 'app.ts': ENTRY, 'page.ts': body }, 'app.ts');
    const fromTs = emitReal(tsEntry);

    rmSync(join(tmpDir, 'page.ts'));
    const tsxEntry = writeProject({ 'page.tsx': body }, 'app.ts');
    const fromTsx = emitReal(tsxEntry);

    expect([...fromTsx.binary]).toEqual([...fromTs.binary]);
    expect(slotNames(fromTsx.binary)).toEqual(['count']);
  });

  it('reads a .tsx island\'s in-function signal defaults', () => {
    // The SILENT case. The island appeared in the table either way, so nothing
    // looked wrong: the slot was just renamed `text:0` and lost its default,
    // and server-side injection by name failed at runtime with an empty log.
    const entry = writeProject({
      'app.ts': `
        import { mount, activateIslands } from 'formajs';
        import { Page } from './page';
        import { Counter } from './counter';
        activateIslands({ Counter });
        mount(() => Page(), '#app');
      `,
      'page.ts': `
        import { h } from 'formajs';
        import { Counter } from './counter';
        export function Page() { return h('div', { id: 'app' }, Counter()); }
      `,
      'counter.tsx': `
        import { h, createSignal } from 'formajs';
        export function Counter() {
          const [hits] = createSignal(42);
          return <button>{() => hits()}</button>;
        }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(slotNames(result.binary)).toEqual(['hits']);
    expect(slotByName(result.binary, 'hits')!.default).toBe('42');

    // And the island carries that slot, or the walker emits no
    // data-forma-props and the client hydrates it with nothing.
    expect(getIslands(result.binary)).toEqual([
      expect.objectContaining({ name: 'Counter', slotIds: [0] }),
    ]);
    expect(warnings()).toBe('');
  });
});

// ===========================================================================
// Export forms
// ===========================================================================

describe('generateRealIr — root page export forms', () => {
  const ENTRY_NAMED = `
    import { mount } from 'formajs';
    import { Page } from './page';
    mount(() => Page(), '#app');
  `;
  const BODY = `return h('div', { id: 'app' }, 'hello');`;

  const forms: Array<[string, string, string]> = [
    ['export function', ENTRY_NAMED, `export function Page() { ${BODY} }`],
    ['export const arrow', ENTRY_NAMED, `export const Page = () => { ${BODY} };`],
    ['export { X }', ENTRY_NAMED, `function Page() { ${BODY} }\nexport { Page };`],
    ['export { XImpl as X }', ENTRY_NAMED, `function PageImpl() { ${BODY} }\nexport { PageImpl as Page };`],
    ['export default function', `
      import { mount } from 'formajs';
      import Page from './page';
      mount(() => Page(), '#app');
    `, `export default function Page() { ${BODY} }`],
    ['aliased import', `
      import { mount } from 'formajs';
      import { PageImpl as Page } from './page';
      mount(() => Page(), '#app');
    `, `export function PageImpl() { ${BODY} }`],
  ];

  for (const [label, entrySource, pageSource] of forms) {
    it(`resolves a root page declared with ${label}`, () => {
      const entry = writeProject({
        'app.ts': entrySource,
        'page.ts': `import { h } from 'formajs';\n${pageSource}`,
      }, 'app.ts');

      const result = emitReal(entry);
      expect(parseOpcodeList(result.binary)).toEqual([
        'OPEN_TAG div id="app"',
        'TEXT "hello"',
        'CLOSE_TAG div',
      ]);
      expect(result.islands).toEqual([]);
      expect(warnings()).toBe('');
    });
  }

  it('resolves a root page re-exported through an index barrel', () => {
    const entry = writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './components';
        mount(() => Page(), '#app');
      `,
      'components/index.ts': `export { Page } from './page';\nexport * from './card';`,
      'components/page.tsx': `
        import { h } from 'formajs';
        import { Card } from './index';
        export function Page() { return <main id="app"><Card /></main>; }
      `,
      'components/card.tsx': `
        import { h } from 'formajs';
        export function Card() { return <article class="card">body</article>; }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    // The barrelled sub-component is INLINED, not deferred to an island shell.
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG main id="app"',
      'OPEN_TAG article class="card"',
      'TEXT "body"',
      'CLOSE_TAG article',
      'CLOSE_TAG main',
    ]);
    expect(result.islands).toEqual([]);
    expect(warnings()).toBe('');
  });
});

// ===========================================================================
// Resolution scope: whose imports get read
// ===========================================================================

describe('generateRealIr — component resolution scope', () => {
  it('resolves a sub-component against the file the call is in', () => {
    // ONE import map was built from the entry and captured in a closure every
    // nested walk carried unchanged. `Leaf` is imported by section.ts, two
    // files down — so it was invisible, and became an empty island shell
    // purely because app.ts did not happen to import it too.
    const entry = writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'page.ts': `
        import { h } from 'formajs';
        import { Section } from './section';
        export function Page() { return h('div', { id: 'app' }, Section()); }
      `,
      'section.ts': `
        import { h } from 'formajs';
        import { Leaf } from './leaf';
        export function Section() { return h('section', null, Leaf()); }
      `,
      'leaf.ts': `
        import { h } from 'formajs';
        export function Leaf() { return h('span', { class: 'leaf' }, 'leaf text'); }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG div id="app"',
      'OPEN_TAG section',
      'OPEN_TAG span class="leaf"',
      'TEXT "leaf text"',
      'CLOSE_TAG span',
      'CLOSE_TAG section',
      'CLOSE_TAG div',
    ]);
    expect(result.islands).toEqual([]);
    expect(warnings()).toBe('');
  });

  it('inlines a helper declared inside the mount callback', () => {
    const entry = writeProject({
      'app.ts': `
        import { h, mount } from 'formajs';
        mount(() => {
          const navItem = (props) => h('li', { class: 'nav' }, props.label);
          return h('ul', { id: 'app' }, navItem({ label: 'Home' }));
        }, '#app');
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG ul id="app"',
      'OPEN_TAG li class="nav"',
      'TEXT "Home"',
      'CLOSE_TAG li',
      'CLOSE_TAG ul',
    ]);
    expect(result.islands).toEqual([]);
  });
});

// ===========================================================================
// Signal scopes: whatever the walk inlines, it names
// ===========================================================================

describe('generateRealIr — signals in the scopes the walk inlines', () => {
  const ENTRY = `
    import { mount } from 'formajs';
    import { Page } from './page';
    mount(() => Page(), '#app');
  `;

  it('names a signal declared inside an inlined sub-component', () => {
    // The reported gap. `resolveSubComponent` pulls only the RETURN expression
    // out of the function, so the body's declarations were never visited and
    // `label` compiled to an anonymous `text:0` with no default — a blank on
    // the server where the client shows "Ready".
    const entry = writeProject({
      'app.ts': ENTRY,
      'page.ts': `
        import { h } from 'formajs';
        import { Sub } from './sub';
        export function Page() { return h('div', { id: 'app' }, Sub()); }
      `,
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [label] = createSignal('Ready');
          return h('span', null, () => label());
        }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(slotNames(result.binary)).toEqual(['label']);
    expect(slotByName(result.binary, 'label')!.default).toBe('Ready');
    expect(parseOpcodeList(result.binary)).toContain('DYN_TEXT label marker=0');
    expect(warnings()).toBe('');
  });

  it('names a signal at the module scope of an inlined sub-component\'s own file', () => {
    // The same gap one scope out, and the one that made `barrel-exports` work
    // by accident: its chip's module scope was read only because the chip is
    // in the islands registry.
    const entry = writeProject({
      'app.ts': ENTRY,
      'page.ts': `
        import { h } from 'formajs';
        import { Sub } from './sub';
        export function Page() { return h('div', { id: 'app' }, Sub()); }
      `,
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        const [label] = createSignal('Ready');
        export function Sub() { return h('span', null, () => label()); }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(slotNames(result.binary)).toEqual(['label']);
    expect(slotByName(result.binary, 'label')!.default).toBe('Ready');
  });

  it('names a signal at the ROOT PAGE file\'s module scope', () => {
    const entry = writeProject({
      'app.ts': ENTRY,
      'page.ts': `
        import { h, createSignal } from 'formajs';
        const [label] = createSignal('Ready');
        export function Page() { return h('div', { id: 'app' }, h('span', null, () => label())); }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(slotNames(result.binary)).toEqual(['label']);
    expect(slotByName(result.binary, 'label')!.default).toBe('Ready');
  });

  it('keeps two sub-components\' same-named signals apart, deterministically', () => {
    // Two components can each declare `count`; they are different signals and
    // must not share a slot. Occurrence order is the WALK's document order, so
    // the name a given declaration gets does not depend on file system order.
    const entry = writeProject({
      'app.ts': ENTRY,
      'page.ts': `
        import { h } from 'formajs';
        import { First } from './first';
        import { Second } from './second';
        export function Page() { return h('div', { id: 'app' }, First(), Second()); }
      `,
      'first.ts': `
        import { h, createSignal } from 'formajs';
        export function First() {
          const [count] = createSignal(1);
          return h('b', null, () => count());
        }
      `,
      'second.ts': `
        import { h, createSignal } from 'formajs';
        export function Second() {
          const [count] = createSignal(2);
          return h('i', null, () => count());
        }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(getSlots(result.binary).map((s) => [s.name, s.default])).toEqual([
      ['count', '1'],
      ['count#2', '2'],
    ]);
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG div id="app"',
      'OPEN_TAG b',
      'DYN_TEXT count marker=0',
      'CLOSE_TAG b',
      'OPEN_TAG i',
      'DYN_TEXT count#2 marker=1',
      'CLOSE_TAG i',
      'CLOSE_TAG div',
    ]);
    // The rename is reported: injecting `count` would fill only the first.
    expect(warnings()).toContain("signal 'count' is also declared in another scope");
  });

  it('does not leak a sub-component\'s signals into the page around it', () => {
    // Lexical scoping, not a flat page-wide map: `hidden` belongs to Sub, and a
    // binding on the PAGE that happens to share the name must not resolve to it.
    const entry = writeProject({
      'app.ts': ENTRY,
      'page.ts': `
        import { h } from 'formajs';
        import { Sub } from './sub';
        export function Page() {
          return h('div', { id: 'app' }, Sub(), h('em', null, () => hidden()));
        }
      `,
      'sub.ts': `
        import { h, createSignal } from 'formajs';
        export function Sub() {
          const [hidden] = createSignal('inner');
          return h('span', null, () => hidden());
        }
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    // The page's binding gets an anonymous slot with no default — and says so.
    expect(slotNames(result.binary)).toEqual(['hidden', 'text:0']);
    expect(slotByName(result.binary, 'text:0')!.default).toBe('');
    expect(warnings()).toContain('dynamic text child');
  });
});

// ===========================================================================
// Inline mount signal defaults
// ===========================================================================

describe('generateRealIr — inline mount', () => {
  it('names signal slots on an inline-mount entry', () => {
    // The old code asked for an exported function literally named
    // `__inline__`, a lookup that could never match, so an inline-mount page
    // had ZERO named slots and every binding landed in an anonymous one.
    const entry = writeProject({
      'app.ts': `
        import { h, mount, createSignal } from 'formajs';
        const [status] = createSignal('idle');
        mount(() => {
          const [open] = createSignal(false);
          return h('div', { id: 'app' }, h('b', null, () => status()), h('i', null, () => open()));
        }, '#app');
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(slotNames(result.binary)).toEqual(['status', 'open']);
    expect(slotByName(result.binary, 'status')!.default).toBe('idle');
    expect(slotByName(result.binary, 'open')!.default).toBe('false');
  });

  it('gives a numeric inline-mount signal its type and default', () => {
    // The two mount paths carried separate copies of slot registration and the
    // inline one had drifted: it handled only text and bool, so a number got a
    // TYPE_TEXT slot with NO default and the server rendered a blank.
    const entry = writeProject({
      'app.ts': `
        import { h, mount, createSignal } from 'formajs';
        const [count] = createSignal(11);
        mount(() => h('div', { id: 'app' }, h('b', null, () => count())), '#app');
      `,
    }, 'app.ts');

    // Pattern 1/2 twin, which always handled numbers, is the reference.
    const named = writeProject({
      'app2.ts': `
        import { mount } from 'formajs';
        import { Page } from './page2';
        mount(() => Page(), '#app');
      `,
      'page2.ts': `
        import { h, createSignal } from 'formajs';
        export function Page() {
          const [count] = createSignal(11);
          return h('div', { id: 'app' }, h('b', null, () => count()));
        }
      `,
    }, 'app2.ts');

    const inlineSlot = slotByName(emitReal(entry).binary, 'count')!;
    const namedSlot = slotByName(emitReal(named).binary, 'count')!;

    expect(inlineSlot.default).toBe('11');
    expect(inlineSlot.typeHint).toBe(namedSlot.typeHint);
  });

  it('treats an expression-bodied mount as an inline mount', () => {
    // `mount(() => h('div', …), '#app')` used to match the NAMED-component
    // pattern: `h` is an imported identifier, so the plugin went looking for a
    // component file called 'formajs', failed, and dropped the whole page to
    // placeholder IR. The arrow's body is the tree.
    const entry = writeProject({
      'app.ts': `
        import { h, mount, createSignal } from 'formajs';
        const [title] = createSignal('Home');
        mount(() => h('main', { id: 'app' }, h('h1', null, () => title())), '#app');
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG main id="app"',
      'OPEN_TAG h1',
      'DYN_TEXT title marker=0',
      'CLOSE_TAG h1',
      'CLOSE_TAG main',
    ]);
    expect(warnings()).toBe('');
  });

  it('treats a mount of a component declared in the entry file as an inline mount', () => {
    const entry = writeProject({
      'app.ts': `
        import { h, mount } from 'formajs';
        function LocalPage() { return h('div', { id: 'app' }, 'local'); }
        mount(() => LocalPage(), '#app');
      `,
    }, 'app.ts');

    const result = emitReal(entry);
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG div id="app"',
      'TEXT "local"',
      'CLOSE_TAG div',
    ]);
    expect(result.islands).toEqual([]);
  });
});

// ===========================================================================
// Rule 9's static spread unroll over a table declared in ANOTHER module
//
// The exact shape of ksx's map route: the page module declares the key
// vocabulary tables and the island imports them back to spread into its
// <select>s. `fileConstants` is extracted per resolved file — correct, and the
// reason an imported table was invisible — so all 34 of those spreads compiled
// to empty island shells. Nothing rendered server-side, and with JavaScript
// off the write path did not exist at all.
// ===========================================================================

describe('generateRealIr — imported constant tables in a spread unroll', () => {
  /** The ksx shape: page declares the table, island imports it back. */
  const KSX_SHAPE = {
    'app.ts': `
      import { mount, activateIslands } from 'formajs';
      import { Page } from './page';
      import { Picker } from './picker';
      activateIslands({ Picker });
      mount(() => Page(), '#app');
    `,
    'page.ts': `
      import { h } from 'formajs';
      import { Picker } from './picker';
      const KEYS = [{ k: 'A' }, { k: 'B' }, { k: 'F1' }];
      export { KEYS };
      export function Page() { return h('main', { id: 'app' }, Picker()); }
    `,
    'picker.ts': `
      import { h } from 'formajs';
      import { KEYS } from './page';
      export function Picker() {
        return h('select', { name: 'key' }, ...KEYS.map((ko) => h('option', null, ko.k)));
      }
    `,
  };

  it('unrolls a const table the island imports from the page module', () => {
    const result = emitReal(writeProject(KSX_SHAPE, 'app.ts'));

    // Every option is STATIC markup inside the island — server-rendered, and
    // present with JavaScript off. Before the fix the island's whole subtree
    // was `OPEN_TAG div / CLOSE_TAG div`, a shell with nothing in it.
    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG main id="app"',
      'ISLAND_START Picker#0',
      'OPEN_TAG select name="key"',
      'OPEN_TAG option',
      'TEXT "A"',
      'CLOSE_TAG option',
      'OPEN_TAG option',
      'TEXT "B"',
      'CLOSE_TAG option',
      'OPEN_TAG option',
      'TEXT "F1"',
      'CLOSE_TAG option',
      'CLOSE_TAG select',
      'ISLAND_END Picker#0',
      'CLOSE_TAG main',
    ]);
    // One island — the registered component. No `island_<n>` fallback shell.
    expect(result.islands.map((i) => i.name)).toEqual(['Picker']);
    expect(warnings()).toBe('');
  });

  it('follows the table through a barrel re-export and an import alias', () => {
    const result = emitReal(writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'tables/keys.ts': `export const RAW_KEYS = [{ k: 'X' }, { k: 'Y' }];`,
      'tables/index.ts': `export { RAW_KEYS } from './keys';`,
      'page.ts': `
        import { h } from 'formajs';
        import { RAW_KEYS as KEYS } from './tables';
        export function Page() {
          return h('ul', { id: 'app' }, ...KEYS.map((r) => h('li', null, r.k)));
        }
      `,
    }, 'app.ts'));

    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG ul id="app"',
      'OPEN_TAG li',
      'TEXT "X"',
      'CLOSE_TAG li',
      'OPEN_TAG li',
      'TEXT "Y"',
      'CLOSE_TAG li',
      'CLOSE_TAG ul',
    ]);
    expect(result.islands).toEqual([]);
  });

  it('substitutes imported rows into attribute position too', () => {
    const result = emitReal(writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'nav.ts': `export const NAV = [{ href: '/', label: 'Home', n: 1 }];`,
      'page.ts': `
        import { h } from 'formajs';
        import { NAV } from './nav';
        export function Page() {
          return h('nav', { id: 'app' },
            ...NAV.map((item) => h('a', { href: item.href, 'data-n': item.n }, item.label)));
        }
      `,
    }, 'app.ts'));

    expect(parseOpcodeList(result.binary)).toEqual([
      'OPEN_TAG nav id="app"',
      'OPEN_TAG a href="/" data-n="1"',
      'TEXT "Home"',
      'CLOSE_TAG a',
      'CLOSE_TAG nav',
    ]);
  });

  it('still degrades a table that is built at runtime, naming the module that declares it', () => {
    const result = emitReal(writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'tables.ts': `export const KEYS = loadKeys();`,
      'page.ts': `
        import { h } from 'formajs';
        import { KEYS } from './tables';
        export function Page() {
          return h('ul', { id: 'app' }, ...KEYS.map((r) => h('li', null, r.k)));
        }
      `,
    }, 'app.ts'));

    expect(result.islands.map((i) => i.name)).toEqual(['island_0']);

    const warned = warnings();
    expect(warned).toContain('...KEYS.map(...)');          // the construct
    expect(warned).toContain('tables.ts');                 // the file to edit
    expect(warned).toContain('CallExpression');            // why it is not static
    expect(warned).toContain('empty island shell');        // the consequence
  });

  it('still degrades a table the declaring module mutates in place', () => {
    // `const` freezes the binding, not the contents. Unrolling the literal
    // would bake a stale snapshot into the server's HTML that the client then
    // disagrees with — worse than an island, because nothing repairs it.
    const result = emitReal(writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'tables.ts': `
        export const KEYS = [{ k: 'A' }];
        KEYS.push({ k: 'B' });
      `,
      'page.ts': `
        import { h } from 'formajs';
        import { KEYS } from './tables';
        export function Page() {
          return h('ul', { id: 'app' }, ...KEYS.map((r) => h('li', null, r.k)));
        }
      `,
    }, 'app.ts'));

    expect(result.islands.map((i) => i.name)).toEqual(['island_0']);
    expect(warnings()).toContain('tables.ts');
  });

  it('still degrades when a nested declaration shadows the imported table', () => {
    // The identifier at the spread reads the INNER binding. Unrolling the
    // imported table there would ship rows the client never renders.
    const result = emitReal(writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'tables.ts': `export const KEYS = [{ k: 'A' }];`,
      'page.ts': `
        import { h } from 'formajs';
        import { KEYS } from './tables';
        export function Page() {
          const KEYS = loadKeys();
          return h('ul', { id: 'app' }, ...KEYS.map((r) => h('li', null, r.k)));
        }
      `,
    }, 'app.ts'));

    expect(result.islands.map((i) => i.name)).toEqual(['island_0']);
    const warned = warnings();
    expect(warned).toContain('declared in a nested scope');
    expect(warned).toContain('page.ts');
  });

  it('terminates on a re-export cycle instead of hanging the build', () => {
    const result = emitReal(writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'a.ts': `export { KEYS } from './b';`,
      'b.ts': `export { KEYS } from './a';`,
      'page.ts': `
        import { h } from 'formajs';
        import { KEYS } from './a';
        export function Page() {
          return h('ul', { id: 'app' }, ...KEYS.map((r) => h('li', null, r.k)));
        }
      `,
    }, 'app.ts'));

    expect(result.islands.map((i) => i.name)).toEqual(['island_0']);
    expect(warnings()).toContain('cycle');
  });
});

// ===========================================================================
// Failing loudly
// ===========================================================================

describe('generateRealIr — diagnostics when a page cannot be resolved', () => {
  it('names the file, the construct and the consequence when the export is not a function', () => {
    const entry = writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'page.ts': `export const Page = 'not a component';`,
    }, 'app.ts');

    expect(generateRealIr(entry)).toBeNull();

    const warned = warnings();
    expect(warned).toContain('page.ts');            // the file to edit
    expect(warned).toContain('StringLiteral');      // the construct
    expect(warned).toContain('placeholder IR');     // the consequence
    expect(warned).toContain('empty <div id="app">');
  });

  it('says a name is missing rather than blaming the return statement', () => {
    // The old message was `could not find return h() tree in Page` whatever
    // the cause — it sent authors looking at a return statement that was
    // fine, when the compiler had never found the export at all.
    const entry = writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './page';
        mount(() => Page(), '#app');
      `,
      'page.ts': `import { h } from 'formajs';\nexport function Other() { return h('div', null); }`,
    }, 'app.ts');

    expect(generateRealIr(entry)).toBeNull();
    expect(warnings()).toContain("no export named 'Page'");
  });

  it('reports a barrel it cannot follow to a file on disk', () => {
    const entry = writeProject({
      'app.ts': `
        import { mount } from 'formajs';
        import { Page } from './components';
        mount(() => Page(), '#app');
      `,
      'components/index.ts': `export { Page } from './missing';`,
    }, 'app.ts');

    expect(generateRealIr(entry)).toBeNull();
    const warned = warnings();
    expect(warned).toContain("re-exported from './missing'");
    expect(warned).toContain('does not resolve to a readable file');
  });
});
