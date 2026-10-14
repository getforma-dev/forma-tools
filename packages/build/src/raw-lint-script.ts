/**
 * @getforma/build — the raw-entry lint's TypeScript, JavaScript and HTML
 * scanner (FORMA-126; SR8).
 *
 * esbuild parses each file, as the build does: a file that does not parse is
 * reported (BUILD-814) rather than passed unseen. Its output is the source with
 * types erased, JSX turned into `h()` calls (an attribute becomes an object
 * key, JSX text a string literal), comments dropped and string escapes
 * normalised, so a small tokenizer reads it without meeting a type, a JSX text
 * node or a comment. Positions are mapped back to the file as written through
 * esbuild's source map.
 *
 * What it misses, by construction (each a reason the allowlist is reviewed,
 * not a proof):
 * - A sink reached through core's module in a callback
 *   (`import('@getforma/core').then((m) => m.template(s))`, or with
 *   `({ template }) =>`): `template`, `templateMany`, `reconcile` and
 *   `setHTMLUnsafe` are tracked from core's own module names (`@getforma/core`,
 *   its subpaths, `formajs`) and the CDN runtime's `FormaRuntime` global,
 *   through imports, `require`, `await import`, destructuring, aliases and
 *   bracket access. `trustedHtml` is matched by name wherever it comes from.
 * - The registry key built at run time (`'@getforma/core' + '#trusted-types'`)
 *   or found by `Object.getOwnPropertySymbols(globalThis)`.
 * - A value's provenance across files or through a function: a raw sink is
 *   passed only when its argument is a `trustedHtml(…)` call or a `const` in
 *   scope bound to one (lexically: a nearer binding of the name shadows it);
 *   anything else is reported, so the lint errs on the side of a listed entry.
 * - The browser's own sinks (`innerHTML`, `insertAdjacentHTML`,
 *   `document.write`, `Element.setHTMLUnsafe`): not Forma's exits, and what
 *   Trusted Types refuses in the browser (DR-20). A `srcdoc` write is reported
 *   in every form, the DOM's included.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts
 */

import { transformSync, type Loader } from 'esbuild';

import { positionIn, scanMarkup, scanStringMarkup, tagEnd, type Found, type Position } from './raw-lint-exits.js';

/** A file the lint could not read or parse (BUILD-814). */
export class ScanError extends Error {
  constructor(message: string, readonly line = 0, readonly column = 0) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokType = 'id' | 'str' | 'tpl' | 'num' | 're' | 'p';

interface Tok {
  type: TokType;
  /** The identifier, the punctuator, or a string's or template chunk's text between its delimiters. */
  value: string;
  /** Offset of the token's first character (a string's opening quote). */
  start: number;
  /** A `)` closing an `if`, `for`, `while` or `with` head: a `/` after it starts a regex. */
  controlClose?: boolean;
}

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const CONTROL_HEAD = new Set(['if', 'for', 'while', 'with']);
const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
];
const IDENT = /[\p{ID_Start}$_\\][\p{ID_Continue}$‌‍\\]*/uy;
const NUMBER = /(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)n?/y;

/**
 * Tokens of JavaScript as esbuild prints it. Comments are skipped; a string
 * or regex that runs into a line end stops there, so a misread costs one line.
 */
function tokenize(code: string): Tok[] {
  const toks: Tok[] = [];
  const braces: Array<'{' | '${'> = [];
  const parens: boolean[] = [];
  const n = code.length;
  let i = 0;

  const regexAllowed = (): boolean => {
    const t = toks[toks.length - 1];
    if (!t) return true;
    if (t.type === 'id') return REGEX_AFTER_WORD.has(t.value);
    if (t.type !== 'p') return false;
    if (t.value === ')') return t.controlClose === true;
    return t.value !== ']';
  };

  /**
   * A template's text from `from` to its closing backtick or next `${`. A
   * whole template with no substitution is a string (``setAttribute(`srcdoc`, s)``).
   */
  const templateChunk = (from: number, opening: boolean): number => {
    let j = from;
    while (j < n) {
      const c = code[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        toks.push({ type: opening ? 'str' : 'tpl', value: code.slice(from, j), start: from - 1 });
        return j + 1;
      }
      if (c === '$' && code[j + 1] === '{') {
        toks.push({ type: 'tpl', value: code.slice(from, j), start: from - 1 });
        toks.push({ type: 'p', value: '${', start: j });
        braces.push('${');
        return j + 2;
      }
      j++;
    }
    toks.push({ type: 'tpl', value: code.slice(from, n), start: from - 1 });
    return n;
  };

  while (i < n) {
    const c = code[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ' || c === ' ' || c === ' ') {
      i++;
      continue;
    }
    if (c === '#' && i === 0 && code[1] === '!') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      toks.push({ type: 'str', value: code.slice(i + 1, Math.min(j, n)), start: i });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      i = templateChunk(i + 1, true);
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && code[j] !== '\n') {
        const d = code[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (inClass) {
          if (d === ']') inClass = false;
        } else if (d === '[') {
          inClass = true;
        } else if (d === '/') {
          break;
        }
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(code[j]!)) j++;
      toks.push({ type: 're', value: code.slice(i, j), start: i });
      i = j;
      continue;
    }
    // A private name (`#paint`) is one identifier, so a symbol names it as written.
    IDENT.lastIndex = c === '#' ? i + 1 : i;
    const id = IDENT.exec(code);
    if (id) {
      const value = c === '#' ? '#' + id[0] : id[0];
      toks.push({ type: 'id', value, start: i });
      i += value.length;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
      NUMBER.lastIndex = i;
      const num = NUMBER.exec(code);
      const len = num ? num[0].length : 1;
      toks.push({ type: 'num', value: code.slice(i, i + len), start: i });
      i += len;
      continue;
    }
    if (c === '}') {
      if (braces.pop() === '${') {
        toks.push({ type: 'p', value: '}', start: i });
        i = templateChunk(i + 1, false);
        continue;
      }
      toks.push({ type: 'p', value: '}', start: i });
      i++;
      continue;
    }
    if (c === '{') {
      braces.push('{');
      toks.push({ type: 'p', value: '{', start: i });
      i++;
      continue;
    }
    if (c === '(') {
      const prev = toks[toks.length - 1];
      parens.push(prev?.type === 'id' && CONTROL_HEAD.has(prev.value));
      toks.push({ type: 'p', value: '(', start: i });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ type: 'p', value: ')', start: i, controlClose: parens.pop() === true });
      i++;
      continue;
    }
    let punct = c;
    for (const p of PUNCTUATORS) {
      if (code.startsWith(p, i) && !(p === '?.' && /[0-9]/.test(code[i + 2] ?? ''))) {
        punct = p;
        break;
      }
    }
    toks.push({ type: 'p', value: punct, start: i });
    i += punct.length;
  }
  return toks;
}

