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
  /** For inline mount returns: the AST node of the return expression.
   *  When set, componentName is '__inline__' and importPath is ''. */
  inlineReturnNode?: import('@babel/types').Expression;
}

export interface ComponentInfo {
  /** The name of the exported function. */
  functionName: string;
  /** The AST Expression node from the function's return statement. */
  returnNode: T.Expression;
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

    // Step 1: Collect import mappings: localName -> importPath
    const importMap = new Map<string, string>();
    for (const node of ast.program.body) {
      if (t.isImportDeclaration(node)) {
        const importPath = node.source.value;
        for (const spec of node.specifiers) {
          importMap.set(spec.local.name, importPath);
        }
      }
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
            if (importPath) {
              result = { componentName, importPath };
              path.stop();
            }
          }
        }

        // Pattern 2: mount(Component, '#app') — direct reference
        if (!result && t.isIdentifier(firstArg)) {
          const componentName = firstArg.name;
          const importPath = importMap.get(componentName);
          if (importPath) {
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
      },
    });

    if (result) {
      (result as EntryPointInfo).importMap = importMap;
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
   * Parse a component file and find the named export function.
   * Extracts the return statement's expression (the h() call tree AST node).
   *
   * Returns the function name and return node, or null if not found.
   */
  parseComponentFile(
    source: string,
    filename: string,
    functionName: string,
  ): ComponentInfo | null {
    const ast = parse(source, PARSE_OPTS);

    let returnNode: T.Expression | null = null;

    traverse(ast, {
      // Match: export function ComponentName() { ... return h(...); }
      ExportNamedDeclaration(path) {
        const decl = path.node.declaration;

        // Case 1: export function Name() { ... }
        if (t.isFunctionDeclaration(decl) && decl.id?.name === functionName) {
          // Walk the function body for return statements
          const funcPath = path.get('declaration') as any;
          funcPath.traverse({
            ReturnStatement(retPath: any) {
              if (retPath.node.argument) {
                returnNode = retPath.node.argument;
                retPath.stop();
              }
            },
            // Don't descend into nested functions
            FunctionDeclaration(p: any) { p.skip(); },
            FunctionExpression(p: any) { p.skip(); },
            ArrowFunctionExpression(p: any) { p.skip(); },
          });
          path.stop();
          return;
        }

        // Case 2: export const Name = function() { ... }
        // or:     export const Name = () => { ... }
        if (t.isVariableDeclaration(decl)) {
          for (const declarator of decl.declarations) {
            if (
              t.isIdentifier(declarator.id) &&
              declarator.id.name === functionName &&
              declarator.init
            ) {
              const init = declarator.init;

              // Arrow with expression body: export const Name = () => h(...)
              if (t.isArrowFunctionExpression(init) && !t.isBlockStatement(init.body)) {
                returnNode = init.body;
                path.stop();
                return;
              }

              // Arrow/function with block body
              if (
                (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) &&
                t.isBlockStatement(init.body)
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

    return { functionName, returnNode };
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
   * inside a named exported function.
   *
   * Returns a Map from signal name to its default info.
   */
  extractSignalDefaults(
    source: string,
    filename: string,
    functionName: string,
  ): Map<string, SignalDefault> {
    const ast = parse(source, PARSE_OPTS);
    const signals = new Map<string, SignalDefault>();

    // Capture reference for use inside traverse callback
    const self = this;

    // Find the target function
    traverse(ast, {
      ExportNamedDeclaration(path) {
        const funcBody = self.findExportedFunctionBody(path.node, functionName);
        if (!funcBody) return;

        // Walk the function body for createSignal calls
        self.collectSignalDefaults(funcBody.body, signals);

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
  ): Map<string, SignalDefault> {
    const ast = parse(source, PARSE_OPTS);
    const signals = new Map<string, SignalDefault>();

    // (a) Module top-level createSignal declarations
    this.collectSignalDefaults(ast.program.body, signals);

    // (b) Top-level statements of the exported component function
    const self = this;
    traverse(ast, {
      ExportNamedDeclaration(path) {
        const funcBody = self.findExportedFunctionBody(path.node, componentName);
        if (!funcBody) return;

        self.collectSignalDefaults(funcBody.body, signals);

        path.stop();
      },
    });

    return signals;
  }

  /**
   * Match an ExportNamedDeclaration against a function name and return its
   * block body. Handles `export function Name() {}`, `export const Name =
   * () => {}`, and `export const Name = function() {}`.
   */
  private findExportedFunctionBody(
    node: T.ExportNamedDeclaration,
    functionName: string,
  ): T.BlockStatement | null {
    const decl = node.declaration;

    // export function Name() { ... }
    if (t.isFunctionDeclaration(decl) && decl.id?.name === functionName) {
      return decl.body;
    }

    // export const Name = () => { ... } or export const Name = function() { ... }
    if (t.isVariableDeclaration(decl)) {
      for (const declarator of decl.declarations) {
        if (
          t.isIdentifier(declarator.id) &&
          declarator.id.name === functionName &&
          declarator.init
        ) {
          const init = declarator.init;
          if (
            (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) &&
            t.isBlockStatement(init.body)
          ) {
            return init.body;
          }
        }
      }
    }

    return null;
  }

  /**
   * Scan a statement list for `const [name, setName] = createSignal(literal)`
   * declarations (including `export const` at module level) and record their
   * defaults into the given map. Non-literal initializers are skipped.
   */
  private collectSignalDefaults(
    statements: T.Statement[],
    signals: Map<string, SignalDefault>,
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
