/**
 * @getforma/build — the raw-entry lint's Rust scanner (FORMA-126; SR8, DR-19,
 * L-37).
 *
 * A token scan, not a parse: the build package carries no Rust parser, and
 * the exits are names. The tokenizer knows Rust's lexical grammar (nested
 * block comments, raw strings with any number of `#`, byte and C strings,
 * char literals against lifetimes, raw identifiers), so a name in a comment
 * or a string is never read as code, and markup inside a string is read as
 * markup. Brackets are paired, so a struct literal's fields, a struct
 * definition's fields, a `use` tree and an item's body are told apart.
 *
 * What it misses, by construction:
 * - A name made by a macro from pieces (`paste!`'s `[<Raw Html>]`), or a raw
 *   entry inside a macro defined in another crate.
 * - `body_prefix`, `config_json` or `config_script` carried in by struct
 *   update (`PageConfig { ..base }`) from a value built elsewhere.
 * - A `RawHtml` reaching `body_prefix` through a function or another file:
 *   `body_prefix` passes only when its value is `Some(&x)` (or `x.as_str()`,
 *   `&*x`) where `x`'s last binding in scope is `RawHtml::trusted(..)` or is
 *   declared a `RawHtml`, or `self.x` that the impl's own struct declares a
 *   `RawHtml`; anything else is reported, so it errs on the side of a listed
 *   entry.
 * Aliases (`use … as`, `type … =`) are collected across every Rust file in
 * the run first, so a call through an alias defined in another file is found.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts > "Rust exits: each fails unlisted, passes listed, fails expired"
 */

import { positionIn, scanStringMarkup, type Found } from './raw-lint-exits.js';

type RTokType = 'id' | 'str' | 'char' | 'life' | 'num' | 'p';

interface RTok {
  type: RTokType;
  value: string;
  start: number;
  /** A raw identifier (`r#name`); `value` is the name without `r#`. */
  raw?: boolean;
  /** Offset of a string's first content character. */
  contentStart?: number;
  /** A raw string (`r"…"`, `r#"…"#`): its text has no escapes. */
  rawString?: boolean;
}

const PUNCT = ['..=', '...', '::', '->', '=>', '==', '!=', '<=', '>=', '&&', '||', '..', '+=', '-=', '*=', '/=', '%=', '^=', '&=', '|='];
const IDENT = /[\p{XID_Start}_][\p{XID_Continue}]*/uy;

