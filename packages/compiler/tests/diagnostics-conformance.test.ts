/**
 * The coded-diagnostics conformance corpus (FORMA-119; the start of design 2's
 * corpus, FORMA-101).
 *
 * Per code in the catalogue, `tests/fixtures/conformance/<CODE>/`:
 *
 *   fail/  a page that reports the code at every line marked `expect: <CODE>`
 *          (in any of its files), and nowhere else; under `strict` the esbuild
 *          build fails with the code at that file and line (a note does not);
 *   pass/  the near miss: the same construct written the way the subset
 *          admits, which does not report the code and builds under `strict`.
 *
 * Every diagnostic a fixture reports is marked, whatever its code: a fixture
 * whose construct also brings a note (a BUILD-504 declaration) marks it too,
 * so "reports exactly its markers" holds for both halves.
 *
 * Three codes cannot be written as a page: BUILD-606 (the compiler failing, or
 * its module not being written), BUILD-801 (the build without a compiler) and
 * BUILD-802 (a build option). Each has its own test, here or in the build
 * package.
 *
 * The catalogue, the fixtures and `docs/DIAGNOSTICS.md` are checked against
 * each other, so a code cannot be added to one and not the others.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';

import { DIAGNOSTIC_CATALOGUE, collectDiagnostics, type Diagnostic } from '../src/diagnostics';
import { formaSsrPlugin, generateRealIr } from '../src/esbuild-ssr-plugin';
import { originalPosition, registerSourceMap } from '../src/diagnostics';
import { transformJsxSource } from '../src/module-loader';

const CORPUS = resolve(__dirname, 'fixtures/conformance');
const CATALOGUE_DOC = resolve(__dirname, '../../../docs/DIAGNOSTICS.md');

/** Codes with no page that can trigger them; each is tested on its own. */
const NOT_A_PAGE = new Set(['BUILD-606', 'BUILD-801', 'BUILD-802', 'BUILD-803', 'BUILD-804', 'BUILD-901']);

interface Marker { code: string; file: string; line: number }

/** Every `expect: <code>` marker in a fixture directory (one code, or all), by file and 1-based line. */
function markers(dir: string, code?: string): Marker[] {
  const found: Marker[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
      for (const m of text.matchAll(/expect: (BUILD-\d{3})/g)) {
        if (!code || m[1] === code) found.push({ code: m[1]!, file, line: i + 1 });
      }
    });
  }
  return found;
}

const STRICT = new Map(DIAGNOSTIC_CATALOGUE.map((e) => [e.code, e.strict]));

/** The set of `code file:line` a fixture reports, and the one its markers expect. */
function reportedAndExpected(dir: string, diagnostics: Diagnostic[]): { reported: string[]; expected: string[] } {
  const reported = [...new Set(diagnostics.map((d) => `${d.code} ${d.file}:${d.line}`))].sort();
  const expected = [...new Set(markers(dir).map((m) => `${m.code} ${m.file}:${m.line}`))].sort();
  return { reported, expected };
}

function entryOf(dir: string): string {
  const entry = ['app.tsx', 'app.ts'].map((f) => join(dir, f)).find((p) => existsSync(p));
  if (!entry) throw new Error(`${dir}: no app.tsx or app.ts`);
  return entry;
}

/** Compile a fixture's page, collecting its diagnostics (the printed lines are silenced). */
function compile(dir: string): { diagnostics: Diagnostic[]; lines: string[] } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    const { diagnostics } = collectDiagnostics(() => generateRealIr(entryOf(dir)));
    return { diagnostics, lines };
  } finally {
    spy.mockRestore();
  }
}

