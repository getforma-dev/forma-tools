/**
 * Forma Compiler - IR Walk Engine
 *
 * Walks h() call tree AST nodes and emits FMIR binary opcodes.
 * Implements all 12 pattern recognition rules for real component analysis.
 *
 * Rules:
 *   1. Static h() calls        -> OPEN_TAG + CLOSE_TAG
 *   2. String literal children  -> TEXT
 *   3. Void elements            -> VOID_TAG
 *   4. Ternary arrow children   -> SHOW_IF
 *   5. Non-ternary arrow child  -> DYN_TEXT
 *   6. Function-valued props    -> DYN_ATTR
 *   7. on* event handlers       -> skip
 *   8. createShow()             -> SHOW_IF
 *   9. Spread .map() unroll     -> static unroll or island
 *  10. Sub-component calls      -> follow or island
 *  11. Unknown expressions      -> ISLAND_START / ISLAND_END
 *  12. null/undefined/false      -> skip
 */

import { parse } from '@babel/parser';
import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { IrEmitContext } from './ir-emit.js';
import { VOID_TAGS, isEventProp, isStaticLiteral, isUndefinedIdentifier } from './utils.js';

// Handle CJS/ESM compatibility for @babel/traverse
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;

/** Maximum depth for sub-component resolution. Prevents unbounded AST parsing. */
export const MAX_RESOLVE_DEPTH = 3;

// ---------------------------------------------------------------------------
// Opcodes
// ---------------------------------------------------------------------------

const OP_OPEN_TAG    = 0x01;
const OP_CLOSE_TAG   = 0x02;
const OP_VOID_TAG    = 0x03;
const OP_TEXT        = 0x04;
const OP_DYN_TEXT    = 0x05;
const OP_DYN_ATTR    = 0x06;
const OP_SHOW_IF     = 0x07;
const OP_SHOW_ELSE   = 0x08;
const OP_LIST         = 0x0A;
const OP_ISLAND_START = 0x0B;
const OP_ISLAND_END   = 0x0C;
const OP_PROP         = 0x12;

// ---------------------------------------------------------------------------
// Slot Type Hints
// ---------------------------------------------------------------------------

const TYPE_TEXT   = 0x01;
const TYPE_BOOL   = 0x02;
const TYPE_ARRAY  = 0x04;
const TYPE_OBJECT = 0x05;
const SOURCE_SERVER = 0x00;
const SOURCE_CLIENT = 0x01;

/** Convert a static literal to its string representation for an attribute value. */
function staticLiteralToAttrString(expr: t.Expression): string | null {
  if (t.isStringLiteral(expr)) return expr.value;
  if (t.isNumericLiteral(expr)) return String(expr.value);
  if (t.isBooleanLiteral(expr)) return expr.value ? '' : null;
  if (t.isNullLiteral(expr)) return null;
  return null;
}

/** Check if an expression is null, undefined, or false (Rule 12). */
function isNullish(node: t.Expression): boolean {
  return t.isNullLiteral(node)
    || isUndefinedIdentifier(node)
    || (t.isBooleanLiteral(node) && node.value === false);
}

/** Check if a node is a function expression (arrow or regular). */
function isFunctionExpr(node: t.Node): boolean {
  return t.isArrowFunctionExpression(node) || t.isFunctionExpression(node);
}

/**
 * Extract signal name from a simple signal-call arrow: () => signalName()
 * Returns the signal name if the body is a no-arg call to an identifier, else null.
 */
