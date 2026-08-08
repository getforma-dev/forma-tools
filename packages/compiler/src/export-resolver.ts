/**
 * Forma Compiler - Export Resolver
 *
 * ONE place that answers "which function does this module export under this
 * name?". Three copies of that question used to exist — `parseComponentFile`
 * and `findExportedFunctionBody` in component-analyzer.ts and
 * `resolveSubComponent` in ir-walk.ts — and they did not agree, so the same
 * component was inlined from one call site and dropped from another.
 *
 * The forms it must handle are not exotic: esbuild rewrites EVERY
 * `export function Card() {}` in a .tsx file into
 *
 *     function Card() { ... }
 *     export { Card };
 *
 * so an analyzer that only reads `ExportNamedDeclaration.declaration` sees
 * nothing at all in a JSX project. That is the shape a real build feeds this
 * compiler, and it used to be the one shape none of the three copies handled.
 *
 * When a form genuinely cannot be followed, the result carries a `detail`
 * naming the FILE and the CONSTRUCT so the caller can warn with a real cause
 * instead of a guess. Silently returning null is the failure mode this module
 * exists to end.
 */

import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';

import type { ModuleLoader } from './module-loader';

const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};

/** The node shapes a Forma component can be declared as. */
export type ComponentFunction =
  | T.FunctionDeclaration
  | T.FunctionExpression
  | T.ArrowFunctionExpression;

export interface ResolvedExport {
  kind: 'found';
  /** The function node the name resolves to. */
  fn: ComponentFunction;
  /** File the function is DECLARED in — not necessarily the file asked about:
   *  a barrel forwards to another module, and constants/imports must then be
   *  read from the module that actually holds the code. */
  filePath: string;
  /** Source of `filePath`, already JSX-transformed by the module loader. */
  source: string;
  /** Parsed AST of `source`, so callers do not re-parse it. */
  ast: T.File;
}

export interface UnresolvedExport {
  kind: 'unresolved';
  /** Human-readable cause naming the file and the construct. Never empty. */
  detail: string;
}

export type ExportLookup = ResolvedExport | UnresolvedExport;

export interface ResolveExportOptions {
  /** Follows `export … from './x'` and `export * from './x'` across files.
   *  Without it those forms resolve to an `unresolved` result that says so. */
  loadModule?: ModuleLoader;
  /**
   * Accept a top-level declaration that is NOT exported.
   *
   * True for sub-component resolution, where a file-local `function Sidebar()`
   * called from the same file is perfectly valid. False when the name arrived
   * through an `import` — a non-exported binding is not importable, and
   * inlining it would render server-side HTML for code the client cannot run.
   */
  allowLocal?: boolean;
  /**
   * Accept a declaration nested inside another function (a helper declared
   * inside the mount callback, say), but only when the whole file declares
   * that name exactly ONCE. Two same-named helpers in different scopes are
   * reported as ambiguous rather than guessed at.
   */
  allowNested?: boolean;
}

/** The binding name a module exports something under, for `import` sites. */
export interface ImportBinding {
  /** The module specifier, verbatim. */
  source: string;
  /** Name in the TARGET module: the imported name, or 'default', or '*'. */
  imported: string;
  /** 'type' when the binding is erased at runtime (`import type { X }` or an
   *  inline `{ type X }` specifier). A type-only binding can never be a
   *  signal, a component, or a constant table — resolvers must not chase it. */
  kind: 'value' | 'type';
}

/**
 * Map every import binding in a file: local name -> what it refers to in the
 * module it came from. `import { CardImpl as Card }` binds local `Card` to
 * exported name `CardImpl`; looking up `Card` in the target file would find
 * nothing.
 */
export function readImportBindings(ast: T.File): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    const source = node.source.value;
    const declKind: 'value' | 'type' = node.importKind === 'type' ? 'type' : 'value';
    for (const spec of node.specifiers) {
      let imported = spec.local.name;
      let kind = declKind;
      if (t.isImportDefaultSpecifier(spec)) {
        imported = 'default';
      } else if (t.isImportNamespaceSpecifier(spec)) {
        imported = '*';
      } else if (t.isImportSpecifier(spec)) {
        imported = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
        if (spec.importKind === 'type') kind = 'type';
      }
      bindings.set(spec.local.name, { source, imported, kind });
    }
  }
  return bindings;
}

/**
 * Resolve `name` as exported by the module whose text is `source`.
 *
 * Handles, in this order: `export function/const` declarations, export
 * SPECIFIERS (`export { X }`, `export { XImpl as X }`, including the shape
 * esbuild emits for every .tsx file), specifiers that forward an imported
 * binding, cross-file re-exports (`export { X } from './x'`), `export default`,
 * an optional non-exported top-level declaration, `export * from './x'`
 * barrels, and an optional nested declaration.
 *
 * Verified by: packages/compiler/tests/export-resolver.test.ts
 */
