/**
 * Contract tests — verify that every import the compiler generates
 * actually exists in @getforma/core. Catches the exact class of bug
 * where template wasn't exported from the main barrel.
 */
import { describe, it, expect } from 'vitest';
import { compileFormaJSX, transformServerFunctions } from '../src/index';

describe('compiler → formajs import contracts', () => {
  it('compiled h() generates template import from "formajs"', () => {
    const source = `
      import { h } from 'formajs';
      export const view = h('div', { class: 'card' }, 'hello');
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('import { template as _$template } from "formajs"');
  });

  it('compiled h() with dynamic children generates createEffect import from "formajs"', () => {
    const source = `
      import { h, createSignal } from 'formajs';
      const [count, setCount] = createSignal(0);
      export const view = h('p', null, () => count());
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('import { createEffect as _$createEffect } from "formajs"');
  });

  it('compiled h() with event handler does not generate unexpected imports', () => {
    const source = `
      import { h } from 'formajs';
      export const view = h('button', { onClick: () => {} }, 'Click');
    `;
    const out = compileFormaJSX(source, '/tmp/test.tsx');
    expect(out).not.toBeNull();
    // Should have template but NOT createEffect (no reactive children)
    expect(out!.code).toContain('import { template as _$template } from "formajs"');
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

describe('server transform → formajs/server import contracts', () => {
  it('client mode generates $$serverFunction import from "formajs/server"', () => {
    const source = `
      async function save(data: string) {
        "use server";
        return data;
      }
    `;
    const out = transformServerFunctions(source, '/tmp/s.ts', { mode: 'client' });
    expect(out).not.toBeNull();
    expect(out!.code).toContain('from "formajs/server"');
    expect(out!.code).toContain('$$serverFunction');
    // Must NOT import from bare "formajs"
    expect(out!.code).not.toMatch(/from ["']formajs["'][^/]/);
  });

  it('server mode generates registerServerFunction import from "formajs/server"', () => {
    const source = `
      async function create(name: string) {
        "use server";
        return { name };
      }
    `;
    const out = transformServerFunctions(source, '/tmp/s.ts', { mode: 'server' });
    expect(out).not.toBeNull();
    expect(out!.code).toContain('from "formajs/server"');
    expect(out!.code).toContain('registerServerFunction');
    // Must NOT import from bare "formajs"
    expect(out!.code).not.toMatch(/from ["']formajs["'][^/]/);
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