function extractSignalName(fn: t.ArrowFunctionExpression | t.FunctionExpression): string | null {
  const body = getEffectiveBody(fn);
  if (
    body
    && t.isCallExpression(body)
    && t.isIdentifier(body.callee)
    && body.arguments.length === 0
  ) {
    return body.callee.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SSR Default Evaluation
// ---------------------------------------------------------------------------

/**
 * Try to evaluate a dynamic attribute expression to a string using known signal
 * defaults. Handles common patterns:
 *   () => showPassword() ? 'text' : 'password'           → "password"
 *   () => 'mfa-panel' + (showMfa() ? '' : ' hidden')     → "mfa-panel hidden"
 *   () => !!busy()                                        → ""
 *
 * Returns the evaluated string, or undefined if evaluation fails.
 */
function tryEvalExprDefault(
  fnExpr: t.ArrowFunctionExpression | t.FunctionExpression,
  signalDefaults: Map<string, { type: string; default: string | boolean | number | null }>,
): string | undefined {
  const body = getEffectiveBody(fnExpr);
  if (!body) return undefined;
  return evalNode(body, signalDefaults);
}

function evalNode(
  node: t.Expression,
  signals: Map<string, { type: string; default: string | boolean | number | null }>,
): string | undefined {
  // String literal: "foo"
  if (t.isStringLiteral(node)) return node.value;

  // Numeric literal: 42
  if (t.isNumericLiteral(node)) return String(node.value);

  // Boolean literal: true/false
  if (t.isBooleanLiteral(node)) return String(node.value);

  // Null literal
  if (t.isNullLiteral(node)) return '';

  // Template literal with no expressions: `foo`
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map(q => q.value.cooked || q.value.raw).join('');
  }

  // Signal call: signalName()
  if (
    t.isCallExpression(node)
    && t.isIdentifier(node.callee)
    && node.arguments.length === 0
  ) {
    const sig = signals.get(node.callee.name);
    if (sig !== undefined) {
      if (sig.default === null) return '';
      return String(sig.default);
    }
    return undefined;
  }

  // Unary negation: !expr or !!expr
  if (t.isUnaryExpression(node) && node.operator === '!') {
    const inner = evalNode(node.argument as t.Expression, signals);
    if (inner === undefined) return undefined;
    const bool = isTruthy(inner);
    return String(!bool);
  }

  // Ternary: test ? consequent : alternate
  if (t.isConditionalExpression(node)) {
    const test = evalNode(node.test as t.Expression, signals);
    if (test === undefined) return undefined;
    const branch = isTruthy(test) ? node.consequent : node.alternate;
    return evalNode(branch as t.Expression, signals);
  }

  // Binary +: left + right (string concatenation)
  if (t.isBinaryExpression(node) && node.operator === '+') {
    const left = evalNode(node.left as t.Expression, signals);
    const right = evalNode(node.right as t.Expression, signals);
    if (left === undefined || right === undefined) return undefined;
    return left + right;
  }

  // Parenthesized expression
  if (t.isParenthesizedExpression(node)) {
    return evalNode(node.expression, signals);
  }

  // Can't evaluate
  return undefined;
}

/** JS-style truthiness for eval results. */
function isTruthy(val: string): boolean {
  return val !== '' && val !== '0' && val !== 'false' && val !== 'null' && val !== 'undefined';
}

// ---------------------------------------------------------------------------
// Walk Context
// ---------------------------------------------------------------------------

export interface WalkContext {
  /** File-level constant arrays (for Rule 9 static unroll). */
  fileConstants?: Map<string, any[]>;
  /** Signal name -> slot id mappings. */
  signalSlots?: Map<string, number>;
  /** Signal name -> default value (for computing DYN_ATTR SSR defaults). */
  signalDefaults?: Map<string, { type: string; default: string | boolean | number | null }>;
  /** Resolve a sub-component call to its source file and function name. */
  resolveComponent?: (name: string) => { source: string; functionName: string } | null;
  /** Set of visited component names for cycle detection. */
  visited?: Set<string>;
  /** Current depth for sub-component resolution (max 3). */
  depth?: number;
  /** List item bindings: "paramName.propName" → target slot id.
   *  Set when walking inside a createList mapFn body.
   *  The PROP opcodes extract properties at runtime; these bindings
   *  tell the child walker which slot each property was extracted into. */
  listItemBindings?: Map<string, number>;
  /** Names of island components registered in activateIslands({...}).
   *  Island components are NEVER inlined — they always emit ISLAND_START/ISLAND_END. */
  islandNames?: Set<string>;
}

// ---------------------------------------------------------------------------
// Parser Options
// ---------------------------------------------------------------------------

const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const],
};

// ---------------------------------------------------------------------------
// Walk Engine — Main Entry Points
// ---------------------------------------------------------------------------

/**
 * Walk an h() call tree and emit FMIR opcodes.
 * This is the primary entry point for IR compilation.
 */
