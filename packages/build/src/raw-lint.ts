/**
 * @getforma/build — the raw-entry allowlist lint, `forma-raw-lint`
 * (FORMA-126; SR8, M8, DR-19, L-37).
 *
 * An application runs it in CI over its sources. It finds every use of
 * INV1's and INV2's exits (the raw-HTML constructors and the string forms the
 * A2 bridge still accepts, the typed raw homes, Trusted Types' per-route
 * relaxation; `RAW_EXITS`), and fails on any the allowlist file does not list
 * with an owner and an end date, and on any listed entry past its end date.
 * The allowlist is the inventory of the application's raw entries (DR-19's
 * monitoring cost).
 *
 * The allowlist, `forma-raw-allowlist.json`:
 *
 * ```json
 * {
 *   "version": 1,
 *   "entries": [
 *     { "path": "src/server/mod.rs", "symbol": "app_page", "exit": "body_prefix",
 *       "owner": "studio", "until": "2027-01-31",
 *       "reason": "the app shell; moves to RawHtml::trusted (appendix E)" }
 *   ]
 * }
 * ```
 *
 * `path` is relative to the allowlist's directory, with `/`. An entry names a
 * line or a symbol (the innermost named function, method, class or module,
 * as the lint prints it), lists at most `count` uses (default 1), and expires
 * after `until`, the last day it is valid.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

import { EXIT_NAMES, RAW_EXITS, type Found } from './raw-lint-exits.js';
import { RustFile, scanRust } from './raw-lint-rust.js';
import { ScanError, scanHtml, scanScript } from './raw-lint-script.js';

export { RAW_EXITS } from './raw-lint-exits.js';

/** Where the codes are documented. */
const CATALOGUE_URL = 'https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md';

/** The allowlist's file name, read from the working directory when none is named. */
export const DEFAULT_ALLOWLIST = 'forma-raw-allowlist.json';

export interface RawLintCode {
  code: string;
  title: string;
  why: string;
  fix: string;
  /** An error fails the run; a warning never does. */
  severity: 'error' | 'warning';
}

/**
 * The lint's codes, BUILD-810 to BUILD-814, in the build package's family
 * (`docs/DIAGNOSTICS.md`). The compiler's `DIAGNOSTIC_CATALOGUE` carries the
 * same entries, which a test keeps equal.
 */
export const RAW_LINT_CATALOGUE: readonly RawLintCode[] = Object.freeze([
  {
    code: 'BUILD-810',
    title: 'Raw entry not on the allowlist (forma-raw-lint)',
    why: "The source uses one of INV1's and INV2's exits (raw HTML, a typed raw home or a Trusted Types relaxation), and the allowlist names no owner and end date for it (SR8).",
    fix: 'Write it without the exit (render through a component, or the typed form the message names), or add an entry to forma-raw-allowlist.json with its path, line or symbol, exit, owner, until and reason.',
    severity: 'error',
  },
  {
    code: 'BUILD-811',
    title: 'Allowlist entry past its end date (forma-raw-lint)',
    why: "The entry's until date has passed: the raw entry it lists was due to go, and its owner has neither removed nor renewed it.",
    fix: 'Remove the raw entry and its allowlist entry, or, with its owner, set a new until and say why in reason.',
    severity: 'error',
  },
  {
    code: 'BUILD-812',
    title: 'Allowlist file the lint cannot use (forma-raw-lint)',
    why: 'The allowlist cannot be read, is not version 1, or has an entry without a path, a known exit, one of line or symbol, an owner, a real until date or a reason; the lint does not guess what it meant.',
    fix: 'Correct the file: the message names the entry and the field.',
    severity: 'error',
  },
  {
    code: 'BUILD-813',
    title: 'Allowlist entry that lists nothing (forma-raw-lint; note)',
    why: 'No raw entry matches it, so the inventory overstates: the exit was removed, or moved to another line or symbol. A note: the run does not fail on it.',
    fix: 'Remove the entry, or point its line or symbol at where the raw entry now is.',
    severity: 'warning',
  },
  {
    code: 'BUILD-814',
    title: 'Source file the lint cannot read (forma-raw-lint)',
    why: 'The file could not be read or parsed, so the raw entries in it cannot be counted; the lint fails rather than pass a file it did not see.',
    fix: 'Fix the syntax error the message names, or leave the file out with --exclude if it is not source.',
    severity: 'error',
  },
]);

const CODE: ReadonlyMap<string, RawLintCode> = new Map(RAW_LINT_CATALOGUE.map((c) => [c.code, c]));

