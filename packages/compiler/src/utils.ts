/**
 * Forma Compiler - Shared Utilities
 *
 * Common helpers used across transform, IR emit, IR walk, and IR analysis passes.
 */

import * as t from '@babel/types';

// ---------------------------------------------------------------------------
// HTML Void Tags
// ---------------------------------------------------------------------------

/** Self-closing HTML tags (void elements). */
export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ---------------------------------------------------------------------------
// Detection Helpers
// ---------------------------------------------------------------------------

/** Check if a prop key is an event handler (onClick, onInput, etc.). */
export function isEventProp(key: string): boolean {
  return key.length > 2
    && key.charCodeAt(0) === 111 // 'o'
    && key.charCodeAt(1) === 110 // 'n'
    && key.charCodeAt(2) >= 65   // 'A'
    && key.charCodeAt(2) <= 90;  // 'Z'
}

/** Check if an expression is a static literal (string, number, boolean, null). */
export function isStaticLiteral(expr: t.Expression): boolean {
  return t.isStringLiteral(expr)
    || t.isNumericLiteral(expr)
    || t.isBooleanLiteral(expr)
    || t.isNullLiteral(expr);
}

/** Check if a node is `undefined`. */
export function isUndefinedIdentifier(node: t.Node): boolean {
  return t.isIdentifier(node) && node.name === 'undefined';
}