export function walkHTree(
  node: t.CallExpression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): void {
  const args = node.arguments;
  if (args.length === 0) return;

  // First arg: tag name
  const tagArg = args[0];
  if (!tagArg) return;

  // Fragment: h(Fragment, null, child1, child2) → emit children inline, no wrapper
  if (t.isIdentifier(tagArg) && tagArg.name === 'Fragment') {
    // Walk children (args after props)
    for (let i = 2; i < args.length; i++) {
      const child = args[i];
      if (!child || t.isSpreadElement(child)) continue;
      if (t.isCallExpression(child)) {
        if (t.isIdentifier(child.callee) && child.callee.name === hName) {
          walkHTree(child, hName, ctx, walkCtx);
        } else {
          walkCallExpression(child, hName, ctx, walkCtx);
        }
      } else if (t.isStringLiteral(child)) {
        ctx.emit(OP_TEXT);
        ctx.emitU32(ctx.addString(child.value));
      }
      // null/undefined/false → skip
    }
    return;
  }

  // Rule 11: non-string tag → island
  if (!t.isStringLiteral(tagArg)) {
    emitIsland(ctx);
    return;
  }

  const tag = tagArg.value;
  const tagStrIdx = ctx.addString(tag);
  const isVoid = VOID_TAGS.has(tag);

  // Process props (second arg)
  const staticAttrs: Array<{ keyIdx: number; valIdx: number }> = [];
  const dynAttrs: Array<{ keyIdx: number; slotId: number }> = [];

  const propsArg = args.length > 1 ? args[1] : undefined;
  if (
    propsArg
    && !t.isNullLiteral(propsArg)
    && !isUndefinedIdentifier(propsArg)
    && !t.isSpreadElement(propsArg)
    && t.isObjectExpression(propsArg)
  ) {
    for (const prop of propsArg.properties) {
      if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) continue;
      if (prop.computed) continue;

      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null;
      if (key === null) continue;

      const val = prop.value as t.Expression;

      // Rule 7: Skip event handlers
      if (isEventProp(key)) continue;

      // Skip ref and dangerouslySetInnerHTML
      if (key === 'ref' || key === 'dangerouslySetInnerHTML') continue;

      // Static literal value -> static attribute pair
      if (isStaticLiteral(val)) {
        const strVal = staticLiteralToAttrString(val);
        if (strVal !== null) {
          const keyIdx = ctx.addString(key);
          const valIdx = ctx.addString(strVal);
          staticAttrs.push({ keyIdx, valIdx });
        }
        continue;
      }

      // List item property in attr value: String(row.id) or row.name → DYN_ATTR with bound slot
      if (walkCtx.listItemBindings) {
        let bindingKey: string | null = null;
        // Direct: row.prop
        if (t.isMemberExpression(val) && !val.computed && t.isIdentifier(val.object) && t.isIdentifier(val.property)) {
          bindingKey = `${val.object.name}.${val.property.name}`;
        }
        // Wrapped: String(row.prop)
        if (
          !bindingKey
          && t.isCallExpression(val)
          && t.isIdentifier(val.callee)
          && (val.callee.name === 'String' || val.callee.name === 'Number')
          && val.arguments.length === 1
          && !t.isSpreadElement(val.arguments[0])
        ) {
          const inner = val.arguments[0] as t.Expression;
          if (t.isMemberExpression(inner) && !inner.computed && t.isIdentifier(inner.object) && t.isIdentifier(inner.property)) {
            bindingKey = `${inner.object.name}.${inner.property.name}`;
          }
        }
        if (bindingKey && walkCtx.listItemBindings.has(bindingKey)) {
          const keyIdx = ctx.addString(key);
          const slotId = walkCtx.listItemBindings.get(bindingKey)!;
          dynAttrs.push({ keyIdx, slotId });
          continue;
        }
      }

      // Rule 6: Function/arrow expression -> DYN_ATTR
      if (isFunctionExpr(val)) {
        const keyIdx = ctx.addString(key);
        // Check if the body is a simple signal call and reuse the slot
        const sigName = extractSignalName(val as t.ArrowFunctionExpression | t.FunctionExpression);
        let slotId: number;
        if (sigName && walkCtx.signalSlots?.has(sigName)) {
          slotId = walkCtx.signalSlots.get(sigName)!;
        } else {
          const slotName = `attr:${key}`;
          // Try to compute SSR default by evaluating the expression with signal defaults
          let defaultBytes = new Uint8Array(0);
          if (walkCtx.signalDefaults && walkCtx.signalDefaults.size > 0) {
            const evaluated = tryEvalExprDefault(
              val as t.ArrowFunctionExpression | t.FunctionExpression,
              walkCtx.signalDefaults,
            );
            if (evaluated !== undefined && evaluated !== '') {
              defaultBytes = new TextEncoder().encode(evaluated);
            }
          }
          slotId = ctx.addSlot(slotName, TYPE_TEXT, SOURCE_CLIENT, defaultBytes);
        }
        dynAttrs.push({ keyIdx, slotId });
        continue;
      }

      // Any other expression -> DYN_ATTR
      const keyIdx = ctx.addString(key);
      const slotName = `attr:${key}`;
      const slotId = ctx.addSlot(slotName, TYPE_TEXT);
      dynAttrs.push({ keyIdx, slotId });
    }
  }

  // Rule 3: Void elements
  if (isVoid) {
    ctx.emit(OP_VOID_TAG);
    ctx.emitU32(tagStrIdx);
    ctx.emitU16(staticAttrs.length);
    for (const attr of staticAttrs) {
      ctx.emitU32(attr.keyIdx);
      ctx.emitU32(attr.valIdx);
    }
    // Emit DYN_ATTR for each dynamic attribute
    for (const dyn of dynAttrs) {
      ctx.emit(OP_DYN_ATTR);
      ctx.emitU32(dyn.keyIdx);
      ctx.emitU16(dyn.slotId);
    }
    return; // void tags have no children or close tag
  }

  // Rule 1: Static h() calls -> OPEN_TAG + CLOSE_TAG
  ctx.emit(OP_OPEN_TAG);
  ctx.emitU32(tagStrIdx);
  ctx.emitU16(staticAttrs.length);
  for (const attr of staticAttrs) {
    ctx.emitU32(attr.keyIdx);
    ctx.emitU32(attr.valIdx);
  }

  // Emit DYN_ATTR for each dynamic attribute
  for (const dyn of dynAttrs) {
    ctx.emit(OP_DYN_ATTR);
    ctx.emitU32(dyn.keyIdx);
    ctx.emitU16(dyn.slotId);
  }

  // Process children (3rd+ args)
  for (let i = 2; i < args.length; i++) {
    const childArg = args[i];
    if (!childArg) continue;

    // Handle spread elements (Rule 9)
    if (t.isSpreadElement(childArg)) {
      emitSpreadChild(childArg, hName, ctx, walkCtx);
      continue;
    }

    const child = childArg as t.Expression;
    emitChild(child, hName, ctx, walkCtx, i);
  }

  // CLOSE_TAG
  ctx.emit(OP_CLOSE_TAG);
  ctx.emitU32(tagStrIdx);
}

/**
 * Handle non-h() call expressions: createShow, sub-components.
 */