export function resolveExportedFunction(
  source: string,
  filePath: string,
  name: string,
  options: ResolveExportOptions = {},
): ExportLookup {
  return lookup(source, filePath, name, options, new Set());
}

function unresolved(detail: string): UnresolvedExport {
  return { kind: 'unresolved', detail };
}

/** A module reached by following one import/re-export edge, or why it wasn't. */
type ModuleEdge = { kind: 'module'; path: string; source: string } | UnresolvedExport;

/**
 * Follow ONE import or re-export edge to the module it names.
 *
 * The rules on that edge — a module loader is required, only relative
 * specifiers are followed (the compiler never reads package code), and a
 * specifier that names no readable file is a diagnosable failure rather than a
 * silent null — are the same whether the name being chased is a component
 * FUNCTION or a module-level constant TABLE. They live here once so the two
 * cannot answer "can this import be followed?" differently, and so there is
 * exactly one place that knows how to phrase the answer.
 * Verified by: packages/compiler/tests/export-resolver.test.ts > "reports a constant imported from a package as unfollowable"
 */
function loadEdge(
  loadModule: ModuleLoader | undefined,
  name: string,
  filePath: string,
  importPath: string,
): ModuleEdge {
  if (!loadModule) {
    return unresolved(
      `'${name}' in ${filePath} is re-exported from '${importPath}'; this resolver was given no module loader, so the re-export cannot be followed`,
    );
  }
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return unresolved(
      `'${name}' in ${filePath} comes from the package import '${importPath}' — the compiler follows relative imports only, so it never reads package code`,
    );
  }
  const mod = loadModule(filePath, importPath);
  if (!mod) {
    return unresolved(
      `'${name}' in ${filePath} is re-exported from '${importPath}', which does not resolve to a readable file on disk`,
    );
  }
  return { kind: 'module', path: mod.path, source: mod.source };
}

function isComponentFunction(node: T.Node | null | undefined): node is ComponentFunction {
  return (
    t.isFunctionDeclaration(node)
    || t.isFunctionExpression(node)
    || t.isArrowFunctionExpression(node)
  );
}

