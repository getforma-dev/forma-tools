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
import { ComponentAnalyzer, type EntryPointInfo, type SignalDefault } from './component-analyzer';
import { readImportBindings, resolveExportedFunction } from './export-resolver';
import { fsModuleLoader, loadComponentSource, resolveFilePath } from './module-loader';
import { walkHTree, walkCallExpression, type WalkContext } from './ir-walk';

export interface SsrPluginOptions {
  /** Page name (e.g., 'platform-login') -- used for the output .ir filename */
  page: string;
  /** Output directory for .ir files */
  outDir: string;
  /** Entry point path (e.g., 'src/platform/onboarding/app.ts') for real IR emission */
  entryPoint?: string;
}

// ---------------------------------------------------------------------------
// Slot type hints (must match ir-walk.ts)
// ---------------------------------------------------------------------------

const TYPE_TEXT   = 0x01;
const TYPE_BOOL   = 0x02;
const TYPE_NUMBER = 0x03;
const SOURCE_CLIENT = 0x01;

/**
 * Register one client-sourced slot per signal, carrying its SSR default.
 *
 * Both mount paths call this. They used to carry separate copies and the
 * inline one had drifted: it handled only text and bool, so a numeric signal
 * on an inline-mount page got a TYPE_TEXT slot with NO default bytes — the
 * server rendered a blank where the number belongs.
 * Verified by: packages/compiler/tests/ssr-emission.test.ts > "gives a numeric inline-mount signal its type and default"
 */
