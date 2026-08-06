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

import type * as T from '@babel/types';
import * as t from '@babel/types';
import {
  IrEmitContext,
  SLOT_SOURCE_CLIENT,
  SLOT_SOURCE_SERVER,
  SLOT_TYPE_ARRAY,
  SLOT_TYPE_BOOL,
  SLOT_TYPE_OBJECT,
  SLOT_TYPE_TEXT,
} from './ir-emit.js';
import { ComponentAnalyzer } from './component-analyzer.js';
import {
  resolveExportedFunction,
  returnExpressionOf,
  type ComponentFunction,
} from './export-resolver.js';
import type { ModuleLoader } from './module-loader.js';
import {
  enterComponentScope,
  lookupSignal,
  newSignalRegistry,
  type SignalDefault,
  type SignalRegistry,
  type SignalScope,
} from './signal-scope.js';
import {
  VOID_TAGS,
  isEventProp,
  isStaticLiteral,
  isUndefinedIdentifier,
  uniqueName,
} from './utils.js';

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
// Slot Type Hints (defined beside the encoder that writes them — ir-emit.ts)
// ---------------------------------------------------------------------------

const TYPE_TEXT   = SLOT_TYPE_TEXT;
const TYPE_BOOL   = SLOT_TYPE_BOOL;
const TYPE_ARRAY  = SLOT_TYPE_ARRAY;
const TYPE_OBJECT = SLOT_TYPE_OBJECT;
const SOURCE_SERVER = SLOT_SOURCE_SERVER;
const SOURCE_CLIENT = SLOT_SOURCE_CLIENT;

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

/** Render an Identifier or MemberExpression as source-like text for warnings. */
function exprToText(node: t.Node): string {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node)) {
    const obj = exprToText(node.object);
    if (!node.computed && t.isIdentifier(node.property)) {
      return `${obj}.${node.property.name}`;
    }
    return `${obj}[...]`;
  }
  return '<expression>';
}

// ---------------------------------------------------------------------------
// Build diagnostics
// ---------------------------------------------------------------------------

/**
 * Report a construct the walker could not translate into IR.
 *
 * Every path that emits a fallback island shell, drops a child, or mints an
 * anonymous slot instead of the thing the author wrote goes through here. The
 * failure mode these replace is the one that cost the most in the field: the
 * compiler quietly emitted a placeholder and the wrong page shipped (see the
 * ksx dogfood ledger, findings #9 and #10). A diagnostic therefore always
 * names three things — WHERE (file), WHAT (the construct, in source terms),
 * and SO WHAT (the consequence for the rendered page).
 * Verified by: packages/compiler/tests/ir-diagnostics.test.ts > "names the file, the construct and the consequence"
 */
function warnDegraded(
  walkCtx: WalkContext,
  construct: string,
  consequence: string,
): void {
  const where = walkCtx.sourceFile ? ` in ${walkCtx.sourceFile}` : '';
  console.warn(`   IR: ${construct}${where} — ${consequence}`);
}

/** Describe a child/tag expression in source-like terms for a diagnostic. */
function describeNode(node: t.Node): string {
  if (t.isIdentifier(node) || t.isMemberExpression(node)) return exprToText(node);
  if (isFunctionExpr(node)) {
    const body = getEffectiveBody(node as t.ArrowFunctionExpression | t.FunctionExpression);
    return body ? `\`() => ${describeNode(body)}\`` : 'a function with no visible return';
  }
  if (t.isCallExpression(node)) return `${exprToText(node.callee)}(...)`;
  if (t.isTemplateLiteral(node)) return 'a template literal';
  if (t.isConditionalExpression(node)) return 'a bare ternary (not wrapped in a function)';
  if (t.isLogicalExpression(node)) return `a bare '${node.operator}' expression (not wrapped in a function)`;
  if (t.isSpreadElement(node)) return 'a spread child';
  if (t.isObjectExpression(node)) return 'an object literal';
  if (t.isArrayExpression(node)) return 'an array literal';
  if (t.isBooleanLiteral(node)) return String(node.value);
  return `a ${node.type}`;
}

/** The consequence shared by every construct that becomes a client-side island. */
const ISLAND_CONSEQUENCE =
  'emitted as an empty island shell, so it renders nothing server-side and only appears once the client bundle hydrates';

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
 * A statically evaluated value. `undefined` (never a member of this type) means
 * "could not be evaluated"; `null` is a real JS null.
 *
 * The evaluator used to work in STRINGS, which made truthiness a guess: the
 * number 0 and the string "0" both arrived as `"0"`, and `false` arrived as the
 * non-empty string `"false"`. That is fine for concatenation and wrong for
 * every conditional — and conditionals are what decides which SHOW_IF branch
 * the server renders. Values stay typed until the moment they are written into
 * a slot's default bytes.
 */
type EvalValue = string | number | boolean | null;

/**
 * Names an expression can resolve against: signals in the lexical chain the
 * walk is currently inside, plus module constants and locals folded from a
 * block-bodied arrow.
 */
interface EvalEnv {
  signal(name: string): SignalDefault | undefined;
  ident(name: string): EvalValue | undefined;
}

/** The env for the scope the walk is in right now. */
function evalEnv(walkCtx: WalkContext): EvalEnv {
  return {
    signal: (name) => lookupSignal(walkCtx.signalScope, name)?.default,
    ident: (name) => walkCtx.stringConstants?.get(name),
  };
}

/** JS truthiness of an evaluated value. */
function isTruthy(val: EvalValue): boolean {
  if (val === null) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0 && !Number.isNaN(val);
  return val !== '';
}

/**
 * Render an evaluated value the way the client renderer would write it into the
 * DOM: `null` is the ABSENT case (an omitted attribute, empty text), everything
 * else is its JS string form.
 */
function evalToText(val: EvalValue): string {
  return val === null ? '' : String(val);
}

/**
 * The `default_bytes` an evaluated value contributes to a slot.
 *
 * Empty bytes mean "no default" to the FMIR reader — `SlotData::new_from_defaults`
 * leaves such a slot Null, which renders as an omitted attribute and empty text.
 * That is the right answer for null and for a value that could not be evaluated;
 * it is also, unavoidably, what an EMPTY STRING default has to encode, because
 * the slot entry has no way to distinguish "" from absent. An attribute whose
 * value evaluates to "" is therefore omitted server-side where the client writes
 * `attr=""` — a documented boundary of the binary format, not a walker choice.
 */
function defaultBytesFor(val: EvalValue | undefined): Uint8Array {
  if (val === undefined || val === null) return new Uint8Array(0);
  return new TextEncoder().encode(String(val));
}

/**
 * Try to evaluate a dynamic binding (`() => …`) to the value the client would
 * render on first paint. Handles the shapes real pages use:
 *   () => showPassword() ? 'text' : 'password'           → "password"
 *   () => 'mfa-panel' + (showMfa() ? '' : ' hidden')     → "mfa-panel hidden"
 *   () => `sidebar ${collapsed() ? 'is-collapsed' : ''}` → "sidebar "
 *   () => { const cls = 'row'; return cls + tone(); }     → "rowcalm"
 *   () => !!busy()                                        → false
 *
 * Returns undefined when any leaf cannot be evaluated — a partial answer would
 * be worse than none, because it would render as though it were complete.
 */
