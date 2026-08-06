/**
 * Forma Compiler - Component Analyzer
 *
 * Parses entry points (app.ts), resolves component imports, extracts
 * h() call trees, file-level constants, and signal defaults.
 * This feeds into the IR walk engine.
 */

import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';
import _traverse from '@babel/traverse';

import type { ModuleLoader } from './module-loader';
import {
  readImportBindings,
  resolveExportedFunction,
  returnExpressionOf,
  type ImportBinding,
} from './export-resolver';

// Handle CJS/ESM compatibility for @babel/traverse
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntryPointInfo {
  /** The component function name found in the mount() call. */
  componentName: string;
  /** The import path for the component (e.g., './OnboardingPage'). */
  importPath: string;
  /** Names of components registered in activateIslands({...}).
   *  These must NOT be inlined — they emit ISLAND_START/ISLAND_END. */
  islandNames?: Set<string>;
  /** Import mappings from the entry file: local name -> import source string.
   *  Used to resolve island component files imported by the entry. */
  importMap?: Map<string, string>;
  /** Full import bindings from the entry file: local name -> { source,
   *  imported }. `import { PageImpl as Page }` binds local `Page` to the name
   *  `PageImpl` in the target module; looking up `Page` there finds nothing. */
  importBindings?: Map<string, ImportBinding>;
  /** For inline mount returns: the AST node of the return expression.
   *  When set, componentName is '__inline__' and importPath is ''. */
  inlineReturnNode?: import('@babel/types').Expression;
}

export interface ComponentInfo {
  /** The name of the exported function. */
  functionName: string;
  /** The AST Expression node from the function's return statement. */
  returnNode: T.Expression;
  /** File the function is DECLARED in. Differs from the file that was asked
   *  when a barrel (`export { X } from './x'`) forwarded the export — the
   *  caller must read constants and imports from THIS file, not the barrel. */
  filePath: string;
  /** Source of `filePath` (JSX already transformed to h() calls). */
  source: string;
}

/**
 * Shared options for the lookups that have to answer "which function does this
 * module export under this name?".
 */
export interface AnalyzerLookupOptions {
  /** Follows `export … from './x'` re-exports across files. Without it those
   *  forms are reported to `onUnresolved` instead of being followed. */
  loadModule?: ModuleLoader;
  /** Receives the reason a name could not be followed to a function, naming
   *  the file and the construct. The caller adds the consequence, which
   *  differs by call site. Nothing about a failed lookup is silent. */
  onUnresolved?: (detail: string) => void;
}

export interface SignalDefault {
  type: 'text' | 'bool' | 'number' | 'null';
  default: string | boolean | number | null;
}

// ---------------------------------------------------------------------------
// Parser Options
// ---------------------------------------------------------------------------

const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};

// ---------------------------------------------------------------------------
// ComponentAnalyzer
// ---------------------------------------------------------------------------

export class ComponentAnalyzer {
  constructor(public readonly baseDir: string) {}

  // -------------------------------------------------------------------------
  // Task 6: Entry Point Parsing
  // -------------------------------------------------------------------------

