/**
 * @getforma/build — Type definitions
 *
 * Configuration and result types for the Forma build pipeline.
 */

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export interface BuildEntry {
  /** Entry point file path */
  entry: string;
  /** Output file path (relative to outputDir) */
  outfile: string;
}

export interface CssEntry {
  /** Glob or array of CSS files to concatenate */
  input: string | string[];
  /** Output file path (relative to outputDir) */
  outfile: string;
  /** If true, run @tailwindcss/cli on the first input file */
  tailwind?: boolean;
}

export interface RouteMapping {
  /** Base names (without extension) of JS files for this route */
  js: string[];
  /** Base names (without extension) of CSS files for this route */
  css: string[];
  /** Font file names for this route (optional, defaults to all fonts in outputDir) */
  fonts?: string[];
}

export interface BuildConfig {
  /** JavaScript entry points to build */
  entryPoints: BuildEntry[];
  /** Route-to-asset mapping for manifest generation */
  routes: Record<string, RouteMapping>;
  /** CSS entries to generate (tailwind and/or concatenation) */
  cssEntries?: CssEntry[];
  /** Output directory for all built assets */
  outputDir: string;
  /** Path or package name to alias '@getforma/core' to in esbuild */
  formaAlias?: string;
  /** Directory containing .woff2 font files to copy */
  fontDir?: string;
  /** Enable SSR IR emission */
  ssr?: boolean;
  /** SSR entry points for IR emission (page name -> entry path) */
  ssrEntryPoints?: Record<string, string>;
  /** WASM crate configuration */
  wasm?: { crateDir: string };
  /** Enable watch mode */
  watch?: boolean;
  /** Budget threshold in bytes (Brotli-compressed), default 200_000 */
  budgetThreshold?: number;
  /** Files that should keep unhashed copies (e.g. for server-inlined assets) */
  serverInlined?: string[];
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface RouteManifest {
  js: string[];
  css: string[];
  fonts: string[];
  total_size_br: number;
  budget_warn_threshold: number;
  ir?: string;
}

export interface AssetManifest {
  version: number;
  build_hash: string;
  assets: Record<string, string>;
  routes: Record<string, RouteManifest>;
  wasm?: { loader: string; binary: string };
}

export interface BuildResult {
  manifest: AssetManifest;
  buildHash: string;
  warnings: string[];
}
