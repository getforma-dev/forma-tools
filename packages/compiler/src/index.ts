/**
 * Forma Compiler - Public API
 *
 * Re-exports the Vite plugin and the core transform function.
 */

export { formaCompiler, type FormaCompilerOptions } from './vite-plugin.js';
export { compileFormaJSX } from './transform.js';
export { formaServer, type FormaServerOptions } from './vite-plugin.js';
export { transformServerFunctions } from './server-transform.js';
export { formaSsrPlugin, generateRealIr, type SsrPluginOptions, type IrResult } from './esbuild-ssr-plugin.js';
export { IrEmitContext, emitIr } from './ir-emit.js';
export { ComponentAnalyzer, type EntryPointInfo, type ComponentInfo, type SignalDefault } from './component-analyzer.js';
export { classifySubtree, SubtreeClassification } from './ir-analyze.js';
export { walkHTree, walkCallExpression, type WalkContext } from './ir-walk.js';
