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

  it('exposes vite plugins for compiler and server transforms', () => {
    const compilerPlugin = formaCompiler();
    const serverPlugin = formaServer({ mode: 'server' });

    expect(compilerPlugin.name).toBe('forma-compiler');
    expect(typeof compilerPlugin.transform).toBe('function');
    expect(serverPlugin.name).toBe('forma-server');
    expect(typeof serverPlugin.transform).toBe('function');
  });
});
