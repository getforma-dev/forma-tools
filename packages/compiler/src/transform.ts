/**
 * Forma Compiler - AST Transform
 *
 * Transforms `h()` hyperscript calls into optimized `template()` +
 * `cloneNode(true)` code. Uses @babel/parser, @babel/traverse,
 * @babel/types, and @babel/generator.
 *
 * Static props and children are baked into a template HTML string.
 * Dynamic props become `createEffect()` calls. Events become
 * `addEventListener()` calls. DOM walker paths (`.firstChild`,
 * `.nextSibling`) are generated to reach each dynamic node.
 */

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import _generate from '@babel/generator';
import type { NodePath } from '@babel/traverse';

// Handle ESM/CJS interop for @babel/traverse and @babel/generator
const traverse = (typeof _traverse === 'function'
  ? _traverse
  : (_traverse as any).default) as typeof _traverse;
const generate = (typeof _generate === 'function'
  ? _generate
  : (_generate as any).default) as typeof _generate;

// ---------------------------------------------------------------------------
// SVG tags — fall back to runtime h() for these
// ---------------------------------------------------------------------------

const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
  'ellipse', 'g', 'text', 'tspan', 'defs', 'use', 'symbol', 'clipPath',
  'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'stop',
  'filter', 'foreignObject', 'animate', 'animateTransform', 'image',
]);

// ---------------------------------------------------------------------------
// Boolean HTML attributes (rendered as valueless: `<input disabled>`)
// ---------------------------------------------------------------------------