function lookup(
  source: string,
  filePath: string,
  name: string,
  options: ResolveExportOptions,
  seen: Set<string>,
): ExportLookup {
  const key = `${filePath}\u0000${name}`;
  if (seen.has(key)) {
    return unresolved(
      `'${name}' in ${filePath} is re-exported in a cycle — the compiler stopped following it`,
    );
  }
  seen.add(key);

  let ast: T.File;
  try {
    ast = parse(source, PARSE_OPTS) as unknown as T.File;
  } catch (err) {
    return unresolved(`${filePath} could not be parsed (${(err as Error).message})`);
  }

  const imports = readImportBindings(ast);
  const starSources: string[] = [];
  let defaultDecl: T.ExportDefaultDeclaration | null = null;
  /** Best explanation found so far for why a MATCHING name is not usable. */
  let blocked: string | null = null;

  const found = (fn: ComponentFunction): ResolvedExport => ({
    kind: 'found', fn, filePath, source, ast,
  });

  const follow = (importPath: string, importedName: string): ExportLookup => {
    const edge = loadEdge(options.loadModule, name, filePath, importPath);
    if (edge.kind !== 'module') return edge;
    return lookup(edge.source, edge.path, importedName, options, seen);
  };

  // --- Explicit exports in this file --------------------------------------
  for (const stmt of ast.program.body) {
    if (t.isExportDefaultDeclaration(stmt)) {
      defaultDecl = stmt;
      continue;
    }
    if (t.isExportAllDeclaration(stmt)) {
      starSources.push(stmt.source.value);
      continue;
    }
    if (!t.isExportNamedDeclaration(stmt)) continue;

    // export function Name() {} / export const Name = () => {}
    if (stmt.declaration) {
      const direct = declaredFunction(stmt.declaration, name);
      if (direct.fn) return found(direct.fn);
      if (direct.blocked) blocked = direct.blocked(filePath);
      continue;
    }

    // export { Name }, export { Impl as Name }, export { Name } from './x'
    for (const spec of stmt.specifiers) {
      if (!t.isExportSpecifier(spec)) {
        // export * as NS from './x' — a namespace object, not a function.
        if (t.isExportNamespaceSpecifier(spec) && spec.exported.name === name) {
          blocked = `'${name}' in ${filePath} is a namespace re-export (\`export * as ${name} from …\`), which is an object, not a component function`;
        }
        continue;
      }
      const exportedName = t.isIdentifier(spec.exported)
        ? spec.exported.name
        : spec.exported.value;
      if (exportedName !== name) continue;

      const local = spec.local.name;

      if (stmt.source) {
        return follow(stmt.source.value, local);
      }

      // Local binding: a declaration in this file, or something imported.
      const localFn = topLevelFunction(ast, local);
      if (localFn) return found(localFn);

      const imported = imports.get(local);
      if (imported) {
        if (imported.imported === '*') {
          blocked = `'${name}' in ${filePath} is exported from a namespace import ('${imported.source}'), which is an object, not a component function`;
          continue;
        }
        return follow(imported.source, imported.imported);
      }

      const alias = local === name ? '' : ` (\`export { ${local} as ${name} }\`)`;
      blocked = `'${name}' in ${filePath}${alias} resolves to '${local}', which is not a function declared or imported in that file`;
    }
  }

  // --- export default -----------------------------------------------------
  const defaultTarget = name === 'default'
    // The import site said `import X from './x'`, so the default IS the answer.
    || (defaultDecl !== null
      && isComponentFunction(defaultDecl.declaration)
      // Otherwise only accept a default whose function is literally named
      // `name`: `export default function Card() {}` asked for 'Card'. Anything
      // looser would silently inline the WRONG component.
      && functionName(defaultDecl.declaration as ComponentFunction) === name);

  if (defaultDecl && defaultTarget) {
    const decl = defaultDecl.declaration;
    if (isComponentFunction(decl)) return found(decl);
    if (t.isIdentifier(decl)) {
      const localFn = topLevelFunction(ast, decl.name);
      if (localFn) return found(localFn);
      const imported = imports.get(decl.name);
      if (imported && imported.imported !== '*') {
        return follow(imported.source, imported.imported);
      }
    }
    blocked = `the default export of ${filePath} is a ${decl.type}, not a function the compiler can follow`;
  }

  // --- Non-exported top-level declaration ---------------------------------
  // esbuild's rewrite is already covered by the specifier branch above; this
  // is for file-local helpers called from within the same module.
  if (options.allowLocal) {
    const localFn = topLevelFunction(ast, name);
    if (localFn) return found(localFn);
  }

  // --- export * from './x' barrels ----------------------------------------
  // `export *` never forwards a default export, so skip it for that name.
  if (name !== 'default') {
    for (const importPath of starSources) {
      const result = follow(importPath, name);
      if (result.kind === 'found') return result;
    }
  }

  // --- Nested declaration (helper inside another function) ----------------
  if (options.allowNested) {
    const nested = nestedFunctions(ast, name);
    if (nested.length === 1) return found(nested[0]!);
    if (nested.length > 1) {
      blocked = `'${name}' in ${filePath} is declared ${nested.length} times in different scopes — the compiler cannot tell which one the call refers to`;
    }
  }

  if (blocked) return unresolved(blocked);

  if (starSources.length > 0) {
    return unresolved(
      `no export named '${name}' in ${filePath}; it re-exports ${starSources.map(s => `'${s}'`).join(', ')} with \`export *\`, and '${name}' was not found there either`,
    );
  }

  return unresolved(`no export named '${name}' in ${filePath} that the compiler can follow to a function`);
}

/**
 * Match a declaration statement against a name. Returns the function when it
 * matches AND is a function; a `blocked` explanation when the name matches but
 * the value is not a function (a component the compiler cannot inline is a
 * different problem from a missing one, and must not be reported as missing).
 */
function declaredFunction(
  decl: T.Declaration,
  name: string,
): { fn?: ComponentFunction; blocked?: (file: string) => string } {
  if (t.isFunctionDeclaration(decl) && decl.id?.name === name) {
    return { fn: decl };
  }
  if (t.isVariableDeclaration(decl)) {
    for (const declarator of decl.declarations) {
      if (!t.isIdentifier(declarator.id) || declarator.id.name !== name) continue;
      if (isComponentFunction(declarator.init)) return { fn: declarator.init };
      const initType = declarator.init ? declarator.init.type : 'nothing';
      return {
        blocked: (file: string) =>
          `'${name}' in ${file} is exported as a ${initType}, not a function the compiler can follow`,
      };
    }
  }
  return {};
}

/**
 * Find a top-level declaration of `name` bound to a function, whether it is
 * export-wrapped or bare. Program scope only.
 */
/** The declared name of a function node, or undefined for an arrow/anonymous. */
function functionName(fn: ComponentFunction): string | undefined {
  if (t.isArrowFunctionExpression(fn)) return undefined;
  return fn.id?.name;
}

function topLevelFunction(ast: T.File, name: string): ComponentFunction | null {
  for (const stmt of ast.program.body) {
    const node = t.isExportNamedDeclaration(stmt) && stmt.declaration
      ? stmt.declaration
      : stmt;

    if (t.isFunctionDeclaration(node) && node.id?.name === name) return node;

    if (t.isVariableDeclaration(node)) {
      for (const declarator of node.declarations) {
        if (
          t.isIdentifier(declarator.id)
          && declarator.id.name === name
          && isComponentFunction(declarator.init)
        ) {
          return declarator.init;
        }
      }
    }
  }
  return null;
}