function tokenize(code: string): RTok[] {
  const toks: RTok[] = [];
  const n = code.length;
  let i = 0;

  /** A raw string whose `r` is at `at` (after any `b` or `c`); null if `at` does not start one. */
  const rawString = (prefixStart: number, at: number): number | null => {
    let j = at + 1;
    let hashes = 0;
    while (code[j] === '#') {
      hashes++;
      j++;
    }
    if (code[j] !== '"') return null;
    const close = '"' + '#'.repeat(hashes);
    const end = code.indexOf(close, j + 1);
    const stop = end === -1 ? n : end;
    toks.push({ type: 'str', value: code.slice(j + 1, stop), start: prefixStart, contentStart: j + 1, rawString: true });
    return end === -1 ? n : end + close.length;
  };

  /** A quoted string whose `"` is at `at`. */
  const quoted = (prefixStart: number, at: number): number => {
    let j = at + 1;
    while (j < n && code[j] !== '"') j += code[j] === '\\' ? 2 : 1;
    toks.push({ type: 'str', value: code.slice(at + 1, Math.min(j, n)), start: prefixStart, contentStart: at + 1 });
    return j + 1;
  };

  /** A char literal or a lifetime whose `'` is at `at`. */
  const quote = (prefixStart: number, at: number): number => {
    if (code[at + 1] === '\\') {
      let j = at + 2;
      while (j < n && code[j] !== "'" && code[j] !== '\n') j++;
      toks.push({ type: 'char', value: code.slice(at + 1, j), start: prefixStart });
      return j + 1;
    }
    const cp = code.codePointAt(at + 1);
    const width = cp !== undefined && cp > 0xffff ? 2 : 1;
    if (code[at + 1 + width] === "'") {
      toks.push({ type: 'char', value: code.slice(at + 1, at + 1 + width), start: prefixStart });
      return at + 2 + width;
    }
    IDENT.lastIndex = at + 1;
    const m = IDENT.exec(code);
    const len = m ? m[0].length : 0;
    toks.push({ type: 'life', value: code.slice(at + 1, at + 1 + len), start: prefixStart });
    return at + 1 + len;
  };

  while (i < n) {
    const c = code[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (code[i] === '/' && code[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (code[i] === '*' && code[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    if (c === '"') {
      i = quoted(i, i);
      continue;
    }
    if (c === "'") {
      i = quote(i, i);
      continue;
    }
    // Prefixed literals: r"…", r#"…"#, b"…", br"…", c"…", cr#"…"#, b'…'; raw identifiers r#name.
    if (c === 'r' || c === 'b' || c === 'c') {
      const next = code[i + 1];
      if (c === 'r' && (next === '"' || next === '#')) {
        const end = rawString(i, i);
        if (end !== null) {
          i = end;
          continue;
        }
        if (next === '#') {
          IDENT.lastIndex = i + 2;
          const m = IDENT.exec(code);
          if (m) {
            toks.push({ type: 'id', value: m[0], start: i, raw: true });
            i += 2 + m[0].length;
            continue;
          }
        }
      }
      if ((c === 'b' || c === 'c') && next === 'r') {
        const end = rawString(i, i + 1);
        if (end !== null) {
          i = end;
          continue;
        }
      }
      if ((c === 'b' || c === 'c') && next === '"') {
        i = quoted(i, i + 1);
        continue;
      }
      if (c === 'b' && next === "'") {
        i = quote(i, i + 1);
        continue;
      }
    }
    IDENT.lastIndex = i;
    const id = IDENT.exec(code);
    if (id) {
      toks.push({ type: 'id', value: id[0], start: i });
      i += id[0].length;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_]/.test(code[j]!)) j++;
      if (code[j] === '.' && /[0-9]/.test(code[j + 1] ?? '')) {
        j++;
        while (j < n && /[0-9a-zA-Z_]/.test(code[j]!)) j++;
      }
      toks.push({ type: 'num', value: code.slice(i, j), start: i });
      i = j;
      continue;
    }
    let punct = c;
    for (const p of PUNCT) {
      if (code.startsWith(p, i)) {
        punct = p;
        break;
      }
    }
    toks.push({ type: 'p', value: punct, start: i });
    i += punct.length;
  }
  return toks;
}

function pairBrackets(toks: RTok[]): number[] {
  const pair = new Array<number>(toks.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.type !== 'p') continue;
    if (t.value === '(' || t.value === '[' || t.value === '{') stack.push(i);
    else if (t.value === ')' || t.value === ']' || t.value === '}') {
      const open = stack.pop();
      if (open !== undefined) {
        pair[open] = i;
        pair[i] = open;
      }
    }
  }
  return pair;
}

const ITEM_KEYWORDS = new Set(['fn', 'impl', 'trait', 'mod', 'struct', 'enum', 'union', 'macro_rules']);
const IDENT_EXITS: ReadonlyMap<string, string> = new Map([
  ['into_parts_unchecked', 'into_parts_unchecked() called: the page\'s HTML leaves without its response'],
  ['with_module_preloads', 'with_module_preloads(): modulepreload links written into the head'],
  ['with_head_link', 'with_head_link(): a link written into the head'],
  ['relax_trusted_types', "relax_trusted_types(): this route's policy relaxes Trusted Types"],
]);
const FIELD_EXITS = new Set(['body_prefix', 'config_json', 'config_script']);
/** Option methods that write the field, and those of them that take the value written. */
const OPTION_WRITES = new Set(['replace', 'insert', 'get_or_insert', 'get_or_insert_with', 'as_mut', 'as_deref_mut']);
const OPTION_VALUE_WRITES = new Set(['replace', 'insert', 'get_or_insert']);

interface RBinding {
  /** The token that binds the name. */
  pos: number;
  /** The block it is visible in (its `{` and `}`; -1 and the end for the file). */
  open: number;
  close: number;
  /** It holds a RawHtml. */
  raw: boolean;
}

/** A Rust file read once: its tokens, and the aliases of `RawHtml` it defines. */
export class RustFile {
  readonly toks: RTok[];
  readonly pair: number[];
  /** Names it gives `RawHtml`: `use … RawHtml as X`, `type X = …RawHtml`. */
  readonly aliases = new Set<string>();

  constructor(readonly source: string) {
    this.toks = tokenize(source);
    this.pair = pairBrackets(this.toks);
    for (let i = 0; i < this.toks.length; i++) {
      if (this.isId(i, 'RawHtml') && this.isId(i + 1, 'as') && this.isId(i + 2)) this.aliases.add(this.toks[i + 2]!.value);
      if (this.isId(i, 'type') && this.isId(i + 1)) {
        let k = i + 2;
        if (this.isP(k, '<')) k = this.angleEnd(k) + 1;
        if (this.isP(k, '=')) {
          const last = this.pathEnd(k + 1);
          if (last !== -1 && this.toks[last]!.value === 'RawHtml') this.aliases.add(this.toks[i + 1]!.value);
        }
      }
    }
  }

  isId(i: number, value?: string): boolean {
    const t = this.toks[i];
    return t !== undefined && t.type === 'id' && (value === undefined || t.value === value);
  }

  isP(i: number, value: string): boolean {
    const t = this.toks[i];
    return t !== undefined && t.type === 'p' && t.value === value;
  }

  /** The `>` closing the `<` at `k` (counting nested angles); the last token if none. */
  angleEnd(k: number): number {
    let depth = 0;
    for (let j = k; j < this.toks.length; j++) {
      if (this.isP(j, '<')) depth++;
      else if (this.isP(j, '>')) {
        depth--;
        if (depth === 0) return j;
      } else if (this.isP(j, ';') || this.isP(j, '{')) return j - 1;
    }
    return this.toks.length - 1;
  }

  /**
   * The index of the last identifier of the path starting at `k`
   * (`::a::b::C`), when that path is not followed by `::`, `(`, `{` or `!`
   * (so it names a type, not a call or a struct literal); -1 otherwise.
   */
  pathEnd(k: number): number {
    let j = k;
    if (this.isP(j, '::')) j++;
    if (!this.isId(j)) return -1;
    while (this.isP(j + 1, '::') && this.isId(j + 2)) j += 2;
    if (this.isP(j + 1, '::') || this.isP(j + 1, '(') || this.isP(j + 1, '{') || this.isP(j + 1, '!')) return -1;
    return j;
  }
}

/**
 * The raw entries in a Rust file. `aliases` are the names every file in the
 * run gives `RawHtml`.
 */
export function scanRust(file: RustFile, aliases: ReadonlySet<string>): Found[] {
  return new RustScan(file, aliases).run();
}

interface Scope {
  open: number;
  close: number;
  kind: string;
  name: string | null;
  /** The item keyword's token (`fn`, `impl`, `struct`, …), when there is one. */
  head?: number;
  /** An `impl` block for `RawHtml` (or an alias): `Self::trusted` is `RawHtml::trusted`. */
  rawSelf: boolean;
}

class RustScan {
  private readonly toks: RTok[];
  private readonly pair: number[];
  private readonly found: Found[] = [];
  private readonly rawNames: Set<string>;
  /**
   * Every binding of each name (let, parameter, closure parameter, for and
   * match patterns): where it is made, the block it is visible in, and
   * whether it holds a `RawHtml` (FORMA-126 review, should-fix 1).
   */
  private readonly bindings = new Map<string, RBinding[]>();
  /** For each struct, its fields declared `RawHtml`. */
  private readonly structRawFields = new Map<string, Set<string>>();
  /** The innermost `{` around each token, or -1. */
  private enclosingBrace: number[] = [];
  /** For each `{`, what it opens. */
  private readonly scopes = new Map<number, Scope>();

  constructor(private readonly file: RustFile, aliases: ReadonlySet<string>) {
    this.toks = file.toks;
    this.pair = file.pair;
    this.rawNames = new Set(['RawHtml', ...aliases]);
  }

  run(): Found[] {
    this.classifyBraces();
    this.collectBindings();
    const stack: Scope[] = [];
    for (let i = 0; i < this.toks.length; i++) {
      while (stack.length > 0 && stack[stack.length - 1]!.close < i) stack.pop();
      this.visit(i, stack);
      const scope = this.scopes.get(i);
      if (scope) stack.push(scope);
    }
    return this.found;
  }

  private isId(i: number, value?: string): boolean {
    return this.file.isId(i, value);
  }

  private isP(i: number, value: string): boolean {
    return this.file.isP(i, value);
  }

  private report(i: number, stack: Scope[], exit: string, message: string, offset = this.toks[i]!.start): void {
    const pos = this.cursor(offset);
    const names = stack.map((s) => s.name).filter((n): n is string => n !== null);
    this.found.push({ exit, line: pos.line, column: pos.column, symbol: names.length > 0 ? names.join('::') : null, message });
  }

  private lastPos = { offset: 0, line: 1, column: 1 };

  /** A position at or before `offset` to count from (positions are asked for in order). */
  private cursor(offset: number): { offset: number; line: number; column: number } {
    if (offset < this.lastPos.offset) this.lastPos = { offset: 0, line: 1, column: 1 };
    const pos = positionIn(this.file.source, offset, this.lastPos);
    this.lastPos = { offset, ...pos };
    return this.lastPos;
  }

  /** What each `{` opens: an item (and its name) or an expression block. */
  private classifyBraces(): void {
    const enclosing: Scope[] = [];
    for (let k = 0; k < this.toks.length; k++) {
      while (enclosing.length > 0 && enclosing[enclosing.length - 1]!.close < k) enclosing.pop();
      if (!this.isP(k, '{') || this.pair[k]! < k) continue;
      const scope = this.classify(k, enclosing[enclosing.length - 1]);
      this.scopes.set(k, scope);
      enclosing.push(scope);
    }
  }

  private classify(k: number, parent: Scope | undefined): Scope {
    const open = k;
    const close = this.pair[k]!;
    if (this.isP(k - 1, '::')) return { open, close, kind: 'use', name: null, rawSelf: false };
    // Back to the start of the item or statement this brace belongs to.
    let b = k - 1;
    while (b >= 0) {
      const t = this.toks[b]!;
      if (t.type === 'p' && (t.value === ')' || t.value === ']') && this.pair[b]! >= 0) {
        b = this.pair[b]! - 1;
        continue;
      }
      if (t.type === 'p' && (t.value === ';' || t.value === '{' || t.value === '}')) break;
      b--;
    }
    for (let j = b + 1; j < k; j++) {
      if (this.isP(j, '#') && this.isP(j + 1, '[')) {
        j = this.pair[j + 1]!;
        continue;
      }
      const t = this.toks[j]!;
      if (t.type !== 'id' || !ITEM_KEYWORDS.has(t.value)) continue;
      if (t.value === 'impl') return this.implScope(j, k, close);
      if (t.value === 'macro_rules') return { open, close, kind: 'macro_rules', name: this.isP(j + 1, '!') && this.isId(j + 2) ? this.toks[j + 2]!.value : null, rawSelf: false, head: j };
      return { open, close, kind: t.value, name: this.isId(j + 1) ? this.toks[j + 1]!.value : null, rawSelf: false, head: j };
    }
    // A struct-like enum variant's fields are declarations, not a literal.
    if (parent?.kind === 'enum') return { open, close, kind: 'struct', name: null, rawSelf: false };
    return { open, close, kind: 'expr', name: null, rawSelf: false };
  }

  /** `impl<…> Trait for Type<…> {` or `impl<…> Type<…> {`: named for the type. */
  private implScope(at: number, k: number, close: number): Scope {
    let j = at + 1;
    if (this.isP(j, '<')) j = this.file.angleEnd(j) + 1;
    let depth = 0;
    let typeStart = j;
    for (let s = j; s < k; s++) {
      if (this.isP(s, '<')) depth++;
      else if (this.isP(s, '>')) depth--;
      else if (depth === 0 && this.isId(s, 'for')) typeStart = s + 1;
    }
    let name: string | null = null;
    for (let s = typeStart; s < k; s++) {
      if (this.isP(s, '<') || this.isId(s, 'where')) break;
      if (this.isId(s) && !['dyn', 'mut', 'crate', 'self', 'super'].includes(this.toks[s]!.value)) name = this.toks[s]!.value;
    }
    return { open: k, close, kind: 'impl', name, rawSelf: name !== null && this.rawNames.has(name) };
  }

  // -- bindings -------------------------------------------------------------
  //
  // A name holds a RawHtml at a use only when its last binding before the
  // use, in a block that encloses the use, is `let x = RawHtml::trusted(..)`,
  // `let x: RawHtml = ..` or a parameter `x: &RawHtml`. Any other binding of
  // the name in between (a shadowing `let`, a parameter, a closure parameter,
  // a `for` or match pattern) shadows it. Bindings are over-approximated,
  // which can only make a name untrusted.

  private bindName(name: string, pos: number, blockOpen: number, raw: boolean): void {
    const binding: RBinding = { pos, open: blockOpen, close: blockOpen === -1 ? this.toks.length : this.pair[blockOpen]!, raw };
    const list = this.bindings.get(name);
    if (list) list.push(binding);
    else this.bindings.set(name, [binding]);
  }

  /** Whether `name`, used at token `u`, holds a RawHtml. */
  private holdsRaw(name: string, u: number): boolean {
    let best: RBinding | undefined;
    for (const b of this.bindings.get(name) ?? []) {
      if (b.pos < u && b.open < u && u < b.close && (!best || b.pos > best.pos)) best = b;
    }
    return best?.raw === true;
  }

  /** A type at `k` that is a RawHtml: `[&['a] [mut]] [path::]RawHtml`. */
  private isRawType(k: number): boolean {
    if (this.isP(k, '&') || this.isP(k, '&&')) k++;
    if (this.toks[k]?.type === 'life') k++;
    if (this.isId(k, 'mut')) k++;
    const last = this.file.pathEnd(k);
    return last !== -1 && this.rawNames.has(this.toks[last]!.value);
  }

  /** An identifier at `k` that a pattern binds (not a path, a variant, `mut`, `ref` or `_`). */
  private isPatternName(k: number): boolean {
    const t = this.toks[k];
    if (!t || t.type !== 'id' || ['mut', 'ref', '_', 'in', 'if', 'box'].includes(t.value)) return false;
    if (/^[A-Z]/.test(t.value) || t.value.startsWith('$')) return false;
    return !this.isP(k + 1, '(') && !this.isP(k + 1, '{') && !this.isP(k + 1, '::') && !this.isP(k + 1, '!') && !this.isP(k - 1, '::') && !this.isP(k - 1, '.');
  }

  /** The pattern names in `[from, to)`, nested brackets included; stops at a depth-0 token in `stops`. */
  private patternNames(from: number, to: number, stops: string[]): { names: number[]; end: number } {
    const names: number[] = [];
    let k = from;
    while (k < to) {
      const t = this.toks[k]!;
      if (t.type === 'p' && stops.includes(t.value)) break;
      if (this.isId(k) && stops.includes(t.value)) break;
      if (t.type === 'p' && (t.value === '(' || t.value === '[' || t.value === '{') && this.pair[k]! > k) {
        for (let j = k + 1; j < this.pair[k]!; j++) if (this.isPatternName(j)) names.push(j);
        k = this.pair[k]! + 1;
        continue;
      }
      if (this.isPatternName(k)) names.push(k);
      k++;
    }
    return { names, end: k };
  }

  private collectBindings(): void {
    const n = this.toks.length;
    this.enclosingBrace = new Array<number>(n).fill(-1);
    const braces: number[] = [];
    for (let i = 0; i < n; i++) {
      while (braces.length > 0 && this.pair[braces[braces.length - 1]!]! < i) braces.pop();
      this.enclosingBrace[i] = braces[braces.length - 1] ?? -1;
      if (this.isP(i, '{') && this.pair[i]! > i) braces.push(i);
    }
    // Struct fields declared RawHtml (`self.x` holds one only in that struct's impl).
    for (const scope of this.scopes.values()) {
      if (scope.kind !== 'struct' || !scope.name) continue;
      for (let k = scope.open + 1; k < scope.close; k++) {
        if (this.toks[k]!.type === 'p' && ['(', '[', '{'].includes(this.toks[k]!.value) && this.pair[k]! > k) {
          k = this.pair[k]!;
          continue;
        }
        if (this.isId(k) && this.isP(k + 1, ':') && this.isRawType(k + 2)) {
          const fields = this.structRawFields.get(scope.name) ?? new Set<string>();
          fields.add(this.toks[k]!.value);
          this.structRawFields.set(scope.name, fields);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const t = this.toks[i]!;
      if (t.type === 'id' && t.value === 'let') {
        const { names, end } = this.patternNames(i + 1, n, [':', '=', ';', 'else']);
        const single = names.length === 1 && (names[0] === i + 1 || (names[0] === i + 2 && this.isId(i + 1, 'mut')));
        let raw = false;
        if (single) {
          if (this.isP(end, ':') && this.isRawType(end + 1)) raw = true;
          let e = end;
          while (e < n && !this.isP(e, '=') && !this.isP(e, ';')) e++;
          if (this.isP(e, '=') && this.trustedCallAt(e + 1) !== -1) raw = true;
        }
        for (const k of names) this.bindName(this.toks[k]!.value, k, this.enclosingBrace[i]!, single && raw);
      } else if (t.type === 'id' && t.value === 'fn') {
        this.bindParameters(i);
      } else if (t.type === 'p' && t.value === '|' && !this.endsValue(i - 1)) {
        // A closure's parameters, visible (over-approximated) in the block around it.
        let close = i + 1;
        while (close < n && !this.isP(close, '|')) {
          if (this.toks[close]!.type === 'p' && ['(', '[', '{'].includes(this.toks[close]!.value) && this.pair[close]! > close) close = this.pair[close]!;
          close++;
        }
        for (const k of this.patternNames(i + 1, close, []).names) this.bindName(this.toks[k]!.value, k, this.enclosingBrace[i]!, false);
        i = close;
      } else if (t.type === 'id' && t.value === 'for' && !this.isP(i + 1, '<')) {
        const { names, end } = this.patternNames(i + 1, n, ['in', '{', ';']);
        if (this.isId(end, 'in')) for (const k of names) this.bindName(this.toks[k]!.value, k, this.enclosingBrace[i]!, false);
      } else if (t.type === 'p' && t.value === '=>') {
        // A match arm's pattern: back to the previous arm.
        let b = i - 1;
        while (b >= 0) {
          const bt = this.toks[b]!;
          if (bt.type === 'p' && (bt.value === ')' || bt.value === ']') && this.pair[b]! >= 0 && this.pair[b]! < b) {
            b = this.pair[b]! - 1;
            continue;
          }
          if (bt.type === 'p' && (bt.value === ',' || bt.value === '{' || bt.value === '}' || bt.value === ';')) break;
          b--;
        }
        for (const k of this.patternNames(b + 1, i, []).names) this.bindName(this.toks[k]!.value, k, this.enclosingBrace[i]!, false);
      }
    }
  }

  /** A token that ends a value: after it, `|` is an operator, not a closure. */
  private endsValue(k: number): boolean {
    const t = this.toks[k];
    if (!t) return false;
    if (t.type === 'id') return !['move', 'return', 'in', 'else', 'match', 'if', 'while', 'let'].includes(t.value);
    if (t.type === 'num' || t.type === 'str' || t.type === 'char') return true;
    return t.type === 'p' && (t.value === ')' || t.value === ']' || t.value === '?');
  }

  /** A function's parameters, visible in its body: `name: &RawHtml` holds one. */
  private bindParameters(fn: number): void {
    let k = fn + 2;
    if (this.isP(k, '<')) k = this.file.angleEnd(k) + 1;
    if (!this.isP(k, '(') || this.pair[k]! < k) return;
    const close = this.pair[k]!;
    let body = close + 1;
    while (body < this.toks.length && !this.isP(body, '{') && !this.isP(body, ';')) body++;
    if (!this.isP(body, '{')) return;
    let start = k + 1;
    while (start < close) {
      let end = start;
      while (end < close && !this.isP(end, ',')) {
        if (this.toks[end]!.type === 'p' && ['(', '[', '{'].includes(this.toks[end]!.value) && this.pair[end]! > end) end = this.pair[end]!;
        end++;
      }
      const { names, end: colon } = this.patternNames(start, end, [':']);
      const single = names.length === 1 && names[0] === colon - 1;
      const raw = single && this.isP(colon, ':') && this.isRawType(colon + 1);
      for (const nk of names) this.bindName(this.toks[nk]!.value, nk, body, raw);
      start = end + 1;
    }
  }

  /**
   * At `k`, a call of `RawHtml::trusted` (or through an alias, or
   * `<RawHtml>::trusted`): the index of its closing `)`, else -1.
   */
  private trustedCallAt(k: number): number {
    let j = k;
    if (this.isP(j, '<')) j++;
    while (this.isId(j) && this.isP(j + 1, '::') && !this.rawNames.has(this.toks[j]!.value)) j += 2;
    if (!this.isId(j) || !this.rawNames.has(this.toks[j]!.value)) return -1;
    j++;
    if (this.isP(j, '>')) j++;
    if (!this.isP(j, '::') || !this.isId(j + 1, 'trusted') || !this.isP(j + 2, '(')) return -1;
    return this.pair[j + 2]!;
  }

  /** The end (exclusive) of the field value or assignment starting at `start`. */
  private valueEnd(start: number): number {
    let k = start;
    while (k < this.toks.length) {
      const t = this.toks[k]!;
      if (t.type === 'p') {
        if (t.value === '(' || t.value === '[' || t.value === '{') {
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

  /** Whether `[a, b)` is a `RawHtml` this file vouched for, wrapped in `Some(&…)` or not. */
  private isRawValue(a: number, b: number, stack: Scope[]): boolean {
    if (this.isId(a, 'Some') && this.isP(a + 1, '(') && this.pair[a + 1] === b - 1) {
      a += 2;
      b -= 1;
    }
    while (a < b && (this.isP(a, '&') || this.isP(a, '*') || this.isP(a, '&&'))) a++;
    const call = this.trustedCallAt(a);
    if (call !== -1) return call === b - 1 || this.isMethodTail(call + 1, b);
    if (this.isId(a, 'self') && this.isP(a + 1, '.') && this.isId(a + 2)) {
      // A field declared RawHtml by this impl's own struct.
      const impl = [...stack].reverse().find((sc) => sc.kind === 'impl');
      const field = this.toks[a + 2]!.value;
      if (!impl?.name || !this.structRawFields.get(impl.name)?.has(field)) return false;
      return a + 3 === b || this.isMethodTail(a + 3, b);
    }
    if (!this.isId(a) || !this.holdsRaw(this.toks[a]!.value, a)) return false;
    return a + 1 === b || this.isMethodTail(a + 1, b);
  }

  /** `.as_str()`, `.as_ref()`, `.deref()` or `[..]` ending exactly at `b`. */
  private isMethodTail(k: number, b: number): boolean {
    if (this.isP(k, '.') && this.isId(k + 1) && ['as_str', 'as_ref', 'deref'].includes(this.toks[k + 1]!.value) && this.isP(k + 2, '(') && this.pair[k + 2] === b - 1) return true;
    return this.isP(k, '[') && this.isP(k + 1, '..') && this.isP(k + 2, ']') && k + 3 === b;
  }

  private visit(i: number, stack: Scope[]): void {
    const tok = this.toks[i]!;
    if (tok.type === 'str') {
      for (const m of scanStringMarkup(tok.value, !tok.rawString)) this.report(i, stack, m.exit, m.message, tok.contentStart! + m.offset);
      return;
    }
    if (tok.type !== 'id') return;
    const name = tok.value;

    if (tok.raw && name === 'html') {
      this.report(i, stack, 'r#html', 'the raw identifier r#html, the name of RawHtml\'s private field');
      return;
    }

    // RawHtml::trusted, through an alias, <RawHtml>::trusted, or Self::trusted in an impl for RawHtml.
    const selfRaw = name === 'Self' && stack.some((s) => s.kind === 'impl' && s.rawSelf);
    if (this.rawNames.has(name) || selfRaw) {
      let j = i + 1;
      if (this.isP(j, '>')) j++;
      if (this.isP(j, '::') && this.isId(j + 1, 'trusted')) {
        const how = name === 'RawHtml' ? '' : selfRaw ? ' as Self::trusted' : ` through the alias ${name}`;
        this.report(i, stack, 'RawHtml::trusted', `RawHtml::trusted${how}: markup written into the page unescaped`);
      }
      if (name === 'RawHtml' && this.isId(i + 1, 'as') && this.isId(i + 2)) {
        this.report(i, stack, 'RawHtml-alias', `RawHtml renamed ${this.toks[i + 2]!.value}, which a search for RawHtml::trusted does not find`);
      }
    }
    if (name === 'RawHtml') {
      // `= RawHtml` (a type alias, an associated type, a generic default): another name for it.
      let start = i;
      while (this.isP(start - 1, '::') && this.isId(start - 2)) start -= 2;
      if (this.isP(start - 1, '::')) start--;
      if (this.isP(start - 1, '=') && this.file.pathEnd(start) === i) {
        const named = this.isId(start - 2) ? ` (${this.toks[start - 2]!.value})` : '';
        this.report(i, stack, 'RawHtml-alias', `RawHtml given another name${named}, which a search for RawHtml::trusted does not find`);
      }
    }

    const identExit = IDENT_EXITS.get(name);
    if (identExit) {
      this.report(i, stack, name, identExit);
      return;
    }

    if (FIELD_EXITS.has(name)) this.visitField(i, stack, name);
  }

  /** `body_prefix: v`, `config_json: v`, `config_script: v` in a struct literal, or `x.field = v`. */
  private visitField(i: number, stack: Scope[], name: string): void {
    const enclosing = stack[stack.length - 1];
    const inLiteral = enclosing !== undefined && enclosing.kind === 'expr' && !this.isPattern(enclosing);
    const afterOpen = this.isP(i - 1, '{') || this.isP(i - 1, ',') || (this.isP(i - 1, ']') && this.isP(this.pair[i - 1]! - 1, '#'));
    let start = -1;
    if (inLiteral && afterOpen && this.isP(i + 1, ':')) start = i + 2;
    else if (this.isP(i - 1, '.') && this.isP(i + 1, '=')) start = i + 2;
    else if (inLiteral && afterOpen && (this.isP(i + 1, ',') || this.isP(i + 1, '}')) && this.isStructLiteral(enclosing)) {
      this.report(i, stack, name, `${name} set by shorthand from a local the lint cannot read`);
      return;
    }
    if (start === -1 && this.isP(i - 1, '.')) {
      this.visitFieldWrite(i, stack, name);
      return;
    }
    if (start === -1) return;
    const end = this.valueEnd(start);
    if (end === start + 1 && this.isId(start, 'None')) return;
    if (name === 'body_prefix') {
      if (!this.isRawValue(start, end, stack)) this.report(i, stack, 'body_prefix', 'body_prefix set to a value not traced to RawHtml::trusted (a string still works in 0.2.x)');
    } else if (name === 'config_json') {
      this.report(i, stack, 'config_json', 'config_json: data written into the page as JSON');
    } else {
      this.report(i, stack, 'config_script', 'config_script (deprecated): handler text written into a nonced script');
    }
  }

  /**
   * The field written another way (FORMA-126 review, should-fix 3): through
   * an Option method (`c.body_prefix.replace(s)`, `.insert`, `.get_or_insert`,
   * `.get_or_insert_with`, `.as_mut`, `.as_deref_mut`), or through a mutable
   * borrow (`&mut c.body_prefix`, as `mem::replace` and `*(&mut …) =` take).
   */
  private visitFieldWrite(i: number, stack: Scope[], name: string): void {
    if (this.isP(i + 1, '.') && this.isId(i + 2) && OPTION_WRITES.has(this.toks[i + 2]!.value) && this.isP(i + 3, '(')) {
      const method = this.toks[i + 2]!.value;
      const open = i + 3;
      const close = this.pair[open]!;
      if (name === 'body_prefix' && OPTION_VALUE_WRITES.has(method) && close > open + 1 && this.isRawValue(open + 1, close, stack)) return;
      this.report(i, stack, name, `${name}.${method}(): a write the lint cannot trace to ${name === 'body_prefix' ? 'RawHtml::trusted' : 'a typed value'}`);
      return;
    }
    // Back over the place expression `c.page.body_prefix` to its start.
    let k = i;
    while (this.isP(k - 1, '.') && this.isId(k - 2)) k -= 2;
    if (this.isId(k - 1, 'mut') && (this.isP(k - 2, '&') || this.isP(k - 2, '&&'))) {
      this.report(i, stack, name, `&mut ${name}: whatever is written through the borrow the lint cannot see`);
    }
  }

  /** A `{` preceded by a type name: `PageConfig {`, `Self {`. */
  private isStructLiteral(scope: Scope): boolean {
    const before = this.toks[scope.open - 1];
    return before !== undefined && before.type === 'id' && /^[A-Z]/.test(before.value);
  }

  /** A struct pattern (`let PageConfig { body_prefix, .. } = c`, a match arm): it reads the field. */
  private isPattern(scope: Scope): boolean {
    if (this.isP(scope.close + 1, '=>')) return true;
    let b = scope.open - 1;
    while (this.isId(b) && this.isP(b - 1, '::')) b -= 2;
    return this.isId(b - 1, 'let') && this.isP(scope.close + 1, '=');
  }
}
