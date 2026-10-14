/**
 * The raw-entry allowlist lint, `forma-raw-lint` (FORMA-126; SR8, M8, DR-19,
 * L-37).
 *
 * The corpus, `tests/fixtures/raw-lint/<exit>/`, has a directory per exit:
 *
 *   fail*     reports a raw entry at every line marked `expect: <exit>`
 *             (with ` in <symbol>`, the symbol it names), and nowhere else;
 *   near-miss* reports nothing: the same names in comments and strings, a
 *             variable named like an exit, the typed forms of another exit.
 *
 * Each exit fails unlisted, passes listed (by line, and by symbol where it
 * has one) and fails once its entry is past its end date. `near-miss/` is
 * SR8's own near miss: a comment, a string literal mentioning trustedHtml and
 * a variable named rawHtml.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DIAGNOSTIC_CATALOGUE } from '@getforma/compiler';

import {
  RAW_EXITS,
  RAW_LINT_CATALOGUE,
  RawLintUsageError,
  formatRawLintReport,
  rawLint,
  runRawLintCli,
  type RawLintReport,
} from '../src/raw-lint';

const CORPUS = resolve(__dirname, 'fixtures/raw-lint');
const TODAY = '2026-10-14';
const YESTERDAY = '2026-10-13';
const LATER = '2099-12-31';

interface Marker {
  file: string;
  line: number;
  exit: string;
  symbol?: string;
}

/** Every `expect: <exit> [in <symbol>]` marker in a fixture directory. */
function markers(dir: string): Marker[] {
  const found: Marker[] = [];
  for (const file of readdirSync(dir).sort()) {
    readFileSync(join(dir, file), 'utf8').split('\n').forEach((text, i) => {
      for (const m of text.matchAll(/expect: (\S+)(?: in (\S+))?/g)) {
        found.push({ file, line: i + 1, exit: m[1]!, ...(m[2] ? { symbol: m[2] } : {}) });
      }
    });
  }
  return found;
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'forma-raw-lint-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeAllowlist(entries: object[], name = 'allowlist.json'): string {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify({ version: 1, entries }, null, 2));
  return path;
}

/** The lint over a fixture directory, paths relative to it; no allowlist unless named. */
function lintDir(dir: string, allowlist?: string, today = TODAY): RawLintReport {
  return rawLint({ paths: [dir], root: dir, cwd: tmp, today, ...(allowlist ? { allowlist } : {}) });
}

const where = (e: { file: string; line: number; exit: string }) => `${e.file}:${e.line} ${e.exit}`;
const codes = (r: RawLintReport) => r.diagnostics.map((d) => d.code);

/** One entry per marked line and exit, by line. */
function entriesByLine(want: Marker[], until: string): object[] {
  const counts = new Map<string, { m: Marker; count: number }>();
  for (const m of want) {
    const key = where(m);
    const seen = counts.get(key);
    if (seen) seen.count++;
    else counts.set(key, { m, count: 1 });
  }
  return [...counts.values()].map(({ m, count }) => ({
    path: m.file, line: m.line, exit: m.exit, owner: 'fixtures', until, reason: 'the corpus',
    ...(count > 1 ? { count } : {}),
  }));
}

/** One entry per marked symbol and exit (counting its uses), and by line where a marker names none. */
function entriesBySymbol(want: Marker[], until: string): object[] {
  const bySymbol = new Map<string, { m: Marker; count: number }>();
  const lines: Marker[] = [];
  for (const m of want) {
    if (!m.symbol) {
      lines.push(m);
      continue;
    }
    const key = `${m.file} ${m.exit} ${m.symbol}`;
    const seen = bySymbol.get(key);
    if (seen) seen.count++;
    else bySymbol.set(key, { m, count: 1 });
  }
  return [
    ...[...bySymbol.values()].map(({ m, count }) => ({
      path: m.file, symbol: m.symbol, exit: m.exit, owner: 'fixtures', until, reason: 'the corpus', count,
    })),
    ...entriesByLine(lines, until),
  ];
}

