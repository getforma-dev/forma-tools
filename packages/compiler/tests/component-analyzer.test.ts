import { describe, it, expect, vi } from 'vitest';
import { ComponentAnalyzer } from '../src/component-analyzer';

const analyzer = new ComponentAnalyzer('/test/project');

// ===========================================================================
// Task 6: Entry Point Parsing — parseEntryPoint
// ===========================================================================

describe('parseEntryPoint', () => {
  it('finds mount with named component import', () => {
    const source = `
      import { mount } from 'formajs';
      import { OnboardingPage } from './OnboardingPage';
      mount(() => OnboardingPage(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'OnboardingPage',
      importPath: './OnboardingPage',
      importMap: new Map([
        ['mount', 'formajs'],
        ['OnboardingPage', './OnboardingPage'],
      ]),
      importBindings: new Map([
        ['mount', { source: 'formajs', imported: 'mount' }],
        ['OnboardingPage', { source: './OnboardingPage', imported: 'OnboardingPage' }],
      ]),
    });
  });

  it('returns null when no mount call exists', () => {
    const source = `
      import { h } from 'formajs';
      const app = h('div', null, 'Hello');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toBeNull();
  });

  it('handles default import', () => {
    const source = `
      import { mount } from 'formajs';
      import Dashboard from './Dashboard';
      mount(() => Dashboard(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'Dashboard',
      importPath: './Dashboard',
      importMap: new Map([
        ['mount', 'formajs'],
        ['Dashboard', './Dashboard'],
      ]),
      // A DEFAULT import binds the local name to the module's `default`
      // export, not to an export named 'Dashboard' — the resolver has to look
      // for the right one over there.
      importBindings: new Map([
        ['mount', { source: 'formajs', imported: 'mount' }],
        ['Dashboard', { source: './Dashboard', imported: 'default' }],
      ]),
    });
  });

  it('handles different component names', () => {
    const source = `
      import { mount } from 'formajs';
      import { UserProfile } from './pages/UserProfile';
      mount(() => UserProfile(), '#root');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'UserProfile',
      importPath: './pages/UserProfile',
      importMap: new Map([
        ['mount', 'formajs'],
        ['UserProfile', './pages/UserProfile'],
      ]),
      importBindings: new Map([
        ['mount', { source: 'formajs', imported: 'mount' }],
        ['UserProfile', { source: './pages/UserProfile', imported: 'UserProfile' }],
      ]),
    });
  });

  it('handles mount with direct component reference (no arrow)', () => {
    const source = `
      import { mount } from 'formajs';
      import { App } from './App';
      mount(App, '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'App',
      importPath: './App',
      importMap: new Map([
        ['mount', 'formajs'],
        ['App', './App'],
      ]),
      importBindings: new Map([
        ['mount', { source: 'formajs', imported: 'mount' }],
        ['App', { source: './App', imported: 'App' }],
      ]),
    });
  });

  it('treats a mount of a locally-declared component as an inline mount', () => {
    // There is no component FILE to open — the component is right here. This
    // used to return null, which drops the whole page to placeholder IR; the
    // arrow's body is the tree, and the entry file is the scope it resolves
    // against.
    const source = `
      import { mount } from 'formajs';
      function LocalComponent() { return null; }
      mount(() => LocalComponent(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.componentName).toBe('__inline__');
    expect(result!.inlineReturnNode!.type).toBe('CallExpression');
  });

  it('does not treat a PACKAGE import as a component file', () => {
    // `mount(() => h('div', …), '#app')` matched the named-component pattern
    // because `h` is an imported identifier — so the plugin went looking for a
    // component file named 'formajs', failed, and dropped the page to
    // placeholder IR. Only a relative import names a file this compiler opens.
    const source = `
      import { h, mount } from 'formajs';
      mount(() => h('div', { id: 'app' }, 'hi'), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result!.componentName).toBe('__inline__');
    expect(result!.importPath).toBe('');
  });

  it('handles re-exported named import', () => {
    const source = `
      import { mount } from 'formajs';
      import { LoginPage as Page } from './LoginPage';
      mount(() => Page(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'Page',
      importPath: './LoginPage',
      importMap: new Map([
        ['mount', 'formajs'],
        ['Page', './LoginPage'],
      ]),
      // The ALIAS is the whole point: local `Page` is exported as `LoginPage`
      // by ./LoginPage, so looking up 'Page' over there would find nothing.
      importBindings: new Map([
        ['mount', { source: 'formajs', imported: 'mount' }],
        ['Page', { source: './LoginPage', imported: 'LoginPage' }],
      ]),
    });
  });

  it('Pattern 3: block-body mount with return — extracts inline return node', () => {
    const source = `
      import { h, mount, createEffect } from '@getforma/core';
      import { Sidebar } from './components/Sidebar';

      mount(() => {
        createEffect(() => { console.log('side effect'); });
        return h('div', null, h(Sidebar, null));
      }, '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.tsx');
    expect(result).not.toBeNull();
    expect(result!.componentName).toBe('__inline__');
    expect(result!.inlineReturnNode).toBeDefined();
  });

  it('Pattern 3: block-body mount with Fragment return', () => {
    const source = `
      import { h, Fragment, mount } from '@getforma/core';

      mount(() => {
        return h(Fragment, null, h('div', null, 'A'), h('span', null, 'B'));
      }, '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.tsx');
    expect(result).not.toBeNull();
    expect(result!.componentName).toBe('__inline__');
    expect(result!.inlineReturnNode).toBeDefined();
  });

  it('Pattern 3: block-body mount with no return — returns null', () => {
    const source = `
      import { h, mount } from '@getforma/core';
      mount(() => { console.log('no return'); }, '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.tsx');
    expect(result).toBeNull();
  });

  it('collects activateIslands names on the named mount path', () => {
    const source = `
      import { mount, activateIslands } from 'formajs';
      import { DashboardPage } from './DashboardPage';
      import { CounterIsland } from './CounterIsland';
      mount(() => DashboardPage(), '#app');
      activateIslands({ CounterIsland });
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.componentName).toBe('DashboardPage');
    expect(result!.islandNames).toEqual(new Set(['CounterIsland']));
  });

  it('collects activateIslands names on the inline block-body mount path', () => {
    const source = `
      import { h, mount, activateIslands } from 'formajs';
      import { CounterIsland } from './CounterIsland';
      mount(() => {
        return h('div', null, CounterIsland());
      }, '#app');
      activateIslands({ CounterIsland });
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.componentName).toBe('__inline__');
    expect(result!.islandNames).toEqual(new Set(['CounterIsland']));
  });

  it('Pattern 3: block-body mount with multiple statements before return', () => {
    const source = `
      import { h, mount, createSignal, createEffect, onCleanup } from '@getforma/core';
      import { PageA } from './pages/PageA';

      const [page, setPage] = createSignal('home');

      mount(() => {
        createEffect(() => { history.pushState(null, '', '/' + page()); });
        const handler = () => setPage(location.pathname.slice(1));
        window.addEventListener('popstate', handler);
        onCleanup(() => window.removeEventListener('popstate', handler));
        return h('div', { class: 'layout' }, h(PageA, null));
      }, '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.tsx');
    expect(result).not.toBeNull();
    expect(result!.componentName).toBe('__inline__');
    expect(result!.inlineReturnNode).toBeDefined();
  });
});

