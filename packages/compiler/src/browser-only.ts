/**
 * Forma Compiler - The browser-only marker, `browserOnly()` (DR-1, L-1)
 *
 * `browserOnly(Component)` from @getforma/core wraps a component that renders
 * in the browser alone. The compiler emits it as a registered island whose
 * server output is its empty host element with its declared props; the
 * browser activates it like any island and renders the component there. One
 * name, so a search finds every use.
 *
 * This file answers one question: is the component a call names declared as
 * `const X = browserOnly(Impl)`? It follows the same edges the component
 * resolver follows (a relative import, `export { X }`, `export { X } from`,
 * `export *`, `export default`) and nothing else: a package is never read.
 *
 * It is asked only where the walker would otherwise give up on a component,
 * so it cannot change what a page that does not use the marker compiles to.
 * Verified by: packages/compiler/tests/browser-only.test.ts
 */

import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';

import { readImportBindings } from './export-resolver.js';
import type { ModuleLoader } from './module-loader.js';

const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};

/** The marker's name, as core exports it. */
export const BROWSER_ONLY = 'browserOnly';

/** Where a component was declared browser-only. */
export interface BrowserOnlyDeclaration {
  /** The file holding `const X = browserOnly(Impl)`. */
  file: string;
  /** The `browserOnly(Impl)` call. Its position is in `file`'s compiled text. */
  call: T.CallExpression;
}

/** `browserOnly(<one argument>)`, by name, as the compiler recognises core's API. */
export function isBrowserOnlyCall(node: T.Node | null | undefined): node is T.CallExpression {
  return (
    t.isCallExpression(node)
    && t.isIdentifier(node.callee)
    && node.callee.name === BROWSER_ONLY
    && node.arguments.length === 1
    && !t.isSpreadElement(node.arguments[0])
  );
}

/** Peel TypeScript's erased wrappers: `browserOnly(Impl) as Component`. */
function unwrapTs(node: T.Node | null | undefined): T.Node | null | undefined {
  let current = node;
  while (
    t.isTSAsExpression(current)
    || t.isTSSatisfiesExpression(current)
    || t.isTSNonNullExpression(current)
    || t.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** A top-level `const name = browserOnly(…)`, exported or not. */
function topLevelBrowserOnly(ast: T.File, name: string): T.CallExpression | null {
  for (const stmt of ast.program.body) {
    const node = t.isExportNamedDeclaration(stmt) && stmt.declaration ? stmt.declaration : stmt;
    if (!t.isVariableDeclaration(node)) continue;
    for (const declarator of node.declarations) {
      if (!t.isIdentifier(declarator.id) || declarator.id.name !== name) continue;
      const init = unwrapTs(declarator.init);
      if (isBrowserOnlyCall(init)) return init;
    }
  }
  return null;
}

export interface BrowserOnlyLookupOptions {
  /** Reads a file's source (JSX already transformed), or null. */
  sourceOf: (file: string) => string | null;
  /** Follows a relative import from a file. */
  loadModule: ModuleLoader;
}

/**
 * The browser-only declaration `name` refers to in `fromFile`: declared there,
 * or imported (through any chain of relative re-exports). Null when it is not
 * a `browserOnly()` declaration, or cannot be followed.
 */
export function findBrowserOnlyDeclaration(
  name: string,
  fromFile: string,
  options: BrowserOnlyLookupOptions,
): BrowserOnlyDeclaration | null {
  const source = options.sourceOf(fromFile);
  if (source === null) return null;
  const ast = parseOrNull(source);
  if (!ast) return null;

  const local = topLevelBrowserOnly(ast, name);
  if (local) return { file: fromFile, call: local };

  const binding = readImportBindings(ast).get(name);
  if (!binding || binding.kind === 'type' || binding.imported === '*') return null;
  const mod = options.loadModule(fromFile, binding.source);
  if (!mod) return null;
  return exported(mod.path, mod.source, binding.imported, options, new Set());
}

/** The browser-only declaration a module exports under `name`. */
function exported(
  file: string,
  source: string,
  name: string,
  options: BrowserOnlyLookupOptions,
  seen: Set<string>,
): BrowserOnlyDeclaration | null {
  const key = `${file}\u0000${name}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const ast = parseOrNull(source);
  if (!ast) return null;
  const imports = readImportBindings(ast);

  const follow = (fromFile: string, specifier: string, importedName: string) => {
    const mod = options.loadModule(fromFile, specifier);
    return mod ? exported(mod.path, mod.source, importedName, options, seen) : null;
  };
  /** A name bound in this file: declared here, or imported. */
  const bound = (localName: string): BrowserOnlyDeclaration | null => {
    const declared = topLevelBrowserOnly(ast, localName);
    if (declared) return { file, call: declared };
    const imported = imports.get(localName);
    if (!imported || imported.kind === 'type' || imported.imported === '*') return null;
    return follow(file, imported.source, imported.imported);
  };

  const stars: string[] = [];
  for (const stmt of ast.program.body) {
    if (t.isExportAllDeclaration(stmt)) {
      stars.push(stmt.source.value);
      continue;
    }
    if (t.isExportDefaultDeclaration(stmt)) {
      if (name !== 'default') continue;
      const decl = unwrapTs(stmt.declaration);
      if (isBrowserOnlyCall(decl)) return { file, call: decl };
      if (t.isIdentifier(decl)) return bound(decl.name);
      continue;
    }
    if (!t.isExportNamedDeclaration(stmt)) continue;
    if (stmt.declaration) {
      const declared = topLevelBrowserOnly(ast, name);
      if (declared && t.isVariableDeclaration(stmt.declaration)
        && stmt.declaration.declarations.some((d) => t.isIdentifier(d.id) && d.id.name === name)) {
        return { file, call: declared };
      }
      continue;
    }
    for (const spec of stmt.specifiers) {
      if (!t.isExportSpecifier(spec)) continue;
      const exportedName = t.isIdentifier(spec.exported) ? spec.exported.name : spec.exported.value;
      if (exportedName !== name) continue;
      return stmt.source ? follow(file, stmt.source.value, spec.local.name) : bound(spec.local.name);
    }
  }
  if (name !== 'default') {
    for (const specifier of stars) {
      const found = follow(file, specifier, name);
      if (found) return found;
    }
  }
  return null;
}

function parseOrNull(source: string): T.File | null {
  try {
    return parse(source, PARSE_OPTS) as unknown as T.File;
  } catch {
    return null;
  }
}
