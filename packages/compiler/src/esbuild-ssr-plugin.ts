/**
 * Forma Compiler - esbuild SSR Plugin
 *
 * An esbuild plugin that emits .ir files alongside JS bundles.
 * Phase 3a: real IR emission via ComponentAnalyzer + IR walk engine,
 * with fallback to placeholder IR if analysis fails.
 */

import type { Plugin } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

// ESM-compatible require for loading esbuild (which is CJS) from sync functions
const _require = createRequire(import.meta.url);
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { IrEmitContext } from './ir-emit';
import { ComponentAnalyzer } from './component-analyzer';
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
const SOURCE_CLIENT = 0x01;

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

      // Parse the entry point AST for imports and local function extraction
      const entryAst = parse(entrySource, PARSE_OPTS);

      // Build import map from the entry point file
      const importMap = new Map<string, string>();
      for (const node of entryAst.program.body) {
        if (t.isImportDeclaration(node)) {
          const importPath = node.source.value;
          for (const spec of node.specifiers) {
            importMap.set(spec.local.name, importPath);
          }
        }
      }

      // Build resolve callback that handles BOTH imported AND locally-defined components
      const resolveComponent = (name: string): { source: string; functionName: string } | null => {
        // 1. Check imports first (same as existing logic)
        const importPathRaw = importMap.get(name);
        if (importPathRaw && (importPathRaw.startsWith('.') || importPathRaw.startsWith('/'))) {
          const resolvedPath = resolveFilePath(entryDir, importPathRaw);
          if (resolvedPath) {
            try {
              let src = readFileSync(resolvedPath, 'utf8');
              // Transform JSX to h() calls if needed
              if (resolvedPath.endsWith('.tsx') || resolvedPath.endsWith('.jsx')) {
                try {
                  const esbuild = _require('esbuild');
                  src = esbuild.transformSync(src, {
                    loader: resolvedPath.endsWith('.tsx') ? 'tsx' : 'jsx',
                    jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm',
                  }).code;
                } catch { /* use raw source */ }
              }
              return { source: src, functionName: name };
            } catch { /* fall through to local check */ }
          }
        }

        // 2. Check locally-defined functions in the entry point
        for (const node of entryAst.program.body) {
          // function Sidebar() { ... }
          if (t.isFunctionDeclaration(node) && node.id?.name === name) {
            return { source: entrySource, functionName: name };
          }
          // const Sidebar = () => { ... } or const Sidebar = function() { ... }
          if (t.isVariableDeclaration(node)) {
            for (const decl of node.declarations) {
              if (
                t.isIdentifier(decl.id) &&
                decl.id.name === name &&
                decl.init &&
                (t.isArrowFunctionExpression(decl.init) || t.isFunctionExpression(decl.init))
              ) {
                return { source: entrySource, functionName: name };
              }
            }
          }
        }

        return null;
      };

      // Extract file constants and signal defaults from entry point itself
      const fileConstants = analyzer.extractFileConstants(entrySource, entryPointPath);

      // Signal defaults: look for createSignal calls at module scope in the entry file
      let signalDefaults = new Map<string, any>();
      try {
        signalDefaults = analyzer.extractSignalDefaults(entrySource, entryPointPath, '__inline__');
      } catch {
        // extractSignalDefaults may not handle '__inline__' — that's fine, skip defaults
      }

      for (const [sigName, sigDefault] of signalDefaults) {
        let typeHint = TYPE_TEXT;
        let defaultBytes = new Uint8Array(0);
        if (sigDefault.type === 'text' && typeof sigDefault.default === 'string') {
          typeHint = TYPE_TEXT;
          defaultBytes = new TextEncoder().encode(sigDefault.default);
        } else if (sigDefault.type === 'bool' && typeof sigDefault.default === 'boolean') {
          typeHint = TYPE_BOOL;
          defaultBytes = new TextEncoder().encode(String(sigDefault.default));
        }
        const slotId = ctx.addSlot(sigName, typeHint, SOURCE_CLIENT, defaultBytes);
        signalSlots.set(sigName, slotId);
      }

      const walkCtx: WalkContext = {
        fileConstants,
        signalSlots,
        signalDefaults,
        resolveComponent,
        visited: new Set(),
        depth: 0,
        islandNames: entryInfo.islandNames,
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
    let componentSource = readFileSync(componentPath, 'utf8');
    if (componentPath.endsWith('.tsx') || componentPath.endsWith('.jsx')) {
      try {
        const esbuild = _require('esbuild');
        componentSource = esbuild.transformSync(componentSource, {
          loader: componentPath.endsWith('.tsx') ? 'tsx' : 'jsx',
          jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm',
        }).code;
      } catch { /* use raw source */ }
    }

    // 5. Extract file constants (for Rule 9 static unroll)
    const fileConstants = analyzer.extractFileConstants(componentSource, componentPath);

    // 6. Extract signal defaults (for slot defaults)
    const signalDefaults = analyzer.extractSignalDefaults(
      componentSource,
      componentPath,
      entryInfo.componentName,
    );

    // 7. Parse the component file to find the return h() tree
    const componentInfo = analyzer.parseComponentFile(
      componentSource,
      componentPath,
      entryInfo.componentName,
    );
    if (!componentInfo) {
      console.warn(`   IR: could not find return h() tree in ${entryInfo.componentName}`);
      return null;
    }

    // 8. Create IrEmitContext and register signal slots with defaults
    const ctx = new IrEmitContext();
    const signalSlots = new Map<string, number>();

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
        typeHint = 0x03; // TYPE_NUMBER
        defaultBytes = new TextEncoder().encode(String(sigDefault.default));
      } else if (sigDefault.type === 'null') {
        typeHint = TYPE_TEXT;
        // No default bytes for null
      }

      const slotId = ctx.addSlot(name, typeHint, SOURCE_CLIENT, defaultBytes);
      signalSlots.set(name, slotId);
    }

    // 9. Build import map from the component file (for sub-component resolution)
    const componentAst = parse(componentSource, PARSE_OPTS);
    const importMap = new Map<string, string>();
    for (const node of componentAst.program.body) {
      if (t.isImportDeclaration(node)) {
        const importPath = node.source.value;
        for (const spec of node.specifiers) {
          importMap.set(spec.local.name, importPath);
        }
      }
    }

    // 10. Build resolve callback for sub-components
    const componentDir = dirname(componentPath);
    const resolveComponent = (name: string): { source: string; functionName: string } | null => {
      const importPathRaw = importMap.get(name);
      if (!importPathRaw) return null;

      // Only resolve relative imports (not package imports like 'formajs')
      if (!importPathRaw.startsWith('.') && !importPathRaw.startsWith('/')) return null;

      const resolvedPath = resolveFilePath(componentDir, importPathRaw);
      if (!resolvedPath) return null;

      try {
        let source = readFileSync(resolvedPath, 'utf8');
        if (resolvedPath.endsWith('.tsx') || resolvedPath.endsWith('.jsx')) {
          try {
            const esbuild = _require('esbuild');
            source = esbuild.transformSync(source, {
              loader: resolvedPath.endsWith('.tsx') ? 'tsx' : 'jsx',
              jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm',
            }).code;
          } catch { /* use raw source */ }
        }
        return { source, functionName: name };
      } catch {
        return null;
      }
    };

    // 11. Build WalkContext and walk the h() tree
    const walkCtx: WalkContext = {
      fileConstants,
      signalSlots,
      signalDefaults,
      resolveComponent,
      visited: new Set(),
      depth: 0,
      islandNames: entryInfo.islandNames,
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

    // 12. Return the binary and island metadata
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
 * Resolve a relative import path to an absolute file path.
 * Tries the path as-is, then with .ts extension.
 */
function resolveFilePath(fromDir: string, importPath: string): string | null {
  const base = resolve(fromDir, importPath);

  // Try exact path
  if (existsSync(base) && !isDirectory(base)) return base;

  // Try with .ts extension
  const withTs = base + '.ts';
  if (existsSync(withTs)) return withTs;

  // Try with .tsx extension
  const withTsx = base + '.tsx';
  if (existsSync(withTsx)) return withTsx;

  // Try with /index.ts
  const indexTs = join(base, 'index.ts');
  if (existsSync(indexTs)) return indexTs;

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

// ---------------------------------------------------------------------------
// Placeholder IR Generation
// ---------------------------------------------------------------------------

/**
 * Generate a placeholder IR for a page.
 *
 * Produces a minimal FMIR binary representing:
 *   <div id="app" data-forma-page="{pageName}"></div>
 *
 * This is enough to validate the full pipeline without needing to resolve
 * component imports and walk their h() trees.
 */
function generatePlaceholderIr(pageName: string): Uint8Array {
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

          // Write island metadata alongside IR if any islands were discovered
          if (irIslands.length > 0) {
            const islandMetaPath = join(options.outDir, `${options.page}.islands.json`);
            writeFileSync(islandMetaPath, JSON.stringify(irIslands, null, 2) + '\n');
            console.log(`   Islands metadata: ${options.page}.islands.json (${irIslands.length} islands)`);
          }
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