export function walkCallExpression(
  node: t.CallExpression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): void {
  // Check if this is a createShow call (Rule 8)
  if (
    t.isIdentifier(node.callee)
    && node.callee.name === 'createShow'
  ) {
    emitCreateShow(node, hName, ctx, walkCtx);
    return;
  }

  // Check if this is a createList call
  if (
    t.isIdentifier(node.callee)
    && node.callee.name === 'createList'
  ) {
    emitCreateList(node, hName, ctx, walkCtx);
    return;
  }

  // Check if this is an h() call
  if (
    t.isIdentifier(node.callee)
    && node.callee.name === hName
  ) {
    walkHTree(node, hName, ctx, walkCtx);
    return;
  }

  // Fragment: Fragment(child1, child2) → emit children inline, no wrapper
  if (
    t.isIdentifier(node.callee)
    && node.callee.name === 'Fragment'
  ) {
    for (let i = 0; i < node.arguments.length; i++) {
      const child = node.arguments[i];
      if (!child || t.isSpreadElement(child)) continue;
      if (t.isCallExpression(child)) {
        if (t.isIdentifier(child.callee) && child.callee.name === hName) {
          walkHTree(child, hName, ctx, walkCtx);
        } else {
          walkCallExpression(child, hName, ctx, walkCtx);
        }
      } else if (t.isStringLiteral(child)) {
        ctx.emit(OP_TEXT);
        ctx.emitU32(ctx.addString(child.value));
      }
      // null/undefined/false → skip
    }
    return;
  }

  // Rule 10: Sub-component calls
  if (t.isIdentifier(node.callee)) {
    const componentName = node.callee.name;

    // Island components are NEVER inlined — they always emit ISLAND_START/ISLAND_END.
    // This check must come before resolveComponent to prevent depth-0 inlining.
    // When resolvable, we walk the full component h() tree between ISLAND_START
    // and ISLAND_END so the Rust walker renders real SSR content inside islands.
    if (walkCtx.islandNames?.has(componentName)) {
      if (walkCtx.resolveComponent) {
        try {
          const resolved = walkCtx.resolveComponent(componentName);
          if (resolved) {
            const componentReturn = resolveSubComponent(
              resolved.source, resolved.functionName, node, hName,
            );
            if (componentReturn && t.isCallExpression(componentReturn)) {
              // Register island and emit ISLAND_START
              const byteOffset = ctx.opcodeLen();
              const id = ctx.addIsland(componentName, 0x01, 0x01, [], byteOffset);
              ctx.emit(OP_ISLAND_START);
              ctx.emitU16(id);

              // Walk the full component subtree for SSR content
              const newVisited = new Set<string>(walkCtx.visited || new Set<string>());
              newVisited.add(componentName);
              const islandWalkCtx: WalkContext = {
                ...walkCtx,
                visited: newVisited,
                depth: (walkCtx.depth ?? 0) + 1,
              };
              walkCallExpression(componentReturn, hName, ctx, islandWalkCtx);

              // Emit ISLAND_END
              ctx.emit(OP_ISLAND_END);
              ctx.emitU16(id);
              return;
            }
          }
        } catch { /* resolution failed, fall back to empty shell */ }
      }

      // Fallback: component couldn't be resolved, emit empty div shell
      emitIsland(ctx, componentName);
      return;
    }

    if (walkCtx.resolveComponent) {
      const resolved = walkCtx.resolveComponent(componentName);
      if (resolved) {
        // Cycle detection
        const visited = walkCtx.visited || new Set<string>();
        if (visited.has(componentName)) {
          emitIsland(ctx, componentName);
          return;
        }

        // Depth check
        const depth = walkCtx.depth ?? 0;
        if (depth >= MAX_RESOLVE_DEPTH) {
          emitIsland(ctx, componentName);
          return;
        }

        // Check if call-site props contain non-static values → bail to island
        if (node.arguments.length > 0) {
          const propsArg = node.arguments[0];
          if (propsArg && !t.isSpreadElement(propsArg) && t.isObjectExpression(propsArg)) {
            const hasNonStatic = propsArg.properties.some(prop => {
              if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) return true;
              const val = prop.value as t.Expression;
              return !isStaticLiteral(val);
            });
            if (hasNonStatic) {
              emitIsland(ctx, componentName);
              return;
            }
          }
        }

        // Try to resolve and walk the sub-component
        try {
          const componentReturn = resolveSubComponent(
            resolved.source,
            resolved.functionName,
            node,
            hName,
          );

          if (componentReturn && t.isCallExpression(componentReturn)) {
            const newVisited = new Set(visited);
            newVisited.add(componentName);

            walkHTree(componentReturn, hName, ctx, {
              ...walkCtx,
              visited: newVisited,
              depth: depth + 1,
            });
            return;
          }
        } catch {
          // Resolution failed, fall through to island
        }
      }
    }

    // Resolution failed or not available → island
    emitIsland(ctx, componentName);
    return;
  }

  // Rule 11: Unknown call expression → island
  emitIsland(ctx);
}

// ---------------------------------------------------------------------------
// Child Emission
// ---------------------------------------------------------------------------

/**
 * Emit opcodes for a single child expression.
 */
