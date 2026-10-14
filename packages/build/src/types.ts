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
  /** Disable SSR for this entry in an otherwise SSR-enabled application. */
  ssr?: boolean;
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
  /** Package name to resolve 'formajs' imports to (e.g. '@getforma/core') */
  formaAlias?: string;
  /** Bundle one shared ESM graph, preserving import() as separately loaded chunks. */
  codeSplitting?: boolean;
  /** Production worker policy; default precaches CSS/fonts. On-demand caches
   * only requested manifest-listed immutable code/style/WASM assets. */
  serviceWorker?: 'precache' | 'on-demand';
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
  /**
   * Fail the build on every coded SSR diagnostic (FORMA-119, DR-1): each
   * construct the compiler cannot represent, with its code, file, line and
   * column, all reported at once. Off by default, where they stay warnings.
   * When unset, `--strict` on the command line of the script that calls
   * `build()` turns it on (`npm run build -- --strict`); `false` ignores the
   * flag. Needs `@getforma/compiler` 0.3.7 or later. In watch mode a page with
   * an error keeps its last good module.
   */
  strict?: boolean;
  /**
   * Also write every SSR diagnostic as JSON to this path (relative to the
   * working directory), whether or not the build fails: the machine-readable
   * report an agent can act on (N12). When unset,
   * `--diagnostics-json=<path>` on the command line sets it.
   */
  diagnosticsJson?: string;
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface RouteManifest {
  js: string[];
  /** Static ESM dependencies only; dynamic import() chunks are intentionally excluded. */
  modulepreload?: string[];
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

/** One link of a composition chain, from the page down (BUILD-403). */
export interface BuildDiagnosticChainLink {
  component: string;
  file: string;
  line: number;
  column: number;
}

/**
 * One coded SSR diagnostic (FORMA-119). The catalogue, one entry per code
 * with its fix, is forma-tools' `docs/DIAGNOSTICS.md`.
 */
export interface BuildDiagnostic {
  /** The stable code, e.g. `BUILD-101`. */
  code: string;
  /** `error` under `--strict`, `warning` without it; `note` never fails a build. */
  severity: 'error' | 'warning' | 'note';
  /** The page (entry outfile without `.js`) whose module reported it. */
  page: string;
  /** The file to edit; empty for a build-level diagnostic. */
  file: string;
  /** 1-based line and column in `file`, as authored; 0 when unknown. */
  line: number;
  column: number;
  /** The specific report: the construct, what happens, and its fix. */
  message: string;
  /** The catalogue's why and fix for the code. */
  why: string;
  fix: string;
  /** BUILD-403: the composition chain from the page down. */
  chain?: BuildDiagnosticChainLink[];
}

export interface BuildResult {
  manifest: AssetManifest;
  buildHash: string;
  warnings: string[];
  /** Every coded SSR diagnostic the build reported, page by page. */
  diagnostics: BuildDiagnostic[];
}