/**
 * Collect every function named `name` declared anywhere in the file OUTSIDE
 * program scope — a helper declared inside the mount callback, for instance.
 * Returns all of them so the caller can refuse to guess when there is more
 * than one.
 */
function nestedFunctions(ast: T.File, name: string): ComponentFunction[] {
  const hits: ComponentFunction[] = [];

  const visitNode = (node: T.Node | null | undefined, atProgramScope: boolean): void => {
    if (!node) return;

    if (t.isFunctionDeclaration(node)) {
      if (!atProgramScope && node.id?.name === name) hits.push(node);
      if (t.isBlockStatement(node.body)) visitStatements(node.body.body, false);
      return;
    }

    if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
      if (t.isBlockStatement(node.body)) visitStatements(node.body.body, false);
      else visitExpression(node.body, false);
      return;
    }
  };

  const visitExpression = (node: T.Node | null | undefined, atProgramScope: boolean): void => {
    if (!node) return;
    if (isComponentFunction(node)) return visitNode(node, atProgramScope);
    if (t.isCallExpression(node) || t.isNewExpression(node)) {
      visitExpression(node.callee as T.Node, atProgramScope);
      for (const arg of node.arguments) visitExpression(arg as T.Node, atProgramScope);
      return;
    }
    if (t.isObjectExpression(node)) {
      for (const prop of node.properties) {
        if (t.isObjectProperty(prop)) visitExpression(prop.value as T.Node, atProgramScope);
        else if (t.isObjectMethod(prop)) visitStatements(prop.body.body, false);
      }
      return;
    }
    if (t.isArrayExpression(node)) {
      for (const el of node.elements) visitExpression(el as T.Node, atProgramScope);
      return;
    }
    if (t.isConditionalExpression(node)) {
      visitExpression(node.test, atProgramScope);
      visitExpression(node.consequent, atProgramScope);
      visitExpression(node.alternate, atProgramScope);
      return;
    }
    if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
      visitExpression(node.left as T.Node, atProgramScope);
      visitExpression(node.right, atProgramScope);
    }
  };

  const visitStatements = (stmts: T.Statement[], atProgramScope: boolean): void => {
    for (const stmt of stmts) visitStatement(stmt, atProgramScope);
  };

  const visitStatement = (stmt: T.Statement | null | undefined, atProgramScope: boolean): void => {
    if (!stmt) return;

    if (t.isExportNamedDeclaration(stmt) && stmt.declaration) {
      return visitStatement(stmt.declaration as T.Statement, atProgramScope);
    }
    if (t.isExportDefaultDeclaration(stmt)) {
      return visitExpression(stmt.declaration as T.Node, atProgramScope);
    }
    if (t.isFunctionDeclaration(stmt)) return visitNode(stmt, atProgramScope);

    if (t.isVariableDeclaration(stmt)) {
      for (const declarator of stmt.declarations) {
        if (
          !atProgramScope
          && t.isIdentifier(declarator.id)
          && declarator.id.name === name
          && isComponentFunction(declarator.init)
        ) {
          hits.push(declarator.init);
        }
        visitExpression(declarator.init, atProgramScope);
      }
      return;
    }
    if (t.isExpressionStatement(stmt)) return visitExpression(stmt.expression, atProgramScope);
    if (t.isReturnStatement(stmt)) return visitExpression(stmt.argument, atProgramScope);
    if (t.isBlockStatement(stmt)) return visitStatements(stmt.body, false);
    if (t.isIfStatement(stmt)) {
      visitExpression(stmt.test, atProgramScope);
      visitStatement(stmt.consequent, false);
      visitStatement(stmt.alternate, false);
      return;
    }
    if (t.isTryStatement(stmt)) {
      visitStatement(stmt.block, false);
      if (stmt.handler) visitStatement(stmt.handler.body, false);
      visitStatement(stmt.finalizer, false);
      return;
    }
    if (
      t.isForStatement(stmt) || t.isForInStatement(stmt) || t.isForOfStatement(stmt)
      || t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt) || t.isLabeledStatement(stmt)
    ) {
      return visitStatement(stmt.body, false);
    }
    if (t.isSwitchStatement(stmt)) {
      for (const c of stmt.cases) visitStatements(c.consequent, false);
    }
  };

  visitStatements(ast.program.body, true);
  return hits;
}

// ---------------------------------------------------------------------------
// Constant tables (Rule 9's static spread unroll)
// ---------------------------------------------------------------------------

/** A module-level constant array the unroll can substitute rows from. */
export type ConstantTable = unknown[];

