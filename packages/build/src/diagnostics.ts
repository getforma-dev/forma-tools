/**
 * @getforma/build — coded SSR diagnostics, `--strict` and the JSON report
 * (FORMA-119; DR-1, N12)
 *
 * The compiler reports every construct it cannot represent with a stable
 * code, file, line and column, and still prints the line it printed before.
 * The build gathers them from every page, returns them in its result, writes
 * them as JSON on request, and under `--strict` fails with all of them at
 * once, after every page has been compiled, rather than at the first.
 *
 * Verified by: packages/build/tests/strict.test.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { BuildConfig, BuildDiagnostic } from './types.js';

/** A diagnostic as `@getforma/compiler` hands it over (0.3.7 and later). */
export interface CompilerDiagnostic {
  code: string;
  file: string;
  line: number;
  column: number;
  message: string;
  why: string;
  fix: string;
  strict: boolean;
  chain?: BuildDiagnostic['chain'];
}

/** Where the catalogue lives, named in a failing `--strict` build. */
export const CATALOGUE_URL = 'https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md';

/**
 * `strict` from the config, else from the environment: `FORMA_STRICT=1` (or
 * `true`) turns it on, unset or `0` (or `false`) leaves it off, and any other
 * value is refused rather than read as off, since a strict switch that fails
 * open passes the pages it was set to check. The build reads no command-line
 * flag of its own, as for `ssr` and `watch`: a script that calls `build()`
 * maps its own flags to the config (the templates map `--strict`). The
 * variable is namespaced so it cannot be a flag meant for another tool.
 * `diagnosticsJson` is config only.
 * Verified by: packages/build/tests/strict.test.ts > "takes strict from the config, else from FORMA_STRICT, and reads no command-line flag"
 */
export function resolveDiagnosticOptions(
  config: BuildConfig,
  env: NodeJS.ProcessEnv = process.env,
): { strict: boolean; diagnosticsJson?: string } {
  let strict = config.strict;
  if (strict === undefined) {
    const value = env.FORMA_STRICT;
    if (value === undefined || value === '' || value === '0' || value === 'false') strict = false;
    else if (value === '1' || value === 'true') strict = true;
    else {
      throw new Error(
        `@getforma/build: FORMA_STRICT is '${value}': set it to 1 to fail the build on SSR diagnostics, or unset it`,
      );
    }
  }
  return { strict, ...(config.diagnosticsJson ? { diagnosticsJson: config.diagnosticsJson } : {}) };
}

/**
 * The diagnostics of one build, page by page. A page's latest compilation
 * replaces its earlier one, so in watch mode the list describes the modules
 * as they are now. Pages are listed in the order of the config's entries,
 * whichever finished compiling first, so the report is the same every run.
 */
export class DiagnosticsCollector {
  private readonly byPage = new Map<string, BuildDiagnostic[]>();
  private readonly buildLevel: BuildDiagnostic[] = [];

  constructor(private readonly strict: boolean, private readonly pageOrder: readonly string[] = []) {}

  /** The SSR plugin's `onDiagnostics` callback. */
  readonly onDiagnostics = (diagnostics: CompilerDiagnostic[], page: string): void => {
    this.byPage.set(page, diagnostics.map((d) => this.toBuildDiagnostic(d, page)));
  };

  /** A diagnostic the build itself reports (BUILD-801, BUILD-802), not a page's. */
  addBuildLevel(diagnostic: CompilerDiagnostic): void {
    this.buildLevel.push(this.toBuildDiagnostic(diagnostic, ''));
  }

  /** Every diagnostic: the build's own first, then each page's in build order. */
  all(): BuildDiagnostic[] {
    const rank = (page: string) => {
      const i = this.pageOrder.indexOf(page);
      return i === -1 ? this.pageOrder.length : i;
    };
    const pages = [...this.byPage.keys()].sort((a, b) => rank(a) - rank(b));
    return [...this.buildLevel, ...pages.flatMap((page) => this.byPage.get(page)!)];
  }

