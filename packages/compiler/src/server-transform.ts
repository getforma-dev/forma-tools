/**
 * FormaJS Compiler - Server Function Transform
 *
 * Detects functions with "use server" directive and:
 * - Client build: replaces body with RPC stub ($$serverFunction call)
 * - Server build: keeps body, registers as endpoint
 *
 * Example:
 * ```ts
 * // Source:
 * async function createTodo(text: string) {
 *   "use server";
 *   return db.insert('todos', { text, done: false });
 * }
 *
 * // Client output:
 * import { $$serverFunction } from "formajs";
 * const createTodo = $$serverFunction("/rpc/createTodo_a1b2c3");
 *
 * // Server output:
 * import { registerServerFunction } from "formajs";
 * async function createTodo(text: string) {
 *   return db.insert('todos', { text, done: false });
 * }
 * registerServerFunction("/rpc/createTodo_a1b2c3", createTodo);
 * ```
 */

import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import _generate from '@babel/generator';
import type { NodePath } from '@babel/traverse';

// Handle both ESM default and CJS module.exports patterns
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;
const generate = (typeof _generate === 'function' ? _generate : (_generate as any).default) as typeof _generate;

export interface ServerTransformOptions {
  /** Whether this is the client or server build. */
  mode: 'client' | 'server';
}

/**
 * Hash a function name + its source for a unique, stable endpoint path.
 * Uses FNV-1a (32-bit) for better distribution and fewer collisions
 * than a simple shift-and-add hash.
 */
function hashEndpoint(name: string, source: string): string {
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    // FNV prime 0x01000193 — multiply via bit shifts for performance:
    // hash * 16777619 === hash * (16777216 + 256 + 128 + 16 + 8 + 2 + 1)
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0');
  return `/rpc/${name}_${hex}`;
}

/**
 * Transform source code to handle "use server" directives.
 * Returns null if no server functions were found.
 */
export function transformServerFunctions(
  code: string,
  id: string,
  options: ServerTransformOptions,
): { code: string; map: any } | null {
  // Quick bail: if no "use server" in the code, skip
  if (!code.includes('"use server"') && !code.includes("'use server'")) return null;

  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
    sourceFilename: id,
  });

  let modified = false;
  const serverFunctions: { name: string; endpoint: string }[] = [];

  traverse(ast, {
    // Handle function declarations: async function foo() { "use server"; ... }
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (!hasUseServerDirective(path.node.body)) return;
      const name = path.node.id?.name;
      if (!name) return;

      const funcSource = code.slice(path.node.start!, path.node.end!);
      const endpoint = hashEndpoint(name, funcSource);
      serverFunctions.push({ name, endpoint });

      if (options.mode === 'client') {
        // Replace function with RPC stub
        // const name = $$serverFunction(endpoint);
        const stub = t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(name),
            t.callExpression(
              t.identifier('$$serverFunction'),
              [t.stringLiteral(endpoint)],
            ),
          ),
        ]);
        path.replaceWith(stub);
        modified = true;
      } else {
        // Server mode: remove the "use server" directive, keep the function body
        removeUseServerDirective(path.node.body);
        modified = true;
      }
    },

    // Handle arrow functions in variable declarations:
    // const foo = async () => { "use server"; ... }
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      const init = path.node.init;
      if (!t.isArrowFunctionExpression(init) && !t.isFunctionExpression(init)) return;
      if (!t.isBlockStatement(init.body)) return;
      if (!hasUseServerDirective(init.body)) return;

      const idNode = path.node.id;
      if (!t.isIdentifier(idNode)) return;
      const name = idNode.name;

      const funcSource = code.slice(path.node.start!, path.node.end!);
      const endpoint = hashEndpoint(name, funcSource);
      serverFunctions.push({ name, endpoint });

      if (options.mode === 'client') {
        // Replace init with RPC stub call
        path.node.init = t.callExpression(
          t.identifier('$$serverFunction'),
          [t.stringLiteral(endpoint)],
        );
        modified = true;
      } else {
        // Server mode: remove the directive
        removeUseServerDirective(init.body);
        modified = true;
      }
    },
  });

  if (!modified) return null;

  // Add necessary imports
  if (options.mode === 'client' && serverFunctions.length > 0) {
    // Add: import { $$serverFunction } from "formajs";
    const importDecl = t.importDeclaration(
      [t.importSpecifier(t.identifier('$$serverFunction'), t.identifier('$$serverFunction'))],
      t.stringLiteral('formajs'),
    );
    ast.program.body.unshift(importDecl);
  } else if (options.mode === 'server' && serverFunctions.length > 0) {
    // Add: import { registerServerFunction } from "formajs";
    const importDecl = t.importDeclaration(
      [t.importSpecifier(t.identifier('registerServerFunction'), t.identifier('registerServerFunction'))],
      t.stringLiteral('formajs'),
    );
    ast.program.body.unshift(importDecl);

    // Add registration calls at the end:
    // registerServerFunction("/rpc/name_hash", name);
    for (const fn of serverFunctions) {
      const regCall = t.expressionStatement(
        t.callExpression(
          t.identifier('registerServerFunction'),
          [t.stringLiteral(fn.endpoint), t.identifier(fn.name)],
        ),
      );
      ast.program.body.push(regCall);
    }
  }

  const output = generate(ast, { sourceMaps: true, sourceFileName: id }, code);
  return { code: output.code, map: output.map };
}

/** Check if a block statement starts with "use server" directive. */
function hasUseServerDirective(body: t.BlockStatement): boolean {
  if (body.directives && body.directives.length > 0) {
    return body.directives.some((d) => d.value.value === 'use server');
  }
  // Also check for expression statement: "use server"; as a string literal
  const first = body.body[0];
  if (t.isExpressionStatement(first) && t.isStringLiteral(first.expression)) {
    return first.expression.value === 'use server';
  }
  return false;
}

/** Remove the "use server" directive from a block statement. */
function removeUseServerDirective(body: t.BlockStatement): void {
  if (body.directives) {
    body.directives = body.directives.filter((d) => d.value.value !== 'use server');
  }
  // Also remove expression statement form
  const first = body.body[0];
  if (t.isExpressionStatement(first) && t.isStringLiteral(first.expression) && first.expression.value === 'use server') {
    body.body.shift();
  }
}