export interface ResolveConstantOptions {
  /** Follows `import`, `export … from './x'` and `export * from './x'` across
   *  files. Without it every cross-file form resolves to `unresolved`. */
  loadModule?: ModuleLoader;
  /**
   * Reads one module's top-level constant tables, keyed by declared name.
   *
   * Injected rather than imported because the rules for which array literals
   * are statically knowable belong to `ComponentAnalyzer.extractFileConstants`
   * — the one reader the unroll already trusts. Passing it in keeps this
   * module free of that dependency AND guarantees an imported table is judged
   * by exactly the same rules as a local one, which is the whole point: a
   * table that would not unroll in the file that uses it must not start
   * unrolling because it moved one file away.
   */
  readConstants: (source: string, filePath: string) => Map<string, ConstantTable>;
}

export type ConstantLookup =
  | { kind: 'found'; value: ConstantTable; filePath: string }
  /** The name is not imported into the asking file at all — the caller's own
   *  "unknown identifier" diagnostic is the right one, not one from here. */
  | { kind: 'not-imported' }
  | UnresolvedExport;

/**
 * Resolve `name` as a constant table IMPORTED into the module `ast` describes.
 *
 * This is the entry point for a use site: it reads the asking file's import
 * bindings (`import { KEYS as K }` must be looked up as 'KEYS' over there),
 * follows that one edge, and hands off to `resolveExportedConstant` in the
 * module the import names.
 *
 * The AST is passed in rather than re-parsed because the caller has already
 * parsed this module for its own scope analysis, and these files are large —
 * ksx's map island is 240 KB and asks this question 34 times.
 * Verified by: packages/compiler/tests/export-resolver.test.ts > "follows an aliased import to the table's declaring module"
 */
export function resolveImportedConstant(
  ast: T.File,
  filePath: string,
  name: string,
  options: ResolveConstantOptions,
): ConstantLookup {
  const binding = readImportBindings(ast).get(name);
  if (!binding) return { kind: 'not-imported' };

  if (binding.imported === '*') {
    return unresolved(
      `'${name}' in ${filePath} is a namespace import (\`import * as ${name} from '${binding.source}'\`), which is a module object, not an array the compiler can unroll`,
    );
  }
  if (binding.imported === 'default') {
    return unresolved(
      `'${name}' in ${filePath} is a DEFAULT import from '${binding.source}'; the compiler reads module-level constants by their declared name, so export the table as a named \`const\` instead`,
    );
  }

  const edge = loadEdge(options.loadModule, name, filePath, binding.source);
  if (edge.kind !== 'module') return edge;
  return resolveExportedConstant(edge.source, edge.path, binding.imported, options);
}

/**
 * Resolve `name` as a constant table EXPORTED by the module whose text is
 * `source`, following re-exports and `export *` barrels.
 *
 * Reaching this function means an `import` named the binding, so a top-level
 * `const` that is never exported does NOT satisfy it — the same rule
 * `resolveExportedFunction` applies through `allowLocal`. Inlining a table the
 * importing module cannot actually see would put rows into the server's HTML
 * that the client could never reproduce.
 * Verified by: packages/compiler/tests/export-resolver.test.ts > "refuses a table the declaring module never exports"
 */
export function resolveExportedConstant(
  source: string,
  filePath: string,
  name: string,
  options: ResolveConstantOptions,
): ConstantLookup {
  return constantLookup(source, filePath, name, options, new Set());
}

