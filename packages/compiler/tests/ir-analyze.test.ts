import { describe, it, expect } from 'vitest';
import { classifySubtree, SubtreeClassification } from '../src/ir-analyze';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import _traverse from '@babel/traverse';

const traverse = typeof _traverse === 'function' ? _traverse : (_traverse as any).default;

/**
 * Parse a JS expression string into a Babel AST Expression node.
 * Wraps the expression in `const x = <expr>` and extracts the init.
 */
function parseExpr(code: string): T.Expression {
  const ast = parse(`const x = ${code}`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  let expr: T.Expression | undefined;
  traverse(ast, {
    VariableDeclarator(path: any) {
      expr = path.node.init;
      path.stop();
    },
  });
  if (!expr) throw new Error(`Failed to parse expression: ${code}`);
  return expr;
}

describe('classifySubtree', () => {
  it('classifies fully static h() call as static', () => {
    const node = parseExpr(`h('div', { class: 'card' }, 'Hello')`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Static);
  });

  it('classifies h() with dynamic class prop as dynamic', () => {
    const node = parseExpr(`h('div', { class: () => activeClass() })`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Dynamic);
  });

  it('classifies h() with signal child as dynamic', () => {
    const node = parseExpr(`h('div', null, () => name())`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Dynamic);
  });

  it('classifies h() with event handler as island', () => {
    const node = parseExpr(`h('button', { onClick: handleClick }, 'Click')`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Island);
  });

  it('classifies h() with ref as island', () => {
    const node = parseExpr(`h('div', { ref: myRef })`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Island);
  });

  it('classifies nested static h() calls as static', () => {
    const node = parseExpr(
      `h('div', null, h('span', { class: 'a' }, 'Hello'))`,
    );
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Static);
  });

  it('classifies nested mixed as island (island wins)', () => {
    const node = parseExpr(
      `h('div', null, h('span', { onClick: fn }, 'Hi'))`,
    );
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Island);
  });

  it('classifies h() with variable prop as dynamic', () => {
    const node = parseExpr(`h('div', { class: className })`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Dynamic);
  });

  it('classifies h() with null props as static', () => {
    const node = parseExpr(`h('div', null, 'text')`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Static);
  });

  it('classifies non-h-call as static', () => {
    const node = parseExpr(`someFunction()`);
    expect(classifySubtree(node, 'h')).toBe(SubtreeClassification.Static);
  });
});