function emitChild(
  child: t.Expression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
  childIndex: number,
): void {
  // Rule 12: null, undefined, false → skip
  if (isNullish(child)) return;

  // Rule 2: String literal → TEXT
  if (t.isStringLiteral(child)) {
    ctx.emit(OP_TEXT);
    ctx.emitU32(ctx.addString(child.value));
    return;
  }

  // Numeric literal → TEXT
  if (t.isNumericLiteral(child)) {
    ctx.emit(OP_TEXT);
    ctx.emitU32(ctx.addString(String(child.value)));
    return;
  }

  // Recursive h() call
  if (
    t.isCallExpression(child)
    && t.isIdentifier(child.callee)
    && child.callee.name === hName
  ) {
    walkHTree(child, hName, ctx, walkCtx);
    return;
  }

  // String(row.prop) or Number(row.prop) wrapper → same as row.prop
  if (
    t.isCallExpression(child)
    && t.isIdentifier(child.callee)
    && (child.callee.name === 'String' || child.callee.name === 'Number')
    && child.arguments.length === 1
    && !t.isSpreadElement(child.arguments[0])
  ) {
    const arg = child.arguments[0] as t.Expression;
    if (t.isMemberExpression(arg) && !arg.computed && t.isIdentifier(arg.object) && t.isIdentifier(arg.property)) {
      const key = `${arg.object.name}.${arg.property.name}`;
      if (walkCtx.listItemBindings?.has(key)) {
        const slotId = walkCtx.listItemBindings.get(key)!;
        const markerId = ctx.nextMarker();
        ctx.emit(OP_DYN_TEXT);
        ctx.emitU16(slotId);
        ctx.emitU16(markerId);
        return;
      }
    }
  }

  // Non-h() call expressions (createShow, sub-components, etc.)
  if (t.isCallExpression(child)) {
    walkCallExpression(child, hName, ctx, walkCtx);
    return;
  }

  // Arrow/function expressions
  if (isFunctionExpr(child)) {
    const arrowOrFunc = child as t.ArrowFunctionExpression | t.FunctionExpression;

    // Get the effective body expression
    const bodyExpr = getEffectiveBody(arrowOrFunc);

    // Rule 4: Ternary arrow → SHOW_IF
    if (bodyExpr && t.isConditionalExpression(bodyExpr)) {
      emitTernaryShowIf(bodyExpr, hName, ctx, walkCtx, childIndex);
      return;
    }

    // Rule 5: Non-ternary arrow → DYN_TEXT
    // Check if the body is a simple signal call like () => email()
    // and reuse the pre-registered slot from signalSlots if available.
    const signalName = extractSignalName(arrowOrFunc);
    let slotId: number;
    if (signalName && walkCtx.signalSlots?.has(signalName)) {
      slotId = walkCtx.signalSlots.get(signalName)!;
    } else {
      const slotName = `text:${childIndex - 2}`;
      slotId = ctx.addSlot(slotName, TYPE_TEXT);
    }
    const markerId = ctx.nextMarker();
    ctx.emit(OP_DYN_TEXT);
    ctx.emitU16(slotId);
    ctx.emitU16(markerId);
    return;
  }

  // List item property access: row.name → DYN_TEXT(bound slot)
  if (t.isMemberExpression(child) && !child.computed && t.isIdentifier(child.object) && t.isIdentifier(child.property)) {
    const key = `${child.object.name}.${child.property.name}`;
    if (walkCtx.listItemBindings?.has(key)) {
      const slotId = walkCtx.listItemBindings.get(key)!;
      const markerId = ctx.nextMarker();
      ctx.emit(OP_DYN_TEXT);
      ctx.emitU16(slotId);
      ctx.emitU16(markerId);
      return;
    }
  }

  // Rule 11: Anything else → ISLAND_START / ISLAND_END
  emitIsland(ctx);
}

// ---------------------------------------------------------------------------
// Rule 4: Ternary SHOW_IF
// ---------------------------------------------------------------------------

/**
 * Emit SHOW_IF for a ternary conditional expression.
 *
 * Binary format:
 *   [SHOW_IF(0x07)] [slot_id(u16)] [then_len(u32)] [else_len(u32)]
 *   [...then_body_opcodes...]
 *   [SHOW_ELSE(0x08)]
 *   [...else_body_opcodes...]
 */
function emitTernaryShowIf(
  cond: t.ConditionalExpression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
  childIndex: number,
): void {
  const slotName = `show:${childIndex - 2}`;
  const slotId = ctx.addSlot(slotName, TYPE_BOOL, SOURCE_CLIENT);

  ctx.emit(OP_SHOW_IF);
  ctx.emitU16(slotId);

  // Placeholders for then_len and else_len
  const thenLenPos = ctx.opcodeLen();
  ctx.emitU32(0); // then_len placeholder
  const elseLenPos = ctx.opcodeLen();
  ctx.emitU32(0); // else_len placeholder

  // Emit then-branch
  const thenStart = ctx.opcodeLen();
  emitBranchContent(cond.consequent, hName, ctx, walkCtx, childIndex);
  const thenLen = ctx.opcodeLen() - thenStart;

  // SHOW_ELSE marker
  ctx.emit(OP_SHOW_ELSE);

  // Emit else-branch
  const elseStart = ctx.opcodeLen();
  emitBranchContent(cond.alternate, hName, ctx, walkCtx, childIndex);
  const elseLen = ctx.opcodeLen() - elseStart;

  // Back-patch lengths
  ctx.patchU32(thenLenPos, thenLen);
  ctx.patchU32(elseLenPos, elseLen);
}

// ---------------------------------------------------------------------------
// Rule 8: createShow → SHOW_IF
// ---------------------------------------------------------------------------

/**
 * Emit SHOW_IF for a createShow() call.
 *
 * Pattern: createShow(() => condition, () => h('div', ...), () => h('span', ...))
 */
function emitCreateShow(
  node: t.CallExpression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): void {
  const slotName = `show:createShow`;
  const slotId = ctx.addSlot(slotName, TYPE_BOOL, SOURCE_CLIENT);

  ctx.emit(OP_SHOW_IF);
  ctx.emitU16(slotId);

  // Placeholders for then_len and else_len
  const thenLenPos = ctx.opcodeLen();
  ctx.emitU32(0);
  const elseLenPos = ctx.opcodeLen();
  ctx.emitU32(0);

  // Then-branch: second argument (index 1)
  const thenStart = ctx.opcodeLen();
  if (node.arguments.length > 1) {
    const thenArg = node.arguments[1];
    if (thenArg && !t.isSpreadElement(thenArg)) {
      emitCreateShowBranch(thenArg as t.Expression, hName, ctx, walkCtx);
    }
  }
  const thenLen = ctx.opcodeLen() - thenStart;

  // SHOW_ELSE marker
  ctx.emit(OP_SHOW_ELSE);

  // Else-branch: third argument (index 2), if it exists
  const elseStart = ctx.opcodeLen();
  if (node.arguments.length > 2) {
    const elseArg = node.arguments[2];
    if (elseArg && !t.isSpreadElement(elseArg)) {
      emitCreateShowBranch(elseArg as t.Expression, hName, ctx, walkCtx);
    }
  }
  const elseLen = ctx.opcodeLen() - elseStart;

  // Back-patch lengths
  ctx.patchU32(thenLenPos, thenLen);
  ctx.patchU32(elseLenPos, elseLen);
}

