import { describe, expect, it } from 'vitest';
import {
  compileFormaJSX,
  formaCompiler,
  formaServer,
  transformServerFunctions,
} from '../src/index';

describe('compiler integration', () => {
  it('compiles h() calls into template-based output', () => {
    const source = `
      import { h } from 'formajs';
      export const view = h('div', { class: 'card' }, 'hello');
    `;

    const out = compileFormaJSX(source, '/tmp/view.ts');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('template');
    expect(out!.code).toContain('cloneNode(true)');
  });

  it('transforms "use server" functions for client mode', () => {
    const source = `
      export async function saveTodo(text: string) {
        "use server";
        return text.length;
      }
    `;

    const out = transformServerFunctions(source, '/tmp/save.ts', { mode: 'client' });
    expect(out).not.toBeNull();
    expect(out!.code).toContain('$$serverFunction');
    expect(out!.code).toContain('/rpc/saveTodo_');
  });

  it('transforms "use server" functions for server mode with registration', () => {
    const source = `
      async function createUser(name: string) {
        "use server";
        return { id: 1, name };
      }
    `;

    const out = transformServerFunctions(source, '/tmp/create.ts', { mode: 'server' });
    expect(out).not.toBeNull();
    expect(out!.code).toContain('registerServerFunction');
    expect(out!.code).toContain('/rpc/createUser_');
    expect(out!.code).not.toContain('"use server"');
  });

  it('per-call counter isolation: separate calls both start from _tmpl$0 / _root$0', () => {
    // Use dynamic attributes so the compiler emits _root$ variables
    const sourceA = `
      import { h } from 'formajs';
      const cls = () => 'a';
      export const a = h('div', { class: cls }, 'A');
    `;
    const sourceB = `
      import { h } from 'formajs';
      const cls = () => 'b';
      export const b = h('span', { class: cls }, 'B');
    `;

    const outA = compileFormaJSX(sourceA, '/tmp/a.ts');
    const outB = compileFormaJSX(sourceB, '/tmp/b.ts');

    expect(outA).not.toBeNull();
    expect(outB).not.toBeNull();

    // Both outputs must start template counter from 0
    expect(outA!.code).toContain('_tmpl$0');
    expect(outB!.code).toContain('_tmpl$0');

    // Both outputs must start root var counter from 0
    expect(outA!.code).toContain('_root$0');
    expect(outB!.code).toContain('_root$0');
  });

  it('multiple h() calls in one file get sequential template IDs', () => {
    const source = `
      import { h } from 'formajs';
      export const a = h('div', null, 'first');
      export const b = h('span', null, 'second');
    `;

    const out = compileFormaJSX(source, '/tmp/multi.ts');
    expect(out).not.toBeNull();

    // Should have _tmpl$0 and _tmpl$1 for the two h() calls
    expect(out!.code).toContain('_tmpl$0');
    expect(out!.code).toContain('_tmpl$1');
  });

  it('exposes vite plugins for compiler and server transforms', () => {
    const compilerPlugin = formaCompiler();
    const serverPlugin = formaServer({ mode: 'server' });

    expect(compilerPlugin.name).toBe('forma-compiler');
    expect(typeof compilerPlugin.transform).toBe('function');
    expect(serverPlugin.name).toBe('forma-server');
    expect(typeof serverPlugin.transform).toBe('function');
  });
});