  /**
   * Parse an entry point file (e.g., app.ts) and find the SSR root component.
   *
   * Detection order:
   * 1. mount(() => Component(), '#app') — traditional pattern
   * 2. activateIslands({...}) + Page component import — island-first pattern.
   *    The SSR root is the imported *Page component NOT in the islands registry.
   *
   * Returns the component name and its import path, or null if not found.
   */
  parseEntryPoint(source: string, filename: string): EntryPointInfo | null {
    const ast = parse(source, PARSE_OPTS);

    // Step 1: Collect import mappings: localName -> importPath (plus the name
    // the target module exports it under, which an alias makes different).
    const importBindings = readImportBindings(ast);
    const importMap = new Map<string, string>();
    for (const [local, binding] of importBindings) {
      importMap.set(local, binding.source);
    }

    // Step 2: Find mount(() => Component(), '#app') call
    let result: EntryPointInfo | null = null;

    traverse(ast, {
      CallExpression(path) {
        // Match mount(...)
        if (!t.isIdentifier(path.node.callee) || path.node.callee.name !== 'mount') {
          return;
        }

        const args = path.node.arguments;
        if (args.length < 1) return;

        const firstArg = args[0];

        // Pattern 1: mount(() => Component(), '#app')
        // The first arg is an arrow function whose body is a call expression
        if (t.isArrowFunctionExpression(firstArg) && t.isCallExpression(firstArg.body)) {
          const innerCall = firstArg.body;
          if (t.isIdentifier(innerCall.callee)) {
            const componentName = innerCall.callee.name;
            const importPath = importMap.get(componentName);
            // Only a RELATIVE import is a component file this compiler can
            // open. `mount(() => h('div', …), '#app')` matched here too and
            // sent the plugin looking for a file called 'formajs', which fails
            // — and a failure at this step drops the WHOLE page to placeholder
            // IR. It is an inline mount; Pattern 3 below is where it belongs.
            // Verified by: packages/compiler/tests/ssr-emission.test.ts > "treats an expression-bodied mount as an inline mount"
            if (importPath && (importPath.startsWith('.') || importPath.startsWith('/'))) {
              result = { componentName, importPath };
              path.stop();
            }
          }
        }

        // Pattern 2: mount(Component, '#app') — direct reference
        if (!result && t.isIdentifier(firstArg)) {
          const componentName = firstArg.name;
          const importPath = importMap.get(componentName);
          if (importPath && (importPath.startsWith('.') || importPath.startsWith('/'))) {
            result = { componentName, importPath };
            path.stop();
          }
        }

        // Pattern 3: mount(() => { ...statements; return JSX; }, '#app')
        // Block-body arrow — extract the ReturnStatement, ignore everything else.
        if (
          !result &&
          t.isArrowFunctionExpression(firstArg) &&
          t.isBlockStatement(firstArg.body)
        ) {
          for (const stmt of firstArg.body.body) {
            if (t.isReturnStatement(stmt) && stmt.argument) {
              result = {
                componentName: '__inline__',
                importPath: '',
                inlineReturnNode: stmt.argument,
              };
              path.stop();
              break;
            }
          }
        }

        // Pattern 3b: mount(() => <expr>, '#app') — an expression-bodied arrow
        // that Pattern 1 did not claim, because the thing it calls is not an
        // imported component: `mount(() => h('div', …), '#app')` or a page
        // component declared in the entry file itself. The arrow's body IS the
        // tree; the entry file is the module scope it resolves against.
        // Verified by: packages/compiler/tests/ssr-emission.test.ts > "treats an expression-bodied mount as an inline mount"
        if (
          !result &&
          t.isArrowFunctionExpression(firstArg) &&
          !t.isBlockStatement(firstArg.body)
        ) {
          result = {
            componentName: '__inline__',
            importPath: '',
            inlineReturnNode: firstArg.body,
          };
          path.stop();
        }
      },
    });

    if (result) {
      (result as EntryPointInfo).importMap = importMap;
      (result as EntryPointInfo).importBindings = importBindings;
      // The mount() patterns (including inline block-body mounts) can ALSO
      // register islands via activateIslands({...}) — scan for them so the
      // walker never inlines an island component and the SSR plugin can
      // merge island signal defaults on these paths too.
      const mountIslandNames = this.collectIslandNames(ast);
      if (mountIslandNames.size > 0) {
        (result as EntryPointInfo).islandNames = mountIslandNames;
      }
      return result;
    }

    // Step 3: Fallback — activateIslands({ ... }) pattern.
    // Collect island component names from the registry object, then find
    // the Page component import that isn't an island.
    const islandNames = this.collectIslandNames(ast);

    if (islandNames.size === 0) return null;

    // The SSR root is the imported component whose name ends with "Page"
    // and is NOT one of the island components in the registry.
    for (const [name, importPath] of importMap) {
      if (!islandNames.has(name) && name.endsWith('Page') && importPath.startsWith('.')) {
        return { componentName: name, importPath, islandNames, importMap };
      }
    }

    return null;
  }