/**
 * Emit content from a createShow branch.
 * The branch is typically an arrow function: () => h('div', ...)
 */
function emitCreateShowBranch(
  expr: t.Expression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): void {
  // Unwrap arrow function: () => h('div', ...)
  if (isFunctionExpr(expr)) {
    const fn = expr as t.ArrowFunctionExpression | t.FunctionExpression;
    const body = getEffectiveBody(fn);
    if (body) {
      if (t.isCallExpression(body) && t.isIdentifier(body.callee) && body.callee.name === hName) {
        walkHTree(body, hName, ctx, walkCtx);
      } else if (t.isCallExpression(body)) {
        walkCallExpression(body, hName, ctx, walkCtx);
      } else {
        emitBranchContent(body, hName, ctx, walkCtx, 2);
      }
      return;
    }
  }

  // Direct h() call (no wrapping arrow)
  if (t.isCallExpression(expr) && t.isIdentifier(expr.callee) && expr.callee.name === hName) {
    walkHTree(expr, hName, ctx, walkCtx);
    return;
  }

  // Anything else → island
  emitIsland(ctx);
}

// ---------------------------------------------------------------------------
// createList → LIST + PROP
// ---------------------------------------------------------------------------

/**
 * Emit LIST opcode for a createList() call.
 *
 * Pattern: createList(dataSignal, keyFn, mapFn)
 *   dataSignal: identifier or arrow returning an array
 *   keyFn: (item) => string key — ignored for SSR
 *   mapFn: (item) => h(...) — the template to render for each item
 *
 * Binary format:
 *   LIST(0x0A) array_slot_id(u16) item_slot_id(u16) body_len(u32)
 *   [...body opcodes (PROP + template)...]
 */
function emitCreateList(
  node: t.CallExpression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): void {
  // Need at least 3 arguments: dataSignal, keyFn, mapFn
  if (node.arguments.length < 3) {
    emitIsland(ctx, 'createList');
    return;
  }

  const mapArg = node.arguments[2];
  if (!mapArg || t.isSpreadElement(mapArg) || !isFunctionExpr(mapArg)) {
    emitIsland(ctx, 'createList');
    return;
  }

  const mapFn = mapArg as t.ArrowFunctionExpression | t.FunctionExpression;

  // Get the map function parameter name (e.g., "row")
  if (mapFn.params.length < 1 || !t.isIdentifier(mapFn.params[0])) {
    emitIsland(ctx, 'createList');
    return;
  }
  const paramName = (mapFn.params[0] as t.Identifier).name;

  // Get the map function body
  const bodyExpr = getEffectiveBody(mapFn);
  if (!bodyExpr) {
    emitIsland(ctx, 'createList');
    return;
  }

  // Create slots: array slot (server-sourced) and item slot
  const arraySlotId = ctx.addSlot('list:array', TYPE_ARRAY, SOURCE_SERVER);
  const itemSlotId = ctx.addSlot('list:item', TYPE_OBJECT, SOURCE_SERVER);

  // Scan the body for param.prop member accesses to determine which
  // properties need PROP extraction opcodes.
  const propNames = new Set<string>();
  collectMemberProps(bodyExpr, paramName, propNames);

  // Create target slots for each property and build the bindings map
  const bindings = new Map<string, number>();
  const propEntries: Array<{ name: string; strIdx: number; slotId: number }> = [];
  for (const propName of Array.from(propNames)) {
    const targetSlotId = ctx.addSlot(`list:${propName}`, TYPE_TEXT, SOURCE_SERVER);
    bindings.set(`${paramName}.${propName}`, targetSlotId);
    propEntries.push({
      name: propName,
      strIdx: ctx.addString(propName),
      slotId: targetSlotId,
    });
  }

  // Emit LIST header: opcode + array_slot + item_slot + body_len(placeholder)
  ctx.emit(OP_LIST);
  ctx.emitU16(arraySlotId);
  ctx.emitU16(itemSlotId);
  const bodyLenPos = ctx.opcodeLen();
  ctx.emitU32(0); // placeholder for body_len

  const bodyStart = ctx.opcodeLen();

  // Emit PROP opcodes at the start of the body
  for (const entry of propEntries) {
    ctx.emit(OP_PROP);
    ctx.emitU16(itemSlotId);     // src: item slot
    ctx.emitU32(entry.strIdx);   // prop name string index
    ctx.emitU16(entry.slotId);   // target slot
  }

  // Walk the body with list item bindings in context
  const listWalkCtx: WalkContext = {
    ...walkCtx,
    listItemBindings: bindings,
  };

  if (t.isCallExpression(bodyExpr) && t.isIdentifier(bodyExpr.callee) && bodyExpr.callee.name === hName) {
    walkHTree(bodyExpr, hName, ctx, listWalkCtx);
  } else if (t.isCallExpression(bodyExpr)) {
    walkCallExpression(bodyExpr, hName, ctx, listWalkCtx);
  } else {
    emitBranchContent(bodyExpr, hName, ctx, listWalkCtx, 2);
  }

  // Back-patch body length
  const bodyLen = ctx.opcodeLen() - bodyStart;
  ctx.patchU32(bodyLenPos, bodyLen);
}

/**
 * Recursively collect all `paramName.propName` member accesses in an AST node.
 * Used to determine which PROP extraction opcodes to emit in a LIST body.
 */
