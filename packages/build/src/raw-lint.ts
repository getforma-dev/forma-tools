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
 * after `until`, the last day it is valid (UTC), which may be at most a year
 * after the run.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

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
    why: 'The allowlist cannot be read, is not version 1, or has an entry without a path, a known exit, one of line or symbol, an owner, a real until date at most a year after the run, or a reason; the lint does not guess what it meant.',
    fix: 'Correct the file: the message names the entry and the field.',
    severity: 'error',
  },
  {
    code: 'BUILD-813',
    title: 'Allowlist entry that lists fewer uses than it says (forma-raw-lint; note)',
    why: 'It matches fewer raw entries than its count, or none, so the inventory overstates and leaves room for unreviewed uses: one was removed, or moved to another line or symbol. A note: the run does not fail on it.',
    fix: 'Lower its count to the uses it lists, remove it if it lists none, or point its line or symbol at where the raw entry now is.',
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
/**
 * The latest `until` an entry may name: one year after the run's date, so
 * every entry is revisited at least yearly (the lead's decision on the
 * FORMA-126 review). 29 February runs to 1 March.
 */
export function latestUntil(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
}

function readAllowlist(path: string, label: string, today: string): { entries: AllowlistEntryRef[]; problems: RawLintDiagnostic[] } {
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
    else if (until !== undefined && until > latestUntil(today)) {
      problem(`${where}: until '${until}' is more than a year after today (${today}); the latest it can be is ${latestUntil(today)}, so every entry is revisited at least yearly`);
    }
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

/**
 * The source files under `paths`, sorted, each once, and a BUILD-814 for each
 * path that cannot be read (FORMA-126 review, should-fix 7). Skipped names
 * (`node_modules`, `target`, a leading `.`) and `--exclude` are checked before
 * anything is read, so a dangling link there costs nothing. A symbolic link is
 * followed; one that leads nowhere or loops is a BUILD-814, unless its name
 * says it is not source (`notes.md`). A directory reached again below itself
 * (a link to an ancestor) is not walked again, and a file reached by two paths
 * is listed once, by its path without a link where there is one.
 */
function listFiles(paths: readonly string[], cwd: string, root: string, exclude: RegExp[]): { files: string[]; problems: RawLintDiagnostic[] } {
  const files = new Map<string, { abs: string; viaLink: boolean }>();
  const problems: RawLintDiagnostic[] = [];
  const rel = (abs: string) => relative(root, abs).split(sep).join('/');
  const excluded = (abs: string) => {
    const r = rel(abs);
    return exclude.some((re) => re.test(r) || re.test(r + '/'));
  };
  const unreadable = (abs: string, err: unknown, what: string) => {
    const code = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
    problems.push(diagnostic('BUILD-814', { exit: null, file: rel(abs), line: 0, column: 0, symbol: null, message: `${rel(abs)} ${what} (${code})` }));
  };
  const visit = (abs: string, name: string, explicit: boolean, viaLink: boolean, ancestors: ReadonlySet<string>) => {
    if (!explicit && (SKIPPED_DIRECTORIES.has(name) || name.startsWith('.'))) return;
    if (excluded(abs)) return;
    let st: Stats;
    let isLink = false;
    try {
      isLink = lstatSync(abs).isSymbolicLink();
      st = statSync(abs);
    } catch (err) {
      // A link to nothing, or a loop of links: fatal only for what may be source.
      if (isLink && !explicit && /\.[^./]+$/.test(name) && !isSource(name)) return;
      unreadable(abs, err, isLink ? 'is a symbolic link that cannot be followed' : 'cannot be read');
      return;
    }
    const linked = viaLink || isLink;
    if (st.isDirectory()) {
      let real: string;
      let names: string[];
      try {
        real = realpathSync(abs);
        names = readdirSync(abs).sort();
      } catch (err) {
        unreadable(abs, err, 'cannot be read');
        return;
      }
      if (ancestors.has(real)) return;
      const below = new Set(ancestors).add(real);
      for (const child of names) visit(resolve(abs, child), child, false, linked, below);
    } else if (st.isFile()) {
      if (!isSource(name)) {
        if (explicit) throw new RawLintUsageError(`${rel(abs)} is not a file the lint reads (TypeScript, JavaScript, Rust or HTML)`);
        return;
      }
      let real = abs;
      try {
        real = realpathSync(abs);
      } catch {
        // Listed by its own path.
      }
      const seen = files.get(real);
      if (!seen || (seen.viaLink && !linked)) files.set(real, { abs, viaLink: linked });
    }
  };
  for (const p of paths) {
    const abs = resolve(cwd, p);
    let exists = existsSync(abs);
    if (!exists) {
      try {
        exists = lstatSync(abs).isSymbolicLink();
      } catch {
        exists = false;
      }
    }
    if (!exists) throw new RawLintUsageError(`no such file or directory: ${p}`);
    visit(abs, basename(abs), true, false, new Set());
  }
  return { files: [...files.values()].map((f) => f.abs).sort(), problems };
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
      const read = readAllowlist(allowlistPath, allowlistLabel!, today);
      entries = read.entries;
      diagnostics.push(...read.problems);
    }
  }

  const listed = listFiles(options.paths, cwd, root, (options.exclude ?? []).map(globToRegExp));
  const files = listed.files;
  diagnostics.push(...listed.problems);

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
        const html = scanHtml(source, file);
        found.push(...html.found.map((f) => ({ ...f, file })));
        for (const err of html.errors) {
          diagnostics.push(diagnostic('BUILD-814', { exit: null, file, line: err.line, column: err.column, symbol: null, message: `${file} cannot be parsed: ${err.message}` }));
        }
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
    } else if (matches.length < e.count) {
      // Slack in a count admits new uses unreviewed (FORMA-126 review, should-fix 8).
      const lists = matches.length === 0 ? 'lists nothing' : `lists ${matches.length} of its count ${e.count}`;
      diagnostics.push(diagnostic('BUILD-813', { ...where, message: `the allowlist entry for ${e.exit} in ${e.path} (${e.line !== undefined ? `line ${e.line}` : `symbol ${e.symbol}`}) ${lists}` }));
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
    `${plural(count('BUILD-813'), 'allowlist entry', 'allowlist entries')} listing fewer uses than they say` +
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