/** The four runs every exit gets: unlisted, listed by line, listed by symbol, expired. */
function checkExit(slug: string, exit: string): void {
  const dir = join(CORPUS, slug);
  const want = markers(dir);
  expect(want.filter((m) => m.exit === exit).length, `${slug} has no marker for ${exit}`).toBeGreaterThan(0);
  expect(readdirSync(dir).some((f) => f.startsWith('near-miss')), `${slug} has no near miss`).toBe(true);

  // Unlisted: every marked line, nothing else, each a BUILD-810; exit code 1.
  const unlisted = lintDir(dir);
  expect(unlisted.rawEntries.map(where).sort()).toEqual(want.map(where).sort());
  for (const m of want.filter((w) => w.symbol)) {
    const entry = unlisted.rawEntries.find((e) => e.file === m.file && e.line === m.line && e.exit === m.exit);
    expect(entry?.symbol, where(m)).toBe(m.symbol);
  }
  expect(unlisted.rawEntries.filter((e) => e.file.startsWith('near-miss'))).toEqual([]);
  expect(codes(unlisted).every((c) => c === 'BUILD-810')).toBe(true);
  expect(unlisted.diagnostics.map(where).sort()).toEqual(want.map(where).sort());
  expect(unlisted.exitCode).toBe(1);

  // Listed by line: passes, every raw entry listed.
  const byLine = lintDir(dir, writeAllowlist(entriesByLine(want, LATER)));
  expect(byLine.diagnostics).toEqual([]);
  expect(byLine.rawEntries.every((e) => e.listed && !e.expired)).toBe(true);
  expect(byLine.exitCode).toBe(0);

  // Listed by symbol: passes too.
  const bySymbol = lintDir(dir, writeAllowlist(entriesBySymbol(want, LATER), 'by-symbol.json'));
  expect(bySymbol.diagnostics).toEqual([]);
  expect(bySymbol.exitCode).toBe(0);

  // Listed until today: still valid. Until yesterday: one BUILD-811 per entry, exit code 1.
  expect(lintDir(dir, writeAllowlist(entriesByLine(want, TODAY), 'today.json')).exitCode).toBe(0);
  const expiredEntries = entriesByLine(want, YESTERDAY);
  const expired = lintDir(dir, writeAllowlist(expiredEntries, 'expired.json'));
  expect(codes(expired)).toEqual(expiredEntries.map(() => 'BUILD-811'));
  expect(expired.rawEntries.every((e) => e.expired && !e.listed && e.entry !== null)).toBe(true);
  expect(expired.exitCode).toBe(1);
}

describe('the corpus', () => {
  it('has a directory for every exit, and no other but SR8\'s near miss', () => {
    const dirs = readdirSync(CORPUS).filter((d) => d !== 'near-miss').sort();
    expect(dirs).toEqual(RAW_EXITS.map((e) => e.slug).sort());
  });
});

describe('TypeScript exits: each fails unlisted, passes listed, fails expired', () => {
  it.each(RAW_EXITS.filter((e) => e.language === 'ts'))('$name', ({ slug, name }) => checkExit(slug, name));
});

describe('markup exits: each fails unlisted, passes listed, fails expired', () => {
  it.each(RAW_EXITS.filter((e) => e.language === 'markup'))('$name', ({ slug, name }) => checkExit(slug, name));
});

describe('Rust exits: each fails unlisted, passes listed, fails expired', () => {
  it.each(RAW_EXITS.filter((e) => e.language === 'rust'))('$name', ({ slug, name }) => checkExit(slug, name));
});

