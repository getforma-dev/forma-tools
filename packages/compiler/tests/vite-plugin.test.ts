/**
 * formaCompiler / formaServer plugin gating.
 *
 * The only previous coverage asserted that `plugin.transform` is a function.
 * What decides whether a project builds is which FILES the hook chooses to
 * rewrite, and that decision was wrong in both directions: the default
 * `**\/node_modules/**` exclude never matched anything (it compared the id
 * against the literal string `node_modules/**`), and include matched on file
 * extension alone, so a scoped `include: ['src/**\/*.ts']` also claimed
 * `vendor/x.ts`. Windows ids — backslash-separated — matched no pattern at all.
 */

import { describe, it, expect } from 'vitest';
import type { Plugin } from 'vite';
import { formaCompiler, formaServer } from '../src/index';

/** Invoke a plugin's transform hook the way Vite does. */
function runTransform(plugin: Plugin, code: string, id: string): string | null {
  const hook = plugin.transform;
  const fn = typeof hook === 'function' ? hook : hook?.handler;
  if (!fn) throw new Error('plugin has no transform hook');
  const out = (fn as (this: unknown, c: string, i: string) => unknown).call({}, code, id);
  if (!out) return null;
  return (out as { code: string }).code;
}

/** A module the compiler WILL rewrite when it is allowed to. */
const SOURCE = `
  import { h } from 'formajs';
  export const view = h('div', { class: 'card' }, 'hello');
`;

describe('formaCompiler file gating', () => {
  const plugin = formaCompiler();

  it('transforms a project source file', () => {
    // Presence half of the contract: the ids below are skipped because of the
    // patterns, not because the hook never transforms anything.
    expect(runTransform(plugin, SOURCE, '/proj/src/view.ts')).toContain('cloneNode(true)');
    expect(runTransform(plugin, SOURCE, 'C:\\proj\\src\\view.tsx')).toContain('cloneNode(true)');
  });

  it.each([
    ['POSIX', '/proj/node_modules/dep/index.ts'],
    ['nested POSIX', '/proj/packages/app/node_modules/dep/lib/index.ts'],
    ['Windows', 'C:\\proj\\node_modules\\dep\\index.ts'],
    ['Windows nested', 'C:\\proj\\packages\\app\\node_modules\\dep\\lib\\index.tsx'],
  ])('excludes node_modules on POSIX and Windows ids (%s)', (_label, id) => {
    expect(runTransform(plugin, SOURCE, id)).toBeNull();
  });

  it('does not exclude a project directory that merely contains the word', () => {
    // Negative space: the exclude is a path-segment match, not a substring one.
    expect(runTransform(plugin, SOURCE, '/proj/src/node_modules_helper/view.ts'))
      .toContain('cloneNode(true)');
  });

  it.each([
    ['.js', '/proj/src/view.js'],
    ['.jsx', '/proj/src/view.jsx'],
    ['.css', '/proj/src/view.css'],
    ['no extension', '/proj/src/view'],
  ])('skips %s files under the default include', (_label, id) => {
    expect(runTransform(plugin, SOURCE, id)).toBeNull();
  });

  it('honours a directory-scoped include', () => {
    const scoped = formaCompiler({ include: ['src/**/*.ts'] });

    expect(runTransform(scoped, SOURCE, 'src/deep/view.ts')).toContain('cloneNode(true)');
    expect(runTransform(scoped, SOURCE, 'src/view.ts')).toContain('cloneNode(true)');
    // Outside the scope — the old extension-only check rewrote this too.
    expect(runTransform(scoped, SOURCE, 'vendor/view.ts')).toBeNull();
  });

  it('honours a custom exclude', () => {
    const scoped = formaCompiler({ exclude: ['**/generated/**'] });

    expect(runTransform(scoped, SOURCE, '/proj/src/generated/view.ts')).toBeNull();
    expect(runTransform(scoped, SOURCE, '/proj/src/view.ts')).toContain('cloneNode(true)');
  });

  it('ignores a Vite query suffix when classifying an id', () => {
    expect(runTransform(plugin, SOURCE, '/proj/src/view.ts?v=abc123'))
      .toContain('cloneNode(true)');
    expect(runTransform(plugin, SOURCE, '/proj/node_modules/dep/index.ts?v=abc123'))
      .toBeNull();
  });

  it('leaves files that do not import forma alone', () => {
    const unrelated = `export const view = h('div', null, 'x');`;
    expect(runTransform(plugin, unrelated, '/proj/src/view.ts')).toBeNull();
  });
});

describe('formaServer file gating', () => {
  const plugin = formaServer({ mode: 'client' });
  const SERVER_FN = `
    export async function saveTodo(text) {
      "use server";
      return text.length;
    }
  `;

  it('transforms a project file with a "use server" directive', () => {
    expect(runTransform(plugin, SERVER_FN, '/proj/src/api.ts'))
      .toContain('$$serverFunction');
  });

  it('skips node_modules', () => {
    expect(runTransform(plugin, SERVER_FN, '/proj/node_modules/dep/api.ts')).toBeNull();
  });

  it('skips files with no directive', () => {
    expect(runTransform(plugin, `export const x = 1;`, '/proj/src/api.ts')).toBeNull();
  });
});