function tryEvalExprDefault(
  fnExpr: t.ArrowFunctionExpression | t.FunctionExpression,
  env: EvalEnv,
): EvalValue | undefined {
  const body = getEffectiveBody(fnExpr);
  if (!body) return undefined;

  // A block body may fold its own locals first: `const cls = 'row'; return …`.
  // Without this, a component that names its class before returning it drops
  // the whole attribute server-side.
  if (t.isBlockStatement(fnExpr.body)) {
    const locals = new Map<string, EvalValue>();
    const inner: EvalEnv = {
      signal: env.signal,
      ident: (name) => (locals.has(name) ? locals.get(name)! : env.ident(name)),
    };
    for (const stmt of fnExpr.body.body) {
      if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'const') continue;
      for (const decl of stmt.declarations) {
        if (!t.isIdentifier(decl.id) || !decl.init) continue;
        const value = evalNode(decl.init, inner);
        if (value !== undefined) locals.set(decl.id.name, value);
      }
    }
    return evalNode(body, inner);
  }

  return evalNode(body, env);
}

function evalNode(node: t.Expression, env: EvalEnv): EvalValue | undefined {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;

  // Template literal, with or without embedded expressions. The dashboard's
  // sidebar class is `${base} ${collapsed() ? 'is-collapsed' : ''}` — refusing
  // interpolation meant that page server-rendered with no class attribute at
  // all and every control was unstyled until hydration.
  if (t.isTemplateLiteral(node)) {
    let out = '';
    for (let i = 0; i < node.quasis.length; i++) {
      out += node.quasis[i]!.value.cooked ?? node.quasis[i]!.value.raw;
      const expr = node.expressions[i];
      if (expr === undefined) continue;
      if (!t.isExpression(expr)) return undefined;
      const value = evalNode(expr, env);
      if (value === undefined) return undefined;
      out += evalToText(value);
    }
    return out;
  }

  // Module-level constant or a folded local: SIL_BODY
  if (t.isIdentifier(node)) {
    if (isUndefinedIdentifier(node)) return null;
    return env.ident(node.name);
  }

  // Signal call: signalName()
  if (
    t.isCallExpression(node)
    && t.isIdentifier(node.callee)
    && node.arguments.length === 0
  ) {
    return env.signal(node.callee.name)?.default;
  }

  // Unary negation: !expr or !!expr
  if (t.isUnaryExpression(node) && node.operator === '!') {
    const inner = evalNode(node.argument as t.Expression, env);
    if (inner === undefined) return undefined;
    return !isTruthy(inner);
  }

  // Ternary: test ? consequent : alternate
  if (t.isConditionalExpression(node)) {
    const test = evalNode(node.test as t.Expression, env);
    if (test === undefined) return undefined;
    return evalNode((isTruthy(test) ? node.consequent : node.alternate) as t.Expression, env);
  }

  // Logical && / ||, which is how conditional classes are usually written.
  if (t.isLogicalExpression(node) && (node.operator === '&&' || node.operator === '||')) {
    const left = evalNode(node.left as t.Expression, env);
    if (left === undefined) return undefined;
    if (node.operator === '&&' && !isTruthy(left)) return left;
    if (node.operator === '||' && isTruthy(left)) return left;
    return evalNode(node.right as t.Expression, env);
  }

  // Binary +: numeric when both sides are numbers, string concatenation
  // otherwise — the same rule JavaScript applies.
  if (t.isBinaryExpression(node) && node.operator === '+') {
    const left = evalNode(node.left as t.Expression, env);
    const right = evalNode(node.right as t.Expression, env);
    if (left === undefined || right === undefined) return undefined;
    if (typeof left === 'number' && typeof right === 'number') return left + right;
    return evalToText(left) + evalToText(right);
  }

  if (t.isParenthesizedExpression(node)) {
    return evalNode(node.expression, env);
  }

  // Can't evaluate
  return undefined;
}

// ---------------------------------------------------------------------------
// Walk Context
// ---------------------------------------------------------------------------

export interface WalkContext {
  /** File-level constant arrays (for Rule 9 static unroll). */
  fileConstants?: Map<string, any[]>;
  /** File-level string constants: const name → folded string value.
   *  Identifiers referencing these resolve to STATIC attribute values
   *  (and fold inside function-valued prop SSR defaults). */
  stringConstants?: Map<string, string>;
  /** The lexical signal chain the walk is currently inside. Pushed at every
   *  point the walk enters a new scope (a component's file, a component's
   *  body), so a signal is in scope exactly when the code that declares it was
   *  inlined into this page — see signal-scope.ts.
   *  Verified by: packages/compiler/tests/ssr-emission.test.ts > "names a signal declared inside an inlined sub-component" */
  signalScope?: SignalScope;
  /** Page-wide signal slot-name occurrences and scope memo. Same eager-init
   *  and by-reference sharing rules as listNames. */
  signalRegistry?: SignalRegistry;
  /** Path of the file whose tree is currently being walked. Only used to name
   *  the file in build diagnostics — nested walks (sub-components, islands)
   *  carry the resolved component's own path so a warning points at the file
   *  the author has to edit, not the page that included it. */
  sourceFile?: string;
  /** Resolve a sub-component call to its source file and function name.
   *
   *  `fromFile` is the file the CALL appears in, and the resolver must read
   *  that file's imports — not the entry point's. A resolver closed over the
   *  entry's import map could only see components the entry itself imported,
   *  so anything a page file imported became an empty island shell the moment
   *  the entry did not happen to import it too.
   *  Verified by: packages/compiler/tests/ir-walk.test.ts > "asks the resolver for the file the CALL is in, not the entry point"
   *
   *  `path` is optional and only feeds diagnostics (see sourceFile). */
  resolveComponent?: (
    name: string,
    fromFile?: string,
  ) => { source: string; functionName: string; path?: string } | null;
  /** Follows `export … from './x'` re-exports when resolving a sub-component,
   *  so a component imported through an index barrel still inlines. */
  loadModule?: ModuleLoader;
  /** Set of visited component names for cycle detection. */
  visited?: Set<string>;
  /** Current depth for sub-component resolution (max 3). */
  depth?: number;
  /** List item bindings: "paramName.propName" → target slot id.
   *  Set when walking inside a createList mapFn body.
   *  The PROP opcodes extract properties at runtime; these bindings
   *  tell the child walker which slot each property was extracted into. */
  listItemBindings?: Map<string, number>;
  /** Per-page registry for list slot naming: occurrences of each derived
   *  base name (for `#n` dedup) plus the running list count (for the
   *  positional fallback). Initialized eagerly at the walk entry points
   *  (walkHTree / walkCallExpression) so it lives on the ROOT context and is
   *  shared by reference with every spread-copied nested walk context —
   *  island subtrees, inlined sub-components, and list bodies all dedup
   *  against the same page-wide namespace. */
  listNames?: { counts: Map<string, number>; total: number };
  /** Per-page registry for show slot naming (createShow + ternary SHOW_IF):
   *  same shape and sharing semantics as listNames. */
  showNames?: { counts: Map<string, number>; total: number };
  /** Per-page occurrence registry for `attr:<key>` slot names. Two dynamic
   *  attributes sharing a key anywhere on the page (sibling elements, an
   *  island and the page around it, a list body and its enclosing page) would
   *  otherwise mint the same name twice; same eager-init and by-reference
   *  sharing rules as listNames.
   *  Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes two dynamic attrs sharing a key on sibling elements"
   */
  attrNames?: Map<string, number>;
  /** Per-page occurrence registry for `text:<childIndex>` slot names. Child
   *  indices restart inside every element, so two dynamic text children at the
   *  same index in different parents collide without it; same sharing rules as
   *  listNames.
   *  Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes two dynamic text children at the same child index"
   */
  textNames?: Map<string, number>;
  /** Names of island components registered in activateIslands({...}).
   *  Island components are NEVER inlined — they always emit ISLAND_START/ISLAND_END. */
  islandNames?: Set<string>;
}

