/**
 * Snapshot tests for the IR Walk Engine.
 *
 * Each test captures the exact opcode hex output for a specific rule,
 * so future changes to the walk engine are caught by snapshot diffs.
 */
import { describe, test, expect } from 'vitest';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';
import { IrEmitContext } from '../src/ir-emit';
import { walkHTree, type WalkContext } from '../src/ir-walk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseExpr(code: string): T.Expression {
  const ast = parse(`const __x = ${code}`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  const decl = ast.program.body[0] as T.VariableDeclaration;
  return decl.declarations[0]!.init!;
}

function opcodeHex(code: string, walkCtx: WalkContext = {}): string {
  const expr = parseExpr(code);
  const ctx = new IrEmitContext();
  walkHTree(expr as T.CallExpression, 'h', ctx, walkCtx);
  const binary = ctx.toBinary();

  // Extract opcode section (section 0 in v2 layout)
  const view = new DataView(binary.buffer);
  const opcodeOffset = view.getUint32(16, true);
  const opcodeSize = view.getUint32(20, true);
  const opcodes = binary.slice(opcodeOffset, opcodeOffset + opcodeSize);

  return Array.from(opcodes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Snapshot Tests — One per Rule
// ---------------------------------------------------------------------------

describe('ir-walk snapshots', () => {
  test('Rule 1: static div with class', () => {
    expect(opcodeHex(`h('div', { class: 'hero' })`)).toMatchSnapshot();
  });

  test('Rule 2: h1 with text child', () => {
    expect(opcodeHex(`h('h1', null, 'Hello World')`)).toMatchSnapshot();
  });

  test('Rule 3: input void tag', () => {
    expect(
      opcodeHex(`h('input', { type: 'email', placeholder: 'you@co.com' })`),
    ).toMatchSnapshot();
  });

  test('Rule 4: ternary arrow child', () => {
    expect(
      opcodeHex(`h('span', null, () => x() ? 'Yes' : 'No')`),
    ).toMatchSnapshot();
  });

  test('Rule 5: dynamic text child', () => {
    expect(opcodeHex(`h('span', null, () => name())`)).toMatchSnapshot();
  });

  test('Rule 6: dynamic attr', () => {
    expect(
      opcodeHex(`h('input', { type: () => x() ? 'text' : 'password' })`),
    ).toMatchSnapshot();
  });

  test('Rule 7: event handler skipped', () => {
    expect(
      opcodeHex(`h('button', { onClick: () => {}, class: 'btn' }, 'Go')`),
    ).toMatchSnapshot();
  });

  test('Rule 9: static map unroll', () => {
    const fileConstants = new Map<string, any[]>();
    fileConstants.set('ITEMS', [
      { title: 'A', desc: 'First' },
      { title: 'B', desc: 'Second' },
    ]);
    expect(
      opcodeHex(
        `h('div', null, ...ITEMS.map((item) => h('p', null, item.title)))`,
        { fileConstants },
      ),
    ).toMatchSnapshot();
  });

  test('Rule 12: null child skipped', () => {
    expect(
      opcodeHex(`h('div', null, null, 'text', false)`),
    ).toMatchSnapshot();
  });

  test('nested structure', () => {
    expect(
      opcodeHex(
        `h('div', { class: 'outer' }, h('h1', null, 'Title'), h('p', null, 'Body'))`,
      ),
    ).toMatchSnapshot();
  });
});