describe('SR8', () => {
  /** An application with a seeded string body_prefix, run as its CI would: from its root. */
  function seededApp(): string {
    const app = join(tmp, 'app');
    mkdirSync(join(app, 'src'), { recursive: true });
    writeFileSync(join(app, 'src', 'main.rs'), [
      'use forma_server::{AssetManifest, PageConfig};',
      '',
      'const SHELL: &str = "<main id=\\"app\\"></main>";',
      '',
      'pub fn page(manifest: &AssetManifest) {',
      '    let config = PageConfig {',
      '        title: "Home",',
      '        body_prefix: Some(SHELL),',
      '        config_json: None,',
      '    };',
      '}',
      '',
    ].join('\n'));
    return app;
  }

  function allow(app: string, entries: object[]): void {
    writeFileSync(join(app, 'forma-raw-allowlist.json'), JSON.stringify({ version: 1, entries }));
  }

  it('SR8: a seeded body_prefix outside the allowlist fails, and so does an entry past its end date', () => {
    const app = seededApp();
    allow(app, []);
    const seeded = rawLint({ paths: ['src'], cwd: app, today: TODAY });
    expect(seeded.allowlist).toBe('forma-raw-allowlist.json');
    expect(seeded.diagnostics.map((d) => [d.code, d.exit, d.file, d.line, d.column, d.symbol])).toEqual([
      ['BUILD-810', 'body_prefix', 'src/main.rs', 8, 9, 'page'],
    ]);
    expect(seeded.exitCode).toBe(1);

    allow(app, [{ path: 'src/main.rs', symbol: 'page', exit: 'body_prefix', owner: 'web', until: '2026-12-31', reason: 'the shell; moves to RawHtml::trusted' }]);
    expect(rawLint({ paths: ['src'], cwd: app, today: TODAY }).exitCode).toBe(0);
    expect(rawLint({ paths: ['src'], cwd: app, today: '2026-12-31' }).exitCode).toBe(0);

    const late = rawLint({ paths: ['src'], cwd: app, today: '2027-01-01' });
    expect(late.diagnostics.map((d) => [d.code, d.exit, d.file, d.line])).toEqual([['BUILD-811', 'body_prefix', 'src/main.rs', 8]]);
    expect(late.diagnostics[0]!.message).toContain('ended on 2026-12-31');
    expect(late.exitCode).toBe(1);

    // Through the command, as CI runs it.
    const out: string[] = [];
    const io = { stdout: (t: string) => out.push(t), stderr: (t: string) => out.push(t), cwd: app };
    expect(runRawLintCli(['--today', '2027-01-01', 'src'], io)).toBe(1);
    expect(out.join('\n')).toMatch(/^BUILD-811 error body_prefix in src\/main\.rs:8:9 \(in page\): /m);
    allow(app, []);
    expect(runRawLintCli(['--today', TODAY, 'src'], io)).toBe(1);
    expect(out.join('\n')).toContain('BUILD-810 error body_prefix in src/main.rs:8:9 (in page): body_prefix: body_prefix set to a value not traced to RawHtml::trusted');
  });

  it('a near miss passes: a comment, a string literal mentioning trustedHtml, a variable named rawHtml', () => {
    const report = lintDir(join(CORPUS, 'near-miss'));
    expect(report.files).toBe(4);
    expect(report.rawEntries).toEqual([]);
    expect(report.diagnostics).toEqual([]);
    expect(report.exitCode).toBe(0);
  });
});