// ---------------------------------------------------------------------------
// Per-file Constant Scoping
// ---------------------------------------------------------------------------

/** Analyzer for re-extracting constants from resolved sub-component/island
 *  sources (baseDir is unused by the extraction methods). */
const constantAnalyzer = new ComponentAnalyzer('');

/**
 * Re-extract file-level constants from a resolved component source so the
 * sub-component/island walk resolves identifiers against its OWN module
 * scope — mirroring the root-file extraction in the SSR plugin.
 * Falls back to EMPTY maps if the source fails to parse: falling back to the
 * parent context's constants would resolve the child file's identifiers
 * against the WRONG module scope (the parent's).
 */
function extractResolvedConstants(
  source: string,
  filePath: string,
): Pick<WalkContext, 'fileConstants' | 'stringConstants'> {
  try {
    return {
      fileConstants: constantAnalyzer.extractFileConstants(source, filePath),
      stringConstants: constantAnalyzer.extractStringConstants(source, filePath),
    };
  } catch {
    return {
      fileConstants: new Map(),
      stringConstants: new Map(),
    };
  }
}

/**
 * The nested walk context for a component the walk has decided to inline:
 * the component file's own constants, its own signal scope chain, and its own
 * path for diagnostics.
 *
 * ONE function builds it for both inlining sites — a registered island and a
 * plain sub-component — so the two cannot drift into resolving different
 * things, which is precisely how island files came to be the only nested scope
 * whose signals were read.
 * Verified by: packages/compiler/tests/ssr-emission.test.ts > "names a signal declared inside an inlined sub-component"
 */
function inlinedWalkContext(
  walkCtx: WalkContext,
  ctx: IrEmitContext,
  sub: ResolvedSubComponent,
  functionName: string,
  visited: Set<string>,
): WalkContext {
  const constants = extractResolvedConstants(sub.source, sub.filePath);
  return {
    ...walkCtx,
    ...constants,
    signalScope: enterComponentScope({
      ast: sub.ast,
      fn: sub.fn,
      fnName: functionName,
      filePath: sub.filePath,
      constants: constants.stringConstants,
      ctx,
      registry: walkCtx.signalRegistry!,
      // A helper declared inside another function is only reachable from its
      // own file, and the caller's chain is then its lexical environment.
      callerScope: sub.filePath === walkCtx.sourceFile ? walkCtx.signalScope ?? null : null,
    }),
    sourceFile: sub.filePath,
    visited,
    depth: (walkCtx.depth ?? 0) + 1,
  };
}

// ---------------------------------------------------------------------------
// Walk Engine — Main Entry Points
// ---------------------------------------------------------------------------

/**
 * Ensure the per-page name registries exist on the given context.
 * MUST run at the walk entry points BEFORE any nested walk spread-copies the
 * context ({ ...walkCtx, ... }): a registry first created lazily on a COPY
 * dies with that copy, and a later sibling construct would recreate it and
 * mint DUPLICATE slot names (e.g. two `list:todos:array` slots), which
 * collapse in the Rust name→id map (last-insert-wins). Covers hand-built
 * test contexts as well as the root contexts built by the SSR plugin.
 * Every slot-name family that can collide page-wide is registered here —
 * list, show, attr and text.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes a dynamic attr inside an island against one on the page"
 */
function ensureNameRegistries(walkCtx: WalkContext): void {
  walkCtx.listNames ??= { counts: new Map(), total: 0 };
  walkCtx.showNames ??= { counts: new Map(), total: 0 };
  walkCtx.attrNames ??= new Map();
  walkCtx.textNames ??= new Map();
  walkCtx.signalRegistry ??= newSignalRegistry();
}

/**
 * Page-unique slot name for a dynamic attribute: `attr:<key>`, then
 * `attr:<key>#2` for the next attribute anywhere on the page that binds the
 * same key. ensureNameRegistries has already run at the walk entry point on
 * every path that reaches here, so the non-null assertion holds — and a lazy
 * `??=` in its place would reintroduce the stranding bug that makes nested
 * walks mint duplicates.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes two dynamic attrs sharing a key on sibling elements"
 */
function attrSlotName(key: string, walkCtx: WalkContext): string {
  return uniqueName(walkCtx.attrNames!, `attr:${key}`);
}

/**
 * Page-unique slot name for a dynamic text child at `childIndex` in its
 * parent's argument list (`h(tag, props, child0, ...)`, so the first child is
 * index 2): `text:0`, then `text:0#2` for the next dynamic text child that
 * lands at the same index under a different parent.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes two dynamic text children at the same child index"
 */
