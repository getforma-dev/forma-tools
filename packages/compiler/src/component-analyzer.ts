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
  plugins: ['typescript' as const],
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
      },
    });

    if (result) return result;

    // Step 3: Fallback — activateIslands({ ... }) pattern.
    // Collect island component names from the registry object, then find
    // the Page component import that isn't an island.
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

    if (islandNames.size === 0) return null;

    // The SSR root is the imported component whose name ends with "Page"
    // and is NOT one of the island components in the registry.
    for (const [name, importPath] of importMap) {
      if (!islandNames.has(name) && name.endsWith('Page') && importPath.startsWith('.')) {
        return { componentName: name, importPath, islandNames };
      }
    }

    return null;
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
   * Extract top-level `const NAME = [{ ... }, ...]` declarations.
   * Only handles arrays of object literals with primitive values.
   *
   * Returns a Map from constant name to the evaluated array.
   */
  extractFileConstants(source: string, filename: string): Map<string, any[]> {
    const ast = parse(source, PARSE_OPTS);
    const constants = new Map<string, any[]>();

    for (const node of ast.program.body) {
      // Only top-level const declarations
      if (!t.isVariableDeclaration(node) || node.kind !== 'const') continue;

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
        const decl = path.node.declaration;

        let funcBody: T.BlockStatement | null = null;

        // export function Name() { ... }
        if (t.isFunctionDeclaration(decl) && decl.id?.name === functionName) {
          funcBody = decl.body;
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
                funcBody = init.body;
              }
            }
          }
        }

        if (!funcBody) return;

        // Walk the function body for createSignal calls
        for (const stmt of funcBody.body) {
          if (!t.isVariableDeclaration(stmt)) continue;

          for (const varDecl of stmt.declarations) {
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

            const signalDefault = self.evaluateSignalDefault(initArg as T.Expression);
            if (signalDefault) {
              signals.set(signalName, signalDefault);
            }
          }
        }

        path.stop();
      },
    });

    return signals;
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
