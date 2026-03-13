/**
 * Forma Compiler - Vite Plugin
 *
 * A Vite plugin that transforms `h()` hyperscript calls into optimized
 * `template()` + `cloneNode(true)` code at build time.
 *
 * Usage:
 * ```ts
 * // vite.config.ts
 * import { formaCompiler } from 'forma/compiler';
 *
 * export default defineConfig({
 *   plugins: [formaCompiler()],
 * });
 * ```
 */

import type { Plugin } from 'vite';
import { compileFormaJSX } from './transform.js';
import { transformServerFunctions, type ServerTransformOptions } from './server-transform.js';

export interface FormaCompilerOptions {
  /** Glob patterns for files to include. Defaults to ts/tsx files. */
  include?: string[];
  /** Glob patterns for files to exclude. Defaults to node_modules. */
  exclude?: string[];
}

export function formaCompiler(options?: FormaCompilerOptions): Plugin {
  const includePatterns = options?.include ?? ['**/*.ts', '**/*.tsx'];
  const excludePatterns = options?.exclude ?? ['**/node_modules/**'];

  return {
    name: 'forma-compiler',
    enforce: 'pre',

    transform(code: string, id: string) {
      // Quick bail: if no h() calls, skip entirely
      if (!code.includes('h(')) return;

      // Check exclude patterns
      if (excludePatterns.some(p => {
        const simplified = p.replace(/\*\*\//g, '');
        return id.includes(simplified);
      })) return;

      // Check include patterns
      if (!includePatterns.some(p => {
        const ext = p.split('.').pop();
        return ext && id.endsWith('.' + ext);
      })) return;

      // Only transform files that import h from forma
      if (!code.includes('forma/') && !code.includes('formajs')) return;

      return compileFormaJSX(code, id);
    },
  };
}

// ---------------------------------------------------------------------------
// Server Functions Plugin
// ---------------------------------------------------------------------------

export interface FormaServerOptions {
  /** Whether this is the client or server build. Default: 'client'. */
  mode?: 'client' | 'server';
}

/**
 * Vite plugin that transforms "use server" directives into RPC stubs (client)
 * or registered endpoints (server).
 *
 * Usage:
 * ```ts
 * // vite.config.ts
 * import { formaServer } from 'forma/compiler';
 *
 * export default defineConfig({
 *   plugins: [formaServer({ mode: 'client' })],
 * });
 * ```
 */
export function formaServer(options?: FormaServerOptions): Plugin {
  const mode = options?.mode ?? 'client';

  return {
    name: 'forma-server',
    enforce: 'pre',

    transform(code: string, id: string) {
      // Quick bail
      if (!code.includes('use server')) return;
      if (id.includes('node_modules')) return;

      return transformServerFunctions(code, id, { mode });
    },
  };
}