function textSlotName(childIndex: number, walkCtx: WalkContext): string {
  return uniqueName(walkCtx.textNames!, `text:${childIndex - 2}`);
}

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
  ensureNameRegistries(walkCtx);
  const args = node.arguments;
  if (args.length === 0) return;

  // First arg: tag name
  const tagArg = args[0];
  if (!tagArg) return;

  // Fragment: h(Fragment, null, child1, child2) → emit children inline, no wrapper
  if (t.isIdentifier(tagArg) && tagArg.name === 'Fragment') {
    emitFragmentChildren(args, 2, hName, ctx, walkCtx);
    return;
  }

  // Component tag: h(Card, props, ...children) — what JSX compiles a
  // capitalized element to. Route it through the same sub-component/island
  // machinery as a bare Card(props) call so it is inlined when resolvable and
  // registered under its REAL name when not: an anonymous `island_<n>` shell
  // is unhydratable, because the client registry is keyed by component name.
  // Verified by: packages/compiler/tests/ir-walk.test.ts > "registers a JSX component tag under its own name"
  if (t.isIdentifier(tagArg) && isComponentName(tagArg.name)) {
    if (args.length > 2) {
      warnDegraded(
        walkCtx,
        `children passed to component <${tagArg.name}>`,
        'not represented in SSR IR (the compiler cannot place a component\'s children) — they appear only after the client renders the component',
      );
    }
    const propsArg = args.length > 1 ? args[1] : undefined;
    const callArgs = propsArg && !t.isSpreadElement(propsArg) && t.isObjectExpression(propsArg)
      ? [propsArg]
      : [];
    walkCallExpression(t.callExpression(tagArg, callArgs), hName, ctx, walkCtx);
    return;
  }

  // Rule 11: non-string tag → island
  if (!t.isStringLiteral(tagArg)) {
    warnDegraded(
      walkCtx,
      `dynamic tag h(${describeNode(tagArg)}, ...)`,
      ISLAND_CONSEQUENCE + ' — use a literal tag name to render it server-side',
    );
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
          ctx.recordSlotRef(slotId);
          dynAttrs.push({ keyIdx, slotId });
          continue;
        }
      }

      // Rule 6: Function/arrow expression -> DYN_ATTR
      if (isFunctionExpr(val)) {
        const keyIdx = ctx.addString(key);
        const fn = val as t.ArrowFunctionExpression | t.FunctionExpression;
        // A bare `() => sig()` binding reuses the signal's own named slot
        // rather than minting an anonymous `attr:` one.
        const sigName = extractSignalName(fn);
        const binding = sigName ? lookupSignal(walkCtx.signalScope, sigName) : undefined;
        let slotId: number;
        if (binding) {
          slotId = binding.slotId;
          ctx.recordSlotRef(slotId);
        } else {
          const evaluated = tryEvalExprDefault(fn, evalEnv(walkCtx));
          if (evaluated === undefined) {
            warnDegraded(
              walkCtx,
              `attribute '${key}' on <${tag}> binds ${describeNode(fn)}, which the compiler cannot evaluate`,
              'the attribute is OMITTED server-side and only appears once the client hydrates —'
              + ' initialize the signals it reads with literal defaults, or fold the value into a module-level const',
            );
          }
          slotId = ctx.addSlot(
            attrSlotName(key, walkCtx),
            // A boolean value must land in a TYPE_BOOL slot: the walkers omit a
            // false boolean attribute and write the bare name for a true one.
            // As TYPE_TEXT it would render `disabled="false"`, which the browser
            // reads as DISABLED — the exact inversion of what the client shows.
            typeof evaluated === 'boolean' ? TYPE_BOOL : TYPE_TEXT,
            SOURCE_CLIENT,
            defaultBytesFor(evaluated),
          );
        }
        dynAttrs.push({ keyIdx, slotId });
        continue;
      }

      // Module-level string const as attr value: d: SIL_BODY → static attribute
      if (t.isIdentifier(val) && walkCtx.stringConstants?.has(val.name)) {
        const keyIdx = ctx.addString(key);
        const valIdx = ctx.addString(walkCtx.stringConstants.get(val.name)!);
        staticAttrs.push({ keyIdx, valIdx });
        continue;
      }

      // Any other expression -> DYN_ATTR
      // Bare identifiers/members that resolved nowhere render empty in SSR —
      // warn so the silent-MISSING failure mode is visible at build time.
      if ((t.isIdentifier(val) && !isUndefinedIdentifier(val)) || t.isMemberExpression(val)) {
        console.warn(
          `   IR: attribute '${key}' on <${tag}> references '${exprToText(val)}' which cannot be resolved statically — SSR will render this attribute empty; inline the literal, use a module-level const, or wrap in a function for a reactive value`,
        );
      }
      const keyIdx = ctx.addString(key);
      const slotName = attrSlotName(key, walkCtx);
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
  ensureNameRegistries(walkCtx);

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
    emitFragmentChildren(node.arguments, 0, hName, ctx, walkCtx);
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
      let reason = 'could not be resolved to a source file (the compiler follows relative imports only)';
      if (walkCtx.resolveComponent) {
        try {
          const resolved = walkCtx.resolveComponent(componentName, walkCtx.sourceFile);
          if (!resolved) {
            reason = 'could not be resolved to a source file (the compiler follows relative imports only)';
          } else {
            const sub = resolveSubComponent(
              resolved.source,
              resolved.path ?? walkCtx.sourceFile ?? '<unknown>',
              resolved.functionName,
              node,
              walkCtx.loadModule,
            );
            const componentReturn = sub?.returnNode;
            if (!componentReturn || !t.isCallExpression(componentReturn)) {
              reason = 'has no return statement the compiler can follow to an h() call';
            } else {
              // Register island and emit ISLAND_START
              const byteOffset = ctx.opcodeLen();
              const id = ctx.addIsland(componentName, 0x01, 0x01, [], byteOffset);
              ctx.emit(OP_ISLAND_START);
              ctx.emitU16(id);

              // Walk the full component subtree for SSR content, capturing
              // every slot id referenced in the island span so the island
              // table entry carries real slot_ids (the Rust walker skips
              // data-forma-props emission for islands with empty slot_ids).
              ctx.beginSlotCapture();
              let capturedSlotIds: number[] = [];
              try {
                const newVisited = new Set<string>(walkCtx.visited || new Set<string>());
                newVisited.add(componentName);
                walkCallExpression(
                  componentReturn,
                  hName,
                  ctx,
                  inlinedWalkContext(walkCtx, ctx, sub, resolved.functionName, newVisited),
                );
              } catch (err) {
                // ISLAND_START is already in the stream: unwinding past the
                // matching ISLAND_END would leave the bytecode unbalanced (and
                // the outer fallback would register a SECOND island for the
                // same component). Absorb the failure, say so, and close the
                // span with whatever content was emitted.
                warnDegraded(
                  walkCtx,
                  `island component '${componentName}' failed part-way through compiling (${(err as Error).message})`,
                  'its server-rendered content is truncated at that point; the shell still hydrates client-side',
                );
              } finally {
                // Always pop the capture set, even when the subtree walk
                // throws — an unbalanced stack would make an enclosing
                // island's endSlotCapture pop THIS island's set instead of
                // its own.
                capturedSlotIds = ctx.endSlotCapture();
              }

              // Emit ISLAND_END
              ctx.emit(OP_ISLAND_END);
              ctx.emitU16(id);
              ctx.setIslandSlotIds(id, capturedSlotIds);
              return;
            }
          }
        } catch (err) {
          // Resolution threw mid-walk — fall back to the empty shell, but say so.
          reason = `failed to compile (${(err as Error).message})`;
        }
      }

      // Fallback: the island's content could not be compiled — emit the empty
      // div shell the client hydrates into, and name the reason. The island
      // itself still works (it is registered under its own name); what is lost
      // is its server-rendered content.
      warnDegraded(
        walkCtx,
        `island component '${componentName}' ${reason}`,
        'its shell still hydrates client-side, but the island renders nothing server-side — the page ships with a hole where it will appear',
      );
      emitIsland(ctx, componentName);
      return;
    }

    /** Every bail-out below defers the component to client-side rendering. */
    const bailOut = (why: string, fix?: string): void => {
      warnDegraded(
        walkCtx,
        `component ${componentName}(...) ${why}`,
        ISLAND_CONSEQUENCE + (fix ? ` — ${fix}` : ''),
      );
      emitIsland(ctx, componentName);
    };

    if (walkCtx.resolveComponent) {
      const resolved = walkCtx.resolveComponent(componentName, walkCtx.sourceFile);
      if (resolved) {
        // Cycle detection
        const visited = walkCtx.visited || new Set<string>();
        if (visited.has(componentName)) {
          bailOut('is recursive (it appears inside its own subtree)');
          return;
        }

        // Depth check
        const depth = walkCtx.depth ?? 0;
        if (depth >= MAX_RESOLVE_DEPTH) {
          bailOut(
            `nests deeper than the ${MAX_RESOLVE_DEPTH}-level inlining limit`,
            'flatten the component tree if it needs to render server-side',
          );
          return;
        }

        // Check if call-site props contain non-static values → bail to island
        if (node.arguments.length > 0) {
          const propsArg = node.arguments[0];
          if (propsArg && !t.isSpreadElement(propsArg) && t.isObjectExpression(propsArg)) {
            const nonStatic = propsArg.properties.find(prop => {
              if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) return true;
              return !isStaticLiteral(prop.value as t.Expression);
            });
            if (nonStatic) {
              bailOut(
                `is passed a prop the compiler cannot evaluate (${
                  t.isObjectProperty(nonStatic) && t.isIdentifier(nonStatic.key)
                    ? `'${nonStatic.key.name}'`
                    : 'a spread or computed property'
                })`,
                'pass literal values to inline a component server-side',
              );
              return;
            }
          }
        }

        // Try to resolve and walk the sub-component
        try {
          const sub = resolveSubComponent(
            resolved.source,
            resolved.path ?? walkCtx.sourceFile ?? '<unknown>',
            resolved.functionName,
            node,
            walkCtx.loadModule,
          );

          if (sub && t.isCallExpression(sub.returnNode)) {
            const newVisited = new Set(visited);
            newVisited.add(componentName);

            walkHTree(
              sub.returnNode,
              hName,
              ctx,
              inlinedWalkContext(walkCtx, ctx, sub, resolved.functionName, newVisited),
            );
            return;
          }
          bailOut('has no return statement the compiler can follow to an h() call');
          return;
        } catch (err) {
          bailOut(`failed to compile (${(err as Error).message})`);
          return;
        }
      }
    }

    // Resolution failed or not available → island
    bailOut(
      'could not be resolved to a source file',
      'the compiler follows relative imports only; package imports and dynamic references always stay client-side',
    );
    return;
  }

  // Rule 11: Unknown call expression → island
  warnDegraded(
    walkCtx,
    `call expression ${describeNode(node)}`,
    ISLAND_CONSEQUENCE,
  );
  emitIsland(ctx);
}