describe('the allowlist', () => {
  const RS = 'pub fn page() {\n    let a = RawHtml::trusted("<a>");\n    let b = RawHtml::trusted("<b>");\n}\n';

  function app(): string {
    const dir = join(tmp, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'page.rs'), RS);
    return dir;
  }

  const base = { path: 'src/page.rs', exit: 'RawHtml::trusted', owner: 'web', until: LATER, reason: 'the page' };

  it('BUILD-812: an allowlist the lint cannot use stops the run with exit code 2, naming the entry and the field', () => {
    app();
    const cases: Array<[string, string]> = [
      ['{ not json', 'cannot be read as JSON'],
      [JSON.stringify({ version: 2, entries: [] }), 'version is 2'],
      [JSON.stringify({ version: 1, entries: {} }), 'entries is not an array'],
      [JSON.stringify({ version: 1, entries: [], extra: 1 }), "unknown top-level field 'extra'"],
      [JSON.stringify({ version: 1, entries: [{ ...base, symbol: 'page', owner: '' }] }), 'entries[0]: owner must be a non-empty string'],
      [JSON.stringify({ version: 1, entries: [{ ...base, symbol: 'page', reason: undefined }] }), 'entries[0]: reason must be a non-empty string'],
      [JSON.stringify({ version: 1, entries: [{ ...base, symbol: 'page', exit: 'innerHTML' }] }), "entries[0]: exit 'innerHTML' is not one the lint knows"],
      [JSON.stringify({ version: 1, entries: [{ ...base, symbol: 'page', until: '2026-02-30' }] }), "entries[0]: until '2026-02-30' is not a date"],
      [JSON.stringify({ version: 1, entries: [{ ...base, symbol: 'page', until: '31/12/2026' }] }), "until '31/12/2026' is not a date"],
      [JSON.stringify({ version: 1, entries: [{ ...base }] }), 'entries[0]: name exactly one of line and symbol'],
      [JSON.stringify({ version: 1, entries: [{ ...base, line: 2, symbol: 'page' }] }), 'name exactly one of line and symbol'],
      [JSON.stringify({ version: 1, entries: [{ ...base, line: 0 }] }), 'line must be a positive integer'],
      [JSON.stringify({ version: 1, entries: [{ ...base, symbol: 'page', count: 0 }] }), 'count must be a positive integer'],
      [JSON.stringify({ version: 1, entries: [{ ...base, symbol: 'page', untill: LATER }] }), "unknown field 'untill'"],
    ];
    for (const [text, message] of cases) {
      const path = join(tmp, 'allowlist.json');
      writeFileSync(path, text);
      const report = rawLint({ paths: ['src'], cwd: tmp, allowlist: path, today: TODAY });
      expect(report.exitCode, text).toBe(2);
      const problems = report.diagnostics.filter((d) => d.code === 'BUILD-812');
      expect(problems.map((d) => d.message).join('\n'), text).toContain(message);
      expect(problems.every((d) => d.file === 'allowlist.json'), text).toBe(true);
    }
    const missing = rawLint({ paths: ['src'], cwd: tmp, allowlist: 'nope.json', today: TODAY });
    expect(missing.exitCode).toBe(2);
    expect(missing.diagnostics.find((d) => d.code === 'BUILD-812')!.message).toContain('nope.json: no such allowlist file');
  });

  it('an entry lists at most its count (default 1): the rest are not on the allowlist', () => {
    app();
    const one = rawLint({ paths: ['src'], cwd: tmp, today: TODAY, allowlist: writeAllowlist([{ ...base, symbol: 'page' }]) });
    expect(one.diagnostics.map((d) => [d.code, d.line])).toEqual([['BUILD-810', 3]]);
    expect(one.rawEntries.map((e) => [e.line, e.listed, e.entry])).toEqual([[2, true, 0], [3, false, null]]);
    const two = rawLint({ paths: ['src'], cwd: tmp, today: TODAY, allowlist: writeAllowlist([{ ...base, symbol: 'page', count: 2 }]) });
    expect(two.exitCode).toBe(0);
    const byLine = rawLint({ paths: ['src'], cwd: tmp, today: TODAY, allowlist: writeAllowlist([{ ...base, line: 2 }, { ...base, line: 3 }]) });
    expect(byLine.exitCode).toBe(0);
    // Another exit, file, line or symbol lists nothing.
    const wrong = rawLint({
      paths: ['src'], cwd: tmp, today: TODAY,
      allowlist: writeAllowlist([{ ...base, symbol: 'other' }, { ...base, line: 9 }, { ...base, exit: 'body_prefix', line: 2 }, { ...base, path: 'src/other.rs', line: 2 }]),
    });
    expect(codes(wrong).sort()).toEqual(['BUILD-810', 'BUILD-810', 'BUILD-813', 'BUILD-813', 'BUILD-813', 'BUILD-813']);
  });

  it('BUILD-813: an entry that lists nothing is a note, and the run passes', () => {
    app();
    const report = rawLint({
      paths: ['src'], cwd: tmp, today: TODAY,
      allowlist: writeAllowlist([{ ...base, symbol: 'page', count: 2 }, { ...base, exit: 'body_prefix', symbol: 'page' }]),
    });
    expect(report.diagnostics.map((d) => [d.code, d.severity, d.exit])).toEqual([['BUILD-813', 'warning', 'body_prefix']]);
    expect(report.diagnostics[0]!.entry).toMatchObject({ index: 1, symbol: 'page' });
    expect(report.exitCode).toBe(0);
  });

  it('BUILD-811: an entry past its end date fails even when it lists nothing', () => {
    app();
    const report = rawLint({
      paths: ['src'], cwd: tmp, today: TODAY,
      allowlist: writeAllowlist([{ ...base, symbol: 'page', count: 2 }, { ...base, exit: 'with_head_link', symbol: 'page', until: YESTERDAY }]),
    });
    expect(report.diagnostics.map((d) => [d.code, d.exit])).toEqual([['BUILD-811', 'with_head_link']]);
    expect(report.diagnostics[0]!.message).toContain('and lists nothing');
    expect(report.exitCode).toBe(1);
  });

  it('matches paths written with \\ or a leading ./, relative to the allowlist\'s directory', () => {
    app();
    const report = rawLint({
      paths: ['src'], cwd: tmp, today: TODAY,
      allowlist: writeAllowlist([{ ...base, path: '.\\src\\page.rs', line: 2 }, { ...base, path: './src/page.rs', line: 3 }]),
    });
    expect(report.exitCode).toBe(0);
    // From a subdirectory's allowlist, paths are relative to it.
    mkdirSync(join(tmp, 'ci'));
    const nested = rawLint({
      paths: ['src'], cwd: tmp, today: TODAY,
      allowlist: writeAllowlist([{ ...base, path: '../src/page.rs', symbol: 'page', count: 2 }], join('ci', 'allow.json')),
    });
    expect(nested.allowlist).toBe('allow.json');
    expect(nested.exitCode).toBe(0);
  });
});