const BOOLEAN_ATTRS = new Set([
  'disabled', 'checked', 'readonly', 'required', 'autofocus', 'autoplay',
  'controls', 'default', 'defer', 'formnovalidate', 'hidden', 'ismap',
  'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open',
  'playsinline', 'reversed', 'selected', 'async',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape HTML special chars for attribute values. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape HTML text content. */
function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Check if a prop key is an event handler (onClick, onInput, etc.). */
function isEventProp(key: string): boolean {
  return key.length > 2
    && key.charCodeAt(0) === 111 /* o */
    && key.charCodeAt(1) === 110 /* n */
    && key.charCodeAt(2) >= 65  /* A */
    && key.charCodeAt(2) <= 90; /* Z */
}

/** Convert event prop name to DOM event name: onClick -> click. */
function eventName(key: string): string {
  return key.slice(2).toLowerCase();
}

/** Self-closing HTML tags (void elements). */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ---------------------------------------------------------------------------
// Template ID counter (per-file, reset for each compileFormaJSX call)
// ---------------------------------------------------------------------------

let templateCounter = 0;

function nextTemplateId(): string {
  return `_tmpl$${templateCounter++}`;
}

let varCounter = 0;

function nextVarId(prefix: string = '_el$'): string {
  return `${prefix}${varCounter++}`;
}

/**
 * Normalize legacy internal "forma/*" or deep "formajs/*" imports to the
 * public package entrypoint used by transformed output.
 */
function normalizePublicFormaImport(source: string): string {
  return source === 'formajs' ? 'formajs' : 'formajs';
}

// ---------------------------------------------------------------------------
// Intermediate Representation
// ---------------------------------------------------------------------------

/**
 * Represents a compiled h() call tree. Built by analyzing the AST, then
 * used to generate the template HTML string, walker paths, and binding code.
 */
interface CompiledElement {
  kind: 'element';
  tag: string;
  /** Static attributes baked into the template HTML. */
  staticAttrs: Array<{ key: string; value: string }>;
  /** Dynamic attribute bindings (createEffect). */
  dynamicAttrs: Array<{ key: string; valueExpr: t.Expression }>;
  /** Event handler bindings (addEventListener). */
  events: Array<{ eventName: string; handler: t.Expression }>;
  /** ref callback expression, if any. */
  ref: t.Expression | null;
  /** dangerouslySetInnerHTML expression, if any. */
  innerHTML: t.Expression | null;
  /** Children, in order. */
  children: CompiledChild[];
}

interface CompiledTextStatic {
  kind: 'text-static';
  value: string;
}

interface CompiledTextDynamic {
  kind: 'text-dynamic';
  expr: t.Expression;
}

interface CompiledChildNode {
  kind: 'child-node';
  /** Original AST expression for a child that is a Node (runtime h() call, variable, etc.). */
  expr: t.Expression;
}

type CompiledChild = CompiledElement | CompiledTextStatic | CompiledTextDynamic | CompiledChildNode;

// ---------------------------------------------------------------------------
// AST Analysis: Classify an h() CallExpression into CompiledElement
// ---------------------------------------------------------------------------

/**
 * Attempt to compile an h() call expression into a CompiledElement.
 * Returns null if the call cannot be compiled (dynamic tag, spread props, SVG, etc.).
 */
function analyzeHCall(
  node: t.CallExpression,
  hBindingName: string,
): CompiledElement | null {
  const args = node.arguments;
  if (args.length === 0) return null;

  // --- Tag argument ---
  const tagArg = args[0];
  if (!tagArg || !t.isStringLiteral(tagArg)) return null; // dynamic tag => bail
  const tag = tagArg.value;

  // SVG tags => bail to runtime
  if (SVG_TAGS.has(tag)) return null;

  // --- Props argument ---
  const propsArg = args.length > 1 ? args[1] : undefined;

  const staticAttrs: CompiledElement['staticAttrs'] = [];
  const dynamicAttrs: CompiledElement['dynamicAttrs'] = [];
  const events: CompiledElement['events'] = [];
  let ref: t.Expression | null = null;
  let innerHTML: t.Expression | null = null;

  if (propsArg && !t.isNullLiteral(propsArg) && !isUndefinedIdentifier(propsArg)) {
    if (!t.isObjectExpression(propsArg)) return null; // not a literal object => bail

    for (const prop of propsArg.properties) {
      // Spread element => bail
      if (t.isSpreadElement(prop)) return null;
      if (!t.isObjectProperty(prop)) return null; // getter/setter/method => bail
      if (prop.computed) return null; // computed key => bail

      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null;
      if (key === null) return null;

      const val = prop.value as t.Expression;

      // ref
      if (key === 'ref') {
        ref = val;
        continue;
      }

      // dangerouslySetInnerHTML
      if (key === 'dangerouslySetInnerHTML') {
        innerHTML = val;
        continue;
      }

      // Event handler
      if (isEventProp(key)) {
        events.push({ eventName: eventName(key), handler: val });
        continue;
      }

      // Static value? string/number/boolean/null literal
      if (isStaticLiteral(val)) {
        const strVal = staticLiteralToString(val);
        if (strVal !== null) {
          staticAttrs.push({ key, value: strVal });
        }
        // If strVal is null (e.g., false for a boolean attr), skip the attr
        continue;
      }

      // Everything else is dynamic
      dynamicAttrs.push({ key, valueExpr: val });
    }
  }

  // --- Children arguments ---
  const children: CompiledChild[] = [];
  for (let i = 2; i < args.length; i++) {
    const childArg = args[i];
    if (!childArg || t.isSpreadElement(childArg)) {
      // Spread children => can't compile entire element
      return null;
    }
    const child = analyzeChild(childArg as t.Expression, hBindingName);
    if (child === null) return null; // child analysis failed => bail entire element
    children.push(child);
  }

  return { kind: 'element', tag, staticAttrs, dynamicAttrs, events, ref, innerHTML, children };
}

/**
 * Analyze a single child argument to an h() call.
 */
function analyzeChild(
  expr: t.Expression,
  hBindingName: string,
): CompiledChild | null {
  // String literal
  if (t.isStringLiteral(expr)) {
    return { kind: 'text-static', value: expr.value };
  }

  // Numeric literal
  if (t.isNumericLiteral(expr)) {
    return { kind: 'text-static', value: String(expr.value) };
  }

  // Template literal with no expressions (static)
  if (t.isTemplateLiteral(expr) && expr.expressions.length === 0 && expr.quasis.length === 1) {
    return { kind: 'text-static', value: expr.quasis[0]!.value.cooked ?? expr.quasis[0]!.value.raw };
  }

  // null / undefined / boolean => skip (no DOM output)
  if (t.isNullLiteral(expr)) return { kind: 'text-static', value: '' };
  if (t.isBooleanLiteral(expr)) return { kind: 'text-static', value: '' };
  if (isUndefinedIdentifier(expr)) return { kind: 'text-static', value: '' };

  // Nested h() call => recursively analyze
  if (isHCall(expr, hBindingName)) {
    const nested = analyzeHCall(expr as t.CallExpression, hBindingName);
    if (nested) return nested;
    // If we can't compile the nested h(), treat as a runtime child node
    return { kind: 'child-node', expr };
  }

  // Function expression (arrow or regular) => dynamic text
  if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
    return { kind: 'text-dynamic', expr };
  }

  // Anything else (variable, call expression, conditional, etc.) => child-node
  return { kind: 'child-node', expr };
}

/** Check if an expression is an h() call using the given binding name. */
function isHCall(expr: t.Expression, hBindingName: string): boolean {
  return t.isCallExpression(expr)
    && t.isIdentifier(expr.callee)
    && expr.callee.name === hBindingName;
}

/** Check if an expression is a static literal (string, number, boolean, null). */
function isStaticLiteral(expr: t.Expression): boolean {
  return t.isStringLiteral(expr)
    || t.isNumericLiteral(expr)
    || t.isBooleanLiteral(expr)
    || t.isNullLiteral(expr);
}

/** Convert a static literal AST node to a string for an HTML attribute. Returns null if the value should be omitted. */
function staticLiteralToString(expr: t.Expression): string | null {
  if (t.isStringLiteral(expr)) return expr.value;
  if (t.isNumericLiteral(expr)) return String(expr.value);
  if (t.isBooleanLiteral(expr)) return expr.value ? '' : null;
  if (t.isNullLiteral(expr)) return null;
  return null;
}

/** Check if an expression is `undefined`. */
function isUndefinedIdentifier(expr: t.Node): boolean {
  return t.isIdentifier(expr) && expr.name === 'undefined';
}

// ---------------------------------------------------------------------------
// HTML Generation from CompiledElement
// ---------------------------------------------------------------------------

/**
 * Build a template HTML string from a CompiledElement tree.
 * Dynamic children get placeholder empty text nodes or empty elements
 * so that walker paths remain stable.
 */
function buildTemplateHTML(elem: CompiledElement): string {
  let html = `<${elem.tag}`;

  // Static attributes
  for (const attr of elem.staticAttrs) {
    if (BOOLEAN_ATTRS.has(attr.key)) {
      // Boolean attribute: only render if truthy (value === '' means present)
      if (attr.value === '' || attr.value) {
        html += ` ${attr.key}`;
      }
    } else {
      html += ` ${attr.key}="${escapeAttr(attr.value)}"`;
    }
  }

  html += '>';

  // Void (self-closing) elements have no children or closing tag
  if (VOID_TAGS.has(elem.tag)) {
    return html;
  }

  // Children
  for (const child of elem.children) {
    switch (child.kind) {
      case 'element':
        html += buildTemplateHTML(child);
        break;
      case 'text-static':
        html += escapeHTML(child.value);
        break;
      case 'text-dynamic':
        // Comment node placeholder — the walker will find it, then
        // compiled code replaces it with a real text node bound via createEffect.
        html += '<!>';
        break;
      case 'child-node':
        // Same as dynamic text — needs a placeholder
        html += '<!>';
        break;
    }
  }

  html += `</${elem.tag}>`;
  return html;
}

// ---------------------------------------------------------------------------
// DOM Walker Path Generation
// ---------------------------------------------------------------------------

/**
 * Represents a path through the DOM tree from a root element to a specific node.
 * Each step is `.firstChild` or `.nextSibling`.
 */
type WalkerStep = 'firstChild' | 'nextSibling';

interface DynamicBinding {
  /** Walker path from root to this node. */
  path: WalkerStep[];
  /** What kind of binding. */
  binding:
    | { kind: 'dynamic-attr'; key: string; valueExpr: t.Expression }
    | { kind: 'event'; eventName: string; handler: t.Expression }
    | { kind: 'dynamic-text'; expr: t.Expression }
    | { kind: 'child-node'; expr: t.Expression }
    | { kind: 'ref'; expr: t.Expression }
    | { kind: 'innerHTML'; expr: t.Expression };
}

/**
 * Collect all dynamic bindings from a CompiledElement tree, with walker paths.
 */
function collectBindings(elem: CompiledElement): DynamicBinding[] {
  const bindings: DynamicBinding[] = [];
  collectBindingsRecursive(elem, [], bindings);
  return bindings;
}

function collectBindingsRecursive(
  elem: CompiledElement,
  parentPath: WalkerStep[],
  bindings: DynamicBinding[],
): void {
  // Dynamic attrs on this element
  for (const attr of elem.dynamicAttrs) {
    bindings.push({
      path: [...parentPath],
      binding: { kind: 'dynamic-attr', key: attr.key, valueExpr: attr.valueExpr },
    });
  }

  // Events on this element
  for (const ev of elem.events) {
    bindings.push({
      path: [...parentPath],
      binding: { kind: 'event', eventName: ev.eventName, handler: ev.handler },
    });
  }

  // Ref on this element
  if (elem.ref) {
    bindings.push({
      path: [...parentPath],
      binding: { kind: 'ref', expr: elem.ref },
    });
  }

  // innerHTML on this element
  if (elem.innerHTML) {
    bindings.push({
      path: [...parentPath],
      binding: { kind: 'innerHTML', expr: elem.innerHTML },
    });
  }

  // Children
  for (let i = 0; i < elem.children.length; i++) {
    const child = elem.children[i]!;
    // Build path to this child:
    // First child: parentPath + firstChild
    // Subsequent children: firstChild's path + nextSibling * i
    const childPath = buildChildPath(parentPath, i);

    switch (child.kind) {
      case 'element':
        collectBindingsRecursive(child, childPath, bindings);
        break;
      case 'text-dynamic':
        bindings.push({
          path: childPath,
          binding: { kind: 'dynamic-text', expr: child.expr },
        });
        break;
      case 'child-node':
        bindings.push({
          path: childPath,
          binding: { kind: 'child-node', expr: child.expr },
        });
        break;
      case 'text-static':
        // No binding needed for static text
        break;
    }
  }
}

/**
 * Build a walker path from a parent element to its Nth child.
 * Child 0: [...parent, firstChild]
 * Child 1: [...parent, firstChild, nextSibling]
 * Child N: [...parent, firstChild, nextSibling, ..., nextSibling]
 */
function buildChildPath(parentPath: WalkerStep[], childIndex: number): WalkerStep[] {
  const path = [...parentPath, 'firstChild' as const];
  for (let i = 0; i < childIndex; i++) {
    path.push('nextSibling');
  }
  return path;
}

// ---------------------------------------------------------------------------
// Code Generation
// ---------------------------------------------------------------------------

/**
 * Generate walker variable declarations and binding statements from collected bindings.
 */
function generateBindingCode(
  bindings: DynamicBinding[],
  rootVar: string,
  createEffectId: string,
): t.Statement[] {
  const statements: t.Statement[] = [];

  // Group bindings by path to avoid creating duplicate walker variables
  const pathToVar = new Map<string, string>();

  // First pass: assign walker variables
  for (const binding of bindings) {
    const pathKey = binding.path.join('.');
    if (pathKey === '') {
      // Root element itself, use rootVar
      pathToVar.set(pathKey, rootVar);
    } else if (!pathToVar.has(pathKey)) {
      const varName = nextVarId();
      pathToVar.set(pathKey, varName);

      // Generate walker expression: _el$.firstChild.nextSibling...
      let expr: t.Expression = t.identifier(rootVar);
      for (const step of binding.path) {
        expr = t.memberExpression(expr, t.identifier(step));
      }

      statements.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(varName), expr),
        ]),
      );
    }
  }

  // Second pass: generate binding statements
  for (const binding of bindings) {
    const pathKey = binding.path.join('.');
    const targetVar = pathToVar.get(pathKey) ?? rootVar;

    switch (binding.binding.kind) {
      case 'dynamic-attr': {
        const { key, valueExpr } = binding.binding;

        if (t.isArrowFunctionExpression(valueExpr) || t.isFunctionExpression(valueExpr)) {
          // Reactive attribute: wrap in createEffect, call the getter on each run
          const body = buildAttrSetStatement(targetVar, key, valueExpr);
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier(createEffectId), [
                t.arrowFunctionExpression([], t.blockStatement(body)),
              ]),
            ),
          );
        } else {
          // Non-function dynamic (variable reference, conditional, etc.)
          // We still need to handle reactivity — wrap in createEffect to be safe
          const body = buildAttrSetStatementFromExpr(targetVar, key, valueExpr);
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier(createEffectId), [
                t.arrowFunctionExpression([], t.blockStatement(body)),
              ]),
            ),
          );
        }
        break;
      }

      case 'event': {
        // _el$.addEventListener('click', handler)
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(targetVar), t.identifier('addEventListener')),
              [t.stringLiteral(binding.binding.eventName), binding.binding.handler],
            ),
          ),
        );
        break;
      }

      case 'dynamic-text': {
        // Replace the comment placeholder with a text node, then bind via createEffect.
        const textVar = nextVarId('_t$');
        const { expr } = binding.binding;

        statements.push(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier(textVar),
              t.callExpression(
                t.memberExpression(t.identifier('document'), t.identifier('createTextNode')),
                [t.stringLiteral('')],
              ),
            ),
          ]),
        );

        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(targetVar), t.identifier('replaceWith')),
              [t.identifier(textVar)],
            ),
          ),
        );

        const effectBody = buildDynamicTextEffect(textVar, expr);
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier(createEffectId), [
              t.arrowFunctionExpression([], t.blockStatement(effectBody)),
            ]),
          ),
        );
        break;
      }

      case 'child-node': {
        // Replace the comment placeholder with the runtime child expression.
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(targetVar), t.identifier('replaceWith')),
              [binding.binding.expr],
            ),
          ),
        );
        break;
      }

      case 'ref': {
        // ref(el) — call the ref function with the element
        statements.push(
          t.expressionStatement(
            t.callExpression(binding.binding.expr, [t.identifier(targetVar)]),
          ),
        );
        break;
      }

      case 'innerHTML': {
        // el.innerHTML = expr.__html
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.identifier(targetVar), t.identifier('innerHTML')),
              t.memberExpression(binding.binding.expr, t.identifier('__html')),
            ),
          ),
        );
        break;
      }
    }
  }

  return statements;
}

