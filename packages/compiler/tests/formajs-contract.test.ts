/**
 * Contract tests — verify that every import the compiler generates
 * actually exists in @getforma/core. Catches the exact class of bug
 * where template wasn't exported from the main barrel.
 *
 * Compiled output names the published package, `@getforma/core`, never the
 * bare `formajs`: npm refuses that name to everyone (too similar to the
 * third-party `forma-js`), so it can only ever resolve through a build alias.
 * A user's own `formajs` import is left as written; the build's `formaAlias`
 * still resolves it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import { compileFormaJSX, transformServerFunctions } from '../src/index';

/** Every named or default import in `code`, as imported name → module specifier. */
function importedFrom(code: string): Record<string, string> {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] });
  const map: Record<string, string> = {};
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers) {
      const name = spec.type === 'ImportSpecifier'
        ? (spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value)
        : spec.local.name;
      map[name] = node.source.value;
    }
  }
  return map;
}

describe('compiler → @getforma/core import contracts', () => {
  it('compiled h() generates template import from "@getforma/core"', () => {
    const source = `
      import { h } from 'formajs';
      export const view = h('div', { class: 'card' }, 'hello');
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('import { template as _$template } from "@getforma/core"');
  });

  it('compiled h() with dynamic children generates createEffect import from "@getforma/core"', () => {
    const source = `
      import { h, createSignal } from 'formajs';
      const [count, setCount] = createSignal(0);
      export const view = h('p', null, () => count());
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('import { createEffect as _$createEffect } from "@getforma/core"');
  });

  it('compiled h() with event handler does not generate unexpected imports', () => {
    const source = `
      import { h } from 'formajs';
      export const view = h('button', { onClick: () => {} }, 'Click');
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    // Should have template but NOT createEffect (no reactive children)
    expect(out!.code).toContain('import { template as _$template } from "@getforma/core"');
    expect(out!.code).not.toContain('createEffect');
  });

  it('compiled h() preserves user imports from "formajs" unchanged', () => {
    const source = `
      import { h, createSignal, batch } from 'formajs';
      const [a] = createSignal(0);
      export const view = h('div', null, 'static');
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    // User's original imports should remain
    expect(out!.code).toContain("import { h, createSignal, batch } from 'formajs'");
  });

  it('adds no import of the bare name "formajs", even to a module written against it', () => {
    // Both compiler-added imports (template for the clone, createEffect for the
    // reactive attribute and text) must name @getforma/core; the user's own
    // `formajs` import is theirs and stays, resolved by the build's alias.
    const source = `
      import { h, createSignal } from 'formajs';
      const [count] = createSignal(0);
      export const view = h('div', { class: () => (count() > 0 ? 'on' : 'off') }, () => count());
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    expect(importedFrom(out!.code)).toEqual({
      template: '@getforma/core',
      createEffect: '@getforma/core',
      h: 'formajs',
      createSignal: 'formajs',
    });
  });

  it('compiles h() imported from "@getforma/core", and the output never names "formajs"', () => {
    // The scoped name is what compiled output imports and what applications
    // migrate to (DR-33); the transform must recognise it as a Forma import,
    // or a migrated module silently falls back to runtime h().
    const source = `
      import { h, createSignal } from '@getforma/core';
      const [count] = createSignal(0);
      export const view = h('p', { class: 'n' }, () => count());
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('cloneNode(true)');
    expect(out!.code).not.toMatch(/formajs/);
    expect(importedFrom(out!.code)).toEqual({
      template: '@getforma/core',
      createEffect: '@getforma/core',
      h: '@getforma/core',
      createSignal: '@getforma/core',
    });
  });

  it('static-only component generates template import but no createEffect', () => {
    const source = `
      import { h } from 'formajs';
      export const view = h('div', { class: 'static' },
        h('h1', null, 'Title'),
        h('p', null, 'Body text'),
      );
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('template');
    expect(out!.code).toContain('cloneNode');
    expect(out!.code).not.toContain('createEffect');
  });
});

describe('server transform → @getforma/core/server import contracts', () => {
  it('client mode generates $$serverFunction import from "@getforma/core/server"', () => {
    const source = `
      async function save(data: string) {
        "use server";
        return data;
      }
    `;
    const out = transformServerFunctions(source, '/tmp/s.ts', { mode: 'client' });
    expect(out).not.toBeNull();
    expect(out!.code).toContain('from "@getforma/core/server"');
    expect(out!.code).toContain('$$serverFunction');
    expect(importedFrom(out!.code)).toEqual({ $$serverFunction: '@getforma/core/server' });
    // Neither the bare name nor any subpath of it
    expect(out!.code).not.toMatch(/formajs/);
  });

  it('server mode generates registerServerFunction import from "@getforma/core/server"', () => {
    const source = `
      async function create(name: string) {
        "use server";
        return { name };
      }
    `;
    const out = transformServerFunctions(source, '/tmp/s.ts', { mode: 'server' });
    expect(out).not.toBeNull();
    expect(out!.code).toContain('from "@getforma/core/server"');
    expect(out!.code).toContain('registerServerFunction');
    expect(importedFrom(out!.code)).toEqual({ registerServerFunction: '@getforma/core/server' });
    // Neither the bare name nor any subpath of it
    expect(out!.code).not.toMatch(/formajs/);
  });

  it('server mode removes "use server" directive', () => {
    const source = `
      async function save(x: string) {
        "use server";
        return x;
      }
    `;
    const out = transformServerFunctions(source, '/tmp/s.ts', { mode: 'server' });
    expect(out).not.toBeNull();
    expect(out!.code).not.toContain('"use server"');
  });
});