// ---------------------------------------------------------------------------
// Child Emission
// ---------------------------------------------------------------------------

/**
 * Is this identifier a component reference rather than a tag name?
 *
 * The JSX transforms both esbuild and Babel apply lower-case element names to
 * string literals (`<div/>` → `h("div", …)`) and leave capitalized ones as
 * identifiers (`<Card/>` → `h(Card, …)`), so an initial capital is exactly the
 * signal that the tag position holds a component.
 */
function isComponentName(name: string): boolean {
  const first = name.charCodeAt(0);
  return first >= 65 && first <= 90; // 'A'-'Z'
}

/**
 * Emit the children of a Fragment inline, with no wrapper element.
 *
 * Children go through the SAME emitChild path as an element's children.
 * Handling only h() calls and string literals here (as this did until the
 * fragment-child audit) silently DROPPED every other child — a `() => name()`
 * text binding, a ternary show, a number, a spread — producing a page missing
 * content with no island marker to recover it client-side and no diagnostic.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "emits a dynamic text child of a Fragment > matching what the same child emits inside a real element"
 *
 * `childArgOffset` is the index of the first child in `args`: 2 for
 * `h(Fragment, props, ...)`, 0 for the bare `Fragment(...)` call form. Child
 * indices are normalized to the element convention so `text:<n>` slot names
 * mean the same thing in both.
 */
function emitFragmentChildren(
  args: Array<t.Node | null | undefined>,
  childArgOffset: number,
  hName: string,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): void {
  for (let i = childArgOffset; i < args.length; i++) {
    const child = args[i];
    if (!child) continue;
    if (t.isSpreadElement(child)) {
      emitSpreadChild(child, hName, ctx, walkCtx);
      continue;
    }
    emitChild(child as t.Expression, hName, ctx, walkCtx, i - childArgOffset + 2);
  }
}

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
        ctx.recordSlotRef(slotId);
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

    // Rule 5: Non-ternary arrow → DYN_TEXT.
    // A bare `() => email()` binding reuses the signal's own named slot.
    const signalName = extractSignalName(arrowOrFunc);
    const binding = signalName ? lookupSignal(walkCtx.signalScope, signalName) : undefined;
    let slotId: number;
    if (binding) {
      slotId = binding.slotId;
      ctx.recordSlotRef(slotId);
    } else {
      // An anonymous text slot still gets an SSR default when the expression
      // evaluates. Without one the server emits the zero-width-space
      // placeholder and the text only appears after hydration — a flash on
      // every page that computes its text (`() => count() + ' items'`).
      const evaluated = tryEvalExprDefault(arrowOrFunc, evalEnv(walkCtx));
      if (evaluated === undefined) {
        warnDegraded(
          walkCtx,
          `dynamic text child ${describeNode(arrowOrFunc)}, which the compiler cannot evaluate`,
          'it renders EMPTY server-side and only fills in once the client hydrates —'
          + ' initialize the signals it reads with literal defaults so the server can render them',
        );
      }
      slotId = ctx.addSlot(
        textSlotName(childIndex, walkCtx),
        TYPE_TEXT,
        SOURCE_CLIENT,
        defaultBytesFor(evaluated),
      );
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
      ctx.recordSlotRef(slotId);
      const markerId = ctx.nextMarker();
      ctx.emit(OP_DYN_TEXT);
      ctx.emitU16(slotId);
      ctx.emitU16(markerId);
      return;
    }
  }

  // Rule 11: Anything else → ISLAND_START / ISLAND_END
  warnDegraded(
    walkCtx,
    `child ${describeNode(child)}`,
    ISLAND_CONSEQUENCE
      + " — wrap it in a function (`() => …`) for a reactive binding, or use createShow/createList for conditionals and lists",
  );
  emitIsland(ctx);
}

// ---------------------------------------------------------------------------
// Rule 4: Ternary SHOW_IF
// ---------------------------------------------------------------------------