/** For each bracket token, the index of its partner; -1 elsewhere or when unbalanced. */
function pairBrackets(toks: Tok[]): number[] {
  const pair = new Array<number>(toks.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.type !== 'p') continue;
    if (t.value === '(' || t.value === '[' || t.value === '{' || t.value === '${') {
      stack.push(i);
    } else if (t.value === ')' || t.value === ']' || t.value === '}') {
      const open = stack.pop();
      if (open !== undefined) {
        pair[open] = i;
        pair[i] = open;
      }
    }
  }
  return pair;
}

// ---------------------------------------------------------------------------
// Source map
// ---------------------------------------------------------------------------

const BASE64_VALUE = new Map<string, number>(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]),
);

/** Per generated line, `[generatedColumn, sourceLine, sourceColumn]`, 0-based (source map v3). */
function decodeMappings(mappings: string): Array<Array<[number, number, number]>> {
  const lines: Array<Array<[number, number, number]>> = [];
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const lineText of mappings.split(';')) {
    const segments: Array<[number, number, number]> = [];
    let generatedColumn = 0;
    for (const segmentText of lineText.split(',')) {
      if (!segmentText) continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segmentText) {
        const digit = BASE64_VALUE.get(char);
        if (digit === undefined) break;
        value += (digit & 31) * 2 ** shift;
        if (digit & 32) {
          shift += 5;
          continue;
        }
        fields.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
        value = 0;
        shift = 0;
      }
      generatedColumn += fields[0] ?? 0;
      if (fields.length < 4) continue;
      sourceLine += fields[2]!;
      sourceColumn += fields[3]!;
      segments.push([generatedColumn, sourceLine, sourceColumn]);
    }
    lines.push(segments);
  }
  return lines;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** Maps an offset in esbuild's output to the line and column written in the source. */
class PositionMap {
  private readonly lineStarts: number[];
  private readonly sourceLineStarts: number[];
  private readonly segments: Array<Array<[number, number, number]>>;

  constructor(private readonly code: string, private readonly source: string, mappings: string) {
    this.lineStarts = lineStartsOf(code);
    this.sourceLineStarts = lineStartsOf(source);
    this.segments = decodeMappings(mappings);
  }

  /** The source position of the generated offset (1-based line and column). */
  at(offset: number): Position {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    const column = offset - this.lineStarts[lo]!;
    // The last segment at or before the column; else the nearest line above.
    for (let line = lo; line >= 0; line--) {
      const segs = this.segments[line] ?? [];
      let best: [number, number, number] | undefined;
      for (const s of segs) {
        if (line === lo && s[0] > column) break;
        best = s;
      }
      if (best) {
        const delta = line === lo ? column - best[0] : 0;
        return { line: best[1] + 1, column: best[2] + 1 + Math.max(0, delta) };
      }
    }
    return { line: lo + 1, column: column + 1 };
  }

  /**
   * The source position of an offset inside a string or template token that
   * starts at `tokenStart`: esbuild prints a template's text as written, so
   * the lines inside it are the source's.
   */
  inside(tokenStart: number, offset: number): Position {
    const start = this.at(tokenStart);
    // A JSX attribute name or text node is printed as a string: its first
    // character was not a quote in the source.
    const sourceOffset = (this.sourceLineStarts[start.line - 1] ?? 0) + start.column - 1;
    const unquoted = this.source[sourceOffset] !== this.code[tokenStart];
    const at = positionIn(this.code, offset, { offset: tokenStart, line: start.line, column: start.column });
    return unquoted && at.line === start.line ? { line: at.line, column: at.column - 1 } : at;
  }
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/** Module names core is published under; a subpath of any counts. */
const FORMA_MODULES = ['@getforma/core', 'formajs'];
/** The sinks a call names by function, with the index of the markup argument. */
const SINK_ARGUMENT: ReadonlyMap<string, number> = new Map([
  ['template', 0],
  ['templateMany', 0],
  ['setHTMLUnsafe', 1],
  ['reconcile', 1],
]);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
const ASSIGNMENT_OPS = new Set(['=', '+=', '-=', '||=', '&&=', '??=']);

type BindingKind = 'trustedVar' | 'trustedCallee' | 'other';

/** A name that writes raw markup when it names a prop or an attribute. */
type KeyKind = 'dangerouslySetInnerHTML' | '__html' | 'srcdoc';

function keyKind(name: string): KeyKind | null {
  if (name === 'dangerouslySetInnerHTML' || name === '__html') return name;
  return /^srcdoc$/i.test(name) ? 'srcdoc' : null;
}

interface Binding {
  region: number;
  kind: BindingKind;
}

function isFormaModule(spec: string): boolean {
  return FORMA_MODULES.some((m) => spec === m || spec.startsWith(m + '/'));
}

/**
 * The loaders to try, the file's own first: a file whose extension
 * understates it (JSX or TypeScript in a `.js` file) is still read, since a
 * file read leniently can still be checked, and one that parses under none
 * of them is reported.
 */
function loaderFor(file: string): Loader[] {
  const lower = file.toLowerCase();
  if (lower.endsWith('.tsx')) return ['tsx'];
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return ['ts', 'tsx'];
  if (lower.endsWith('.jsx')) return ['jsx', 'tsx'];
  return ['js', 'jsx', 'ts', 'tsx'];
}

/**
 * The raw entries in a TypeScript or JavaScript source. Throws a
 * {@link ScanError} when esbuild cannot parse it.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts > "TypeScript exits: each fails unlisted, passes listed, fails expired"
 */
export function scanScript(source: string, file: string, loaders: Loader[] = loaderFor(file)): Found[] {
  let transformed: { code: string; map: string } | undefined;
  let firstError: unknown;
  for (const loader of loaders) {
    try {
      transformed = transformSync(source, {
        loader,
        jsx: 'transform',
        jsxFactory: 'h',
        jsxFragment: 'Fragment',
        sourcemap: 'external',
        sourcefile: file,
        legalComments: 'none',
        charset: 'utf8',
        target: 'esnext',
        logLevel: 'silent',
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
      });
      break;
    } catch (err) {
      firstError ??= err;
    }
  }
  if (!transformed) {
    const first = (firstError as { errors?: Array<{ text: string; location?: { line: number; column: number } | null }> }).errors?.[0];
    throw new ScanError(
      first ? `esbuild could not parse it: ${first.text}` : `esbuild could not parse it: ${String(firstError)}`,
      first?.location?.line ?? 0,
      first?.location ? first.location.column + 1 : 0,
    );
  }
  const map = JSON.parse(transformed.map) as { mappings: string };
  return new ScriptScan(transformed.code, new PositionMap(transformed.code, source, map.mappings)).run();
}

class ScriptScan {
  private readonly toks: Tok[];
  private readonly pair: number[];
  private readonly found: Found[] = [];
  /** Token indices not to read as uses: import and re-export lists, destructured requires. */
  private readonly skip = new Set<number>();
  /** Local names bound to core's other sinks, to the sink's name. */
  private readonly sinkLocals = new Map<string, string>();
  /** Local names of core's h() (beside `h`, which JSX compiles to). */
  private readonly hLocals = new Set<string>(['h']);
  /** Local names bound to core's module as a namespace. */
  private readonly namespaces = new Set<string>(['FormaRuntime']);
  /**
   * Lexical regions: the file (0), and each function, method, arrow and
   * catch clause, from its parameters to the end of its body.
   */
  private regions: Array<{ start: number; end: number; parent: number }> = [];
  /** The innermost region of each token. */
  private regionOf: number[] = [];
  /** Every binding of each name, with its region and what it holds. */
  private readonly bindings = new Map<string, Binding[]>();
  /** `const` declarations whose initialiser may make them trusted. */
  private readonly constCandidates: Array<{ binding: Binding; start: number; end: number }> = [];
  /** Consts holding a prop's name (`const K = 'srcdoc'`), file-wide (over-approximated). */
  private readonly keyConsts = new Map<string, KeyKind>();
  /** Assignments (`x = …`), by name and token; each untrusts the binding it writes. */
  private readonly assignments: Array<{ name: string; at: number }> = [];
  /** `name@region` for each binding an assignment writes. */
  private readonly assigned = new Set<string>();
  /**
   * Export specifiers, by token index, read once every binding is known: a
   * re-export of a sink of core's, or of trustedHtml under another name, is a
   * raw entry (FORMA-126 review, should-fix 5).
   */
  private readonly exportSpecifiers = new Map<number, { name: string; alias: string; fromCore: boolean; local: boolean }>();
  /** `export * from <core>`, by the `*`'s token index. */
  private readonly exportStars = new Set<number>();
  private symbols: Array<string | null> = [];