export interface RawLintOptions {
  /** Files and directories to scan, relative to `cwd`. */
  paths: readonly string[];
  /** The allowlist file. Default: `forma-raw-allowlist.json` in `cwd`, if it exists. */
  allowlist?: string;
  /** What paths in the allowlist and the report are relative to. Default: the allowlist's directory, else `cwd`. */
  root?: string;
  /** The day end dates are checked against, `YYYY-MM-DD`. Default: today, in UTC. */
  today?: string;
  /** Globs, relative to the root, of files and directories not to scan (`**`, `*`, `?`). */
  exclude?: readonly string[];
  /** Default: `process.cwd()`. */
  cwd?: string;
}

/** An allowlist entry, as the report names it. */
export interface AllowlistEntryRef {
  /** Its position in `entries`, from 0. */
  index: number;
  path: string;
  exit: string;
  line?: number;
  symbol?: string;
  owner: string;
  until: string;
  reason: string;
  count: number;
}

/** One raw entry found, and what the allowlist says of it. */
export interface RawEntry extends Found {
  /** Relative to the root, with `/`. */
  file: string;
  /** An unexpired entry lists it. */
  listed: boolean;
  /** The index of the entry that lists it, expired or not; null if none does. */
  entry: number | null;
  /** The entry that lists it is past its end date. */
  expired: boolean;
}

export interface RawLintDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  /** The exit, for BUILD-810; the entry's exit for BUILD-811 and BUILD-813. */
  exit: string | null;
  file: string;
  line: number;
  column: number;
  symbol: string | null;
  message: string;
  why: string;
  fix: string;
  entry?: AllowlistEntryRef;
}

export interface RawLintReport {
  /** 1: a field may be added without changing it; renaming or removing one increments it. */
  version: 1;
  today: string;
  /** Relative to the root; null when there is none. */
  allowlist: string | null;
  /** Source files read. */
  files: number;
  /** Every raw entry found, in file and position order: the inventory. */
  rawEntries: RawEntry[];
  diagnostics: RawLintDiagnostic[];
  /** 0 passes; 1 a BUILD-810, BUILD-811 or BUILD-814; 2 a BUILD-812. */
  exitCode: 0 | 1 | 2;
}

/** A path, option or argument the lint cannot run with (exit code 2). */
export class RawLintUsageError extends Error {}

const SCRIPT_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const RUST_FILE = /\.rs$/i;
const HTML_FILE = /\.html?$/i;
const DECLARATION_FILE = /\.d\.[cm]?ts$/i;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'target']);

function isSource(path: string): boolean {
  return (SCRIPT_FILE.test(path) && !DECLARATION_FILE.test(path)) || RUST_FILE.test(path) || HTML_FILE.test(path);
}