describe('reading sources', () => {
  it('BUILD-814: a file esbuild cannot parse fails the run at its line, and so does an inline script', () => {
    mkdirSync(join(tmp, 'src'));
    writeFileSync(join(tmp, 'src', 'broken.ts'), 'export const a = 1;\nexport const b = (;\n');
    writeFileSync(join(tmp, 'src', 'page.html'), '<!doctype html>\n<p>x</p>\n<script>\n  const = 1;\n</script>\n');
    writeFileSync(join(tmp, 'src', 'data.html'), '<script type="application/json">{ not: js }</script>\n<script src="/app.js"></script>\n');
    const report = rawLint({ paths: ['src'], cwd: tmp, today: TODAY });
    expect(report.diagnostics.map((d) => [d.code, d.file, d.line])).toEqual([
      ['BUILD-814', 'src/broken.ts', 2],
      ['BUILD-814', 'src/page.html', 4],
    ]);
    expect(report.diagnostics[1]!.message).toContain('an inline script');
    expect(report.exitCode).toBe(1);
  });

  it('reads TypeScript in a .js file and JSX in a .js file rather than failing them', () => {
    mkdirSync(join(tmp, 'src'));
    writeFileSync(join(tmp, 'src', 'typed.js'), 'interface A { x: string }\nexport const f = (a: A) => trustedHtml(a.x);\n');
    writeFileSync(join(tmp, 'src', 'view.js'), 'export const v = <p dangerouslySetInnerHTML={{ __html: s }} />;\n');
    const report = rawLint({ paths: ['src'], cwd: tmp, today: TODAY });
    expect(report.rawEntries.map((e) => [e.file, e.line, e.exit])).toEqual([
      ['src/typed.js', 2, 'trustedHtml'],
      ['src/view.js', 1, 'dangerouslySetInnerHTML'],
    ]);
  });

  it('walks directories, skipping node_modules, target and dot-directories, and leaves out what --exclude matches', () => {
    const write = (rel: string) => {
      mkdirSync(join(tmp, rel, '..'), { recursive: true });
      writeFileSync(join(tmp, rel), 'export const x = trustedHtml("<b>");\n');
    };
    for (const rel of ['app/src/a.ts', 'app/node_modules/pkg/b.ts', 'app/target/c.ts', 'app/.cache/d.ts', 'app/dist/e.js', 'app/gen/f.ts', 'app/gen/keep/g.ts', 'app/src/types.d.ts', 'app/src/notes.md']) write(rel);
    const all = rawLint({ paths: ['app'], cwd: tmp, root: join(tmp, 'app'), today: TODAY });
    expect(all.rawEntries.map((e) => e.file)).toEqual(['dist/e.js', 'gen/f.ts', 'gen/keep/g.ts', 'src/a.ts']);
    const excluded = rawLint({ paths: ['app'], cwd: tmp, root: join(tmp, 'app'), today: TODAY, exclude: ['dist/**', 'gen/*.ts'] });
    expect(excluded.rawEntries.map((e) => e.file)).toEqual(['gen/keep/g.ts', 'src/a.ts']);
    expect(rawLint({ paths: ['app'], cwd: tmp, root: join(tmp, 'app'), today: TODAY, exclude: ['**/gen/**', 'dist'] }).rawEntries.map((e) => e.file)).toEqual(['src/a.ts']);
  });

  it('refuses a path that does not exist, a file it does not read, and a bad date', () => {
    writeFileSync(join(tmp, 'notes.md'), 'x');
    expect(() => rawLint({ paths: ['missing'], cwd: tmp, today: TODAY })).toThrow(RawLintUsageError);
    expect(() => rawLint({ paths: ['notes.md'], cwd: tmp, today: TODAY })).toThrow(/not a file the lint reads/);
    expect(() => rawLint({ paths: [], cwd: tmp, today: TODAY })).toThrow(/at least one/);
    expect(() => rawLint({ paths: ['.'], cwd: tmp, today: '2026-13-01' })).toThrow(/not a date/);
  });

  it('positions are the author\'s: lines and columns through JSX, template literals and HTML', () => {
    mkdirSync(join(tmp, 'src'));
    writeFileSync(join(tmp, 'src', 'view.tsx'), [
      "import { h, trustedHtml } from '@getforma/core';",
      '// a comment esbuild drops',
      '',
      'export function View(p: { s: string }) {',
      '  const page = `',
      '    <section>',
      '      <iframe data-bind:srcdoc="{doc}"></iframe>',
      '    </section>`;',
      '  return (',
      '    <div',
      '      data-bind:srcdoc="{doc}"',
      '      title={page}>{trustedHtml(p.s)}</div>',
      '  );',
      '}',
    ].join('\n'));
    writeFileSync(join(tmp, 'src', 'page.html'), '<!doctype html>\n<div>\n  <iframe\n     title="x" data-bind:srcdoc="{d}"></iframe>\n</div>\n');
    const report = rawLint({ paths: ['src'], cwd: tmp, today: TODAY });
    expect(report.rawEntries.map((e) => [e.file, e.line, e.column, e.exit, e.symbol])).toEqual([
      ['src/page.html', 4, 16, 'data-bind:srcdoc', null],
      ['src/view.tsx', 7, 15, 'data-bind:srcdoc', 'View'],
      ['src/view.tsx', 11, 7, 'data-bind:srcdoc', 'View'],
      ['src/view.tsx', 12, 21, 'trustedHtml', 'View'],
    ]);
  });
});