  constructor(code: string, private readonly map: PositionMap) {
    this.toks = tokenize(code);
    this.pair = pairBrackets(this.toks);
  }

  run(): Found[] {
    this.computeRegions();
    this.collectBindings();
    this.collectDeclarations();
    this.classifyConsts();
    this.symbols = this.computeSymbols();
    for (let i = 0; i < this.toks.length; i++) this.visit(i);
    return this.found;
  }

  // -- helpers --------------------------------------------------------------

  private t(i: number): Tok | undefined {
    return this.toks[i];
  }

  private isP(i: number, value: string): boolean {
    const t = this.toks[i];
    return t !== undefined && t.type === 'p' && t.value === value;
  }

  private isId(i: number, value?: string): boolean {
    const t = this.toks[i];
    return t !== undefined && t.type === 'id' && (value === undefined || t.value === value);
  }

  private report(i: number, exit: string, message: string, at?: Position): void {
    const pos = at ?? this.map.at(this.toks[i]!.start);
    this.found.push({ exit, line: pos.line, column: pos.column, symbol: this.symbols[i] ?? null, message });
  }

  /**
   * The end (exclusive) of the expression starting at `start`: the next `,`
   * or `;` at its own depth, or the bracket that closes around it.
   */
  private expressionEnd(start: number): number {
    let k = start;
    while (k < this.toks.length) {
      const t = this.toks[k]!;
      if (t.type === 'p') {
        if (t.value === '(' || t.value === '[' || t.value === '{' || t.value === '${') {
          const close = this.pair[k]!;
          if (close === -1) return this.toks.length;
          k = close + 1;
          continue;
        }
        if (t.value === ',' || t.value === ';' || t.value === ')' || t.value === ']' || t.value === '}') return k;
      }
      k++;
    }
    return k;
  }

  /** The tokens of call argument `index` of the call whose `(` is at `open`, or null. */
  private argument(open: number, index: number): [number, number] | null {
    const close = this.pair[open]!;
    let start = open + 1;
    for (let a = 0; ; a++) {
      if (start >= close) return null;
      const end = this.expressionEnd(start);
      if (a === index) return end > start ? [start, end] : null;
      if (!this.isP(end, ',')) return null;
      start = end + 1;
    }
  }

  /**
   * The length of a trustedHtml callee at `i`: `trustedHtml`, a local bound to
   * it, or `ns.trustedHtml` on core's namespace (behind `window.` and the like
   * for the CDN global); 0 if there is none.
   */
  private trustedCalleeLength(i: number): number {
    let k = i;
    if (this.isId(k) && GLOBAL_OBJECTS.has(this.toks[k]!.value) && this.isP(k + 1, '.')) k += 2;
    if (this.isId(k) && this.namespaces.has(this.toks[k]!.value) && this.isP(k + 1, '.') && this.isId(k + 2, 'trustedHtml')) return k + 3 - i;
    if (this.isId(k) && this.namespaces.has(this.toks[k]!.value) && this.isP(k + 1, '[') && this.t(k + 2)?.type === 'str' && this.t(k + 2)!.value === 'trustedHtml' && this.isP(k + 3, ']')) return k + 4 - i;
    if (k === i && this.isId(k) && this.isTrustedCallee(k)) return 1;
    return 0;
  }

  /** Whether the expression in `[a, b)` is markup vouched for by trustedHtml(). */
  private isTrusted(a: number, b: number): boolean {
    while (a < b && this.isP(a, '(') && this.pair[a] === b - 1) {
      a++;
      b--;
    }
    if (b - a === 1 && this.isId(a) && this.resolve(this.toks[a]!.value, a) === 'trustedVar') return true;
    const callee = this.trustedCalleeLength(a);
    if (callee === 0) return false;
    let open = a + callee;
    if (this.isP(open, '?.')) open++;
    return this.isP(open, '(') && this.pair[open] === b - 1;
  }

