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
  /**
   * The application's name, for its service worker (DR-25, FORMA-130). The
   * same string the server passes to forma-server's
   * `sw::ServiceWorker::for_app`: 1 to 63 of `a-z`, `0-9` and `-`, starting
   * with a letter or digit.
   *
   * With it, the production worker names its cache `forma:<app>:<build>`,
   * deletes on activation only v1's cache names and this application's older
   * caches (never another application's), and waits for the previous build's
   * worker to control no tab instead of taking over (no `skipWaiting()`, no
   * `clients.claim()`). forma-server 0.2.2 serves it only to an application
   * that enables its worker; otherwise `/sw.js` is forma-server's retiring
   * worker, which deletes these same caches. Without it, the worker is
   * 0.3.0's, kept for a server not yet on forma-server 0.2.2. The development
   * (watch) worker ignores it.
   */
  app?: string;
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

export interface BuildResult {
  manifest: AssetManifest;
  buildHash: string;
  warnings: string[];
}
