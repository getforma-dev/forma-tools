/**
 * Forma Compiler - esbuild SSR Plugin
 *
 * An esbuild plugin that emits .ir files alongside JS bundles.
 * Phase 3a: real IR emission via ComponentAnalyzer + IR walk engine,
 * with fallback to placeholder IR if analysis fails.
 */

import type { Plugin } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

// ESM-compatible require for loading esbuild (which is CJS) from sync functions
const _require = createRequire(import.meta.url);
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { IrEmitContext } from './ir-emit';
import { ComponentAnalyzer } from './component-analyzer';
import { readImportBindings, resolveExportedFunction } from './export-resolver';
import { fsModuleLoader, loadComponentSource, resolveFilePath } from './module-loader';
import {
  collectSignalDeclarations,
  createSignalImportResolver,
  enterComponentScope,
  enterSignalScope,
  newSignalRegistry,
  resolveModuleSignalImports,
  type SignalScope,
} from './signal-scope';
import { moduleConstantScope, walkHTree, walkCallExpression, type WalkContext } from './ir-walk';

export interface SsrPluginOptions {
  /** Page name (e.g., 'platform-login') -- used for the output .ir filename */
  page: string;
  /** Output directory for .ir files */
  outDir: string;
  /** Entry point path (e.g., 'src/platform/onboarding/app.ts') for real IR emission */
  entryPoint?: string;
}

// ---------------------------------------------------------------------------
// Parser options
// ---------------------------------------------------------------------------

const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};

// ---------------------------------------------------------------------------
// Real IR Generation
// ---------------------------------------------------------------------------

export interface IrResult {
  binary: Uint8Array;
  islands: Array<{ id: number; name: string; trigger: number; propsMode: number; slotIds: number[] }>;
}

/**
 * Build the `resolveComponent` callback the walker uses for sub-component
 * calls, rebasing on the file each call actually appears in.
 *
 * The import map used to be built ONCE from the entry point and captured in a
 * closure, so `StatCard` imported by `pages/OverviewPage.tsx` was invisible
 * unless `app.tsx` happened to import it too — a whole page's components
 * degraded to empty island shells purely because of who imported them.
 * Verified by: packages/compiler/tests/ssr-emission.test.ts > "resolves a sub-component against the file the call is in"
 *
 * `seed` lets the caller pre-register the in-memory source of a file the
 * compiler has already transformed (the entry point), so it is not re-read
 * from disk untransformed.
 */
function createComponentResolver(
  seed: Array<{ path: string; source: string }>,
): (name: string, fromFile?: string) => { source: string; functionName: string; path?: string } | null {
  // Values are `string | null`; null caches "this file could not be read", so
  // an unreadable file is not retried once per component reference AND is not
  // mistaken for an empty module on the second lookup.
  const sources = new Map<string, string | null>();
  for (const { path, source } of seed) sources.set(path, source);

  const sourceOf = (filePath: string): string | null => {
    const cached = sources.get(filePath);
    if (cached !== undefined) return cached;
    const loaded = loadComponentSource(filePath);
    sources.set(filePath, loaded);
    return loaded;
  };

  const bindingsCache = new Map<string, Map<string, { source: string; imported: string }>>();
  const bindingsOf = (filePath: string, source: string) => {
    let bindings = bindingsCache.get(filePath);
    if (!bindings) {
      try {
        bindings = readImportBindings(parse(source, PARSE_OPTS) as any);
      } catch {
        bindings = new Map();
      }
      bindingsCache.set(filePath, bindings);
    }
    return bindings;
  };

  return (name, fromFile) => {
    if (!fromFile) return null;
    const fromSource = sourceOf(fromFile);
    if (fromSource === null) return null;

    // 1. An import in the calling file wins: it names both the file and the
    //    binding the target module exports it under (`import { CardImpl as
    //    Card }` must be looked up as 'CardImpl' over there, not 'Card').
    const binding = bindingsOf(fromFile, fromSource).get(name);
    if (binding) {
      if (binding.imported === '*') return null;
      if (!binding.source.startsWith('.') && !binding.source.startsWith('/')) return null;
      const path = resolveFilePath(dirname(fromFile), binding.source);
      if (!path) return null;
      const source = sourceOf(path);
      if (source === null) return null;
      return { source, functionName: binding.imported, path };
    }

    // 2. Otherwise the calling file may declare it itself — a file-local
    //    helper component, exported or not, top-level or nested.
    const local = resolveExportedFunction(fromSource, fromFile, name, {
      loadModule: fsModuleLoader,
      allowLocal: true,
      allowNested: true,
    });
    if (local.kind === 'found') {
      return { source: fromSource, functionName: name, path: fromFile };
    }

    return null;
  };
}