function constantLookup(
  source: string,
  filePath: string,
  name: string,
  options: ResolveConstantOptions,
  seen: Set<string>,
): ConstantLookup {
  // Same cycle guard, same key shape as the function lookup above. `a.ts`
  // re-exporting from `b.ts` which re-exports back terminates here with a
  // diagnosable result instead of recursing until the stack gives out.
  // Verified by: packages/compiler/tests/export-resolver.test.ts > "terminates on a re-export cycle instead of recursing"
  const key = `${filePath}\u0000${name}`;
  if (seen.has(key)) {
    return unresolved(
      `'${name}' in ${filePath} is re-exported in a cycle — the compiler stopped following it`,
    );
  }
  seen.add(key);

  let ast: T.File;
  try {
    ast = parse(source, PARSE_OPTS) as unknown as T.File;
  } catch (err) {
    return unresolved(`${filePath} could not be parsed (${(err as Error).message})`);
  }

  let tables: Map<string, ConstantTable>;
  try {
    tables = options.readConstants(source, filePath);
  } catch (err) {
    return unresolved(
      `the module-level constants of ${filePath} could not be read (${(err as Error).message})`,
    );
  }

  const imports = readImportBindings(ast);
  const starSources: string[] = [];
  /** Best explanation so far for why a MATCHING name is not usable. */
  let blocked: string | null = null;

  const follow = (importPath: string, importedName: string): ConstantLookup => {
    const edge = loadEdge(options.loadModule, name, filePath, importPath);
    if (edge.kind !== 'module') return edge;
    return constantLookup(edge.source, edge.path, importedName, options, seen);
  };

  /** The table `local` names in THIS module, or null if it declares none. */
  const localTable = (local: string): ConstantLookup | null => {
    const value = tables.get(local);
    return value ? { kind: 'found', value, filePath } : null;
  };

  for (const stmt of ast.program.body) {
    if (t.isExportAllDeclaration(stmt)) {
      starSources.push(stmt.source.value);
      continue;
    }
    if (!t.isExportNamedDeclaration(stmt)) continue;

    // export const KEYS = [ … ]
    if (stmt.declaration) {
      if (!t.isVariableDeclaration(stmt.declaration)) continue;
      for (const decl of stmt.declaration.declarations) {
        if (!t.isIdentifier(decl.id) || decl.id.name !== name) continue;
        const hit = localTable(name);
        if (hit) return hit;
        blocked = notStatic(name, filePath, stmt.declaration.kind, decl.init);
      }
      continue;
    }

    // export { KEYS }, export { RAW as KEYS }, export { KEYS } from './x'
    for (const spec of stmt.specifiers) {
      if (!t.isExportSpecifier(spec)) {
        if (t.isExportNamespaceSpecifier(spec) && spec.exported.name === name) {
          blocked = `'${name}' in ${filePath} is a namespace re-export (\`export * as ${name} from …\`), which is a module object, not an array the compiler can unroll`;
        }
        continue;
      }
      const exportedName = t.isIdentifier(spec.exported)
        ? spec.exported.name
        : spec.exported.value;
      if (exportedName !== name) continue;

      const local = spec.local.name;

      if (stmt.source) return follow(stmt.source.value, local);

      // The form ksx's map tables use: bare `const KEYS_LETTER = [ … ]` at the
      // top of MapPage.ts, `export { KEYS_LETTER, … }` at the bottom.
      const hit = localTable(local);
      if (hit) return hit;

      const imported = imports.get(local);
      if (imported) {
        if (imported.imported === '*') {
          blocked = `'${name}' in ${filePath} is exported from a namespace import ('${imported.source}'), which is a module object, not an array the compiler can unroll`;
          continue;
        }
        return follow(imported.source, imported.imported);
      }

      blocked = declaredButUnreadable(name, filePath, local, ast);
    }
  }

  // `export *` never forwards a default export — and it never has to be
  // skipped for that name here, because a DEFAULT import is refused at the use
  // site with a message that says to name the export instead.
  for (const importPath of starSources) {
    const result = follow(importPath, name);
    if (result.kind === 'found') return result;
  }

  if (blocked) return unresolved(blocked);

  if (tables.has(name)) {
    return unresolved(
      `'${name}' is declared in ${filePath} but never exported from it, so the import that named it does not resolve to that declaration`,
    );
  }

  if (starSources.length > 0) {
    return unresolved(
      `no export named '${name}' in ${filePath}; it re-exports ${starSources.map(s => `'${s}'`).join(', ')} with \`export *\`, and '${name}' was not found there either`,
    );
  }

  return unresolved(
    `no export named '${name}' in ${filePath} that the compiler can read as a module-level array of object literals`,
  );
}

/** The one sentence that says why a table the compiler FOUND is unusable. */
const NOT_STATIC_TAIL =
  'the compiler unrolls only a `const` bound to an array literal of object literals with string, number or boolean values';

function notStatic(
  name: string,
  filePath: string,
  kind: string,
  init: T.Expression | null | undefined,
): string {
  if (kind !== 'const') {
    return `'${name}' in ${filePath} is declared with \`${kind}\`, which can be reassigned at runtime — ${NOT_STATIC_TAIL}`;
  }
  const what = init ? `a ${init.type}` : 'nothing';
  return `'${name}' in ${filePath} is ${what} the compiler cannot evaluate statically — ${NOT_STATIC_TAIL}`;
}

/**
 * Why an `export { local as name }` that names a declaration in this file
 * still did not produce a table: either the declaration is not static, or
 * there is no such declaration at all.
 */
function declaredButUnreadable(
  name: string,
  filePath: string,
  local: string,
  ast: T.File,
): string {
  const alias = local === name ? '' : ` (\`export { ${local} as ${name} }\`)`;
  for (const stmt of ast.program.body) {
    const node = t.isExportNamedDeclaration(stmt) && stmt.declaration ? stmt.declaration : stmt;
    if (!t.isVariableDeclaration(node)) continue;
    for (const decl of node.declarations) {
      if (t.isIdentifier(decl.id) && decl.id.name === local) {
        return notStatic(name, filePath, node.kind, decl.init);
      }
    }
  }
  return `'${name}' in ${filePath}${alias} resolves to '${local}', which is not a module-level constant declared or imported in that file`;
}