/**
 * Build statements for setting an attribute from a reactive function expression.
 * The function is called inside an effect, so we call it and set the result.
 */
function buildAttrSetStatement(
  targetVar: string,
  key: string,
  fnExpr: t.Expression,
): t.Statement[] {
  // Call the function to get the value
  const callExpr = t.callExpression(fnExpr, []);

  return buildAttrAssignment(targetVar, key, callExpr);
}

/**
 * Build statements for setting an attribute from a general expression.
 */
function buildAttrSetStatementFromExpr(
  targetVar: string,
  key: string,
  expr: t.Expression,
): t.Statement[] {
  return buildAttrAssignment(targetVar, key, expr);
}

/**
 * Build the actual attribute assignment statement(s).
 */
function buildAttrAssignment(
  targetVar: string,
  key: string,
  valueExpr: t.Expression,
): t.Statement[] {
  if (key === 'class' || key === 'className') {
    // _el$.className = value
    return [
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(t.identifier(targetVar), t.identifier('className')),
          valueExpr,
        ),
      ),
    ];
  }

  if (key === 'style') {
    // _el$.style.cssText = value (assuming string for compiled path)
    return [
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(
            t.memberExpression(t.identifier(targetVar), t.identifier('style')),
            t.identifier('cssText'),
          ),
          valueExpr,
        ),
      ),
    ];
  }

  if (BOOLEAN_ATTRS.has(key)) {
    // value ? _el$.setAttribute(key, '') : _el$.removeAttribute(key)
    return [
      t.expressionStatement(
        t.conditionalExpression(
          valueExpr,
          t.callExpression(
            t.memberExpression(t.identifier(targetVar), t.identifier('setAttribute')),
            [t.stringLiteral(key), t.stringLiteral('')],
          ),
          t.callExpression(
            t.memberExpression(t.identifier(targetVar), t.identifier('removeAttribute')),
            [t.stringLiteral(key)],
          ),
        ),
      ),
    ];
  }

  // Generic: _el$.setAttribute(key, String(value))
  return [
    t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier(targetVar), t.identifier('setAttribute')),
        [t.stringLiteral(key), valueExpr],
      ),
    ),
  ];
}