  // -- bindings -------------------------------------------------------------

  /** Imports, re-exports and destructured requires of core. */
  private collectBindings(): void {
    const toks = this.toks;
    for (let i = 0; i < toks.length; i++) {
      if (this.isId(i, 'import') && !this.isP(i - 1, '.') && !this.isP(i + 1, '(') && !this.isP(i + 1, '.')) {
        i = this.importStatement(i);
      } else if (this.isId(i, 'export') && (this.isP(i + 1, '{') || this.isP(i + 1, '*'))) {
        i = this.exportStatement(i);
      } else if ((this.isId(i, 'const') || this.isId(i, 'let') || this.isId(i, 'var')) && !this.isP(i - 1, '.')) {
        this.destructuredRequire(i);
      }
    }
  }

  private importStatement(i: number): number {
    // Find `from "module"` or a bare `import "module"`.
    let k = i + 1;
    const specifiers: Array<{ imported: string; local: string; at: number }> = [];
    const namespaceLocals: string[] = [];
    if (this.t(k)?.type === 'str') return k;
    while (k < this.toks.length && !this.isId(k, 'from') && !this.isP(k, ';')) {
      if (this.isP(k, '{')) {
        const close = this.pair[k]!;
        let s = k + 1;
        while (s < close) {
          const nameTok = this.t(s)!;
          if (nameTok.type === 'id' || nameTok.type === 'str') {
            if (this.isId(s + 1, 'as')) {
              specifiers.push({ imported: nameTok.value, local: this.t(s + 2)!.value, at: s });
              s += 3;
            } else {
              specifiers.push({ imported: nameTok.value, local: nameTok.value, at: s });
              s += 1;
            }
          } else {
            s += 1;
          }
        }
        k = close + 1;
        continue;
      }
      if (this.isP(k, '*') && this.isId(k + 1, 'as') && this.isId(k + 2)) {
        namespaceLocals.push(this.t(k + 2)!.value);
        k += 3;
        continue;
      }
      if (this.isId(k) && this.t(k)!.value !== 'type') namespaceLocals.push(this.t(k)!.value);
      k++;
    }
    const moduleTok = this.isId(k, 'from') ? this.t(k + 1) : undefined;
    const end = moduleTok ? k + 1 : k;
    for (let s = i; s <= end; s++) this.skip.add(s);
    const fromCore = moduleTok !== undefined && moduleTok.type === 'str' && isFormaModule(moduleTok.value);
    if (fromCore) for (const ns of namespaceLocals) this.namespaces.add(ns);
    for (const spec of specifiers) this.bindImport(spec.imported, spec.local, fromCore);
    return end;
  }

  /**
   * trustedHtml under another name is followed wherever it is imported from
   * (an application's own module may re-export it); the other sinks, whose
   * names are common words, only from core.
   */
  private bindImport(imported: string, local: string, fromCore: boolean, region = 0): void {
    this.bind(local, region, imported === 'trustedHtml' ? 'trustedCallee' : 'other');
    if (fromCore && SINK_ARGUMENT.has(imported)) this.sinkLocals.set(local, imported);
    if (fromCore && imported === 'h') this.hLocals.add(local);
  }

  /**
   * `export { … } from` and `export { … }`: not uses, but trustedHtml
   * exported under another name hides it from importers, so that is one.
   */
  private exportStatement(i: number): number {
    if (this.isP(i + 1, '*')) {
      let k = i + 1;
      while (k < this.toks.length && !this.isP(k, ';') && this.t(k)?.type !== 'str') k++;
      if (this.t(k)?.type === 'str' && isFormaModule(this.t(k)!.value)) this.exportStars.add(i + 1);
      for (let s = i; s <= k; s++) this.skip.add(s);
      return k;
    }
    const close = this.pair[i + 1]!;
    if (close === -1) return i;
    const reexport = this.isId(close + 1, 'from');
    const fromCore = reexport && this.t(close + 2)?.type === 'str' && isFormaModule(this.t(close + 2)!.value);
    for (let s = i + 2; s < close; s++) {
      const nameTok = this.t(s)!;
      if (nameTok.type !== 'id' && nameTok.type !== 'str') continue;
      if (this.isP(s - 1, '{') || this.isP(s - 1, ',')) {
        const alias = this.isId(s + 1, 'as') ? this.t(s + 2)!.value : nameTok.value;
        this.exportSpecifiers.set(s, { name: nameTok.value, alias, fromCore, local: !reexport });
      }
    }
    const end = reexport ? close + 2 : close;
    for (let s = i; s <= end; s++) this.skip.add(s);
    return end;
  }

  /** The raw entry an export specifier or `export *` at `i` makes, if any. */
  private visitExport(i: number): void {
    if (this.exportStars.has(i)) {
      this.report(i, 'core-reexport', "core's raw sinks re-exported wholesale: importers call them where the lint does not follow");
      return;
    }
    const spec = this.exportSpecifiers.get(i);
    if (!spec) return;
    // `export { trustedHtml as x }`, or a local bound to it exported under a third name.
    const trusted = spec.name === 'trustedHtml' || (spec.local && this.isTrustedCallee(i));
    if (trusted) {
      if (spec.alias !== 'trustedHtml') this.report(i, 'trustedHtml', `trustedHtml exported as ${spec.alias}, which a search for trustedHtml does not find`);
      return;
    }
    // `export { reconcile } from '@getforma/core/runtime'`, or a sink imported from core and exported.
    const sink = spec.fromCore ? (SINK_ARGUMENT.has(spec.name) ? spec.name : undefined) : spec.local ? this.sinkLocals.get(spec.name) : undefined;
    if (sink) this.report(i, sink, `${sink} re-exported from core${spec.alias !== spec.name ? ` as ${spec.alias}` : ''}: importers call it where the lint does not follow`);
  }

