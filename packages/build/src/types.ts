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
  /**
   * WASM crate configuration: runs `wasm-pack` on the crate and ships the
   * WASM walker.
   *
   * @deprecated Removed in 3.0.0 with the WASM walker (forma-ir's `wasm`
   * feature and `@getforma/core/wasm`); a build that sets it warns BUILD-803.
   * Islands re-render in the browser with `h()`.
   */
  wasm?: { crateDir: string };
  /** Enable watch mode */
  watch?: boolean;
  /** Budget threshold in bytes (Brotli-compressed), default 200_000 */
  budgetThreshold?: number;
  /** Files that should keep unhashed copies (e.g. for server-inlined assets) */
  serverInlined?: string[];
  /**
   * Fail the build on every coded SSR diagnostic but a note (FORMA-119,
   * DR-1): each construct the compiler cannot represent, with its code, file,
   * line and column, all reported at once. Off by default, where they stay
   * warnings. When unset, `FORMA_STRICT=1` in the environment turns it on; the
   * build reads no command-line flag, so a build script that takes `--strict`
   * maps it here, as it does `--ssr` and `--watch`. Needs
   * `@getforma/compiler` 0.3.7 or later. In watch mode a page with an error
   * keeps its last good module.
   */
  strict?: boolean;
  /**
   * Also write every SSR diagnostic as JSON to this path (relative to the
   * working directory), whether or not the build fails: the machine-readable
   * report an agent can act on (N12). It must be outside `outputDir`, which
   * the build replaces whole and serves.
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
  /** @deprecated Written only by the deprecated `wasm` config key; removed in 3.0.0. */
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