describe('line endings', () => {
  it('a CRLF source reports the lines and columns an LF one does', () => {
    const rs = 'pub fn page() {\n    // RawHtml::trusted in a comment\n    let c = PageConfig { body_prefix: Some(SHELL) };\n}\n';
    const tsx = "import { h, trustedHtml } from '@getforma/core';\n\nexport function V(p: { s: string }) {\n  return <div\n    data-bind:srcdoc=\"{d}\">{trustedHtml(p.s)}</div>;\n}\n";
    const html = '<!doctype html>\n<!-- data-bind:srcdoc -->\n<iframe\n  data-bind:srcdoc="{d}"></iframe>\n<script>\n  FormaRuntime.reconcile(el, s);\n</script>\n';
    const run = (eol: string) => {
      const dir = join(tmp, eol === '\n' ? 'lf' : 'crlf');
      mkdirSync(dir);
      writeFileSync(join(dir, 'a.rs'), rs.replace(/\n/g, eol));
      writeFileSync(join(dir, 'b.tsx'), tsx.replace(/\n/g, eol));
      writeFileSync(join(dir, 'c.html'), html.replace(/\n/g, eol));
      return rawLint({ paths: [dir], root: dir, cwd: tmp, today: TODAY }).rawEntries.map((e) => [e.file, e.line, e.column, e.exit, e.symbol]);
    };
    const lf = run('\n');
    expect(lf).toEqual([
      ['a.rs', 3, 26, 'body_prefix', 'page'],
      ['b.tsx', 5, 5, 'data-bind:srcdoc', 'V'],
      ['b.tsx', 5, 29, 'trustedHtml', 'V'],
      ['c.html', 4, 3, 'data-bind:srcdoc', null],
      ['c.html', 6, 16, 'reconcile', null],
    ]);
    expect(run('\r\n')).toEqual(lf);
  });
});