  /**
   * `const { reconcile } = require('@getforma/core/runtime')`, `= await
   * import(…)`, `= FormaRuntime`, and a namespace destructured or aliased
   * (`const { template } = F`, `const G = F`; FORMA-126 review, should-fix 4).
   */
  private destructuredRequire(i: number): void {
    const pattern = i + 1;
    let eq: number;
    if (this.isP(pattern, '{')) {
      const close = this.pair[pattern]!;
      if (close === -1) return;
      eq = close + 1;
    } else if (this.isId(pattern)) {
      eq = pattern + 1;
    } else {
      return;
    }
    if (!this.isP(eq, '=')) return;
    let k = eq + 1;
    if (this.isId(k, 'await')) k++;
    let fromCore = false;
    if ((this.isId(k, 'require') || this.isId(k, 'import')) && this.isP(k + 1, '(') && this.t(k + 2)?.type === 'str' && this.isP(k + 3, ')')) {
      fromCore = isFormaModule(this.t(k + 2)!.value);
    } else {
      // `= FormaRuntime`, `= window.FormaRuntime`, or `= F` for a namespace F already known.
      let g = k;
      if (this.isId(g) && GLOBAL_OBJECTS.has(this.t(g)!.value) && this.isP(g + 1, '.')) g += 2;
      fromCore = this.isId(g) && this.namespaces.has(this.t(g)!.value) && (this.isP(g + 1, ';') || this.isP(g + 1, ',') || g + 1 >= this.toks.length);
    }
    if (!fromCore) return;
    if (this.isId(pattern)) {
      this.namespaces.add(this.t(pattern)!.value);
      return;
    }
    const close = this.pair[pattern]!;
    for (let s = pattern + 1; s < close; s++) {
      const nameTok = this.t(s)!;
      if (nameTok.type !== 'id') continue;
      if (this.isP(s + 1, ':') && this.isId(s + 2)) {
        this.bindImport(nameTok.value, this.t(s + 2)!.value, true, this.regionOf[s + 2]);
        this.skip.add(s);
        this.skip.add(s + 2);
        s += 2;
      } else if (this.isP(s - 1, '{') || this.isP(s - 1, ',')) {
        this.bindImport(nameTok.value, nameTok.value, true, this.regionOf[s]);
        this.skip.add(s);
      }
    }
  }

  // -- scopes ---------------------------------------------------------------
  //
  // Trust is lexical (FORMA-126 review, should-fix 1). A name is trusted
  // markup at a use only when the nearest region declaring it declares it
  // only as a `const` bound to a trustedHtml() call, and nothing in the file
  // assigns to it; a parameter, `let`, `var`, function, class, catch clause or
  // destructured binding of the same name in a nearer region shadows it.
  // Bindings are over-approximated (every identifier in a parameter list or a
  // pattern counts), which can only make a name untrusted.

  private bind(name: string, region: number, kind: BindingKind): Binding {
    const binding: Binding = { region, kind };
    const list = this.bindings.get(name);
    if (list) list.push(binding);
    else this.bindings.set(name, [binding]);
    return binding;
  }

  /** What `name` holds at token `at`: the kind of its nearest declaration, or `none`. */
  private resolve(name: string, at: number): BindingKind | 'none' {
    const list = this.bindings.get(name);
    if (!list) return 'none';
    for (let r = this.regionOf[at] ?? 0; r !== -1; r = this.regions[r]!.parent) {
      const here = list.filter((b) => b.region === r);
      if (here.length === 0) continue;
      const kind = here[0]!.kind;
      if (here.some((b) => b.kind !== kind)) return 'other';
      if (kind !== 'other' && this.assigned.has(`${name}@${r}`)) return 'other';
      return kind;
    }
    return 'none';
  }

  /** The identifier at `i` names trustedHtml itself or a local bound to it there. */
  private isTrustedCallee(i: number): boolean {
    const name = this.toks[i]!.value;
    return name === 'trustedHtml' || this.resolve(name, i) === 'trustedCallee';
  }

  /** The regions, and each token's innermost one. */
  private computeRegions(): void {
    const n = this.toks.length;
    const found: Array<{ start: number; end: number; params: [number, number] }> = [];
    for (let k = 0; k < n; k++) {
      if (this.isP(k, '=>')) {
        let pStart = k - 1;
        if (this.isP(pStart, ')') && this.pair[pStart]! >= 0) pStart = this.pair[pStart]!;
        const end = this.isP(k + 1, '{') && this.pair[k + 1]! > k ? this.pair[k + 1]! : this.expressionEnd(k + 1) - 1;
        found.push({ start: pStart, end: Math.max(end, k), params: [pStart, k - 1] });
      } else if (this.isP(k, '{') && this.isP(k - 1, ')') && this.pair[k - 1]! >= 0 && this.pair[k]! > k) {
        const open = this.pair[k - 1]!;
        const before = this.t(open - 1);
        if (before?.type === 'id' && ['if', 'for', 'while', 'switch', 'with'].includes(before.value)) continue;
        if (before?.type === 'id' && before.value === 'await' && this.isId(open - 2, 'for')) continue;
        found.push({ start: open, end: this.pair[k]!, params: [open + 1, k - 2] });
      }
    }
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    this.regions = [{ start: 0, end: n - 1, parent: -1 }];
    this.regionOf = new Array<number>(n).fill(0);
    const stack: number[] = [0];
    let next = 0;
    for (let i = 0; i < n; i++) {
      while (stack.length > 1 && this.regions[stack[stack.length - 1]!]!.end < i) stack.pop();
      while (next < found.length && found[next]!.start === i) {
        const f = found[next++]!;
        const id = this.regions.length;
        this.regions.push({ start: f.start, end: f.end, parent: stack[stack.length - 1]! });
        stack.push(id);
        // Every identifier in the parameters is a binding of this region.
        for (let p = f.params[0]; p <= f.params[1]; p++) {
          if (this.isId(p) && !this.isP(p - 1, '.') && !this.isP(p - 1, '?.')) this.pendingParams.push({ name: this.toks[p]!.value, region: id });
        }
      }
      this.regionOf[i] = stack[stack.length - 1]!;
    }
    for (const p of this.pendingParams) this.bind(p.name, p.region, 'other');
  }

  private readonly pendingParams: Array<{ name: string; region: number }> = [];