/** `**`, `*` and `?` over `/`-separated paths. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function diagnostic(code: string, fields: Omit<RawLintDiagnostic, 'code' | 'severity' | 'why' | 'fix'>): RawLintDiagnostic {
  const c = CODE.get(code)!;
  return { code, severity: c.severity, ...fields, why: c.why, fix: c.fix };
}

const ENTRY_FIELDS = new Set(['path', 'exit', 'line', 'symbol', 'owner', 'until', 'reason', 'count']);

/** The allowlist's entries, each checked; what is wrong with any is a BUILD-812. */
function readAllowlist(path: string, label: string): { entries: AllowlistEntryRef[]; problems: RawLintDiagnostic[] } {
  const problems: RawLintDiagnostic[] = [];
  const problem = (message: string) => problems.push(diagnostic('BUILD-812', { exit: null, file: label, line: 0, column: 0, symbol: null, message }));
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    problem(`${label} cannot be read as JSON: ${(err as Error).message}`);
    return { entries: [], problems };
  }
  const doc = data as { version?: unknown; entries?: unknown };
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    problem(`${label} is not an object with version and entries`);
    return { entries: [], problems };
  }
  for (const key of Object.keys(doc)) if (key !== 'version' && key !== 'entries') problem(`${label}: unknown top-level field '${key}'`);
  if (doc.version !== 1) problem(`${label}: version is ${JSON.stringify(doc.version)}; this lint reads version 1`);
  if (!Array.isArray(doc.entries)) {
    problem(`${label}: entries is not an array`);
    return { entries: [], problems };
  }
  const entries: AllowlistEntryRef[] = [];
  doc.entries.forEach((raw: unknown, index: number) => {
    const where = `${label} entries[${index}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      problem(`${where} is not an object`);
      return;
    }
    const e = raw as Record<string, unknown>;
    const before = problems.length;
    for (const key of Object.keys(e)) if (!ENTRY_FIELDS.has(key)) problem(`${where}: unknown field '${key}'`);
    const text = (field: string): string | undefined => {
      const v = e[field];
      if (typeof v !== 'string' || v.trim() === '') {
        problem(`${where}: ${field} must be a non-empty string`);
        return undefined;
      }
      return v;
    };
    const path = text('path');
    const exit = text('exit');
    const owner = text('owner');
    const until = text('until');
    const reason = text('reason');
    if (exit !== undefined && !EXIT_NAMES.has(exit)) problem(`${where}: exit '${exit}' is not one the lint knows (${[...EXIT_NAMES].join(', ')})`);
    if (until !== undefined && !isValidDate(until)) problem(`${where}: until '${until}' is not a date written YYYY-MM-DD`);
    const hasLine = e.line !== undefined;
    const hasSymbol = e.symbol !== undefined;
    if (hasLine === hasSymbol) problem(`${where}: name exactly one of line and symbol`);
    if (hasLine && !(Number.isInteger(e.line) && (e.line as number) > 0)) problem(`${where}: line must be a positive integer`);
    if (hasSymbol && (typeof e.symbol !== 'string' || e.symbol.trim() === '')) problem(`${where}: symbol must be a non-empty string`);
    if (e.count !== undefined && !(Number.isInteger(e.count) && (e.count as number) > 0)) problem(`${where}: count must be a positive integer`);
    if (problems.length > before) return;
    entries.push({
      index,
      path: posix.normalize(path!.replace(/\\/g, '/')).replace(/^\.\//, ''),
      exit: exit!,
      ...(hasLine ? { line: e.line as number } : { symbol: e.symbol as string }),
      owner: owner!,
      until: until!,
      reason: reason!,
      count: (e.count as number | undefined) ?? 1,
    });
  });
  return { entries, problems };
}

/** The source files under `paths`, sorted, each once. */
function listFiles(paths: readonly string[], cwd: string, root: string, exclude: RegExp[]): string[] {
  const files = new Set<string>();
  const rel = (abs: string) => relative(root, abs).split(sep).join('/');
  const excluded = (abs: string, dir: boolean) => {
    const r = rel(abs);
    return exclude.some((re) => re.test(r) || (dir && re.test(r + '/')));
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = resolve(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(name) || name.startsWith('.') || excluded(abs, true)) continue;
        walk(abs);
      } else if (st.isFile() && isSource(name) && !excluded(abs, false)) {
        files.add(abs);
      }
    }
  };
  for (const p of paths) {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) throw new RawLintUsageError(`no such file or directory: ${p}`);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (!excluded(abs, true)) walk(abs);
    } else if (!isSource(abs)) {
      throw new RawLintUsageError(`${p} is not a file the lint reads (TypeScript, JavaScript, Rust or HTML)`);
    } else if (!excluded(abs, false)) {
      files.add(abs);
    }
  }
  return [...files].sort();
}

/**
 * Run the lint. Throws {@link RawLintUsageError} for a path that does not
 * exist or an option it cannot use; everything else is in the report.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts > "SR8: a seeded body_prefix outside the allowlist fails, and so does an entry past its end date"
 */
export function rawLint(options: RawLintOptions): RawLintReport {
  const cwd = options.cwd ?? process.cwd();
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!isValidDate(today)) throw new RawLintUsageError(`today '${today}' is not a date written YYYY-MM-DD`);
  if (options.paths.length === 0) throw new RawLintUsageError('name at least one file or directory to scan');

  let allowlistPath: string | null = null;
  if (options.allowlist !== undefined) allowlistPath = resolve(cwd, options.allowlist);
  else if (existsSync(resolve(cwd, DEFAULT_ALLOWLIST))) allowlistPath = resolve(cwd, DEFAULT_ALLOWLIST);
  const root = options.root !== undefined ? resolve(cwd, options.root) : allowlistPath ? dirname(allowlistPath) : cwd;
  const rel = (abs: string) => relative(root, abs).split(sep).join('/');

  const diagnostics: RawLintDiagnostic[] = [];
  let entries: AllowlistEntryRef[] = [];
  const allowlistLabel = allowlistPath ? rel(allowlistPath) : null;
  if (allowlistPath) {
    if (!existsSync(allowlistPath)) {
      diagnostics.push(diagnostic('BUILD-812', { exit: null, file: allowlistLabel!, line: 0, column: 0, symbol: null, message: `${options.allowlist}: no such allowlist file` }));
    } else {
      const read = readAllowlist(allowlistPath, allowlistLabel!);
      entries = read.entries;
      diagnostics.push(...read.problems);
    }
  }

  const files = listFiles(options.paths, cwd, root, (options.exclude ?? []).map(globToRegExp));

  // Rust aliases of RawHtml are collected from every file before any is scanned.
  const found: Array<Found & { file: string }> = [];
  const rustFiles: Array<{ file: string; rust: RustFile }> = [];
  const aliases = new Set<string>();
  for (const abs of files) {
    const file = rel(abs);
    let source: string;
    try {
      source = readFileSync(abs, 'utf8');
    } catch (err) {
      diagnostics.push(diagnostic('BUILD-814', { exit: null, file, line: 0, column: 0, symbol: null, message: `${file} cannot be read: ${(err as Error).message}` }));
      continue;
    }
    try {
      if (RUST_FILE.test(abs)) {
        const rust = new RustFile(source);
        for (const a of rust.aliases) aliases.add(a);
        rustFiles.push({ file, rust });
      } else if (HTML_FILE.test(abs)) {
        found.push(...scanHtml(source, file).map((f) => ({ ...f, file })));
      } else {
        found.push(...scanScript(source, file).map((f) => ({ ...f, file })));
      }
    } catch (err) {
      if (!(err instanceof ScanError)) throw err;
      diagnostics.push(diagnostic('BUILD-814', { exit: null, file, line: err.line, column: err.column, symbol: null, message: `${file} cannot be parsed: ${err.message}` }));
    }
  }
  for (const { file, rust } of rustFiles) found.push(...scanRust(rust, aliases).map((f) => ({ ...f, file })));
  found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column));

  // Match each raw entry to the first entry with room for it.
  const used = new Map<number, number>();
  const matchedBy = new Map<number, Array<Found & { file: string }>>();
  const expired = (e: AllowlistEntryRef) => today > e.until;
  const rawEntries: RawEntry[] = [];
  for (const f of found) {
    const entry = entries.find((e) =>
      e.path === f.file && e.exit === f.exit && (e.line !== undefined ? e.line === f.line : e.symbol === f.symbol) && (used.get(e.index) ?? 0) < e.count);
    if (entry) {
      used.set(entry.index, (used.get(entry.index) ?? 0) + 1);
      matchedBy.set(entry.index, [...(matchedBy.get(entry.index) ?? []), f]);
    }
    rawEntries.push({ ...f, listed: entry !== undefined && !expired(entry), entry: entry ? entry.index : null, expired: entry !== undefined && expired(entry) });
    if (!entry) {
      diagnostics.push(diagnostic('BUILD-810', {
        exit: f.exit, file: f.file, line: f.line, column: f.column, symbol: f.symbol,
        message: `${f.exit}: ${f.message}; not on the allowlist`,
      }));
    }
  }
  for (const e of entries) {
    const matches = matchedBy.get(e.index) ?? [];
    const at = matches[0];
    const where = { exit: e.exit, file: e.path, line: at?.line ?? e.line ?? 0, column: at?.column ?? 0, symbol: at?.symbol ?? e.symbol ?? null, entry: e };
    if (expired(e)) {
      const listing = matches.length === 0 ? 'and lists nothing' : `listing ${matches.length} ${e.exit} use${matches.length === 1 ? '' : 's'}`;
      diagnostics.push(diagnostic('BUILD-811', { ...where, message: `the allowlist entry for ${e.exit} in ${e.path} (${e.line !== undefined ? `line ${e.line}` : `symbol ${e.symbol}`}, owner ${e.owner}) ended on ${e.until}, ${listing}` }));
    } else if (matches.length === 0) {
      diagnostics.push(diagnostic('BUILD-813', { ...where, message: `the allowlist entry for ${e.exit} in ${e.path} (${e.line !== undefined ? `line ${e.line}` : `symbol ${e.symbol}`}) lists nothing` }));
    }
  }

  const hasCode = (code: string) => diagnostics.some((d) => d.code === code);
  const exitCode: 0 | 1 | 2 = hasCode('BUILD-812') ? 2 : diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
  const order = (d: RawLintDiagnostic) => RAW_LINT_CATALOGUE.findIndex((c) => c.code === d.code);
  diagnostics.sort((a, b) => order(a) - order(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column));
  return { version: 1, today, allowlist: allowlistLabel, files: files.length, rawEntries, diagnostics, exitCode };
}

/** One line per diagnostic, then the count and each code's why and fix. */
export function formatRawLintReport(report: RawLintReport): string {
  const lines: string[] = [];
  for (const d of report.diagnostics) {
    const where = d.line > 0 ? `${d.file}:${d.line}:${d.column}` : d.file;
    const symbol = d.symbol ? ` (in ${d.symbol})` : '';
    lines.push(`${d.code} ${d.severity} ${d.exit ?? ''}${d.exit ? ' ' : ''}in ${where}${symbol}: ${d.message}`);
  }
  const listed = report.rawEntries.filter((e) => e.listed).length;
  const count = (code: string) => report.diagnostics.filter((d) => d.code === code).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  lines.push(
    `forma-raw-lint: ${plural(report.rawEntries.length, 'raw entry', 'raw entries')} in ${plural(report.files, 'file', 'files')}: ` +
    `${listed} listed, ${count('BUILD-810')} not on the allowlist; ` +
    `${plural(count('BUILD-811'), 'allowlist entry', 'allowlist entries')} past the end date; ` +
    `${plural(count('BUILD-813'), 'allowlist entry', 'allowlist entries')} listing nothing` +
    (count('BUILD-812') ? `; ${plural(count('BUILD-812'), 'allowlist problem', 'allowlist problems')}` : '') +
    (count('BUILD-814') ? `; ${plural(count('BUILD-814'), 'file', 'files')} not read` : '') +
    (report.exitCode === 0 ? '. Pass.' : '. Fail.'),
  );
  for (const c of RAW_LINT_CATALOGUE) {
    if (!report.diagnostics.some((d) => d.code === c.code)) continue;
    lines.push(`  ${c.code} ${c.title}. Why: ${c.why} Fix: ${c.fix}`);
  }
  if (report.diagnostics.length > 0) lines.push(`  The codes: ${CATALOGUE_URL}`);
  return lines.join('\n');
}

const USAGE = `Usage: forma-raw-lint [options] <file or directory>...

Fails when a use of INV1's and INV2's exits (raw HTML, the typed raw homes, a
Trusted Types relaxation) is not on the allowlist with an owner and an end
date, or when an allowlist entry is past its end date (SR8).

Options:
  --allowlist <file>  The allowlist (default: ./${DEFAULT_ALLOWLIST}, if it exists)
  --root <dir>        What paths are relative to (default: the allowlist's directory, else .)
  --exclude <glob>    Do not scan matching files or directories; repeatable
  --today <date>      Check end dates against this day, YYYY-MM-DD (default: today, UTC)
  --json              Print the report as JSON instead of text
  --report <file>     Also write the JSON report to this file
  --exits             List the exits an entry's "exit" can name
  -h, --help          Show this help

Exit codes: 0 pass; 1 a raw entry not on the allowlist, an entry past its end
date, or a file the lint cannot read; 2 a usage error or an allowlist the lint
cannot use. Codes: ${CATALOGUE_URL}`;

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd: string;
}

/**
 * The `forma-raw-lint` command. Returns the exit code.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts > "the command: exit codes, text and JSON"
 */
export function runRawLintCli(argv: readonly string[], io: CliIo): number {
  const paths: string[] = [];
  const exclude: string[] = [];
  let allowlist: string | undefined;
  let root: string | undefined;
  let today: string | undefined;
  let json = false;
  let reportFile: string | undefined;
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new RawLintUsageError(`${flag} needs a value`);
    return v;
  };
  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const take = () => {
        if (inline !== undefined) return inline;
        const v = value(i, flag);
        i++;
        return v;
      };
      switch (flag) {
        case '-h':
        case '--help':
          io.stdout(USAGE);
          return 0;
        case '--exits':
          io.stdout(RAW_EXITS.map((e) => `${e.name.padEnd(24)} ${e.language.padEnd(6)} ${e.what}`).join('\n'));
          return 0;
        case '--allowlist': allowlist = take(); break;
        case '--root': root = take(); break;
        case '--exclude': exclude.push(take()); break;
        case '--today': today = take(); break;
        case '--report': reportFile = take(); break;
        case '--json': json = true; break;
        default:
          if (arg.startsWith('-')) throw new RawLintUsageError(`unknown option ${arg}`);
          paths.push(arg);
      }
    }
    const report = rawLint({ paths, exclude, cwd: io.cwd, ...(allowlist !== undefined ? { allowlist } : {}), ...(root !== undefined ? { root } : {}), ...(today !== undefined ? { today } : {}) });
    const text = JSON.stringify(report, null, 2);
    if (reportFile) writeFileSync(isAbsolute(reportFile) ? reportFile : resolve(io.cwd, reportFile), text + '\n');
    io.stdout(json ? text : formatRawLintReport(report));
    return report.exitCode;
  } catch (err) {
    if (err instanceof RawLintUsageError) {
      io.stderr(`forma-raw-lint: ${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
}
