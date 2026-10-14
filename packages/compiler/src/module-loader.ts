/**
 * Forma Compiler - Module Loader
 *
 * Filesystem side of module resolution: turn a relative import specifier into
 * an absolute path, and read that file as source the Babel parser accepts
 * (JSX is transformed to h() calls first — the IR walker only understands
 * h() call trees, never raw JSX AST).
 *
 * These live apart from the esbuild SSR plugin because the export resolver
 * (export-resolver.ts) needs them too: following `export { X } from './x'`
 * across files is a filesystem operation, not an AST one.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { registerSourceMap } from './diagnostics.js';

// ESM-compatible require for loading esbuild (which is CJS) from sync functions
const _require = createRequire(import.meta.url);

/**
 * Load the module a relative import specifier names, starting from the file
 * that contains the import. Returns null when the specifier does not resolve
 * to a readable file (or is a package import, which the compiler never
 * follows).
 */
export type ModuleLoader = (
  fromFile: string,
  importPath: string,
) => { path: string; source: string } | null;

/**
 * Resolve a relative import path to an absolute file path.
 * Tries the path as-is, then the extensions a Forma source file can carry,
 * then the directory's index file.
 */
export function resolveFilePath(fromDir: string, importPath: string): string | null {
  const base = resolve(fromDir, importPath);

  // Try exact path
  if (existsSync(base) && !isDirectory(base)) return base;

  for (const ext of ['.ts', '.tsx', '.jsx', '.js']) {
    const withExt = base + ext;
    if (existsSync(withExt)) return withExt;
  }

  for (const index of ['index.ts', 'index.tsx', 'index.jsx', 'index.js']) {
    const indexPath = join(base, index);
    if (existsSync(indexPath)) return indexPath;
  }

  return null;
}

/**
 * Check if a path is a directory (to avoid accidentally reading dirs).
 */
function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read a component source file, transforming JSX syntax to h() calls
 * when the file is .tsx/.jsx (the IR walker only understands h() trees).
 * Returns the (possibly transformed) source, or null if the read fails.
 *
 * NOTE: esbuild rewrites `export function Card() {}` into a bare declaration
 * plus `export { Card };`. Every consumer of this function therefore has to
 * resolve export SPECIFIERS, not just export declarations — see
 * export-resolver.ts.
 * Verified by: packages/compiler/tests/export-resolver.test.ts > "esbuild's own .tsx output resolves through the specifier form"
 */
export function loadComponentSource(filePath: string): string | null {
  try {
    return transformJsxSource(readFileSync(filePath, 'utf8'), filePath);
  } catch {
    return null;
  }
}

/**
 * Turn a .tsx or .jsx file's JSX into h() calls (the IR walker reads only h()
 * trees); any other file is returned as it is.
 *
 * The transform's source map is kept for the file (`registerSourceMap`), so a
 * diagnostic on the compiled text names the line the author wrote: esbuild
 * reprints the file, and its lines are not the source's. An external map leaves
 * the code byte-identical to a transform without one.
 * Verified by: packages/compiler/tests/diagnostics-conformance.test.ts > "maps a position in a .tsx file back to the line the author wrote"
 */
export function transformJsxSource(source: string, filePath: string): string {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) {
    registerSourceMap(filePath, null);
    return source;
  }
  try {
    const esbuild = _require('esbuild');
    const transformed = esbuild.transformSync(source, {
      loader: filePath.endsWith('.tsx') ? 'tsx' : 'jsx',
      jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm',
      sourcemap: 'external', sourcefile: filePath,
    });
    registerSourceMap(filePath, transformed.map);
    return transformed.code;
  } catch {
    // esbuild not available, or the file does not parse: use the raw source,
    // whose positions are the author's.
    registerSourceMap(filePath, null);
    return source;
  }
}

/**
 * The filesystem module loader the compiler uses in a real build: resolve the
 * specifier relative to the importing file's directory, then read it through
 * loadComponentSource so a .tsx module arrives as h() calls.
 *
 * Package imports (anything not starting with `.` or `/`) are never followed.
 */
export const fsModuleLoader: ModuleLoader = (fromFile, importPath) => {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null;
  const path = resolveFilePath(dirname(fromFile), importPath);
  if (!path) return null;
  const source = loadComponentSource(path);
  if (source === null) return null;
  return { path, source };
};