/**
 * Derive the slot name for a SHOW_IF (createShow or ternary) from its
 * condition expression, using the shared per-page showNames registry:
 * condition-derived base (`() => visible()` → `show:visible`) with a
 * positional fallback (`show:#2`) and per-base occurrence suffixes
 * (`show:visible#2`) — same scheme as list slot naming (see the doc
 * comment on emitCreateList).
 */
function deriveShowSlotName(cond: t.Node | null | undefined, walkCtx: WalkContext): string {
  // Created at the walk entry points — see attrSlotName on why this must not
  // fall back to a lazily created registry.
  const registry = walkCtx.showNames!;
  registry.total += 1;
  const condName = deriveBindingName(cond);
  const base = condName === null
    ? `#${registry.total}`
    : uniqueName(registry.counts, condName);
  return `show:${base}`;
}

/**
 * Mint the TYPE_BOOL slot a SHOW_IF selects its branch with, carrying the
 * branch the CLIENT would take on first paint as its SSR default.
 *
 * Without a default the slot is Null, which the walkers read as false, so the
 * server rendered the ELSE branch for every conditional on the page —
 * including one whose signal defaults to `true`. Hydration does not repair it:
 * `adoptShowRegion` matches the client's THEN descriptor against the server's
 * ELSE element, the tags match, the node is adopted, and the static content is
 * never rewritten. Both mismatch-repair arms test "one side has content and the
 * other does not", and here both do — so the page shows the wrong branch, with
 * no warning from either side, until the signal CHANGES VALUE. For a
 * config-like default that never changes, that is forever.
 *
 * The slot NAME is unchanged and no slot is reused: `show:<name>` stays in the
 * table, because servers inject shows by that name.
 * Verified by: packages/compiler/tests/ssr-render.test.ts > "renders the THEN branch for a show whose condition defaults true"
 */
function addShowSlot(
  cond: t.Node | null | undefined,
  ctx: IrEmitContext,
  walkCtx: WalkContext,
): number {
  const slotName = deriveShowSlotName(cond, walkCtx);

  let value: EvalValue | undefined;
  if (cond && isFunctionExpr(cond)) {
    value = tryEvalExprDefault(cond as t.ArrowFunctionExpression | t.FunctionExpression, evalEnv(walkCtx));
  } else if (cond && t.isExpression(cond)) {
    value = evalNode(cond, evalEnv(walkCtx));
  }

  if (value === undefined) {
    warnDegraded(
      walkCtx,
      cond
        ? `conditional on ${describeNode(cond)}, which the compiler cannot evaluate`
        : 'conditional with no condition expression',
      'the server renders its ELSE branch; if the client would render the THEN branch, hydration'
      + ' adopts the wrong one silently and the page stays wrong until the condition changes value —'
      + ' initialize the signals it reads with literal defaults',
    );
    return ctx.addSlot(slotName, TYPE_BOOL, SOURCE_CLIENT);
  }

  return ctx.addSlot(
    slotName,
    TYPE_BOOL,
    SOURCE_CLIENT,
    new TextEncoder().encode(String(isTruthy(value))),
  );
}

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
  const slotId = addShowSlot(cond.test, ctx, walkCtx);

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
  const slotId = addShowSlot(node.arguments[0], ctx, walkCtx);

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
  warnDegraded(
    walkCtx,
    `createShow branch ${describeNode(expr)}`,
    ISLAND_CONSEQUENCE + ' — a branch must be `() => h(...)` (or a direct h(...) call) to render server-side',
  );
  emitIsland(ctx);
}

// ---------------------------------------------------------------------------
// createList → LIST + PROP
// ---------------------------------------------------------------------------

/**
 * Derive a human-meaningful name for a binding expression:
 * an identifier (`todos`), a call (`todos()`, `state.todos()`), an arrow or
 * function expression wrapping either (`() => todos()`,
 * `function() { return todos(); }`), a member access (`state.todos`), or a
 * `!`-negation of any of these (`!visible()`, `!!visible()`).
 * Returns null when no static name is recoverable.
 */
function deriveBindingName(node: t.Node | null | undefined): string | null {
  if (!node) return null;
  if (t.isIdentifier(node)) return node.name;
  if (t.isCallExpression(node)) return deriveBindingName(node.callee);
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    // Unwrap both function forms (expression and block bodies) the same way
    // extractSignalName does — a `function() { return visible(); }` condition
    // must derive the same name as `() => visible()`.
    return deriveBindingName(getEffectiveBody(node));
  }
  if (t.isMemberExpression(node) && t.isIdentifier(node.property) && !node.computed) {
    return node.property.name;
  }
  if (t.isUnaryExpression(node) && node.operator === '!') {
    return deriveBindingName(node.argument);
  }
  return null;
}