/**
 * Generate real IR by parsing the entry point, resolving the component,
 * extracting its h() tree, and walking it to produce FMIR binary.
 *
 * Returns the FMIR binary and island info, or null if any step fails (caller falls back to placeholder).
 */
export function generateRealIr(entryPointPath: string): IrResult | null {
  try {
    // 1. Read the entry point file
    let entrySource = readFileSync(entryPointPath, 'utf8');
    const entryDir = dirname(entryPointPath);

    // 1b. If the file is .tsx/.jsx, transform JSX syntax to h() calls
    // so the Babel AST parser produces CallExpression nodes (not JSXElement).
    // The IR walker only understands h() call trees, not raw JSX AST.
    if (entryPointPath.endsWith('.tsx') || entryPointPath.endsWith('.jsx')) {
      try {
        const esbuild = _require('esbuild');
        const transformed = esbuild.transformSync(entrySource, {
          loader: entryPointPath.endsWith('.tsx') ? 'tsx' : 'jsx',
          jsxFactory: 'h',
          jsxFragment: 'Fragment',
          format: 'esm',
        });
        entrySource = transformed.code;
      } catch {
        // esbuild not available — fall through with raw JSX (will likely fail later)
      }
    }

    // 2. Create ComponentAnalyzer and parse entry point
    const analyzer = new ComponentAnalyzer(entryDir);
    // IMPORTANT: JSX transform (step 1b) must run BEFORE parseEntryPoint so that
    // any inlineReturnNode references the transformed AST (h() calls, not JSX nodes).
    const entryInfo = analyzer.parseEntryPoint(entrySource, entryPointPath);
    if (!entryInfo) {
      console.warn(`   IR: could not find mount() call in ${entryPointPath}`);
      return null;
    }

    // Follows imports so a signal declared in a store module folds on this
    // page. One per page — its caches make the expensive work per-module, not
    // per-importer. The injected reader judges an imported signal by exactly
    // the rules a local one gets (same collector, same module-const folding)
    // but QUIETLY: the eager scan reads modules whose signals may never
    // appear on this page, and a warning about a signal nobody reads is
    // noise — a read of an unfoldable signal still warns at its use site.
    const signalImports = createSignalImportResolver(fsModuleLoader, (source, filePath) =>
      collectSignalDeclarations(
        (parse(source, PARSE_OPTS) as unknown as t.File).program.body,
        {
          filePath,
          constants: moduleConstantScope(source, filePath, fsModuleLoader).stringConstants,
          quiet: true,
        },
      ),
    );

    // ── Handle inline return from block-body mount() (Pattern 3) ──
    if (entryInfo.componentName === '__inline__' && entryInfo.inlineReturnNode) {
      const ctx = new IrEmitContext();
      const signalRegistry = newSignalRegistry();

      const resolveComponent = createComponentResolver([
        { path: entryPointPath, source: entrySource },
      ]);

      // The entry point's own module scope: its constants, and the resolver
      // for tables it imports (Rule 9's unroll).
      const { fileConstants, stringConstants, resolveImportedConstant } =
        moduleConstantScope(entrySource, entryPointPath, fsModuleLoader);

      // An inline mount has no exported component to look inside: the page's
      // scope chain is the entry file's module scope, then the mount
      // callback's own body. Both are real lexical scopes of the tree being
      // walked, which is why the walk reads them and no separate extractor
      // has to know this pattern exists.
      // Verified by: packages/compiler/tests/ssr-emission.test.ts > "names signal slots on an inline-mount entry"
      const entryAst = parse(entrySource, PARSE_OPTS);
      let signalScope: SignalScope = enterSignalScope(
        null,
        `${entryPointPath}#module`,
        collectSignalDeclarations(entryAst.program.body, {
          filePath: entryPointPath,
          constants: stringConstants,
        }),
        ctx,
        signalRegistry,
      );
      // An inline-mount page can keep its signals in a store module too — the
      // module frame gets the same import resolution enterComponentScope does.
      resolveModuleSignalImports(
        signalScope,
        entryAst as unknown as t.File,
        entryPointPath,
        signalImports,
        ctx,
        signalRegistry,
      );
      if (entryInfo.inlineMountBody) {
        signalScope = enterSignalScope(
          signalScope,
          `${entryPointPath}#mount`,
          collectSignalDeclarations(entryInfo.inlineMountBody, {
            filePath: entryPointPath,
            constants: stringConstants,
          }),
          ctx,
          signalRegistry,
        );
      }

      const walkCtx: WalkContext = {
        sourceFile: entryPointPath,
        fileConstants,
        stringConstants,
        resolveImportedConstant,
        signalScope,
        signalRegistry,
        signalImports,
        resolveComponent,
        loadModule: fsModuleLoader,
        visited: new Set(),
        depth: 0,
        islandNames: entryInfo.islandNames,
        // Per-page slot-name registries MUST be created on the root context
        // (not lazily inside a spread-copied nested context) so every list,
        // show, dynamic attribute and dynamic text child on the page dedups
        // against one shared namespace.
        // Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes a dynamic attr inside an island against one on the page"
        listNames: { counts: new Map(), total: 0 },
        showNames: { counts: new Map(), total: 0 },
        attrNames: new Map(),
        textNames: new Map(),
      };

      const returnNode = entryInfo.inlineReturnNode;

      if (t.isCallExpression(returnNode) && t.isIdentifier(returnNode.callee) && returnNode.callee.name === 'h') {
        walkHTree(returnNode, 'h', ctx, walkCtx);
      } else if (t.isCallExpression(returnNode)) {
        walkCallExpression(returnNode, 'h', ctx, walkCtx);
      } else {
        console.warn(`   IR: inline return node is not a call expression`);
        return null;
      }

      const binary = ctx.toBinary();
      const islands = ctx.getIslands();

      return { binary, islands };
    }

    // ── Original code continues for Pattern 1 & 2 (named component) ──

    // 3. Resolve the component file path
    const componentPath = resolveFilePath(entryDir, entryInfo.importPath);
    if (!componentPath) {
      console.warn(`   IR: could not resolve component '${entryInfo.importPath}' from ${entryDir}`);
      return null;
    }

    // 4. Read and parse the component file (transform JSX if needed)
    const componentSource = loadComponentSource(componentPath);
    if (componentSource === null) {
      console.warn(`   IR: could not read component file ${componentPath}`);
      return null;
    }

    // 4b. The entry's import binding names what the component module exports
    // it under: `import { PageImpl as Page }` must be looked up as 'PageImpl'.
    const exportedName =
      entryInfo.importBindings?.get(entryInfo.componentName)?.imported
      ?? entryInfo.componentName;

    // 5. Find the root component's h() tree. The function may be DECLARED in
    // another file (a barrel forwarded the export), and everything scoped to
    // the module — constants, imports, diagnostics — has to follow it there.
    const componentInfo = analyzer.parseComponentFile(
      componentSource,
      componentPath,
      exportedName,
      {
        loadModule: fsModuleLoader,
        onUnresolved: (detail) => console.warn(
          `   IR: ${detail} — the page falls back to placeholder IR, so it server-renders as an empty <div id="app"> and shows nothing at all until the client bundle hydrates`,
        ),
      },
    );
    if (!componentInfo) return null;

    const rootPath = componentInfo.filePath;
    const rootSource = componentInfo.source;

    // 6. The root page module's constant scope: the tables it declares (for
    // Rule 9's static unroll), the strings it declares (for static attribute
    // resolution), and the resolver for tables it IMPORTS.
    const { fileConstants, stringConstants, resolveImportedConstant } =
      moduleConstantScope(rootSource, rootPath, fsModuleLoader);

    // 7. Create IrEmitContext and open the root page's scope chain: the page
    // FILE's module scope, then the page COMPONENT's own body. Island and
    // sub-component scopes are NOT gathered here — the walk pushes each one as
    // it inlines that component, which is what makes a scope the walk learns
    // to inline later work without a matching extractor being written for it.
    const ctx = new IrEmitContext();
    const signalRegistry = newSignalRegistry();
    const signalScope = enterComponentScope({
      ast: componentInfo.ast,
      fn: componentInfo.fn,
      fnName: exportedName,
      filePath: rootPath,
      constants: stringConstants,
      ctx,
      registry: signalRegistry,
      imports: signalImports,
    });

    // 8. Build resolve callback for sub-components
    const resolveComponent = createComponentResolver([
      { path: entryPointPath, source: entrySource },
      { path: componentPath, source: componentSource },
      { path: rootPath, source: rootSource },
    ]);

    // 9. Build WalkContext and walk the h() tree
    const walkCtx: WalkContext = {
      sourceFile: rootPath,
      fileConstants,
      stringConstants,
      resolveImportedConstant,
      signalScope,
      signalRegistry,
      signalImports,
      resolveComponent,
      loadModule: fsModuleLoader,
      visited: new Set(),
      depth: 0,
      islandNames: entryInfo.islandNames,
      // Per-page slot-name registries MUST be created on the root context
      // (not lazily inside a spread-copied nested context) so every list
      // and show on the page dedups against one shared namespace.
      listNames: { counts: new Map(), total: 0 },
      showNames: { counts: new Map(), total: 0 },
      attrNames: new Map(),
      textNames: new Map(),
    };

    const returnNode = componentInfo.returnNode;

    if (t.isCallExpression(returnNode) && t.isIdentifier(returnNode.callee) && returnNode.callee.name === 'h') {
      walkHTree(returnNode, 'h', ctx, walkCtx);
    } else if (t.isCallExpression(returnNode)) {
      walkCallExpression(returnNode, 'h', ctx, walkCtx);
    } else {
      console.warn(`   IR: return node is not a call expression in ${entryInfo.componentName}`);
      return null;
    }

    // 10. Return the binary and island metadata
    return {
      binary: ctx.toBinary(),
      islands: ctx.getIslands(),
    };
  } catch (err) {
    console.warn(`   IR: real emission failed: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Placeholder IR Generation
// ---------------------------------------------------------------------------

/**
 * Generate a placeholder IR for a page.
 *
 * Produces a minimal FMIR binary representing:
 *   <div id="app" data-forma-page="{pageName}"></div>
 *
 * This is the fallback every page lands on when real IR emission fails: the
 * shell the client-side mount hydrates into. Exported so the test suite can
 * exercise THIS function rather than a copy of its body — a re-implementation
 * in the test would keep passing while the shipped fallback was broken.
 * Verified by: packages/compiler/tests/ir-roundtrip.test.ts > "placeholder IR from the SSR plugin has valid structure"
 */
export function generatePlaceholderIr(pageName: string): Uint8Array {
  const ctx = new IrEmitContext();

  const divIdx = ctx.addString('div');
  const idKeyIdx = ctx.addString('id');
  const idValIdx = ctx.addString('app');
  const pageKeyIdx = ctx.addString('data-forma-page');
  const pageValIdx = ctx.addString(pageName);

  // OPEN_TAG "div" with 2 static attrs: id="app" data-forma-page="{pageName}"
  ctx.emit(0x01); // OP_OPEN_TAG
  ctx.emitU32(divIdx);
  ctx.emitU16(2); // 2 attributes
  ctx.emitU32(idKeyIdx);
  ctx.emitU32(idValIdx);
  ctx.emitU32(pageKeyIdx);
  ctx.emitU32(pageValIdx);

  // CLOSE_TAG "div"
  ctx.emit(0x02); // OP_CLOSE_TAG
  ctx.emitU32(divIdx);

  return ctx.toBinary();
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * esbuild plugin that emits FMIR .ir files for SSR.
 *
 * Attaches an `onEnd` hook that generates an IR file after each
 * successful build. IR emission is non-fatal -- if it fails, the page
 * falls back to Phase 1 (client-side mount).
 */
export function formaSsrPlugin(options: SsrPluginOptions): Plugin {
  return {
    name: 'forma-ssr-ir',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) return;

        try {
          let irBytes: Uint8Array | null = null;
          let irIslands: IrResult['islands'] = [];

          // Phase 3a: try real IR emission when entryPoint is provided
          if (options.entryPoint) {
            const irResult = generateRealIr(options.entryPoint);
            if (irResult) {
              irBytes = irResult.binary;
              irIslands = irResult.islands;
              console.log(`   IR emitted (real): ${options.page}.ir (${irBytes.length} bytes, ${irIslands.length} islands)`);
            }
          }

          // Fall back to placeholder IR if real emission failed or no entryPoint
          if (!irBytes) {
            irBytes = generatePlaceholderIr(options.page);
            console.log(`   IR emitted (placeholder): ${options.page}.ir (${irBytes.length} bytes)`);
          }

          const irPath = join(options.outDir, `${options.page}.ir`);
          writeFileSync(irPath, irBytes);

          // The island table is INSIDE the .ir binary, and generateRealIr
          // returns it to programmatic callers. This step used to also drop a
          // `<page>.islands.json` next to it, which nothing read: its only
          // consumer was @getforma/build's island-registry generator, itself
          // removed as unusable (see that package's CHANGELOG). Emitting build
          // metadata into the SERVED asset directory made every consumer clean
          // up after the compiler — ksx Studio had to delete both byproducts by
          // hand to keep them out of its rust-embed binary.
        } catch (err) {
          // IR emission failure is non-fatal -- page falls back to Phase 1
          console.warn(
            `   IR emission failed for ${options.page}:`,
            (err as Error).message,
          );
        }
      });
    },
  };
}