  /** The ones `--strict` fails the build on. */
  errors(): BuildDiagnostic[] {
    return this.all().filter((d) => d.severity === 'error');
  }

  private toBuildDiagnostic(d: CompilerDiagnostic, page: string): BuildDiagnostic {
    return {
      code: d.code,
      severity: !d.strict ? 'note' : this.strict ? 'error' : 'warning',
      page,
      file: d.file,
      line: d.line,
      column: d.column,
      message: d.message,
      why: d.why,
      fix: d.fix,
      ...(d.chain ? { chain: d.chain } : {}),
    };
  }
}

/**
 * BUILD-801: SSR was asked for, and @getforma/compiler cannot be loaded. The
 * build reports it itself, since there is no compiler to.
 */
export function compilerMissing(): CompilerDiagnostic {
  return {
    code: 'BUILD-801',
    file: '',
    line: 0,
    column: 0,
    message: '@getforma/compiler not available for SSR. Skipping IR emission.',
    why: 'The build was asked for server-rendered modules but cannot load @getforma/compiler, so it writes none.',
    fix: 'Install @getforma/compiler (a peer dependency of @getforma/build), or turn `ssr` off.',
    strict: true,
  };
}

/**
 * BUILD-802: `serviceWorker` without `app` (FORMA-130's deprecation), in the
 * report beside the line the build prints. A note: --strict does not fail on
 * a deprecation, which is not a construct the server cannot render.
 */
export function workerWithoutAppDiagnostic(message: string): CompilerDiagnostic {
  return {
    code: 'BUILD-802',
    file: '',
    line: 0,
    column: 0,
    message: message.replace(/^BUILD-802 /, ''),
    why: "The worker is 0.3.0's: its caches are shared by every Forma application on the origin, and it takes over open tabs at once. From 3.0.0 a worker is written only for a named app.",
    fix: "Set `app` to the name the server passes to forma-server's `sw::ServiceWorker::for_app`.",
    strict: false,
  };
}

/** The report's format version. A field may be added without a change;
 *  renaming or removing a field, or changing what one means, increments it. */
export const DIAGNOSTICS_JSON_VERSION = 1;

/**
 * Write the JSON report: `{ version, strict, diagnostics }`, one object per
 * diagnostic with its code, severity, page, file, line, column, message, why,
 * fix and (BUILD-403) chain. The path is outside `outputDir` (validation
 * refuses one inside), so the staging swap never touches it.
 */
export function writeDiagnosticsJson(path: string, strict: boolean, diagnostics: BuildDiagnostic[]): string {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify({ version: DIAGNOSTICS_JSON_VERSION, strict, diagnostics }, null, 2) + '\n');
  return target;
}

/** One diagnostic as `file:line:column  CODE  message`, then why and fix. */
export function formatBuildDiagnostic(d: BuildDiagnostic): string {
  const where = d.file ? (d.line > 0 ? `${d.file}:${d.line}:${d.column}` : d.file) : `(page ${d.page || 'none'})`;
  return `${where}  ${d.code}  ${d.message}\n    why: ${d.why}\n    fix: ${d.fix}`;
}

/** The error a `--strict` build fails with: every error, then the catalogue. */
export function strictFailure(errors: BuildDiagnostic[]): Error & { diagnostics: BuildDiagnostic[] } {
  const count = errors.length === 1 ? '1 SSR diagnostic is an error' : `${errors.length} SSR diagnostics are errors`;
  const error = new Error(
    `@getforma/build --strict: ${count} (without --strict they are warnings):\n`
    + errors.map(formatBuildDiagnostic).join('\n')
    + `\nEach code, with its fix: ${CATALOGUE_URL}`,
  ) as Error & { diagnostics: BuildDiagnostic[] };
  error.name = 'FormaStrictBuildError';
  error.diagnostics = errors;
  return error;
}