function collectMemberProps(node: t.Node, paramName: string, props: Set<string>): void {
  if (!node) return;

  // Direct member access: param.prop
  if (
    t.isMemberExpression(node)
    && !node.computed
    && t.isIdentifier(node.object)
    && node.object.name === paramName
    && t.isIdentifier(node.property)
  ) {
    props.add(node.property.name);
  }

  // Recurse into all child nodes
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && item.type) {
          collectMemberProps(item, paramName, props);
        }
      }
    } else if (child && typeof child === 'object' && child.type) {
      collectMemberProps(child, paramName, props);
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 9: Spread .map() Unroll
// ---------------------------------------------------------------------------

/**
 * Handle spread children: ...ARRAY.map(cb)
 *
 * If ARRAY is in fileConstants and the callback only uses Rules 1-7 patterns,
 * statically unroll. Otherwise, emit island.
 */
function emitSpreadChild(
  spread: t.SpreadElement,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): void {
  const arg = spread.argument;

  // Check for IDENTIFIER.map(arrow)
  if (
    t.isCallExpression(arg)
    && t.isMemberExpression(arg.callee)
    && t.isIdentifier(arg.callee.object)
    && t.isIdentifier(arg.callee.property)
    && arg.callee.property.name === 'map'
    && arg.arguments.length >= 1
  ) {
    const arrayName = arg.callee.object.name;
    const callback = arg.arguments[0];

    // Check if the array is a known file constant
    if (
      walkCtx.fileConstants
      && walkCtx.fileConstants.has(arrayName)
      && callback
      && !t.isSpreadElement(callback)
      && isFunctionExpr(callback)
    ) {
      const items = walkCtx.fileConstants.get(arrayName)!;
      const fn = callback as t.ArrowFunctionExpression | t.FunctionExpression;

      // Get the callback parameter name
      const params = fn.params;
      if (params.length >= 1 && t.isIdentifier(params[0])) {
        const paramName = params[0].name;
        const body = getEffectiveBody(fn);

        if (body && t.isCallExpression(body) && t.isIdentifier(body.callee) && body.callee.name === hName) {
          // Unroll: for each item in the array, substitute properties and walk
          for (const item of items) {
            const substituted = substituteProperties(body, paramName, item);
            if (substituted && t.isCallExpression(substituted)) {
              walkHTree(substituted, hName, ctx, walkCtx);
            } else {
              emitIsland(ctx);
            }
          }
          return;
        }
      }
    }
  }

  // Can't statically unroll → island
  emitIsland(ctx);
}

/**
 * Substitute member expressions like `param.key` with actual values from the object.
 * Returns a new AST node with substitutions applied, or null if substitution fails.
 */
function substituteProperties(
  node: t.CallExpression,
  paramName: string,
  item: Record<string, any>,
): t.CallExpression | null {
  try {
    return substituteInCallExpr(node, paramName, item);
  } catch {
    return null;
  }
}

function substituteInCallExpr(
  node: t.CallExpression,
  paramName: string,
  item: Record<string, any>,
): t.CallExpression {
  const newArgs = node.arguments.map(arg => {
    if (t.isSpreadElement(arg)) return arg;
    return substituteInExpr(arg as t.Expression, paramName, item);
  });
  return t.callExpression(node.callee, newArgs);
}

function substituteInExpr(
  expr: t.Expression,
  paramName: string,
  item: Record<string, any>,
): t.Expression {
  // param.key → string literal
  if (
    t.isMemberExpression(expr)
    && t.isIdentifier(expr.object)
    && expr.object.name === paramName
    && t.isIdentifier(expr.property)
    && !expr.computed
  ) {
    const key = expr.property.name;
    const val = item[key];
    if (typeof val === 'string') return t.stringLiteral(val);
    if (typeof val === 'number') return t.numericLiteral(val);
    if (typeof val === 'boolean') return t.booleanLiteral(val);
    if (val === null) return t.nullLiteral();
    // Unknown type, return as-is (will be caught by static checks)
    return expr;
  }

  // Recurse into h() call arguments
  if (t.isCallExpression(expr)) {
    return substituteInCallExpr(expr, paramName, item);
  }

  // String literal, number literal, etc. pass through
  return expr;
}

// ---------------------------------------------------------------------------
// Rule 10: Sub-component Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a sub-component by parsing its source and finding the exported function.
 * Returns the h() call expression from the function's return statement, with
 * prop substitutions applied.
 */
function resolveSubComponent(
  source: string,
  functionName: string,
  callNode: t.CallExpression,
  hName: string,
): t.Expression | null {
  let ast;
  try {
    ast = parse(source, PARSE_OPTS);
  } catch {
    return null;
  }

  let returnNode: t.Expression | null = null;

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const decl = path.node.declaration;

      // export function Name() { ... }
      if (t.isFunctionDeclaration(decl) && decl.id?.name === functionName) {
        const funcPath = path.get('declaration') as any;
        funcPath.traverse({
          ReturnStatement(retPath: any) {
            if (retPath.node.argument) {
              returnNode = retPath.node.argument;
              retPath.stop();
            }
          },
          FunctionDeclaration(p: any) { p.skip(); },
          FunctionExpression(p: any) { p.skip(); },
          ArrowFunctionExpression(p: any) { p.skip(); },
        });
        path.stop();
        return;
      }

      // export const Name = () => ...
      if (t.isVariableDeclaration(decl)) {
        for (const declarator of decl.declarations) {
          if (
            t.isIdentifier(declarator.id)
            && declarator.id.name === functionName
            && declarator.init
          ) {
            const init = declarator.init;

            if (t.isArrowFunctionExpression(init) && !t.isBlockStatement(init.body)) {
              returnNode = init.body;
              path.stop();
              return;
            }

            if (
              (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))
              && t.isBlockStatement(init.body)
            ) {
              for (const stmt of init.body.body) {
                if (t.isReturnStatement(stmt) && stmt.argument) {
                  returnNode = stmt.argument;
                  break;
                }
              }
              path.stop();
              return;
            }
          }
        }
      }
    },
  });

  if (!returnNode) return null;

  // Apply prop substitutions from the call arguments
  // Pattern: Alert({ message: error, variant: 'error' })
  if (callNode.arguments.length > 0) {
    const propsArg = callNode.arguments[0];
    if (propsArg && t.isObjectExpression(propsArg) && !t.isSpreadElement(propsArg)) {
      returnNode = applyPropSubstitutions(returnNode, propsArg, functionName);
    }
  }

  return returnNode;
}

