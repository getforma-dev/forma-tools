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

// ---------------------------------------------------------------------------
// Slot Naming
// ---------------------------------------------------------------------------

/**
 * Reserve the next occurrence of `base` in a per-page occurrence registry and
 * return the unique name for it: the first occurrence keeps `base` verbatim,
 * the Nth gets `base#N`. Shared by every slot-name family (signals, list bases,
 * show, attr, text) so one documented scheme governs all of them — and so a
 * name that appears once on a page keeps the spelling downstream consumers pin.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "keeps single-occurrence attr and text names unsuffixed"
 * Verified by: packages/compiler/tests/signal-scope.test.ts > "suffixes the second scope to declare a name"
 */
export function uniqueName(counts: Map<string, number>, base: string): string {
  const occurrence = (counts.get(base) ?? 0) + 1;
  counts.set(base, occurrence);
  return occurrence > 1 ? `${base}#${occurrence}` : base;
}
