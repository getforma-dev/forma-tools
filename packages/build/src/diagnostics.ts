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
 * `strict` and `diagnosticsJson` from the config, else from the command line
 * of the script that calls `build()`: `--strict`, and
 * `--diagnostics-json=<path>` or `--diagnostics-json <path>`. The build has no
 * binary of its own, so its flags are read where an application's build
 * script already reads `--ssr` and `--watch`. A config value always wins.
 * Verified by: packages/build/tests/strict.test.ts > "reads --strict and --diagnostics-json from the command line unless the config sets them"
 */
export function resolveDiagnosticOptions(
  config: BuildConfig,
  argv: readonly string[] = process.argv,
): { strict: boolean; diagnosticsJson?: string } {
  let jsonFromArgv: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--diagnostics-json=')) jsonFromArgv = arg.slice('--diagnostics-json='.length);
    else if (arg === '--diagnostics-json' && argv[i + 1] && !argv[i + 1]!.startsWith('--')) jsonFromArgv = argv[i + 1];
  }
  const diagnosticsJson = config.diagnosticsJson ?? (jsonFromArgv || undefined);
  return {
    strict: config.strict ?? argv.includes('--strict'),
    ...(diagnosticsJson ? { diagnosticsJson } : {}),
  };
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

  /** A diagnostic the build itself reports (BUILD-801), not a page's. */
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
 * Write the JSON report: `{ version, strict, diagnostics }`, one object per
 * diagnostic with its code, severity, page, file, line, column, message, why,
 * fix and (BUILD-403) chain.
 */
export function writeDiagnosticsJson(path: string, strict: boolean, diagnostics: BuildDiagnostic[]): string {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify({ version: 1, strict, diagnostics }, null, 2) + '\n');
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