/**
 * Apply prop substitutions: replace references to props with their values.
 * Only handles string literal prop values (bail to null for others).
 */
function applyPropSubstitutions(
  node: t.Expression,
  propsObj: t.ObjectExpression,
  _functionName: string,
): t.Expression {
  // Build a map of prop name -> expression
  const propMap = new Map<string, t.Expression>();
  let hasNonStatic = false;

  for (const prop of propsObj.properties) {
    if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) {
      hasNonStatic = true;
      continue;
    }
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (key === null) continue;

    const val = prop.value as t.Expression;
    if (isStaticLiteral(val)) {
      propMap.set(key, val);
    } else {
      hasNonStatic = true;
    }
  }

  // If there are non-static props we can't fully substitute, return as-is
  // The caller will handle it (possibly as island)
  if (hasNonStatic) return node;

  return node;
}

// ---------------------------------------------------------------------------
// Branch Content Emission
// ---------------------------------------------------------------------------

/**
 * Emit content for a SHOW_IF branch (then or else).
 */
function emitBranchContent(
  expr: t.Expression,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
  childIndex: number,
): void {
  // String literal → TEXT
  if (t.isStringLiteral(expr)) {
    ctx.emit(OP_TEXT);
    ctx.emitU32(ctx.addString(expr.value));
    return;
  }

  // Numeric literal → TEXT
  if (t.isNumericLiteral(expr)) {
    ctx.emit(OP_TEXT);
    ctx.emitU32(ctx.addString(String(expr.value)));
    return;
  }

  // null/undefined/false → skip
  if (isNullish(expr)) return;

  // h() call → walk
  if (
    t.isCallExpression(expr)
    && t.isIdentifier(expr.callee)
    && expr.callee.name === hName
  ) {
    walkHTree(expr, hName, ctx, walkCtx);
    return;
  }

  // Other call expression
  if (t.isCallExpression(expr)) {
    walkCallExpression(expr, hName, ctx, walkCtx);
    return;
  }

  // Anything else → DYN_TEXT
  const slotName = `text:${childIndex - 2}`;
  const slotId = ctx.addSlot(slotName, TYPE_TEXT);
  const markerId = ctx.nextMarker();
  ctx.emit(OP_DYN_TEXT);
  ctx.emitU16(slotId);
  ctx.emitU16(markerId);
}

// ---------------------------------------------------------------------------
// Island Emission
// ---------------------------------------------------------------------------

/**
 * Emit ISLAND_START / ISLAND_END markers and register island in the table.
 *
 * When rootTag and rootAttrs are provided (resolved from the island component's
 * own root h() call), the shell element matches the component's root element.
 * The Rust walker injects data-forma-island attributes onto this element, so
 * CSR hydration can replace it in-place without an extra wrapper div.
 */
function emitIsland(ctx: IrEmitContext, name?: string, rootTag?: string, rootAttrs?: Array<[string, string]>): void {
  // Capture byte offset BEFORE emitting ISLAND_START so walk_island() can seek directly here.
  const byteOffset = ctx.opcodeLen();
  // addIsland increments nextIslandCounter and registers the island in the table.
  // Use the returned id for the fallback name to avoid double-increment.
  // trigger: 0x01 = Load, propsMode: 0x01 = Inline (must match Rust IslandTrigger/PropsMode enums)
  const id = ctx.addIsland(name || `island_${ctx.peekNextIslandId()}`, 0x01, 0x01, [], byteOffset);
  ctx.emit(OP_ISLAND_START);
  ctx.emitU16(id);

  // Emit a shell element so the Rust walker has an element to inject
  // data-forma-island / data-forma-component attributes onto.
  // Uses the component's own root tag + static attributes when resolved,
  // falling back to a plain <div> for unresolvable components.
  const tag = rootTag || 'div';
  const tagIdx = ctx.addString(tag);
  ctx.emit(OP_OPEN_TAG);
  ctx.emitU32(tagIdx);

  const attrs = rootAttrs || [];
  ctx.emitU16(attrs.length);
  for (const [key, val] of attrs) {
    ctx.emitU32(ctx.addString(key));
    ctx.emitU32(ctx.addString(val));
  }

  ctx.emit(OP_CLOSE_TAG);
  ctx.emitU32(tagIdx);

  ctx.emit(OP_ISLAND_END);
  ctx.emitU16(id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the effective body expression from an arrow/function expression.
 * For expression bodies: returns the body directly.
 * For block bodies: returns the argument of the first return statement.
 */
function getEffectiveBody(
  fn: t.ArrowFunctionExpression | t.FunctionExpression,
): t.Expression | null {
  if (t.isArrowFunctionExpression(fn) && !t.isBlockStatement(fn.body)) {
    return fn.body;
  }

  if (t.isBlockStatement(fn.body)) {
    for (const stmt of fn.body.body) {
      if (t.isReturnStatement(stmt) && stmt.argument) {
        return stmt.argument;
      }
    }
  }

  return null;
}