// ---------------------------------------------------------------------------
// Signals declared in another module (imported signal defaults)
// ---------------------------------------------------------------------------

export interface ResolveSignalOptions<V> {
  /** Follows `import`, `export … from './x'` and `export * from './x'` across
   *  files. Without it every cross-file form resolves to `unresolved`. */
  loadModule?: ModuleLoader;
  /**
   * Reads one module's top-level signal declarations, keyed by getter name.
   *
   * Injected for the same reason `ResolveConstantOptions.readConstants` is:
   * which `createSignal(...)` defaults are statically knowable belongs to
   * `collectSignalDeclarations` — the one reader the scope chain already
   * trusts — and injection guarantees an imported signal is judged by exactly
   * the same rules as one declared beside its use.
   */
  readSignals: (source: string, filePath: string) => Map<string, V>;
  /**
   * Optional per-path AST memo. The signal walk parses each module it reaches
   * to read its exports; a page whose files import many names from one store
   * would otherwise re-parse that store once per name. `null` records a
   * module that failed to parse, so the failure is not retried either.
   */
  parsed?: Map<string, T.File | null>;
}

export type SignalExportLookup<V> =
  | {
    kind: 'found';
    /** The module that DECLARES the signal, after aliases and re-exports. */
    filePath: string;
    /** The getter's name in that module. */
    name: string;
    /** That module's complete top-level signal declarations — the map its
     *  `#module` frame must be entered with, however it is first entered. */
    declarations: Map<string, V>;
  }
  | UnresolvedExport;

/**
 * Resolve `name` as a signal getter EXPORTED by the module whose text is
 * `source`, following re-exports and `export *` barrels.
 *
 * Mirrors `resolveExportedConstant`: an import named the binding, so a
 * top-level signal that is never exported does NOT satisfy it. The payload
 * differs — a signal's identity is its defining module's frame, so the caller
 * gets that module's path and full declaration map rather than a value copy.
 * Verified by: packages/compiler/tests/signal-scope.test.ts > "a re-exported signal resolves through the barrel"
 */
export function resolveExportedSignal<V>(
  source: string,
  filePath: string,
  name: string,
  options: ResolveSignalOptions<V>,
): SignalExportLookup<V> {
  return signalLookup(source, filePath, name, options, new Set());
}

function signalLookup<V>(
  source: string,
  filePath: string,
  name: string,
  options: ResolveSignalOptions<V>,
  seen: Set<string>,
): SignalExportLookup<V> {
  // Same cycle guard, same key shape as the lookups above.
  // Verified by: packages/compiler/tests/signal-scope.test.ts > "an import cycle terminates instead of recursing"
  const key = `${filePath}\u0000${name}`;
  if (seen.has(key)) {
    return unresolved(
      `'${name}' in ${filePath} is re-exported in a cycle — the compiler stopped following it`,
    );
  }
  seen.add(key);

  let ast: T.File;
  if (options.parsed?.has(filePath)) {
    const cached = options.parsed.get(filePath)!;
    if (cached === null) {
      return unresolved(`${filePath} could not be parsed (recorded on an earlier lookup)`);
    }
    ast = cached;
  } else {
    try {
      ast = parse(source, PARSE_OPTS) as unknown as T.File;
      options.parsed?.set(filePath, ast);
    } catch (err) {
      options.parsed?.set(filePath, null);
      return unresolved(`${filePath} could not be parsed (${(err as Error).message})`);
    }
  }

  let declarations: Map<string, V>;
  try {
    declarations = options.readSignals(source, filePath);
  } catch (err) {
    return unresolved(
      `the signal declarations of ${filePath} could not be read (${(err as Error).message})`,
    );
  }

  const imports = readImportBindings(ast);
  const starSources: string[] = [];

  const follow = (importPath: string, importedName: string): SignalExportLookup<V> => {
    const edge = loadEdge(options.loadModule, name, filePath, importPath);
    if (edge.kind !== 'module') return edge;
    return signalLookup(edge.source, edge.path, importedName, options, seen);
  };

  const localSignal = (local: string): SignalExportLookup<V> | null =>
    declarations.has(local)
      ? { kind: 'found', filePath, name: local, declarations }
      : null;

  /** Does a declarator bind `local` as a signal getter (`const [local, …]`)? */
  const declaresGetter = (decl: T.VariableDeclarator, local: string): boolean =>
    t.isArrayPattern(decl.id)
    && decl.id.elements.length > 0
    && t.isIdentifier(decl.id.elements[0])
    && decl.id.elements[0].name === local;

  for (const stmt of ast.program.body) {
    if (t.isExportAllDeclaration(stmt)) {
      starSources.push(stmt.source.value);
      continue;
    }
    if (!t.isExportNamedDeclaration(stmt)) continue;
    // `export type { x } from './y'` is erased at runtime — following it as
    // a value edge would fold the store's default (and mint its slot table)
    // for an import that cannot exist once TypeScript compiles.
    if (stmt.exportKind === 'type') continue;

    // export const [name, setName] = createSignal(…)
    if (stmt.declaration) {
      if (!t.isVariableDeclaration(stmt.declaration)) continue;
      for (const decl of stmt.declaration.declarations) {
        if (!declaresGetter(decl, name)) continue;
        const hit = localSignal(name);
        if (hit) return hit;
        // Declared here but not statically evaluable: the collector already
        // warned with the cause when `readSignals` visited this module, and
        // the importer keeps today's degradation. Nothing to invent.
        return unresolved(
          `'${name}' in ${filePath} is a signal whose default the compiler cannot evaluate statically`,
        );
      }
      continue;
    }

    // export { name }, export { local as name }, export { name } from './x'
    for (const spec of stmt.specifiers) {
      if (!t.isExportSpecifier(spec)) {
        if (t.isExportNamespaceSpecifier(spec) && spec.exported.name === name) {
          return unresolved(
            `'${name}' in ${filePath} is a namespace re-export (\`export * as ${name} from …\`), which is a module object, not a signal getter`,
          );
        }
        continue;
      }
      // Inline form of the same erasure: `export { type x } from './y'`.
      if (spec.exportKind === 'type') continue;
      const exportedName = t.isIdentifier(spec.exported)
        ? spec.exported.name
        : spec.exported.value;
      if (exportedName !== name) continue;

      const local = spec.local.name;

      if (stmt.source) return follow(stmt.source.value, local);

      const hit = localSignal(local);
      if (hit) return hit;

      const imported = imports.get(local);
      if (imported) {
        if (imported.imported === '*' || imported.imported === 'default') {
          return unresolved(
            `'${name}' in ${filePath} forwards a ${imported.imported === '*' ? 'namespace' : 'default'} import from '${imported.source}', which the compiler does not follow for signals`,
          );
        }
        return follow(imported.source, imported.imported);
      }

      return unresolved(
        `'${name}' in ${filePath} resolves to '${local}', which is not a signal with a statically evaluable default declared or imported in that file`,
      );
    }
  }

  for (const importPath of starSources) {
    const result = follow(importPath, name);
    if (result.kind === 'found') return result;
  }

  if (declarations.has(name)) {
    return unresolved(
      `'${name}' is declared in ${filePath} but never exported from it, so the import that named it does not resolve to that declaration`,
    );
  }

  return unresolved(
    `no export named '${name}' in ${filePath} that the compiler can read as a signal with a statically evaluable default`,
  );
}