describe('the command', () => {
  function cli(args: string[], cwd = tmp): { code: number; out: string; err: string } {
    const out: string[] = [];
    const err: string[] = [];
    const code = runRawLintCli(args, { stdout: (t) => out.push(t), stderr: (t) => err.push(t), cwd });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('the command: exit codes, text and JSON', () => {
    mkdirSync(join(tmp, 'src'));
    writeFileSync(join(tmp, 'src', 'a.ts'), "import { trustedHtml } from '@getforma/core';\nexport const a = trustedHtml('<b>');\n");
    writeFileSync(join(tmp, 'src', 'b.ts'), 'export const b = 1;\n');

    const text = cli(['--today', TODAY, 'src']);
    expect(text.code).toBe(1);
    expect(text.out).toContain('BUILD-810 error trustedHtml in src/a.ts:2:18: trustedHtml: trustedHtml() called; not on the allowlist');
    expect(text.out).toContain('forma-raw-lint: 1 raw entry in 2 files: 0 listed, 1 not on the allowlist;');
    expect(text.out).toMatch(/Fail\.\n {2}BUILD-810 Raw entry not on the allowlist/);

    const json = cli(['--json', `--today=${TODAY}`, '--report', 'report.json', 'src']);
    expect(json.code).toBe(1);
    const report = JSON.parse(json.out) as RawLintReport;
    expect(Object.keys(report)).toEqual(['version', 'today', 'allowlist', 'files', 'rawEntries', 'diagnostics', 'exitCode']);
    expect(report).toMatchObject({ version: 1, today: TODAY, allowlist: null, files: 2, exitCode: 1 });
    expect(Object.keys(report.diagnostics[0]!)).toEqual(['code', 'severity', 'exit', 'file', 'line', 'column', 'symbol', 'message', 'why', 'fix']);
    expect(Object.keys(report.rawEntries[0]!)).toEqual(['exit', 'line', 'column', 'symbol', 'message', 'file', 'listed', 'entry', 'expired']);
    expect(JSON.parse(readFileSync(join(tmp, 'report.json'), 'utf8'))).toEqual(report);

    writeFileSync(join(tmp, 'forma-raw-allowlist.json'), JSON.stringify({ version: 1, entries: [{ path: 'src/a.ts', line: 2, exit: 'trustedHtml', owner: 'web', until: LATER, reason: 'r' }] }));
    const pass = cli(['--today', TODAY, 'src']);
    expect(pass.code).toBe(0);
    expect(pass.out).toBe('forma-raw-lint: 1 raw entry in 2 files: 1 listed, 0 not on the allowlist; 0 allowlist entries past the end date; 0 allowlist entries listing nothing. Pass.');

    expect(cli(['--allowlist', 'other.json', 'src']).code).toBe(2);
    expect(cli([]).code).toBe(2);
    expect(cli(['--nope', 'src']).err).toContain('unknown option --nope');
    expect(cli(['--today']).err).toContain('--today needs a value');
    expect(cli(['--today', 'tomorrow', 'src']).code).toBe(2);
    expect(cli(['missing-dir']).code).toBe(2);
    const help = cli(['--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('Usage: forma-raw-lint');
    const exits = cli(['--exits']);
    for (const e of RAW_EXITS) expect(exits.out).toContain(e.name);
  });

  it('is the package\'s bin, built from its own entry', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { bin: Record<string, string>; scripts: { build: string } };
    expect(pkg.bin).toEqual({ 'forma-raw-lint': 'dist/raw-lint-cli.js' });
    expect(pkg.scripts.build).toContain('src/raw-lint-cli.ts');
    // Windows runners check source out with CRLF; the shebang is what matters.
    expect(readFileSync(resolve(__dirname, '../src/raw-lint-cli.ts'), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\r?\n/);
  });
});

describe('the codes and the exits, documented', () => {
  it('the compiler catalogue and docs/DIAGNOSTICS.md carry BUILD-810 to BUILD-814 as the lint reports them', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/DIAGNOSTICS.md'), 'utf8');
    expect(RAW_LINT_CATALOGUE.map((c) => c.code)).toEqual(['BUILD-810', 'BUILD-811', 'BUILD-812', 'BUILD-813', 'BUILD-814']);
    for (const c of RAW_LINT_CATALOGUE) {
      expect(DIAGNOSTIC_CATALOGUE.find((e) => e.code === c.code), c.code).toEqual({
        code: c.code, title: c.title, why: c.why, fix: c.fix, strict: c.severity === 'error',
      });
      const section = doc.slice(doc.indexOf(`### ${c.code} `)).split(/\n### /)[0]!;
      expect(section, c.code).toContain(`### ${c.code} ${c.title}`);
      expect(section, c.code).toContain(`**Why.** ${c.why}`);
      expect(section, c.code).toContain(`**Fix.** ${c.fix}`);
    }
    const report = rawLint({ paths: [join(CORPUS, 'body_prefix')], cwd: tmp, today: TODAY });
    expect(formatRawLintReport(report)).toContain('https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md');
  });

  it('the README lists every exit the lint knows', () => {
    const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');
    const start = readme.indexOf('## Raw-entry lint (`forma-raw-lint`)');
    expect(start).toBeGreaterThan(-1);
    const section = readme.slice(start, readme.indexOf('\n## ', start + 1));
    const listed = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    expect(listed).toEqual(RAW_EXITS.map((e) => e.name));
  });
});