  /**
   * `const`, `let` and `var` declarators, function and class names, and
   * assignments. Imports and destructured requires are bound where they are
   * read (collectBindings).
   */
  private collectDeclarations(): void {
    const toks = this.toks;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.type !== 'id' || this.isP(i - 1, '.') || this.isP(i - 1, '?.')) continue;
      if ((t.value === 'function' || t.value === 'class') && this.isId(i + 1) && toks[i + 1]!.value !== 'extends') {
        this.bind(toks[i + 1]!.value, this.regionOf[i]!, 'other');
        continue;
      }
      if (t.value === 'const' || t.value === 'let' || t.value === 'var') {
        if (this.skip.has(i + 1)) continue;
        let k = i + 1;
        for (;;) {
          if (this.isId(k)) {
            const name = toks[k]!.value;
            const region = this.regionOf[k]!;
            if (this.isP(k + 1, '=')) {
              const end = this.expressionEnd(k + 2);
              const binding = this.bind(name, region, 'other');
              const keyName = end === k + 3 && toks[k + 2]!.type === 'str' ? keyKind(toks[k + 2]!.value) : null;
              if (t.value === 'const' && keyName) this.keyConsts.set(name, keyName);
              if (t.value === 'const') this.constCandidates.push({ binding, start: k + 2, end });
              if (!this.isP(end, ',')) break;
              k = end + 1;
              continue;
            }
            this.bind(name, region, 'other');
            if (!this.isP(k + 1, ',')) break;
            k += 2;
            continue;
          }
          if ((this.isP(k, '{') || this.isP(k, '[')) && this.pair[k]! > k) {
            // A pattern: every identifier in it is bound here (over-approximated).
            const close = this.pair[k]!;
            for (let p = k + 1; p < close; p++) {
              // Names a destructured require of core bound already are not bound again.
              if (this.isId(p) && !this.isP(p - 1, '.') && !this.skip.has(p)) this.bind(toks[p]!.value, this.regionOf[p]!, 'other');
            }
            const end = this.isP(close + 1, '=') ? this.expressionEnd(close + 2) : close + 1;
            if (!this.isP(end, ',')) break;
            k = end + 1;
            continue;
          }
          break;
        }
        continue;
      }
      // An assignment to a name already declared: `x = …`, `x += …`.
      const op = toks[i + 1];
      if (op?.type === 'p' && ASSIGNMENT_OPS.has(op.value) && !this.isId(i - 1, 'const') && !this.isId(i - 1, 'let') && !this.isId(i - 1, 'var')) {
        this.assignments.push({ name: t.value, at: i });
      }
    }
    // Each assignment writes the nearest binding of its name.
    for (const a of this.assignments) {
      const list = this.bindings.get(a.name) ?? [];
      for (let r = this.regionOf[a.at] ?? 0; r !== -1; r = this.regions[r]!.parent) {
        if (list.some((b) => b.region === r)) {
          this.assigned.add(`${a.name}@${r}`);
          break;
        }
      }
    }
  }

  /**
   * Which `const`s hold trusted markup (`const x = trustedHtml(…)`) and which
   * hold trustedHtml itself (`const mint = trustedHtml`). Repeated, so a
   * const bound to another trusted const is followed.
   */
  private classifyConsts(): void {
    for (let round = 0; round < 4; round++) {
      let changed = false;
      for (const c of this.constCandidates) {
        let kind: BindingKind = 'other';
        if (this.isTrusted(c.start, c.end)) kind = 'trustedVar';
        else {
          const callee = this.trustedCalleeLength(c.start);
          if (callee > 0 && c.start + callee === c.end) kind = 'trustedCallee';
        }
        if (kind !== c.binding.kind) {
          c.binding.kind = kind;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // -- symbols --------------------------------------------------------------

  /** For each token, the dotted names of the functions, methods and classes around it. */
  private computeSymbols(): Array<string | null> {
    const toks = this.toks;
    const classBodies = new Map<number, string | null>();
    for (let i = 0; i < toks.length; i++) {
      if (!this.isId(i, 'class') || this.isP(i - 1, '.') || this.isP(i + 1, ':')) continue;
      const name = this.isId(i + 1) && this.t(i + 1)!.value !== 'extends' ? this.t(i + 1)!.value : this.nameBeforeValue(i - 1);
      let k = i + 1;
      while (k < toks.length && !this.isP(k, '{')) {
        if (this.isP(k, '(') || this.isP(k, '[')) k = Math.max(k, this.pair[k]!);
        k++;
      }
      classBodies.set(k, name);
    }
    const out = new Array<string | null>(toks.length).fill(null);
    const stack: Array<{ close: number; name: string | null }> = [];
    let current: string | null = null;
    for (let i = 0; i < toks.length; i++) {
      while (stack.length > 0 && stack[stack.length - 1]!.close < i) {
        stack.pop();
        current = this.joined(stack);
      }
      out[i] = current;
      if (this.isP(i, '{') && this.pair[i]! > i) {
        const name = classBodies.has(i) ? classBodies.get(i)! : this.scopeName(i);
        stack.push({ close: this.pair[i]!, name });
        current = this.joined(stack);
      }
    }
    return out;
  }

  private joined(stack: Array<{ name: string | null }>): string | null {
    const names = stack.map((s) => s.name).filter((n): n is string => n !== null);
    return names.length > 0 ? names.join('.') : null;
  }

  /** The name a `{` at `k` opens a body for: a function, a method, an arrow assigned to a name. */
  private scopeName(k: number): string | null {
    if (this.isP(k - 1, ')')) {
      const open = this.pair[k - 1]!;
      if (open < 1) return null;
      const before = this.t(open - 1)!;
      if (before.type === 'id') {
        if (['if', 'for', 'while', 'switch', 'catch', 'with'].includes(before.value)) return null;
        if (before.value === 'await' && this.isId(open - 2, 'for')) return null;
        if (before.value === 'function') return this.nameBeforeFunction(open - 1);
        if (this.isP(open - 2, '.')) return null;
        return before.value;
      }
      if (before.type === 'str') return before.value;
      if (this.isP(open - 1, '*') && this.isId(open - 2, 'function')) return this.nameBeforeFunction(open - 2);
      return null;
    }
    if (this.isP(k - 1, '=>')) {
      let start = k - 2;
      if (this.isP(start, ')')) start = this.pair[start]!;
      let b = start - 1;
      if (this.isId(b, 'async')) b--;
      return this.nameBeforeValue(b);
    }
    return null;
  }

  private nameBeforeFunction(fn: number): string | null {
    let b = fn - 1;
    if (this.isId(b, 'async')) b--;
    return this.nameBeforeValue(b);
  }

  /** `name =` or `name:` just before a value at `b + 1`. */
  private nameBeforeValue(b: number): string | null {
    if (this.isP(b, '=') || this.isP(b, ':')) {
      const name = this.t(b - 1);
      if (name && (name.type === 'id' || name.type === 'str')) return name.value;
    }
    return null;
  }

  // -- uses -----------------------------------------------------------------

  private visit(i: number): void {
    const tok = this.toks[i]!;
    if (tok.type === 'str' || tok.type === 'tpl') {
      for (const m of scanStringMarkup(tok.value, true)) {
        this.report(i, m.exit, m.message, this.map.inside(tok.start, tok.start + 1 + m.offset));
      }
    }
    this.visitExport(i);
    if (this.skip.has(i)) return;
    if (tok.type === 'str') this.visitString(i, tok);
    else if (tok.type === 'id') this.visitIdentifier(i, tok);
  }

  /** A key in an object literal: `{ key:` or `, key:`. */
  private isKey(i: number): boolean {
    return this.isP(i + 1, ':') && (this.isP(i - 1, '{') || this.isP(i - 1, ','));
  }

  /** A shorthand property `{ key }` or `{ a, key, b }`. */
  private isShorthand(i: number): boolean {
    return (this.isP(i - 1, '{') || this.isP(i - 1, ',')) && (this.isP(i + 1, ',') || this.isP(i + 1, '}')) && this.enclosingIsBrace(i);
  }

  private enclosingIsBrace(i: number): boolean {
    return this.enclosingOpener(i) === '{';
  }

  /** The innermost bracket open around token `i`: `(`, `[`, `{`, `${`, or null at the top level. */
  private enclosingOpener(i: number): string | null {
    let depth = 0;
    for (let k = i - 1; k >= 0; k--) {
      const t = this.toks[k]!;
      if (t.type !== 'p') continue;
      if (t.value === ')' || t.value === ']' || t.value === '}') depth++;
      else if (t.value === '(' || t.value === '[' || t.value === '{' || t.value === '${') {
        if (depth === 0) return t.value;
        depth--;
      }
    }
    return null;
  }

  private visitString(i: number, tok: Tok): void {
    // A member of core's namespace by bracket: `F['template'](s)`, `F['trustedHtml'](s)`.
    if (this.isP(i - 1, '[') && this.isP(i + 1, ']') && this.isNamespaceAt(i - 2)) {
      if (tok.value === 'trustedHtml') {
        this.report(i, 'trustedHtml', this.isP(i + 2, '(') ? 'trustedHtml() called' : 'trustedHtml referenced, not called: the lint cannot see what it is given');
        return;
      }
      if (SINK_ARGUMENT.has(tok.value)) {
        this.checkSinkUse(i, tok.value, i + 2);
        return;
      }
    }
    const kind = keyKind(tok.value);
    if (kind) this.visitKeyName(i, kind);
  }

  /** A sink of core's at `i`, its name ending before `after`: called with untraced markup, or referenced. */
  private checkSinkUse(i: number, sink: string, after: number): void {
    const open = this.isP(after, '(') ? after : this.isP(after, '?.') && this.isP(after + 1, '(') ? after + 1 : -1;
    if (open === -1) {
      this.report(i, sink, `${sink} referenced, not called: the lint cannot see what it is given`);
      return;
    }
    const arg = this.argument(open, SINK_ARGUMENT.get(sink)!);
    if (!arg || !this.isTrusted(arg[0], arg[1])) this.report(i, sink, `${sink}() given markup not traced to trustedHtml()`);
  }

  /**
   * Core's module at token `k`, as an object: a namespace import or an alias
   * of one, `FormaRuntime` (behind `window.` and the like), or the module
   * itself (`require('@getforma/core')`, `(await import('@getforma/core'))`).
   */
  private isNamespaceAt(k: number): boolean {
    if (this.isId(k)) return this.namespaces.has(this.toks[k]!.value);
    if (!this.isP(k, ')') || this.pair[k]! < 0) return false;
    const open = this.pair[k]!;
    // `require("m")` / `import("m")`, or a parenthesised `await import("m")`.
    if ((this.isId(open - 1, 'require') || this.isId(open - 1, 'import')) && this.t(open + 1)?.type === 'str' && open + 2 === k) {
      return isFormaModule(this.t(open + 1)!.value);
    }
    let j = open + 1;
    if (this.isId(j, 'await')) j++;
    return (this.isId(j, 'require') || this.isId(j, 'import')) && this.isP(j + 1, '(') && this.t(j + 2)?.type === 'str' && this.isP(j + 3, ')') && j + 4 === k && isFormaModule(this.t(j + 2)!.value);
  }

  /**
   * A prop or attribute name written as a string, or as a const holding one:
   * an object key (`{ "srcdoc": v }`, `{ [K]: v }`), a computed member write
   * (`el['srcdoc'] = v`), or a name passed beside its value
   * (`setAttribute('srcdoc', v)`, `Reflect.set(o, 'dangerouslySetInnerHTML', v)`).
   * Verified by: packages/build/tests/raw-lint.test.ts > "TypeScript exits: each fails unlisted, passes listed, fails expired"
   */
  private visitKeyName(i: number, kind: KeyKind): void {
    if (this.isKey(i)) {
      this.checkKeyValue(i, i + 2, kind);
      return;
    }
    if (this.isP(i - 1, '[') && this.isP(i + 1, ']')) {
      // `{ ["srcdoc"]: v }` or `el["srcdoc"] = v`.
      if (this.isP(i + 2, ':') || this.isP(i + 2, '=')) this.checkKeyValue(i, i + 3, kind);
      return;
    }
    if (kind !== '__html' && (this.isP(i - 1, '(') || this.isP(i - 1, ',')) && this.isP(i + 1, ',') && this.enclosingOpener(i) === '(') {
      this.checkKeyValue(i, i + 2, kind);
    }
  }

  private visitIdentifier(i: number, tok: Tok): void {
    const name = tok.value;
    const afterDot = this.isP(i - 1, '.') || this.isP(i - 1, '?.');
    const onNamespace = afterDot && this.isNamespaceAt(i - 2);

    // trustedHtml, and any local bound to it.
    if (name === 'trustedHtml' || (!afterDot && this.resolve(name, i) === 'trustedCallee')) {
      if (this.isKey(i) && name !== 'trustedHtml') return;
      // `const mint = trustedHtml`: the new name's declaration is not a use; the reference is.
      if (name !== 'trustedHtml' && this.isP(i + 1, '=') && (this.isId(i - 1, 'const') || this.isId(i - 1, 'let') || this.isId(i - 1, 'var'))) return;
      const called = this.isP(i + 1, '(') || (this.isP(i + 1, '?.') && this.isP(i + 2, '('));
      const as = name === 'trustedHtml' ? '' : ` as ${name}()`;
      if (this.isId(i - 1, 'function')) this.report(i, 'trustedHtml', 'a function named trustedHtml: its callers reach raw markup by that name');
      else if (called) this.report(i, 'trustedHtml', `trustedHtml() called${as}`);
      else if (this.isKey(i)) this.report(i, 'trustedHtml', 'a property named trustedHtml');
      else this.report(i, 'trustedHtml', `trustedHtml referenced${name === 'trustedHtml' ? '' : ` as ${name}`}, not called: the lint cannot see what it is given`);
      return;
    }

    // h('script'): a script element core builds, JSX `<script>` included (the lead's decision on the review).
    if ((onNamespace ? name === 'h' : !afterDot && this.hLocals.has(name)) && this.isP(i + 1, '(') && this.t(i + 2)?.type === 'str' && /^script$/i.test(this.t(i + 2)!.value)) {
      this.report(i, "h('script')", "h('script'): a script element whose src runs under 'strict-dynamic' (refused in 3.0.0)");
      return;
    }

    // template, templateMany, setHTMLUnsafe, reconcile from core.
    const sink = onNamespace ? (SINK_ARGUMENT.has(name) ? name : undefined) : !afterDot && !this.isKey(i) ? this.sinkLocals.get(name) : undefined;
    if (sink) {
      this.checkSinkUse(i, sink, i + 1);
      return;
    }

    // A const holding a prop's name, used as one: `{ [K]: v }`, `el[K] = v`, `setAttribute(K, v)`.
    const constKey = !afterDot ? this.keyConsts.get(name) : undefined;
    if (constKey && !this.isKey(i) && !(this.isP(i + 1, '=') && (this.isId(i - 1, 'const') || this.isId(i - 1, 'let') || this.isId(i - 1, 'var')))) {
      this.visitKeyName(i, constKey);
      return;
    }

    // Props and attributes: dangerouslySetInnerHTML, its __html, and srcdoc.
    const kind = keyKind(name);
    if (!kind) return;
    if (this.isKey(i)) {
      this.checkKeyValue(i, i + 2, kind);
    } else if (!afterDot && this.isShorthand(i)) {
      this.report(i, kind === 'srcdoc' ? 'srcdoc' : 'dangerouslySetInnerHTML', `${name} passed by shorthand: the lint cannot see what it holds`);
    } else if (afterDot && this.isP(i + 1, '=')) {
      this.checkKeyValue(i, i + 2, kind);
    }
  }

  /**
   * `srcdoc: trustedHtml(…)` and `__html: trustedHtml(…)` pass; anything else
   * is a use. Every `__html` key is checked where it is written, whatever
   * holds it (FORMA-126 review, should-fix 2), so a dangerouslySetInnerHTML
   * whose value has `__html` keys leaves them to report themselves, and one
   * without (a variable, a call) is reported at its own name.
   */
  private checkKeyValue(i: number, start: number, kind: KeyKind): void {
    const end = this.expressionEnd(start);
    if (this.isTrusted(start, end)) return;
    if (kind === 'srcdoc') {
      this.report(i, 'srcdoc', 'srcdoc set to a value not traced to trustedHtml()');
      return;
    }
    if (kind === '__html') {
      this.report(i, 'dangerouslySetInnerHTML', 'an __html not traced to trustedHtml()');
      return;
    }
    for (let k = start; k < end; k++) {
      const t = this.toks[k]!;
      if ((t.type === 'id' || t.type === 'str') && t.value === '__html' && (this.isKey(k) || (this.isP(k - 1, '[') && this.isP(k + 1, ']')))) return;
    }
    this.report(i, 'dangerouslySetInnerHTML', 'dangerouslySetInnerHTML set to a value the lint cannot read as { __html: trustedHtml(…) }');
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

/**
 * The raw entries in an HTML file, read in one pass: the markup exits in its
 * tags (not its text, and comments only where they start in text), every
 * exit in its inline scripts, and the markup exits in a script of another
 * type (`text/x-template`, `application/json`), read as a string would be.
 * A script that does not parse is returned among `errors` (BUILD-814), and
 * the rest of the file is still read (FORMA-126 review, should-fix 6).
 *
 * Verified by: packages/build/tests/raw-lint.test.ts > "markup exits: each fails unlisted, passes listed, fails expired"
 */
export function scanHtml(source: string, file: string): { found: Found[]; errors: ScanError[] } {
  const found: Found[] = [];
  const errors: ScanError[] = [];
  const n = source.length;
  const markup = (text: string, base: number) => {
    for (const m of scanMarkup(text)) {
      const pos = positionIn(source, base + m.offset);
      found.push({ exit: m.exit, line: pos.line, column: pos.column, symbol: null, message: m.message });
    }
  };
  let i = 0;
  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (!/[a-zA-Z]/.test(source[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }
    const end = tagEnd(source, lt);
    const tag = source.slice(lt, end);
    markup(tag, lt);
    i = end;
    const name = /^<([a-zA-Z][^\s/>]*)/.exec(tag)![1]!.toLowerCase();
    if (name !== 'script' && name !== 'style') continue;
    // Raw text up to the element's end tag.
    const closeRe = new RegExp(`</${name}[\\s/>]`, 'ig');
    closeRe.lastIndex = end;
    const closeAt = closeRe.exec(source)?.index ?? n;
    if (name === 'script' && !/\ssrc\s*=/i.test(tag)) {
      const type = (/\stype\s*=\s*["']?([^"'\s>]*)/i.exec(tag)?.[1] ?? '').toLowerCase();
      if (SCRIPT_TYPES.has(type)) {
        // The script alone, at its own offsets.
        const virtual = source.slice(0, end).replace(/[^\n]/g, ' ') + source.slice(end, closeAt);
        try {
          found.push(...scanScript(virtual, file, ['js', 'jsx']));
        } catch (err) {
          if (!(err instanceof ScanError)) throw err;
          errors.push(new ScanError(`an inline script: ${err.message}`, err.line, err.column));
        }
      } else {
        for (const m of scanStringMarkup(source.slice(end, closeAt), false)) {
          const pos = positionIn(source, end + m.offset);
          found.push({ exit: m.exit, line: pos.line, column: pos.column, symbol: null, message: m.message });
        }
      }
    }
    i = closeAt;
  }
  return { found: found.sort((a, b) => a.line - b.line || a.column - b.column), errors };
}