/**
 * Build effect body for dynamic text: _t$.textContent = String(fn())
 * If the expression is a function, call it. Otherwise, use it directly.
 */
function buildDynamicTextEffect(textVar: string, expr: t.Expression): t.Statement[] {
  let valueExpr: t.Expression;

  if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
    // It's a function: call it to get the value
    valueExpr = t.callExpression(expr, []);
  } else {
    valueExpr = expr;
  }

  return [
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(t.identifier(textVar), t.identifier('textContent')),
        valueExpr,
      ),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Main Transform
// ---------------------------------------------------------------------------

/**
 * Compile FormaJS `h()` calls in the given source code into optimized
 * `template()` + `cloneNode(true)` code.
 *
 * Returns `{ code, map }` if transformations were made, or `null` if
 * no h() calls from forma were found.
 */
export function compileFormaJSX(
  code: string,
  id: string,
): { code: string; map: any } | null {
  // Reset counters for this file
  templateCounter = 0;
  varCounter = 0;

  // Parse with @babel/parser
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
    sourceFilename: id,
  });

  // --- Step 1: Find h imports from forma ---

  // Track the local binding name for h (could be renamed via `import { h as hh }`)
  let hBindingName: string | null = null;
  let hImportSource: string | null = null;
  let createEffectImportSource: string | null = null;

  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    const source = node.source.value;

    // Check if this imports from forma
    if (!source.startsWith('forma/') && !source.startsWith('formajs')) continue;

    for (const spec of node.specifiers) {
      if (!t.isImportSpecifier(spec)) continue;
      const imported = t.isIdentifier(spec.imported)
        ? spec.imported.name
        : spec.imported.value;

      if (imported === 'h') {
        hBindingName = spec.local.name;
        hImportSource = source;
      }
      if (imported === 'createEffect') {
        createEffectImportSource = source;
      }
    }
  }

  // If no h import from forma, nothing to transform
  if (!hBindingName) return null;

  // --- Step 2: Find all top-level h() call expressions and compile them ---

  // We'll collect template declarations (module-level) and replace h() calls inline.
  const templateDeclarations: t.VariableDeclaration[] = [];
  let needsTemplateImport = false;
  let needsCreateEffectImport = false;
  let transformed = false;

  // Use a unique createEffect name for compiled output to avoid conflicts
  const compiledCreateEffectId = '_$createEffect';
  const compiledTemplateId = '_$template';

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      const node = path.node;

      // Check if this is an h() call
      if (!t.isIdentifier(node.callee) || node.callee.name !== hBindingName) return;

      // Try to compile
      const compiled = analyzeHCall(node, hBindingName!);
      if (!compiled) return; // Can't compile, leave as runtime h()

      // Check if there are any dynamic bindings at all
      const bindings = collectBindings(compiled);
      const html = buildTemplateHTML(compiled);

      if (!html) return;

      // Generate template variable at module scope
      const tmplVar = nextTemplateId();
      needsTemplateImport = true;

      // const _tmpl$ = _$template('<div ...>');
      templateDeclarations.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(tmplVar),
            t.callExpression(t.identifier(compiledTemplateId), [t.stringLiteral(html)]),
          ),
        ]),
      );

      // If no dynamic bindings, just clone and return
      if (bindings.length === 0) {
        // Replace h() call with: _tmpl$.cloneNode(true)
        path.replaceWith(
          t.callExpression(
            t.memberExpression(t.identifier(tmplVar), t.identifier('cloneNode')),
            [t.booleanLiteral(true)],
          ),
        );
        transformed = true;
        return;
      }

      // Has dynamic bindings: generate IIFE or block with declarations
      // We need to:
      // 1. Clone the template
      // 2. Walk to dynamic nodes
      // 3. Set up bindings
      // 4. Return the root element

      if (bindings.some(b =>
        b.binding.kind === 'dynamic-attr'
        || b.binding.kind === 'dynamic-text'
      )) {
        needsCreateEffectImport = true;
      }

      const rootVar = nextVarId('_root$');

      // const _root$ = _tmpl$.cloneNode(true);
      const cloneStmt = t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(rootVar),
          t.callExpression(
            t.memberExpression(t.identifier(tmplVar), t.identifier('cloneNode')),
            [t.booleanLiteral(true)],
          ),
        ),
      ]);

      const bindingStatements = generateBindingCode(bindings, rootVar, compiledCreateEffectId);

      // Build an IIFE: (() => { clone; walk; bind; return _root$; })()
      const iifeBody = [
        cloneStmt,
        ...bindingStatements,
        t.returnStatement(t.identifier(rootVar)),
      ];

      const iife = t.callExpression(
        t.arrowFunctionExpression([], t.blockStatement(iifeBody)),
        [],
      );

      path.replaceWith(iife);
      transformed = true;
    },
  });

  if (!transformed) return null;

  // --- Step 3: Inject imports and template declarations ---

  // Add template import
  if (needsTemplateImport) {
    const templateSource = normalizePublicFormaImport(hImportSource ?? 'formajs');
    const templateImport = t.importDeclaration(
      [t.importSpecifier(t.identifier(compiledTemplateId), t.identifier('template'))],
      t.stringLiteral(templateSource),
    );
    ast.program.body.unshift(templateImport);
  }

  // Add createEffect import if needed and not already imported
  if (needsCreateEffectImport) {
    // Determine the source for createEffect import
    const effectSource = normalizePublicFormaImport(createEffectImportSource ?? hImportSource ?? 'formajs');
    const effectImport = t.importDeclaration(
      [t.importSpecifier(t.identifier(compiledCreateEffectId), t.identifier('createEffect'))],
      t.stringLiteral(effectSource),
    );
    ast.program.body.unshift(effectImport);
  }

  // Insert template declarations after imports
  // Find the last import declaration index
  let lastImportIndex = -1;
  for (let i = 0; i < ast.program.body.length; i++) {
    if (t.isImportDeclaration(ast.program.body[i])) {
      lastImportIndex = i;
    }
  }

  // Insert template declarations right after the last import
  const insertIndex = lastImportIndex + 1;
  for (let i = templateDeclarations.length - 1; i >= 0; i--) {
    ast.program.body.splice(insertIndex, 0, templateDeclarations[i]!);
  }

  // --- Step 4: Generate output code ---

  const result = generate(ast, {
    sourceMaps: true,
    sourceFileName: id,
  }, code);

  return {
    code: result.code,
    map: result.map,
  };
}