/**
 * Emit LIST opcode for a createList() call.
 *
 * Pattern: createList(dataSignal, keyFn, mapFn)
 *   dataSignal: identifier or arrow returning an array
 *   keyFn: (item) => string key — ignored for SSR
 *   mapFn: (item) => h(...) — the template to render for each item
 *
 * Slot naming: each list derives a base name from its data source
 * (`createList(todos, ...)` → `todos`); when the source has no derivable
 * name (e.g. a literal `() => []`), the map function's first parameter is
 * used instead (`(tile) => ...` → `tile`, unless named `_`), and only then
 * a positional fallback (`#3`). Shows follow the same scheme: the base is
 * derived from the condition (`() => visible()` → `visible`, `!` unwraps)
 * with the same positional fallback. Occurrence suffixes are per-BASE in
 * document order — the first occurrence is unsuffixed, the second reuse of
 * the same base gets `#2`, and so on. Slots are then `list:<base>:array`,
 * `list:<base>:item`, and `list:<base>:<prop>` (or `show:<base>`), so every
 * list on a page is individually addressable by name for server-side
 * SlotData injection.
 *
 * Dynamic attributes (`attr:<key>`) and dynamic text children
 * (`text:<childIndex>`) run the SAME occurrence scheme over their own
 * page-wide registries — see attrSlotName / textSlotName. Every slot name a
 * page emits is therefore unique, which the Rust name→id map requires: it
 * inserts each name into one HashMap, so a duplicate silently makes the
 * earlier slot unreachable for server-side SlotData injection.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes two dynamic attrs sharing a key on sibling elements"
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
  /** Every bail-out below renders the whole list as an empty client island. */
  const bailOut = (why: string, fix: string): void => {
    warnDegraded(walkCtx, `createList(...) ${why}`, `the whole list is ${ISLAND_CONSEQUENCE} — ${fix}`);
    emitIsland(ctx, 'createList');
  };

  // Need at least 3 arguments: dataSignal, keyFn, mapFn
  if (node.arguments.length < 3) {
    bailOut(
      `was called with ${node.arguments.length} argument(s)`,
      'SSR needs all three of createList(source, keyFn, mapFn)',
    );
    return;
  }

  const mapArg = node.arguments[2];
  if (!mapArg || t.isSpreadElement(mapArg) || !isFunctionExpr(mapArg)) {
    bailOut(
      `has a third argument that is ${mapArg ? describeNode(mapArg) : 'missing'} rather than a function`,
      'inline the map function at the call site so the compiler can see the row template',
    );
    return;
  }

  const mapFn = mapArg as t.ArrowFunctionExpression | t.FunctionExpression;

  // Get the map function parameter name (e.g., "row")
  if (mapFn.params.length < 1 || !t.isIdentifier(mapFn.params[0])) {
    bailOut(
      mapFn.params.length < 1
        ? 'has a map function that takes no row parameter'
        : `has a destructured map parameter (${mapFn.params[0]!.type})`,
      'name the row parameter — `(row) => ...`, then read `row.field` — so the compiler can emit a PROP for each field',
    );
    return;
  }
  const paramName = (mapFn.params[0] as t.Identifier).name;

  // Get the map function body
  const bodyExpr = getEffectiveBody(mapFn);
  if (!bodyExpr) {
    bailOut(
      'has a map function with no return value the compiler can see',
      'return the row template directly — `(row) => h(...)` or a block body whose top-level `return` is the h() call',
    );
    return;
  }

  // Unique per-page base name for this list's slots (see doc comment above):
  // source-derived, else map-param-derived, else positional. Deduped on the
  // BASE, not on each slot name, so one list's three slots stay a matched set.
  // Created at the walk entry points — see attrSlotName on why this must not
  // fall back to a lazily created registry.
  const registry = walkCtx.listNames!;
  registry.total += 1;
  const derivedName = deriveBindingName(node.arguments[0])
    ?? (paramName !== '_' ? paramName : null);
  const base = derivedName === null
    ? `#${registry.total}`
    : uniqueName(registry.counts, derivedName);

  // Create slots: array slot (server-sourced) and item slot
  const arraySlotId = ctx.addSlot(`list:${base}:array`, TYPE_ARRAY, SOURCE_SERVER);
  const itemSlotId = ctx.addSlot(`list:${base}:item`, TYPE_OBJECT, SOURCE_SERVER);

  // Scan the body for param.prop member accesses to determine which
  // properties need PROP extraction opcodes.
  const propNames = new Set<string>();
  collectMemberProps(bodyExpr, paramName, propNames);

  // Create target slots for each property and build the bindings map
  const bindings = new Map<string, number>();
  const propEntries: Array<{ name: string; strIdx: number; slotId: number }> = [];
  for (const propName of Array.from(propNames)) {
    const targetSlotId = ctx.addSlot(`list:${base}:${propName}`, TYPE_TEXT, SOURCE_SERVER);
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
              warnDegraded(
                walkCtx,
                `row ${JSON.stringify(item)} of the unrolled '${arrayName}' spread could not be substituted`,
                `that one row is ${ISLAND_CONSEQUENCE}`,
              );
              emitIsland(ctx);
            }
          }
          return;
        }
      }
    }
  }

  // Can't statically unroll → island
  warnDegraded(
    walkCtx,
    `spread child ...${describeNode(arg)}`,
    ISLAND_CONSEQUENCE
      + ' — only `...CONST.map(item => h(...))` over a module-level array of object literals unrolls statically; use createList for runtime data',
  );
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

  // Recurse into the props object: `h('a', { href: item.href }, ...)`.
  // Without this the unroll substituted only CHILD positions, so every
  // attribute taken from the item reached the walker as an unresolvable
  // `item.href` and was emitted as an EMPTY dynamic attribute — the same
  // silent missing-attribute failure as a module const that will not fold.
  // A new object is built rather than mutated: the same body AST is
  // substituted once per row.
  // Verified by: packages/compiler/tests/ir-walk.test.ts > "unrolls item properties in attribute position"
  if (t.isObjectExpression(expr)) {
    return t.objectExpression(
      expr.properties.map((prop) => {
        if (t.isSpreadElement(prop) || !t.isObjectProperty(prop) || prop.computed) {
          return prop;
        }
        const value = substituteInExpr(prop.value as t.Expression, paramName, item);
        if (value === prop.value) return prop;
        return t.objectProperty(prop.key, value, false, false);
      }),
    );
  }

  // String literal, number literal, etc. pass through
  return expr;
}

// ---------------------------------------------------------------------------
// Rule 10: Sub-component Resolution
// ---------------------------------------------------------------------------

interface ResolvedSubComponent {
  /** The h() call expression the component returns, props already substituted. */
  returnNode: t.Expression;
  /** File the component is DECLARED in — the barrel a page imports through is
   *  not where the code lives, and module-scope constants must be read from
   *  the file that actually holds it. */
  filePath: string;
  /** Source of `filePath`. */
  source: string;
  /** Parsed module of `filePath` — its top level is the component's outer
   *  lexical scope. */
  ast: T.File;
  /** The component function. Its body is the component's inner scope. */
  fn: ComponentFunction;
}

/**
 * Resolve a sub-component to the tree it returns, through the one shared
 * export resolver (export-resolver.ts) — the same code path the root page and
 * the signal-default extractors use, so the three can no longer disagree about
 * which export forms exist.
 *
 * `allowLocal`/`allowNested` are on because a sub-component call CAN name a
 * file-local helper: `function Sidebar()` beside the mount, or a `navItem`
 * arrow declared inside the mount callback. Those are not importable, but
 * nothing imported them — the call site is in the same file.
 *
 * Returns the h() call expression from the function's return statement with
 * prop substitutions applied, plus the file it actually came from.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "inlines a sub-component re-exported through an index barrel"
 */
function resolveSubComponent(
  source: string,
  filePath: string,
  functionName: string,
  callNode: t.CallExpression,
  loadModule?: ModuleLoader,
): ResolvedSubComponent | null {
  const lookup = resolveExportedFunction(source, filePath, functionName, {
    loadModule,
    allowLocal: true,
    allowNested: true,
  });
  if (lookup.kind === 'unresolved') return null;

  const returnNode = returnExpressionOf(lookup.fn);
  if (!returnNode) return null;

  /** The component's first parameter — its props binding, needed to substitute
   *  call-site prop values into the returned tree (see substituteProps). */
  const paramNode: t.Node | null = lookup.fn.params[0] ?? null;

  // Apply prop substitutions from the call arguments
  // Pattern: Alert({ message: 'Saved', variant: 'success' })
  if (callNode.arguments.length > 0) {
    const propsArg = callNode.arguments[0];
    if (propsArg && !t.isSpreadElement(propsArg) && t.isObjectExpression(propsArg)) {
      substituteProps(returnNode, paramNode, propsArg);
    }
  }

  return {
    returnNode,
    filePath: lookup.filePath,
    source: lookup.source,
    ast: lookup.ast,
    fn: lookup.fn,
  };
}