// ===========================================================================
// Task 6: Entry Point Parsing — parseComponentFile
// ===========================================================================

describe('parseComponentFile', () => {
  it('extracts return node from exported function declaration', () => {
    const source = `
      import { h, createSignal } from 'formajs';
      export function OnboardingPage() {
        const [email, setEmail] = createSignal('');
        return h('div', { class: 'page' }, h('h1', null, 'Welcome'));
      }
    `;
    const result = analyzer.parseComponentFile(source, 'OnboardingPage.ts', 'OnboardingPage');
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('OnboardingPage');
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('returns null for non-existent function name', () => {
    const source = `
      export function MyComponent() {
        return h('div', null, 'Hello');
      }
    `;
    const result = analyzer.parseComponentFile(source, 'MyComponent.ts', 'OtherComponent');
    expect(result).toBeNull();
  });

  it('returns null for non-exported function', () => {
    const source = `
      function MyComponent() {
        return h('div', null, 'Hello');
      }
    `;
    const result = analyzer.parseComponentFile(source, 'file.ts', 'MyComponent');
    expect(result).toBeNull();
  });

  it('handles exported arrow function with expression body', () => {
    const source = `
      import { h } from 'formajs';
      export const Card = () => h('div', { class: 'card' }, 'Content');
    `;
    const result = analyzer.parseComponentFile(source, 'Card.ts', 'Card');
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('Card');
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('handles exported arrow function with block body', () => {
    const source = `
      import { h } from 'formajs';
      export const Card = () => {
        const title = 'Hello';
        return h('div', null, title);
      };
    `;
    const result = analyzer.parseComponentFile(source, 'Card.ts', 'Card');
    expect(result).not.toBeNull();
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('handles exported function expression', () => {
    const source = `
      import { h } from 'formajs';
      export const Widget = function() {
        return h('span', null, 'widget');
      };
    `;
    const result = analyzer.parseComponentFile(source, 'Widget.ts', 'Widget');
    expect(result).not.toBeNull();
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('resolves the specifier export shape esbuild emits for .tsx', () => {
    // Every `export function X()` in a .tsx file arrives here as a bare
    // declaration plus `export { X }`. Reading only
    // ExportNamedDeclaration.declaration finds nothing, and the page falls
    // back to placeholder IR.
    const source = `
      import { h } from 'formajs';
      function Page() { return h('main', null, 'hi'); }
      export { Page };
    `;
    const result = analyzer.parseComponentFile(source, 'page.tsx', 'Page');
    expect(result).not.toBeNull();
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('follows an export alias to the real declaration', () => {
    const source = `
      import { h } from 'formajs';
      function PageImpl() { return h('main', null, 'hi'); }
      export { PageImpl as Page };
    `;
    expect(analyzer.parseComponentFile(source, 'page.ts', 'Page')).not.toBeNull();
  });

  it('reports WHY a name could not be followed instead of returning a bare null', () => {
    const details: string[] = [];
    const result = analyzer.parseComponentFile(
      `export const Page = 'not a component';`,
      'page.ts',
      'Page',
      { onUnresolved: (d) => details.push(d) },
    );
    expect(result).toBeNull();
    // The file and the construct: "no export named Page" would send the author
    // looking for a missing export that is right there.
    expect(details.join('\n')).toContain('page.ts');
    expect(details.join('\n')).toContain('StringLiteral');
  });

  it('does not extract return from nested function', () => {
    const source = `
      export function Outer() {
        function inner() {
          return h('span', null, 'inner');
        }
        return h('div', null, 'outer');
      }
    `;
    const result = analyzer.parseComponentFile(source, 'file.ts', 'Outer');
    expect(result).not.toBeNull();
    // Should get the outer return, not the inner one
    // The outer return is h('div', ...) — check it's a call expression
    expect(result!.returnNode.type).toBe('CallExpression');
  });
});

// ===========================================================================
// Task 7: File-level Constant Extraction
// ===========================================================================

describe('extractFileConstants', () => {
  it('extracts const array of objects with string values', () => {
    const source = `
      const CAPABILITIES = [
        { title: 'Multi-Tenant Auth', description: 'Isolated user pools per tenant' },
        { title: 'OAuth + MFA', description: 'Google and GitHub SSO' },
      ];

      export function Page() { return null; }
    `;
    const result = analyzer.extractFileConstants(source, 'page.ts');
    expect(result.size).toBe(1);
    expect(result.get('CAPABILITIES')).toEqual([
      { title: 'Multi-Tenant Auth', description: 'Isolated user pools per tenant' },
      { title: 'OAuth + MFA', description: 'Google and GitHub SSO' },
    ]);
  });

  it('handles objects with mixed primitive types', () => {
    const source = `
      const ITEMS = [
        { name: 'Widget', count: 42, active: true },
        { name: 'Gadget', count: 0, active: false },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.get('ITEMS')).toEqual([
      { name: 'Widget', count: 42, active: true },
      { name: 'Gadget', count: 0, active: false },
    ]);
  });

  it('ignores non-const declarations', () => {
    const source = `
      let ITEMS = [{ name: 'a' }];
      var OTHER = [{ name: 'b' }];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('ignores non-array const declarations', () => {
    const source = `
      const NAME = 'hello';
      const COUNT = 42;
      const OBJ = { key: 'val' };
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('ignores arrays with non-object elements', () => {
    const source = `
      const NAMES = ['Alice', 'Bob', 'Charlie'];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('ignores arrays with objects containing non-primitive values', () => {
    const source = `
      const ITEMS = [
        { name: 'Widget', handler: () => console.log('click') },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('handles empty array', () => {
    const source = `
      const EMPTY = [];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(1);
    expect(result.get('EMPTY')).toEqual([]);
  });

  it('returns empty map for no constants', () => {
    const source = `
      export function Component() { return null; }
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('drops a const table the file mutates in place', () => {
    // `const` freezes the BINDING, not the array. Rule 9 unrolls this map's
    // contents into static server HTML, so a table whose contents change after
    // declaration would ship a stale snapshot the client then disagrees with —
    // and unlike a missing island, nothing repairs a wrong static row.
    const source = `
      const ROWS = [{ k: 'A' }];
      ROWS.push({ k: 'B' });
    `;
    expect(analyzer.extractFileConstants(source, 'file.ts').size).toBe(0);
  });

  it('drops a const table assigned through an index', () => {
    const source = `
      const ROWS = [{ k: 'A' }];
      ROWS[0] = { k: 'B' };
    `;
    expect(analyzer.extractFileConstants(source, 'file.ts').size).toBe(0);
  });

  it('keeps a table the file only reads', () => {
    // The guard must not fire on ordinary reads — `.map`, `.length`, indexing —
    // or it would degrade every table Rule 9 exists to unroll.
    const source = `
      const ROWS = [{ k: 'A' }];
      const first = ROWS[0];
      const all = ROWS.map((r) => r.k).join(ROWS.length);
    `;
    expect(analyzer.extractFileConstants(source, 'file.ts').get('ROWS'))
      .toEqual([{ k: 'A' }]);
  });

  it('extracts multiple constants', () => {
    const source = `
      const FEATURES = [
        { name: 'Auth', enabled: true },
      ];
      const PLANS = [
        { name: 'Free', price: 0 },
        { name: 'Pro', price: 29 },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(2);
    expect(result.get('FEATURES')).toEqual([{ name: 'Auth', enabled: true }]);
    expect(result.get('PLANS')).toEqual([
      { name: 'Free', price: 0 },
      { name: 'Pro', price: 29 },
    ]);
  });

  it('ignores constants inside function bodies', () => {
    const source = `
      export function Component() {
        const LOCAL = [{ key: 'val' }];
        return null;
      }
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('handles objects with string-literal keys', () => {
    const source = `
      const DATA = [
        { 'data-testid': 'card', 'aria-label': 'info' },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.get('DATA')).toEqual([
      { 'data-testid': 'card', 'aria-label': 'info' },
    ]);
  });

  it('extracts export const array declarations', () => {
    const source = `
      export const FEATURES = [
        { name: 'Auth', enabled: true },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(1);
    expect(result.get('FEATURES')).toEqual([{ name: 'Auth', enabled: true }]);
  });
});

// ===========================================================================
// String Constant Extraction — extractStringConstants
// ===========================================================================

describe('extractStringConstants', () => {
  it('folds an export const string declaration', () => {
    const source = `
      export const ICON_PATH = 'M4 6h16' + 'M4 12h16';
      const LOCAL = 'plain';
    `;
    const result = analyzer.extractStringConstants(source, 'icons.ts');
    expect(result.get('ICON_PATH')).toBe('M4 6h16M4 12h16');
    expect(result.get('LOCAL')).toBe('plain');
  });

  it('folds a reference chain through an export const', () => {
    const source = `
      export const HEAD = 'M10 0 ';
      const BODY = HEAD + 'L20 30';
    `;
    const result = analyzer.extractStringConstants(source, 'icons.ts');
    expect(result.get('BODY')).toBe('M10 0 L20 30');
  });

  it('drops a const shadowed by a nested variable declaration', () => {
    const source = `
      const cls = 'icon';
      const KEEP = 'kept';
      export function Page() {
        const cls = computeClass();
        return h('div', { class: cls });
      }
    `;
    const result = analyzer.extractStringConstants(source, 'page.ts');
    // Shadowed name must not fold — the walker cannot tell which binding an
    // identifier refers to, and baking the module value into a static attr
    // would be unrecoverable client-side.
    expect(result.has('cls')).toBe(false);
    expect(result.get('KEEP')).toBe('kept');
  });

  it('drops a const shadowed by a function parameter', () => {
    const source = `
      const label = 'Default';
      function format(label) { return label.trim(); }
    `;
    const result = analyzer.extractStringConstants(source, 'file.ts');
    expect(result.has('label')).toBe(false);
  });

  it('drops a folded const whose UTF-8 encoding exceeds 65535 bytes and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = `
      const HUGE = '${'x'.repeat(70000)}';
      const SMALL = 'ok';
    `;
    const result = analyzer.extractStringConstants(source, 'big.ts');
    // A >64KB string cannot be encoded in the FMIR string table (u16 length
    // prefix), so it must never enter the fold map.
    expect(result.has('HUGE')).toBe(false);
    expect(result.get('SMALL')).toBe('ok');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`const 'HUGE'`),
    );
    warnSpy.mockRestore();
  });

  it('keeps a folded const at exactly 65535 bytes', () => {
    const source = `const EDGE = '${'x'.repeat(65535)}';`;
    const result = analyzer.extractStringConstants(source, 'edge.ts');
    expect(result.get('EDGE')).toHaveLength(65535);
  });
});