  /**
   * Collect island component names from an activateIslands({ ... }) call.
   * Returns an empty set when no registry call is present.
   */
  private collectIslandNames(ast: T.File): Set<string> {
    const islandNames = new Set<string>();

    traverse(ast, {
      CallExpression(path) {
        if (!t.isIdentifier(path.node.callee) || path.node.callee.name !== 'activateIslands') {
          return;
        }
        const args = path.node.arguments;
        if (args.length < 1 || !t.isObjectExpression(args[0])) return;

        for (const prop of (args[0] as T.ObjectExpression).properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            islandNames.add(prop.key.name);
          } else if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
            islandNames.add((prop.value as T.Identifier).name);
          }
        }
        path.stop();
      },
    });

    return islandNames;
  }

  /**
   * Parse a component file and find the function it exports under
   * `functionName`, then extract that function's returned expression (the h()
   * call tree AST node).
   *
   * Every export form resolveExportedFunction understands works here —
   * including `export { Page }`, which is what esbuild rewrites EVERY
   * `export function Page()` in a .tsx file into. This used to read
   * `ExportNamedDeclaration.declaration` only, so a JSX page resolved to
   * nothing and the whole page fell back to placeholder IR.
   * Verified by: packages/compiler/tests/component-analyzer.test.ts > "resolves the specifier export shape esbuild emits for .tsx"
   *
   * A non-exported top-level declaration is deliberately NOT accepted: the
   * name got here through an `import`, and a binding the entry cannot import
   * must not be server-rendered as though it could.
   *
   * Returns null when the name cannot be followed to a function; the reason
   * goes to `options.onUnresolved` rather than nowhere.
   */
  parseComponentFile(
    source: string,
    filename: string,
    functionName: string,
    options: AnalyzerLookupOptions = {},
  ): ComponentInfo | null {
    const lookup = resolveExportedFunction(source, filename, functionName, {
      loadModule: options.loadModule,
      allowLocal: false,
      allowNested: false,
    });

    if (lookup.kind === 'unresolved') {
      options.onUnresolved?.(lookup.detail);
      return null;
    }

    const returnNode = returnExpressionOf(lookup.fn);
    if (!returnNode) {
      options.onUnresolved?.(
        `'${functionName}' in ${lookup.filePath} has no return statement the compiler can follow to an h() call`,
      );
      return null;
    }

    return {
      functionName,
      returnNode,
      filePath: lookup.filePath,
      source: lookup.source,
    };
  }

  // -------------------------------------------------------------------------
  // Task 7: File-level Constant Extraction
  // -------------------------------------------------------------------------

  /**
   * Unwrap `export const X = ...` to its inner VariableDeclaration; pass
   * bare VariableDeclarations through unchanged. Module-level extraction
   * must see exported constants the same as unexported ones — iterating
   * program.body naively only yields the ExportNamedDeclaration wrapper.
   */
  private static asVariableDeclaration(node: T.Node): T.VariableDeclaration | null {
    if (t.isVariableDeclaration(node)) return node;
    if (
      t.isExportNamedDeclaration(node)
      && node.declaration
      && t.isVariableDeclaration(node.declaration)
    ) {
      return node.declaration;
    }
    return null;
  }

  /**
   * Extract top-level `const NAME = [{ ... }, ...]` declarations
   * (including `export const`). Only handles arrays of object literals
   * with primitive values.
   *
   * Returns a Map from constant name to the evaluated array.
   */
  extractFileConstants(source: string, filename: string): Map<string, any[]> {
    const ast = parse(source, PARSE_OPTS);
    const constants = new Map<string, any[]>();

    for (const stmt of ast.program.body) {
      // Only top-level const declarations (export-wrapped or bare)
      const node = ComponentAnalyzer.asVariableDeclaration(stmt);
      if (!node || node.kind !== 'const') continue;

      for (const decl of node.declarations) {
        if (!t.isIdentifier(decl.id) || !decl.init) continue;

        // Must be an array expression
        if (!t.isArrayExpression(decl.init)) continue;

        const arr = this.evaluateArrayExpression(decl.init);
        if (arr !== null) {
          constants.set(decl.id.name, arr);
        }
      }
    }

    return constants;
  }

  /**
   * Extract top-level `const NAME = <expr>` declarations (including
   * `export const`) whose initializer folds statically to a string: string
   * literals, no-expression template literals, `+` concatenation chains, and
   * references to string constants declared earlier in the same file (folded
   * in declaration order).
   *
   * Only `const` declarations are captured — `let`/`var` may be reassigned
   * at runtime, so they cannot be treated as static.
   *
   * Names that are ALSO declared in any nested (function/block) scope are
   * dropped again — see the shadowing note below.
   *
   * Returns a Map from constant name to the folded string value.
   */
  extractStringConstants(source: string, filename: string): Map<string, string> {
    const ast = parse(source, PARSE_OPTS);
    const constants = new Map<string, string>();

    for (const stmt of ast.program.body) {
      // Only top-level const declarations (never let/var; export-wrapped or bare)
      const node = ComponentAnalyzer.asVariableDeclaration(stmt);
      if (!node || node.kind !== 'const') continue;

      for (const decl of node.declarations) {
        if (!t.isIdentifier(decl.id) || !decl.init) continue;

        const folded = this.foldStringExpression(decl.init, constants);
        if (folded === null) continue;

        // FMIR string-table entries carry a u16 byte-length prefix, so a
        // folded constant over 65535 UTF-8 bytes can never be encoded (see
        // encodeStringTable in ir-emit.ts). Drop it here — attribute uses
        // fall through to the DYN_ATTR warn path instead of hard-failing
        // the whole IR emission at encode time.
        const byteLength = new TextEncoder().encode(folded).length;
        if (byteLength > 0xffff) {
          console.warn(
            `   IR: const '${decl.id.name}' in ${filename} folds to a ${byteLength}-byte string — exceeds the 65535-byte FMIR string limit, not folding it`,
          );
          continue;
        }

        constants.set(decl.id.name, folded);
      }
    }

    // Shadowing guard (F10 hazard): if a nested scope re-declares a name we
    // folded (module `const cls = 'icon'` + component-local
    // `const cls = computeClass()`), folding would bake the MODULE value
    // into a static attribute with NO slot — unrecoverable client-side,
    // strictly worse than the old empty-DYN_ATTR behavior, which was at
    // least correctable at runtime. The walk has no scope tracking, so be
    // conservative: delete any folded name that is also declared (variable
    // or parameter) in ANY nested scope, even an unrelated one. Rare and
    // over-conservative, but safe — shadowed names then hit the existing
    // unresolvable-identifier warn path.
    if (constants.size > 0) {
      const deleteBindings = (idNode: T.Node) => {
        for (const name of Object.keys(t.getBindingIdentifiers(idNode))) {
          constants.delete(name);
        }
      };
      traverse(ast, {
        VariableDeclarator(path) {
          // Skip module top-level declarations — those ARE the folded consts.
          const declaration = path.parentPath;
          const container = declaration.parentPath;
          if (!container) return;
          if (t.isProgram(container.node)) return;
          if (
            t.isExportNamedDeclaration(container.node)
            && container.parentPath
            && t.isProgram(container.parentPath.node)
          ) {
            return;
          }
          deleteBindings(path.node.id);
        },
        Function(path) {
          for (const param of path.node.params) deleteBindings(param);
        },
        CatchClause(path) {
          if (path.node.param) deleteBindings(path.node.param);
        },
      });
    }

    return constants;
  }

  /**
   * Fold an expression to a string using constants already folded earlier
   * in the same file. Returns null if the expression cannot be folded
   * (non-string values are dropped — only string results are kept).
   */
  private foldStringExpression(
    node: T.Node,
    known: Map<string, string>,
  ): string | null {
    if (t.isStringLiteral(node)) return node.value;

    // Template literal with no expressions: `foo`
    if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
      return node.quasis.map(q => q.value.cooked ?? q.value.raw).join('');
    }

    // Reference to a const folded earlier in the same file
    if (t.isIdentifier(node)) {
      return known.get(node.name) ?? null;
    }

    // Binary +: left + right (string concatenation chains)
    if (t.isBinaryExpression(node) && node.operator === '+') {
      const left = this.foldStringExpression(node.left, known);
      const right = this.foldStringExpression(node.right, known);
      if (left === null || right === null) return null;
      return left + right;
    }

    if (t.isParenthesizedExpression(node)) {
      return this.foldStringExpression(node.expression, known);
    }

    return null;
  }

  /**
   * Evaluate an ArrayExpression of ObjectExpressions with primitive values.
   * Returns null if any element cannot be statically evaluated.
   */
  private evaluateArrayExpression(node: T.ArrayExpression): any[] | null {
    const result: any[] = [];

    for (const element of node.elements) {
      if (!element || t.isSpreadElement(element)) return null;

      if (t.isObjectExpression(element)) {
        const obj = this.evaluateObjectExpression(element);
        if (obj === null) return null;
        result.push(obj);
      } else {
        // Non-object elements are not supported
        return null;
      }
    }

    return result;
  }

  /**
   * Evaluate an ObjectExpression with only primitive (string/number/boolean) values.
   * Returns null if any property cannot be statically evaluated.
   */
  private evaluateObjectExpression(
    node: T.ObjectExpression,
  ): Record<string, any> | null {
    const obj: Record<string, any> = {};

    for (const prop of node.properties) {
      if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) return null;
      if (prop.computed) return null;

      // Extract key
      let key: string | null = null;
      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      } else if (t.isStringLiteral(prop.key)) {
        key = prop.key.value;
      }
      if (key === null) return null;

      // Extract value — must be a primitive literal
      const val = prop.value;
      if (t.isStringLiteral(val)) {
        obj[key] = val.value;
      } else if (t.isNumericLiteral(val)) {
        obj[key] = val.value;
      } else if (t.isBooleanLiteral(val)) {
        obj[key] = val.value;
      } else {
        // Non-primitive value, bail
        return null;
      }
    }

    return obj;
  }

  // -------------------------------------------------------------------------
  // Task 8: Signal Initial Value Detection
  // -------------------------------------------------------------------------

  /**
   * Find `const [name, setName] = createSignal(initialValue)` patterns
   * inside the function a module exports under `functionName`.
   *
   * Returns a Map from signal name to its default info.
   */
  extractSignalDefaults(
    source: string,
    filename: string,
    functionName: string,
    options: AnalyzerLookupOptions = {},
  ): Map<string, SignalDefault> {
    const signals = new Map<string, SignalDefault>();
    const body = this.findExportedFunctionBody(source, filename, functionName, options);
    if (body) this.collectSignalDefaults(body.body, signals, filename);
    return signals;
  }

  /**
   * Find `const [name, setName] = createSignal(initialValue)` patterns in an
   * entry point that mounts inline: `mount(() => { … }, '#app')`.
   *
   * There is no exported component to look inside, so the component's scope is
   * the module's top level plus the mount callback's own body — both are
   * collected. Asking for an exported function instead (the old code asked for
   * one literally named `__inline__`) could only ever come back empty, and an
   * inline-mount page therefore got ZERO named signal slots.
   * Verified by: packages/compiler/tests/component-analyzer.test.ts > "collects module-scope and mount-callback signals for an inline mount"
   *
   * Returns a Map from signal name to its default info.
   */
  extractInlineMountSignalDefaults(
    source: string,
    filename: string,
  ): Map<string, SignalDefault> {
    const ast = parse(source, PARSE_OPTS);
    const signals = new Map<string, SignalDefault>();

    this.collectSignalDefaults(ast.program.body, signals, filename);

    const self = this;
    traverse(ast, {
      CallExpression(path) {
        if (!t.isIdentifier(path.node.callee) || path.node.callee.name !== 'mount') return;
        const firstArg = path.node.arguments[0];
        if (
          firstArg
          && t.isArrowFunctionExpression(firstArg)
          && t.isBlockStatement(firstArg.body)
        ) {
          self.collectSignalDefaults(firstArg.body.body, signals, filename);
        }
        path.stop();
      },
    });

    return signals;
  }

  /**
   * Find `const [name, setName] = createSignal(initialValue)` patterns
   * in an ISLAND component file.
   *
   * Unlike extractSignalDefaults, this covers BOTH:
   * (a) module top-level declarations (island files typically declare their
   *     signals at module scope so the Page twin can single-source defaults),
   * (b) the top-level statements of the exported function named componentName.
   *
   * Returns a Map from signal name to its default info.
   */
  extractIslandSignalDefaults(
    source: string,
    filename: string,
    componentName: string,
    options: AnalyzerLookupOptions = {},
  ): Map<string, SignalDefault> {
    const ast = parse(source, PARSE_OPTS);
    const signals = new Map<string, SignalDefault>();

    // (a) Module top-level createSignal declarations of the file we were
    //     pointed at.
    this.collectSignalDefaults(ast.program.body, signals, filename);

    const lookup = resolveExportedFunction(source, filename, componentName, {
      loadModule: options.loadModule,
      allowLocal: false,
      allowNested: false,
    });
    if (lookup.kind === 'unresolved') {
      options.onUnresolved?.(lookup.detail);
      return signals;
    }

    // (b) When a barrel forwarded the export, the island's code — and its
    //     module-scope signals — live in ANOTHER file. Reading only the
    //     barrel's module scope would find nothing there.
    if (lookup.filePath !== filename) {
      this.collectSignalDefaults(lookup.ast.program.body, signals, lookup.filePath);
    }

    // (c) Top-level statements of the component function itself.
    if (t.isBlockStatement(lookup.fn.body)) {
      this.collectSignalDefaults(lookup.fn.body.body, signals, lookup.filePath);
    }

    return signals;
  }

  /**
   * Body of the function a module exports under `functionName`, through the
   * one shared export resolver — so a `.tsx` island, whose
   * `export function Counter()` esbuild has rewritten to `export { Counter }`,
   * is read the same as its `.ts` twin.
   *
   * This was the SILENT instance of the export-form defect: byte-identical
   * `.ts` and `.tsx` islands produced different IR (named slot `hits` with its
   * default vs. anonymous `text:0` with none) and neither build said a word.
   * Failing to find the body now reports why.
   * Verified by: packages/compiler/tests/component-analyzer.test.ts > "reads a .tsx island's in-function signal through the esbuild specifier shape"
   */
  private findExportedFunctionBody(
    source: string,
    filename: string,
    functionName: string,
    options: AnalyzerLookupOptions,
  ): T.BlockStatement | null {
    const lookup = resolveExportedFunction(source, filename, functionName, {
      loadModule: options.loadModule,
      allowLocal: false,
      allowNested: false,
    });

    if (lookup.kind === 'unresolved') {
      options.onUnresolved?.(lookup.detail);
      return null;
    }

    if (!t.isBlockStatement(lookup.fn.body)) {
      // An expression-bodied arrow declares no signals — nothing to report.
      return null;
    }

    return lookup.fn.body;
  }

  /**
   * Scan a statement list for `const [name, setName] = createSignal(literal)`
   * declarations (including `export const` at module level) and record their
   * defaults into the given map.
   *
   * A signal whose initial value is not a string/number/boolean/null literal
   * cannot be given an SSR default, so it gets NO named slot — every binding to
   * it falls back to an anonymous `text:<n>`/`attr:<key>` slot and can no
   * longer be addressed by name for server-side injection. That used to happen
   * in silence; it now warns, because the consequence (a slot key that quietly
   * does not exist) is invisible until injection fails at runtime.
   * Verified by: packages/compiler/tests/ir-diagnostics.test.ts > "warns that a non-literal signal default gets no named slot"
   */
  private collectSignalDefaults(
    statements: T.Statement[],
    signals: Map<string, SignalDefault>,
    filename?: string,
  ): void {
    for (const stmt of statements) {
      const decl = ComponentAnalyzer.asVariableDeclaration(stmt);
      if (!decl) continue;

      for (const varDecl of decl.declarations) {
        // Must be array destructuring: const [name, setName] = ...
        if (!t.isArrayPattern(varDecl.id)) continue;
        if (!varDecl.init) continue;

        // Must be a createSignal(...) call
        if (
          !t.isCallExpression(varDecl.init) ||
          !t.isIdentifier(varDecl.init.callee) ||
          varDecl.init.callee.name !== 'createSignal'
        ) {
          continue;
        }

        // Extract signal name from first element of array pattern
        const elements = varDecl.id.elements;
        if (elements.length < 1 || !elements[0] || !t.isIdentifier(elements[0])) {
          continue;
        }
        const signalName = elements[0].name;

        // Extract initial value from first argument
        const initArgs = varDecl.init.arguments;
        if (initArgs.length < 1) continue;

        const initArg = initArgs[0];
        if (!initArg || t.isSpreadElement(initArg)) continue;

        const signalDefault = this.evaluateSignalDefault(initArg as T.Expression);
        if (signalDefault) {
          signals.set(signalName, signalDefault);
        } else {
          console.warn(
            `   IR: signal '${signalName}'${filename ? ` in ${filename}` : ''} is initialized with a ${(initArg as T.Expression).type} the compiler cannot evaluate — it gets no named slot, so bindings to it land in anonymous 'text:'/'attr:' slots and cannot be injected by name; initialize it with a string, number, boolean or null literal to get one`,
          );
        }
      }
    }
  }

  /**
   * Evaluate a signal's initial value expression to a SignalDefault.
   * Supports: string, number, boolean, null literals.
   */
  private evaluateSignalDefault(node: T.Expression): SignalDefault | null {
    if (t.isStringLiteral(node)) {
      return { type: 'text', default: node.value };
    }
    if (t.isNumericLiteral(node)) {
      return { type: 'number', default: node.value };
    }
    if (t.isBooleanLiteral(node)) {
      return { type: 'bool', default: node.value };
    }
    if (t.isNullLiteral(node)) {
      return { type: 'null', default: null };
    }
    // Unsupported expression type
    return null;
  }
}
