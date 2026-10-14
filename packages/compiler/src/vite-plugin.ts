/**
 * Forma Compiler - Vite Plugin
 *
 * A Vite plugin that transforms `h()` hyperscript calls into optimized
 * `template()` + `cloneNode(true)` code at build time.
 *
 * Deprecated, with `formaServer` below: both are removed in 3.0.0 (L-23).
 * `@getforma/build`, which keeps runtime `h()`, is the one supported build.
 *
 * Usage:
 * ```ts
 * // vite.config.ts
 * import { formaCompiler } from '@getforma/compiler';
 *
 * export default defineConfig({
 *   plugins: [formaCompiler()],
 * });
 * ```
 */

import type { Plugin } from 'vite';
import { compileFormaJSX } from './transform.js';
import { transformServerFunctions, type ServerTransformOptions } from './server-transform.js';

/**
 * Why each Vite plugin is going. The compiled template path's output does not
 * behave like runtime `h()` (FORMA-007's review, probes against core 2.0.1),
 * and none of the stack's applications uses either plugin.
 */
const DEPRECATIONS = {
  formaCompiler:
    'formaCompiler is deprecated and will be removed in 3.0.0, together with the compiled template path. ' +
    'Its output does not behave like runtime h(): an island hydrated over server-rendered markup gets no handlers or updates, ' +
    'a signal getter as a child renders as source text, and style objects are dropped. ' +
    'Remove the plugin (FormaJS runs without it); @getforma/build is the supported build.',
  formaServer:
    'formaServer is deprecated and will be removed in 3.0.0, together with server functions ("use server"). ' +
    'No application of the Forma stack uses them.',
} as const;

const warned = new Set<keyof typeof DEPRECATIONS>();

/**
 * Log a plugin's deprecation once per process, however many times its factory
 * runs (Vite may evaluate its config more than once).
 * Verified by: packages/compiler/tests/vite-plugin-deprecation.test.ts > "formaCompiler logs its deprecation once, naming 3.0.0"
 */
function deprecated(name: keyof typeof DEPRECATIONS): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[@getforma/compiler] ${DEPRECATIONS[name]}`);
}

export interface FormaCompilerOptions {
  /** Glob patterns for files to include. Defaults to `['**\/*.ts', '**\/*.tsx']`. */
  include?: string[];
  /** Glob patterns for files to exclude. Defaults to `['**\/node_modules/**']`. */
  exclude?: string[];
}

/**
 * Compile a glob to an anchored RegExp over a `/`-separated module id.
 *
 * Supports the three constructs the options document: a `**` segment (any
 * number of path segments, including none), `*` inside a segment (anything but
 * a separator), and literal segments.
 *
 * The previous matcher did neither pattern justice: exclude was tested with
 * `id.includes(pattern.replace(/\*\*\//g, ''))`, i.e. `id.includes(
 * 'node_modules/**')`, which is false for every path in existence — so the
 * default exclude never excluded anything and the plugin rewrote dependency
 * sources. Include only ever compared the pattern's file extension, so
 * `include: ['src/**\/*.ts']` also matched `vendor/other.ts`.
 * Verified by: packages/compiler/tests/vite-plugin.test.ts > "excludes node_modules on POSIX and Windows ids (Windows)"
 */
function globToRegExp(glob: string): RegExp {
  const segments = glob.split('/');
  let source = '';
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '**') {
      // `[^/]*` rather than `[^/]+`: an absolute POSIX id starts with an empty
      // segment (`/proj/src/x.ts`), which a one-or-more matcher rejects.
      source += last ? '.*' : '(?:[^/]*/)*';
      return;
    }
    source += segment
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*');
    if (!last) source += '/';
  });
  return new RegExp(`^${source}$`);
}

/**
 * Normalize a module id for matching: Windows separators become `/` (a
 * `C:\proj\node_modules\dep\x.ts` id never matched a `**\/node_modules/**`
 * pattern), and Vite's query suffix (`?v=hash`, `?worker`) is dropped so a
 * transformed-with-query request is classified the same as the bare file.
 */
function normalizeId(id: string): string {
  const withoutQuery = id.split('?')[0] ?? id;
  return withoutQuery.replace(/\\/g, '/');
}

/**
 * @deprecated Removed in 3.0.0 (L-23): the compiled template path differs from
 * runtime `h()`. Use `@getforma/build`, or no plugin at all.
 */
export function formaCompiler(options?: FormaCompilerOptions): Plugin {
  deprecated('formaCompiler');
  const includePatterns = (options?.include ?? ['**/*.ts', '**/*.tsx']).map(globToRegExp);
  const excludePatterns = (options?.exclude ?? ['**/node_modules/**']).map(globToRegExp);

  return {
    name: 'forma-compiler',
    enforce: 'pre',

    transform(code: string, id: string) {
      // Quick bail: if no h() calls, skip entirely
      if (!code.includes('h(')) return;

      const path = normalizeId(id);

      // Check exclude patterns
      if (excludePatterns.some(re => re.test(path))) return;

      // Check include patterns
      if (!includePatterns.some(re => re.test(path))) return;

      // Only transform files that import h from forma. A cheap substring
      // pre-filter, not the decision: `@getforma/core` passes it by accident
      // (`getforma/` contains `forma/`), and compileFormaJSX then declines the
      // module, because it compiles only `h` imported from `formajs` or
      // `forma/*`. Such a module keeps runtime h(), at the cost of one parse.
      // Verified by: packages/compiler/tests/vite-plugin.test.ts > "leaves a module that imports h from \"@getforma/core\" to runtime h()"
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
 * import { formaServer } from '@getforma/compiler';
 *
 * export default defineConfig({
 *   plugins: [formaServer({ mode: 'client' })],
 * });
 * ```
 *
 * @deprecated Removed in 3.0.0 with server functions (L-23, DR-22).
 */
export function formaServer(options?: FormaServerOptions): Plugin {
  deprecated('formaServer');
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