function registerSignalSlots(
  ctx: IrEmitContext,
  signalDefaults: Map<string, SignalDefault>,
  signalSlots: Map<string, number>,
): void {
  for (const [name, sigDefault] of signalDefaults) {
    let typeHint = TYPE_TEXT;
    let defaultBytes = new Uint8Array(0);

    if (sigDefault.type === 'text' && typeof sigDefault.default === 'string') {
      typeHint = TYPE_TEXT;
      defaultBytes = new TextEncoder().encode(sigDefault.default);
    } else if (sigDefault.type === 'bool' && typeof sigDefault.default === 'boolean') {
      typeHint = TYPE_BOOL;
      defaultBytes = new TextEncoder().encode(String(sigDefault.default));
    } else if (sigDefault.type === 'number' && typeof sigDefault.default === 'number') {
      typeHint = TYPE_NUMBER;
      defaultBytes = new TextEncoder().encode(String(sigDefault.default));
    }
    // type 'null' keeps TYPE_TEXT with no default bytes: the Rust walker omits
    // the attribute entirely for an empty default, which is what null means.

    const slotId = ctx.addSlot(name, typeHint, SOURCE_CLIENT, defaultBytes);
    signalSlots.set(name, slotId);
  }
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

    // ── Handle inline return from block-body mount() (Pattern 3) ──
    if (entryInfo.componentName === '__inline__' && entryInfo.inlineReturnNode) {
      const ctx = new IrEmitContext();
      const signalSlots = new Map<string, number>();

      // Import map from the entry point file (island signal extraction below)
      const importMap = new Map<string, string>();
      for (const [local, binding] of entryInfo.importBindings ?? []) {
        importMap.set(local, binding.source);
      }

      const resolveComponent = createComponentResolver([
        { path: entryPointPath, source: entrySource },
      ]);

      // Extract file constants and signal defaults from entry point itself
      const fileConstants = analyzer.extractFileConstants(entrySource, entryPointPath);
      const stringConstants = analyzer.extractStringConstants(entrySource, entryPointPath);

      // Signal defaults: an inline mount has no exported component to look
      // inside — its signals live at module scope and in the mount callback.
      // This used to ask for an export literally named '__inline__', a lookup
      // that could never match, so an inline-mount page got ZERO named signal
      // slots and every binding landed in an anonymous `text:`/`attr:` slot
      // that server-side injection cannot address by name.
      // Verified by: packages/compiler/tests/ssr-emission.test.ts > "names signal slots on an inline-mount entry"
      const signalDefaults = analyzer.extractInlineMountSignalDefaults(
        entrySource,
        entryPointPath,
      ) as Map<string, SignalDefault>;

      // Merge signal defaults from island component files (finding F9) — the
      // inline block-body mount path can register islands via
      // activateIslands({...}) too. The entry file IS the component here, so
      // its own import map and dir serve as the component-level fallback.
      mergeIslandSignalDefaults(
        analyzer,
        entryInfo,
        'the entry mount',
        entryDir,
        importMap,
        entryDir,
        signalDefaults,
      );

      registerSignalSlots(ctx, signalDefaults, signalSlots);

      const walkCtx: WalkContext = {
        sourceFile: entryPointPath,
        fileConstants,
        stringConstants,
        signalSlots,
        signalDefaults,
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

    // 6. Extract file constants (for Rule 9 static unroll) and string
    // constants (for static attribute resolution)
    const fileConstants = analyzer.extractFileConstants(rootSource, rootPath);
    const stringConstants = analyzer.extractStringConstants(rootSource, rootPath);

    // 7. Extract signal defaults (for slot defaults). A failure here used to be
    // the compiler's only fully silent one: the signals kept their bindings but
    // lost their names, so the page shipped anonymous slots the server could
    // not inject into and no build output said why.
    const signalDefaults = analyzer.extractSignalDefaults(
      componentSource,
      componentPath,
      exportedName,
      {
        loadModule: fsModuleLoader,
        onUnresolved: (detail) => console.warn(
          `   IR: ${detail} — its createSignal defaults cannot be read, so bindings to them land in anonymous 'text:'/'attr:' slots that cannot be injected by name`,
        ),
      },
    );

    // 8. Build import map from the root component's own file (for island
    // signal extraction below)
    const componentAst = parse(rootSource, PARSE_OPTS);
    const componentDir = dirname(rootPath);
    const importMap = new Map<string, string>();
    for (const [local, binding] of readImportBindings(componentAst as any)) {
      importMap.set(local, binding.source);
    }

    // 9. Merge signal defaults from ISLAND component files (first-wins,
    // root component authoritative — see mergeIslandSignalDefaults).
    mergeIslandSignalDefaults(
      analyzer,
      entryInfo,
      `root '${entryInfo.componentName}'`,
      entryDir,
      importMap,
      componentDir,
      signalDefaults,
    );

    // 10. Create IrEmitContext and register signal slots with defaults
    const ctx = new IrEmitContext();
    const signalSlots = new Map<string, number>();

    registerSignalSlots(ctx, signalDefaults, signalSlots);

    // 11. Build resolve callback for sub-components
    const resolveComponent = createComponentResolver([
      { path: entryPointPath, source: entrySource },
      { path: componentPath, source: componentSource },
      { path: rootPath, source: rootSource },
    ]);

    // 12. Build WalkContext and walk the h() tree
    const walkCtx: WalkContext = {
      sourceFile: rootPath,
      fileConstants,
      stringConstants,
      signalSlots,
      signalDefaults,
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

    // 13. Return the binary and island metadata
    return {
      binary: ctx.toBinary(),
      islands: ctx.getIslands(),
    };
  } catch (err) {
    console.warn(`   IR: real emission failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Merge signal defaults from ISLAND component files into the page-level map.
 * Island files declare their signals at module scope (or inside the island
 * function); merging is FIRST-WINS — the root component's defaults (already
 * in `signalDefaults`) are authoritative, then islands merge in registry
 * order. Identical duplicate declarations merge silently; only a conflicting
 * default warns, naming the declarer whose default actually won — first-wins
 * means the keeper may be an EARLIER ISLAND, not necessarily the root.
 *
 * `rootLabel` names the pre-seeded declarations in warnings (e.g.
 * "root 'DashboardPage'"). `componentImportMap`/`componentDir` are the
 * fallback for resolving island files not imported by the entry itself;
 * the inline mount path passes the entry's own map and dir for both.
 */
function mergeIslandSignalDefaults(
  analyzer: ComponentAnalyzer,
  entryInfo: EntryPointInfo,
  rootLabel: string,
  entryDir: string,
  componentImportMap: Map<string, string>,
  componentDir: string,
  signalDefaults: Map<string, SignalDefault>,
): void {
  if (!entryInfo.islandNames) return;

  // Provenance: signal name -> label of the declarer whose default won.
  const provenance = new Map<string, string>();
  for (const sigName of signalDefaults.keys()) {
    provenance.set(sigName, rootLabel);
  }

  for (const islandName of entryInfo.islandNames) {
    // Resolve the island's source file via the entry's import map,
    // falling back to the component file's import map.
    let islandPath: string | null = null;
    const entryImport = entryInfo.importMap?.get(islandName);
    if (entryImport && (entryImport.startsWith('.') || entryImport.startsWith('/'))) {
      islandPath = resolveFilePath(entryDir, entryImport);
    }
    if (!islandPath) {
      const componentImport = componentImportMap.get(islandName);
      if (componentImport && (componentImport.startsWith('.') || componentImport.startsWith('/'))) {
        islandPath = resolveFilePath(componentDir, componentImport);
      }
    }
    if (!islandPath) {
      console.warn(`   IR: could not resolve island component '${islandName}' for signal extraction`);
      continue;
    }

    const islandSource = loadComponentSource(islandPath);
    if (islandSource === null) {
      console.warn(`   IR: could not read island component file ${islandPath}`);
      continue;
    }

    const islandDefaults = analyzer.extractIslandSignalDefaults(
      islandSource,
      islandPath,
      islandName,
      {
        loadModule: fsModuleLoader,
        onUnresolved: (detail) => console.warn(
          `   IR: ${detail} — signals declared inside island '${islandName}' get no named slots, so bindings to them land in anonymous 'text:'/'attr:' slots that cannot be injected by name`,
        ),
      },
    );
    for (const [sigName, sigDefault] of islandDefaults) {
      const existing = signalDefaults.get(sigName);
      if (!existing) {
        signalDefaults.set(sigName, sigDefault);
        provenance.set(sigName, `island '${islandName}'`);
      } else if (existing.type !== sigDefault.type || existing.default !== sigDefault.default) {
        const keeper = provenance.get(sigName) ?? rootLabel;
        console.warn(
          `   IR: signal '${sigName}' in island '${islandName}' has default ${JSON.stringify(sigDefault.default)} but ${keeper} declares ${JSON.stringify(existing.default)} — keeping the default from ${keeper}`,
        );
      }
    }
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