/** Build a fixture with esbuild and the SSR plugin under `strict`. */
async function strictBuild(dir: string): Promise<esbuild.Message[]> {
  const outDir = mkdtempSync(join(tmpdir(), 'forma-conformance-'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await esbuild.build({
      entryPoints: [entryOf(dir)],
      bundle: true,
      write: false,
      outdir: outDir,
      format: 'esm',
      packages: 'external',
      jsx: 'transform',
      jsxFactory: 'h',
      jsxFragment: 'Fragment',
      logLevel: 'silent',
      plugins: [formaSsrPlugin({ page: 'page', outDir, entryPoint: entryOf(dir), strict: true })],
    });
    return [];
  } catch (err) {
    return (err as esbuild.BuildFailure).errors ?? [{ text: String(err) } as esbuild.Message];
  } finally {
    warn.mockRestore();
    log.mockRestore();
    rmSync(outDir, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the code catalogue', () => {
  it('numbers every code by family, once', () => {
    const codes = DIAGNOSTIC_CATALOGUE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^BUILD-[1-9]\d\d$/);
    expect([...codes].sort()).toEqual(codes);
  });

  it('has exactly these notes, the codes strict mode never fails on: BUILD-504 and the deprecations', () => {
    // A construct DR-1 admits, and the deprecated paths that keep working in
    // A2 (a build that still sets `wasm` must pass in strict mode).
    expect(DIAGNOSTIC_CATALOGUE.filter((e) => !e.strict).map((e) => e.code))
      .toEqual(['BUILD-504', 'BUILD-802', 'BUILD-803', 'BUILD-804', 'BUILD-901']);
  });

  it('gives every code a why and a fix', () => {
    for (const e of DIAGNOSTIC_CATALOGUE) {
      expect(e.why.length, e.code).toBeGreaterThan(20);
      expect(e.fix.length, e.code).toBeGreaterThan(10);
    }
  });

  it('documents every code, with its fix, in docs/DIAGNOSTICS.md', () => {
    const doc = readFileSync(CATALOGUE_DOC, 'utf8');
    const documented = [...doc.matchAll(/^### (BUILD-\d{3})\b/gm)].map((m) => m[1]);
    expect(documented).toEqual(DIAGNOSTIC_CATALOGUE.map((e) => e.code));
    for (const e of DIAGNOSTIC_CATALOGUE) {
      const section = doc.slice(doc.indexOf(`### ${e.code}`)).split(/\n### /)[0]!;
      expect(section, e.code).toContain('**Fix.**');
    }
  });

  it('catalogues every code the source reports, the build package included', () => {
    const srcDir = resolve(__dirname, '../src');
    const buildSrcDir = resolve(__dirname, '../../build/src');
    const catalogued = new Set(DIAGNOSTIC_CATALOGUE.map((e) => e.code));
    const used = new Set<string>();
    for (const dir of [srcDir, buildSrcDir]) {
      for (const name of readdirSync(dir)) {
        if (dir === srcDir && name === 'diagnostics.ts') continue;
        for (const m of readFileSync(join(dir, name), 'utf8').matchAll(/\b(BUILD-\d{3})\b/g)) used.add(m[1]!);
      }
    }
    expect([...used]).toEqual(expect.arrayContaining(['BUILD-801', 'BUILD-802', 'BUILD-803', 'BUILD-804', 'BUILD-901']));
    for (const code of used) expect(catalogued.has(code), code).toBe(true);
    // Every walker report names a code: no warnDegraded call without one.
    const walker = readFileSync(join(srcDir, 'ir-walk.ts'), 'utf8');
    const calls = [...walker.matchAll(/warnDegraded\(\s*walkCtx,\s*([^,\s]+)/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(25);
    for (const arg of calls) expect(arg, arg).toMatch(/^('BUILD-\d{3}'|code|gap)$/);
  });

  it('has a fixture pair for every code a page can trigger, and no other', () => {
    const fixtures = readdirSync(CORPUS).sort();
    const expected = DIAGNOSTIC_CATALOGUE.map((e) => e.code).filter((c) => !NOT_A_PAGE.has(c));
    expect(fixtures).toEqual(expected);
    for (const code of fixtures) {
      expect(existsSync(join(CORPUS, code, 'fail')), code).toBe(true);
      expect(existsSync(join(CORPUS, code, 'pass')), code).toBe(true);
      expect(markers(join(CORPUS, code, 'fail'), code).length, `${code}: no expect marker`).toBeGreaterThan(0);
    }
  });
});

const PAGE_CODES = DIAGNOSTIC_CATALOGUE.filter((e) => !NOT_A_PAGE.has(e.code));

describe.each(PAGE_CODES)('$code ($title)', ({ code, strict }) => {
  const failDir = join(CORPUS, code, 'fail');
  const passDir = join(CORPUS, code, 'pass');

  it('reports the code at every marked line, and nothing else', () => {
    const { diagnostics, lines } = compile(failDir);
    const { reported, expected } = reportedAndExpected(failDir, diagnostics);
    expect(reported).toEqual(expected);
    expect(markers(failDir, code).length).toBeGreaterThan(0);
    // Each report printed one line, as at 0.3.6, now carrying its code and position.
    expect(lines).toHaveLength(diagnostics.length);
    for (const [i, d] of diagnostics.entries()) {
      expect(lines[i]).toMatch(new RegExp(`^ {3}IR: ${d.code} `));
      expect(lines[i]).toContain(`${d.file}:${d.line}:${d.column}`);
      expect(d.column).toBeGreaterThan(0);
    }
  });

  it(strict ? 'fails the build under strict, at that file and line' : 'is a note: strict does not fail on it', async () => {
    const errors = await strictBuild(failDir);
    if (!strict) {
      expect(errors).toEqual([]);
      return;
    }
    const marked = markers(failDir).filter((m) => STRICT.get(m.code));
    expect(errors.length).toBe(marked.length);
    for (const error of errors) {
      const errorCode = error.text.split(' ')[0]!;
      expect(marked).toContainEqual({ code: errorCode, file: error.location!.file, line: error.location!.line });
      expect(error.notes.map((n) => n.text).join('\n')).toMatch(/^why: [\s\S]*\nfix: /);
    }
  });

  it('the near miss does not report it, and builds under strict', async () => {
    const { diagnostics } = compile(passDir);
    const { reported, expected } = reportedAndExpected(passDir, diagnostics);
    expect(reported).toEqual(expected);
    // A near miss may carry a note it cannot avoid (a BUILD-504 declaration),
    // never the code under test, and never an error.
    for (const m of markers(passDir)) {
      expect(m.code).not.toBe(code);
      expect(STRICT.get(m.code), m.code).toBe(false);
    }
    expect(await strictBuild(passDir)).toEqual([]);
  });
});

describe('BUILD-606', () => {
  it('reports a module the plugin cannot write, and still builds without strict', async () => {
    const dir = join(CORPUS, 'BUILD-101', 'pass');
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const seen: Diagnostic[] = [];
    const outDir = join(tmpdir(), 'forma-conformance-missing', 'no', 'such', 'dir');
    await esbuild.build({
      entryPoints: [entryOf(dir)], bundle: true, write: false, outdir: tmpdir(), format: 'esm',
      packages: 'external', jsxFactory: 'h', jsxFragment: 'Fragment', logLevel: 'silent',
      plugins: [formaSsrPlugin({ page: 'home', outDir, entryPoint: entryOf(dir), onDiagnostics: (d) => seen.push(...d) })],
    });
    expect(seen.map((d) => d.code)).toEqual(['BUILD-606']);
    expect(lines[0]).toMatch(/^ {3}IR: BUILD-606 IR emission failed for home: /);
  });

  it('reports an emission failure from the compiler itself', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    // A directory where the entry should be: reading it throws inside the
    // compiler, which falls back to a placeholder, as at 0.3.6.
    const { result, diagnostics } = collectDiagnostics(() => generateRealIr(CORPUS));
    expect(result).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['BUILD-606']);
    expect(lines[0]).toMatch(/^ {3}IR: BUILD-606 real emission failed: /);
  });
});

describe('positions', () => {
  it('maps a position in a .tsx file back to the line the author wrote', () => {
    // esbuild reprints the file: comments go, so the compiled text's lines
    // are not the author's. The map takes a node's position back.
    const file = join(tmpdir(), 'forma-position-fixture.tsx');
    const source = [
      "import { h } from '@getforma/core';",
      '// a comment esbuild drops',
      '// and another',
      'export function Page() {',
      '  return (',
      '    <main>',
      '      <p title={undefinedName()}>x</p>',
      '    </main>',
      '  );',
      '}',
    ].join('\n');
    const compiled = transformJsxSource(source, file);
    const compiledLine = compiled.split('\n').findIndex((l) => l.includes('undefinedName')) + 1;
    const compiledColumn = compiled.split('\n')[compiledLine - 1]!.indexOf('undefinedName');
    expect(compiledLine).not.toBe(7);
    expect(originalPosition(file, { line: compiledLine, column: compiledColumn }))
      .toEqual({ line: 7, column: source.split('\n')[6]!.indexOf('undefinedName') + 1 });
    registerSourceMap(file, null);
  });

  it('leaves a .ts file’s positions as they are, columns 1-based', () => {
    expect(originalPosition('/no/map/here.ts', { line: 12, column: 4 })).toEqual({ line: 12, column: 5 });
  });

  it('names the composition chain from the page down (BUILD-403, L-26)', () => {
    const { diagnostics } = compile(join(CORPUS, 'BUILD-403', 'fail'));
    const chain = diagnostics[0]!.chain!;
    expect(chain.map((link) => link.component)).toEqual(['mount()', 'A', 'B', 'C', 'D']);
    expect(chain.every((link) => link.line > 0 && link.file.endsWith('app.tsx'))).toBe(true);
    expect(diagnostics[0]!.message).toContain('(chain: mount() > A > B > C > D)');
  });
});