/**
 * The expression a component function returns: the body of an
 * expression-bodied arrow, or the first `return <expr>` in a block body that
 * is not inside a NESTED function (a helper's return is not the component's).
 */
export function returnExpressionOf(fn: ComponentFunction): T.Expression | null {
  if (t.isArrowFunctionExpression(fn) && !t.isBlockStatement(fn.body)) {
    return fn.body;
  }
  if (!t.isBlockStatement(fn.body)) return null;
  return firstReturnExpression(fn.body);
}

/**
 * First `return <expr>` reachable in a block without descending into a nested
 * function. Descends into every statement container (if/try/loops/switch) so a
 * component that returns from inside a conditional is still found.
 * Verified by: packages/compiler/tests/export-resolver.test.ts > "finds a return nested inside an if statement"
 */
function firstReturnExpression(block: T.BlockStatement): T.Expression | null {
  let result: T.Expression | null = null;

  const visitStatements = (stmts: T.Statement[]): void => {
    for (const stmt of stmts) {
      if (result) return;
      visitStatement(stmt);
    }
  };

  const visitStatement = (stmt: T.Statement | null | undefined): void => {
    if (!stmt || result) return;

    if (t.isReturnStatement(stmt)) {
      if (stmt.argument) result = stmt.argument;
      return;
    }
    if (t.isBlockStatement(stmt)) return visitStatements(stmt.body);
    if (t.isIfStatement(stmt)) {
      visitStatement(stmt.consequent);
      visitStatement(stmt.alternate);
      return;
    }
    if (t.isTryStatement(stmt)) {
      visitStatement(stmt.block);
      if (stmt.handler) visitStatement(stmt.handler.body);
      visitStatement(stmt.finalizer);
      return;
    }
    if (
      t.isForStatement(stmt) || t.isForInStatement(stmt) || t.isForOfStatement(stmt)
      || t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt) || t.isLabeledStatement(stmt)
    ) {
      return visitStatement(stmt.body);
    }
    if (t.isSwitchStatement(stmt)) {
      for (const c of stmt.cases) {
        visitStatements(c.consequent);
        if (result) return;
      }
    }
    // Nested function declarations are deliberately NOT descended into.
  };

  visitStatements(block.body);
  return result;
}