/**
 * Substitute call-site prop values into an inlined component's returned tree.
 *
 * `Badge({ label: 'New' })` over `function Badge(props) { return h('span',
 * null, props.label); }` must emit `TEXT "New"`. Until this was implemented the
 * substitution was a no-op that returned its input unchanged in every branch —
 * so `props.label` reached the walker as an unresolvable expression and became
 * an EMPTY island nested inside the span: the label vanished from the server
 * render with no diagnostic. Both prop-binding forms are handled:
 *
 *   function Badge(props)      → `props.label` member reads
 *   function Badge({ label })  → the destructured local, including `{ label = 'x' }`
 *
 * Only static literals are substituted, which is all that can reach here:
 * walkCallExpression bails to an island before inlining when any call-site prop
 * is non-static. The tree is mutated in place — resolveSubComponent parses the
 * component source per call, so it is private to this walk.
 *
 * A name is left alone if a nested function inside the returned tree rebinds
 * it (`(label) => ...` shadowing the prop), which is the same conservatism the
 * module-constant folding applies.
 * Verified by: packages/compiler/tests/ir-walk.test.ts > "substitutes a call-site prop into an inlined component"
 */
function substituteProps(
  returnNode: t.Expression,
  paramNode: t.Node | null,
  propsObj: t.ObjectExpression,
): void {
  if (!paramNode) return;

  // Call-site props: key → literal value.
  const values = new Map<string, t.Expression>();
  for (const prop of propsObj.properties) {
    if (t.isSpreadElement(prop) || !t.isObjectProperty(prop) || prop.computed) continue;
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (key === null) continue;
    const val = prop.value as t.Expression;
    if (isStaticLiteral(val)) values.set(key, val);
  }
  if (values.size === 0) return;

  // Local bindings to replace: `label` (destructured) or `props.label` (member).
  const locals = new Map<string, t.Expression>();
  let propsParamName: string | null = null;

  if (t.isIdentifier(paramNode)) {
    propsParamName = paramNode.name;
  } else if (t.isObjectPattern(paramNode)) {
    for (const prop of paramNode.properties) {
      if (t.isRestElement(prop) || !t.isObjectProperty(prop) || prop.computed) continue;
      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null;
      if (key === null) continue;
      // `{ label }`, `{ label: text }` and `{ label = 'fallback' }` all bind a
      // local name; only the first two forms name it in `prop.value` directly.
      const target = t.isAssignmentPattern(prop.value) ? prop.value.left : prop.value;
      if (!t.isIdentifier(target)) continue;
      const value = values.get(key);
      if (value) locals.set(target.name, value);
    }
  }

  if (locals.size === 0 && propsParamName === null) return;

  const replace = (node: t.Node, shadowed: Set<string>): void => {
    for (const key of t.VISITOR_KEYS[node.type] || []) {
      const child = (node as any)[key];
      const children: any[] = Array.isArray(child) ? child : [child];
      for (let i = 0; i < children.length; i++) {
        const item = children[i];
        if (!item || typeof item !== 'object' || !item.type) continue;

        // `props.label` → literal
        if (
          propsParamName !== null
          && !shadowed.has(propsParamName)
          && t.isMemberExpression(item)
          && !item.computed
          && t.isIdentifier(item.object)
          && item.object.name === propsParamName
          && t.isIdentifier(item.property)
          && values.has(item.property.name)
        ) {
          const replacement = values.get(item.property.name)!;
          if (Array.isArray(child)) child[i] = replacement;
          else (node as any)[key] = replacement;
          continue;
        }

        // destructured `label` → literal (never a property key or a declaration)
        if (
          t.isIdentifier(item)
          && locals.has(item.name)
          && !shadowed.has(item.name)
          && !(t.isMemberExpression(node) && !node.computed && key === 'property')
          && !(t.isObjectProperty(node) && key === 'key' && !node.computed)
        ) {
          const replacement = locals.get(item.name)!;
          if (Array.isArray(child)) child[i] = replacement;
          else (node as any)[key] = replacement;
          continue;
        }

        // Descend, hiding any name a nested function rebinds.
        let nestedShadowed = shadowed;
        if (t.isFunction(item)) {
          const bound = new Set<string>();
          for (const param of item.params) {
            for (const name of Object.keys(t.getBindingIdentifiers(param))) bound.add(name);
          }
          if (bound.size > 0) nestedShadowed = new Set([...shadowed, ...bound]);
        }
        replace(item, nestedShadowed);
      }
    }
  };

  replace(returnNode, new Set());
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

  // Anything else → DYN_TEXT, with an SSR default when the expression folds
  // (a branch like `PREFIX + name()` is static text once the signals resolve).
  // Reached from a conditional branch, a createShow branch and a list row
  // body, so the diagnostic names the VALUE rather than guessing which.
  const evaluated = evalNode(expr, evalEnv(walkCtx));
  if (evaluated === undefined) {
    warnDegraded(
      walkCtx,
      `dynamic value ${describeNode(expr)}, which the compiler cannot evaluate`,
      'it renders EMPTY server-side and only fills in once the client hydrates',
    );
  }
  const slotId = ctx.addSlot(
    textSlotName(childIndex, walkCtx),
    TYPE_TEXT,
    SOURCE_CLIENT,
    defaultBytesFor(evaluated),
  );
  const markerId = ctx.nextMarker();
  ctx.emit(OP_DYN_TEXT);
  ctx.emitU16(slotId);
  ctx.emitU16(markerId);
}

// ---------------------------------------------------------------------------
// Island Emission
// ---------------------------------------------------------------------------

/**
 * Emit ISLAND_START / ISLAND_END markers and register the island in the table.
 *
 * This is the FALLBACK shell for every subtree the walker does NOT translate
 * into IR — a registered island whose component would not resolve, a
 * sub-component stopped by the depth/cycle/non-static-props guards, an
 * un-unrollable spread, or an unrecognized expression. It emits a bare <div>
 * for the Rust walker to hang data-forma-island / data-forma-component
 * attributes on, so CSR hydration can replace it in place.
 *
 * A registered island that DOES resolve never reaches here: it emits its own
 * root element from the walked component subtree, between ISLAND_START and
 * ISLAND_END (see walkCallExpression's islandNames branch).
 * Verified by: packages/compiler/tests/island-registry.test.ts > "unresolved island falls back to empty div shell"
 * Verified by: packages/compiler/tests/island-registry.test.ts > "island root element matches component root tag"
 */
function emitIsland(ctx: IrEmitContext, name?: string): void {
  // Capture byte offset BEFORE emitting ISLAND_START so walk_island() can seek directly here.
  const byteOffset = ctx.opcodeLen();
  // addIsland increments nextIslandCounter and registers the island in the table.
  // Use the returned id for the fallback name to avoid double-increment.
  // trigger: 0x01 = Load, propsMode: 0x01 = Inline (must match Rust IslandTrigger/PropsMode enums)
  const id = ctx.addIsland(name || `island_${ctx.peekNextIslandId()}`, 0x01, 0x01, [], byteOffset);
  ctx.emit(OP_ISLAND_START);
  ctx.emitU16(id);

  // Emit an empty <div> shell so the Rust walker has an element to inject
  // data-forma-island / data-forma-component attributes onto.
  const tagIdx = ctx.addString('div');
  ctx.emit(OP_OPEN_TAG);
  ctx.emitU32(tagIdx);
  ctx.emitU16(0); // no attributes

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
