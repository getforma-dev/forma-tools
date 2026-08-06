import { describe, it, expect, vi } from 'vitest';
import { IrEmitContext } from '../src/ir-emit';
import { walkHTree, walkCallExpression, type WalkContext } from '../src/ir-walk';
import { ComponentAnalyzer } from '../src/component-analyzer';
import {
  collectSignalDeclarations,
  enterSignalScope,
  newSignalRegistry,
} from '../src/signal-scope';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';
import {
  assertBinaryInvariants,
  getIslands,
  getSlotNames,
  getSlots,
  getStrings,
  parseOpcodeList,
} from './helpers/fmir';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseExpr(code: string): T.Expression {
  const ast = parse(`const __x = ${code}`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  const decl = ast.program.body[0] as T.VariableDeclaration;
  return decl.declarations[0]!.init!;
}

/**
 * Walk an h() expression through walkHTree into `ctx` and return the binary,
 * asserting the universal FMIR invariants (see assertBinaryInvariants) on the
 * way out. Every test in this file emits through one of these three helpers,
 * so page-wide slot-name uniqueness, slot-id density, string interning,
 * orphan-free string tables and island byte offsets are enforced for free on
 * every fixture — including ones written long before those properties existed.
 */
function walkIntoAndEmit(code: string, ctx: IrEmitContext, walkCtx: WalkContext = {}): Uint8Array {
  const expr = parseExpr(code);
  if (t.isCallExpression(expr)) {
    walkHTree(expr, 'h', ctx, walkCtx);
  }
  const binary = ctx.toBinary();
  assertBinaryInvariants(binary);
  return binary;
}

/** Emit an h() expression through walkHTree. */
function walkAndEmit(code: string, walkCtx: WalkContext = {}): Uint8Array {
  return walkIntoAndEmit(code, new IrEmitContext(), walkCtx);
}

/**
 * Open a signal scope over `declarations` (real source, read by the real
 * collector) and return it with the context its slots were minted into.
 *
 * Tests build scopes the way the walk does rather than hand-assembling slot
 * maps: a hand-made map could stay valid while the pass that produces the real
 * one broke.
 */
function withSignals(declarations: string): { ctx: IrEmitContext; walkCtx: WalkContext } {
  const ctx = new IrEmitContext();
  const registry = newSignalRegistry();
  const scope = enterSignalScope(
    null,
    'fixture.ts#module',
    collectSignalDeclarations(
      parse(declarations, { sourceType: 'module', plugins: ['typescript'] }).program.body as T.Statement[],
      { filePath: 'fixture.ts' },
    ),
    ctx,
    registry,
  );
  return { ctx, walkCtx: { signalScope: scope, signalRegistry: registry } };
}

/** Emit a non-h() call expression through walkCallExpression. */
function walkCallAndEmit(code: string, walkCtx: WalkContext = {}): Uint8Array {
  const expr = parseExpr(code);
  const ctx = new IrEmitContext();
  if (t.isCallExpression(expr)) {
    walkCallExpression(expr, 'h', ctx, walkCtx);
  }
  const binary = ctx.toBinary();
  assertBinaryInvariants(binary);
  return binary;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IR Walk Engine', () => {
  // -------------------------------------------------------------------------
  // Rule 1: Static h() calls → OPEN_TAG + CLOSE_TAG
  // -------------------------------------------------------------------------

  describe('Rule 1: Static h() calls', () => {
    it('emits OPEN_TAG and CLOSE_TAG for static div', () => {
      const binary = walkAndEmit(`h('div', { class: 'hero-section' }, 'Hello')`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div class="hero-section"',
        'TEXT "Hello"',
        'CLOSE_TAG div',
      ]);
    });

    it('emits static attributes in prop order, interned exactly once each', () => {
      const binary = walkAndEmit(`h('div', { class: 'hero-section', id: 'main' })`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div class="hero-section" id="main"',
        'CLOSE_TAG div',
      ]);
      expect(getStrings(binary)).toEqual(['div', 'class', 'hero-section', 'id', 'main']);
      expect(getSlotNames(binary)).toEqual([]);
    });

    it('emits nested elements correctly', () => {
      const binary = walkAndEmit(`h('div', null, h('span', null, 'Hi'))`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG span',
        'TEXT "Hi"',
        'CLOSE_TAG span',
        'CLOSE_TAG div',
      ]);
    });

    it('omits an attribute whose static value is false', () => {
      const binary = walkAndEmit(`h('div', { hidden: false, id: 'x' })`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div id="x"',
        'CLOSE_TAG div',
      ]);
      expect(getStrings(binary)).toEqual(['div', 'id', 'x']);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 2: String literal children → TEXT
  // -------------------------------------------------------------------------

  describe('Rule 2: String literal children', () => {
    it('emits TEXT for string child', () => {
      const binary = walkAndEmit(`h('h1', null, 'Auth infrastructure for modern SaaS')`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG h1',
        'TEXT "Auth infrastructure for modern SaaS"',
        'CLOSE_TAG h1',
      ]);
      expect(getStrings(binary)).toEqual(['h1', 'Auth infrastructure for modern SaaS']);
    });

    it('emits TEXT for numeric child', () => {
      const binary = walkAndEmit(`h('span', null, 42)`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG span',
        'TEXT "42"',
        'CLOSE_TAG span',
      ]);
      expect(getStrings(binary)).toEqual(['span', '42']);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 3: Void elements → VOID_TAG
  // -------------------------------------------------------------------------

  describe('Rule 3: Void elements', () => {
    it('emits VOID_TAG with no CLOSE_TAG for input', () => {
      const binary = walkAndEmit(
        `h('input', { id: 'reg-email', type: 'email', placeholder: 'you@company.com' })`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'VOID_TAG input id="reg-email" type="email" placeholder="you@company.com"',
      ]);
    });

    it('emits VOID_TAG for br', () => {
      const binary = walkAndEmit(`h('br', null)`);
      expect(parseOpcodeList(binary)).toEqual(['VOID_TAG br']);
    });

    it('emits VOID_TAG for img with attributes', () => {
      const binary = walkAndEmit(`h('img', { src: '/logo.png', alt: 'Logo' })`);

      expect(parseOpcodeList(binary)).toEqual([
        'VOID_TAG img src="/logo.png" alt="Logo"',
      ]);
      expect(getStrings(binary)).toEqual(['img', 'src', '/logo.png', 'alt', 'Logo']);
    });

    it('emits DYN_ATTR after VOID_TAG for a function-valued attribute', () => {
      const binary = walkAndEmit(`h('input', { type: () => showPassword() ? 'text' : 'password' })`);

      expect(parseOpcodeList(binary)).toEqual([
        'VOID_TAG input',
        'DYN_ATTR type -> attr:type',
      ]);
    });

    it('drops children of a void element', () => {
      const binary = walkAndEmit(`h('br', null, 'ignored')`);

      expect(parseOpcodeList(binary)).toEqual(['VOID_TAG br']);
      expect(getStrings(binary)).toEqual(['br']);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 4: Ternary arrow → SHOW_IF
  // -------------------------------------------------------------------------

  describe('Rule 4: Ternary arrow children', () => {
    it('emits SHOW_IF/SHOW_ELSE with branch lengths bounding each branch', () => {
      const binary = walkAndEmit(
        `h('button', null, () => submitting() ? 'Creating account...' : 'Create Account')`,
      );

      // TEXT is 5 bytes (opcode + str_idx), so each branch is exactly 5 long.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG button',
        'SHOW_IF show:submitting then=5 else=5',
        'TEXT "Creating account..."',
        'SHOW_ELSE',
        'TEXT "Create Account"',
        'CLOSE_TAG button',
      ]);
    });

    it('emits TEXT in both branches of ternary', () => {
      const binary = walkAndEmit(`h('span', null, () => active() ? 'Active' : 'Inactive')`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG span',
        'SHOW_IF show:active then=5 else=5',
        'TEXT "Active"',
        'SHOW_ELSE',
        'TEXT "Inactive"',
        'CLOSE_TAG span',
      ]);
    });

    it('emits h() call trees in ternary branches', () => {
      const binary = walkAndEmit(
        `h('div', null, () => loading() ? h('span', null, 'Loading...') : h('p', null, 'Done'))`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'SHOW_IF show:loading then=17 else=17',
        'OPEN_TAG span',
        'TEXT "Loading..."',
        'CLOSE_TAG span',
        'SHOW_ELSE',
        'OPEN_TAG p',
        'TEXT "Done"',
        'CLOSE_TAG p',
        'CLOSE_TAG div',
      ]);
    });

    it('records structurally asymmetric branch lengths independently', () => {
      // Every branch length in the fixtures above is symmetric, so a then/else
      // swap would be invisible. Here the branches differ in shape AND size:
      // then = OPEN_TAG(7) + VOID_TAG(7) + CLOSE_TAG(5) = 19 bytes,
      // else = TEXT(5).
      const binary = walkAndEmit(
        `h('div', null, () => editing() ? h('form', null, h('input', null)) : 'read only')`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'SHOW_IF show:editing then=19 else=5',
        'OPEN_TAG form',
        'VOID_TAG input',
        'CLOSE_TAG form',
        'SHOW_ELSE',
        'TEXT "read only"',
        'CLOSE_TAG div',
      ]);
    });

    it('dedupes ternary shows against createShow shows in one namespace', () => {
      const binary = walkAndEmit(
        `h('div', null,
          () => visible() ? 'Yes' : 'No',
          createShow(() => visible(), () => h('span', null, 'Also')),
        )`,
      );

      expect(getSlotNames(binary)).toEqual(['show:visible', 'show:visible#2']);
    });

    it('falls back to a positional name for a non-derivable ternary test', () => {
      const binary = walkAndEmit(`h('div', null, () => (a() && b()) ? 'Both' : 'Not')`);
      expect(getSlotNames(binary)).toEqual(['show:#1']);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 5: Non-ternary arrow → DYN_TEXT
  // -------------------------------------------------------------------------

  describe('Rule 5: Non-ternary arrow children', () => {
    it('emits DYN_TEXT for non-ternary arrow', () => {
      const binary = walkAndEmit(`h('span', null, () => email())`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG span',
        'DYN_TEXT text:0 marker=0',
        'CLOSE_TAG span',
      ]);
    });

    it('emits DYN_TEXT, not SHOW_IF, for an arrow calling a signal', () => {
      const binary = walkAndEmit(`h('div', null, () => count())`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'DYN_TEXT text:0 marker=0',
        'CLOSE_TAG div',
      ]);
    });

    it('names the text slot after its child index within the parent', () => {
      const binary = walkAndEmit(`h('div', null, 'a', () => b(), 'c', () => d())`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'TEXT "a"',
        'DYN_TEXT text:1 marker=0',
        'TEXT "c"',
        'DYN_TEXT text:3 marker=1',
        'CLOSE_TAG div',
      ]);
    });

    it('reuses the slot of a signal that is in scope', () => {
      const { ctx, walkCtx } = withSignals(`const [email] = createSignal('');`);
      const binary = walkIntoAndEmit(`h('div', null, () => email())`, ctx, walkCtx);

      // Binding to the signal slot by NAME proves the DYN_TEXT operand points
      // at slot 0 and that no fresh `text:0` slot was minted.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'DYN_TEXT email marker=0',
        'CLOSE_TAG div',
      ]);
      expect(getSlotNames(binary)).toEqual(['email']);
    });

    it('gives an anonymous text slot the value the client would render', () => {
      // `() => count() + ' items'` is not a bare signal call, so it mints its
      // own `text:` slot — which used to carry NO default at all, so the
      // server emitted the zero-width-space placeholder and the text appeared
      // only after hydration.
      const { ctx, walkCtx } = withSignals(`const [count] = createSignal(3);`);
      const binary = walkIntoAndEmit(`h('p', null, () => count() + ' items')`, ctx, walkCtx);

      expect(getSlots(binary).find(s => s.name === 'text:0')!.default).toBe('3 items');
    });
  });

  // -------------------------------------------------------------------------
  // Rule 6: Function-valued props → DYN_ATTR
  // -------------------------------------------------------------------------

  describe('Rule 6: Function-valued props', () => {
    it('emits DYN_ATTR bound to an attr slot for a function-valued prop', () => {
      const binary = walkAndEmit(`h('input', { type: () => showPassword() ? 'text' : 'password' })`);

      expect(parseOpcodeList(binary)).toEqual([
        'VOID_TAG input',
        'DYN_ATTR type -> attr:type',
      ]);
      expect(getStrings(binary)).toEqual(['input', 'type', 'attr:type']);
    });

    it('keeps static and dynamic attributes of one element distinct', () => {
      const binary = walkAndEmit(
        `h('div', { class: 'static', style: () => dynamicStyle() }, 'Content')`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div class="static"',
        'DYN_ATTR style -> attr:style',
        'TEXT "Content"',
        'CLOSE_TAG div',
      ]);
      expect(getStrings(binary)).toEqual([
        'div', 'class', 'static', 'style', 'Content', 'attr:style',
      ]);
    });

    it('emits a static attribute for an identifier resolving to a module string const', () => {
      const stringConstants = new Map([['SIL_BODY', 'M10 20 L30 40']]);
      const binary = walkAndEmit(`h('path', { d: SIL_BODY })`, { stringConstants });

      // Resolved const → static attribute pair, no DYN_ATTR and no slot.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG path d="M10 20 L30 40"',
        'CLOSE_TAG path',
      ]);
      expect(getSlotNames(binary)).toEqual([]);
    });

    it('folds const + chains via extractStringConstants into a static attribute', () => {
      const analyzer = new ComponentAnalyzer('.');
      const source = [
        `const SIL_HEAD = 'M10 0 ';`,
        `const SIL_TORSO = 'L20 30';`,
        'const SIL_BODY = SIL_HEAD + SIL_TORSO + `z`;',
      ].join('\n');
      const stringConstants = analyzer.extractStringConstants(source, 'icon.ts');
      expect(stringConstants.get('SIL_BODY')).toBe('M10 0 L20 30z');

      const binary = walkAndEmit(`h('path', { d: SIL_BODY })`, { stringConstants });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG path d="M10 0 L20 30z"',
        'CLOSE_TAG path',
      ]);
      expect(getSlotNames(binary)).toEqual([]);
    });

    it('does not fold a module const shadowed in a nested scope and warns instead', () => {
      const analyzer = new ComponentAnalyzer('.');
      const source = [
        `const cls = 'icon';`,
        `export function Page() {`,
        `  const cls = computeClass();`,
        `  return h('div', { class: cls });`,
        `}`,
      ].join('\n');
      const stringConstants = analyzer.extractStringConstants(source, 'page.ts');
      // The shadowed name must NOT survive folding — baking the module value
      // as a static attr would be unrecoverable client-side (F10 hazard).
      expect(stringConstants.has('cls')).toBe(false);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const binary = walkAndEmit(`h('div', { class: cls })`, { stringConstants });

      // Falls back to the correctable DYN_ATTR path, with the build warning.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'DYN_ATTR class -> attr:class',
        'CLOSE_TAG div',
      ]);
      expect(getStrings(binary)).toEqual(['div', 'class', 'attr:class']);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`attribute 'class' on <div> is cls, which the compiler cannot evaluate`),
      );
      warnSpy.mockRestore();
    });

    it('does not fold let variables and warns on the unresolved identifier', () => {
      const analyzer = new ComponentAnalyzer('.');
      const stringConstants = analyzer.extractStringConstants(
        `let silBody = 'M10 20';`,
        'icon.ts',
      );
      expect(stringConstants.has('silBody')).toBe(false);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const binary = walkAndEmit(`h('path', { d: silBody })`, { stringConstants });

      // Keeps today's behavior: DYN_ATTR with an empty-default slot.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG path',
        'DYN_ATTR d -> attr:d',
        'CLOSE_TAG path',
      ]);
      expect(getSlots(binary)).toEqual([
        { id: 0, name: 'attr:d', nameIdx: 2, typeHint: 0x01, source: 0x01, default: '' },
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`attribute 'd' on <path> is silBody, which the compiler cannot evaluate`),
      );
      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Rule 7: on* event handlers → skip
  // -------------------------------------------------------------------------

  describe('Rule 7: Event handlers skipped', () => {
    it('skips onClick handler and keeps the other props', () => {
      const binary = walkAndEmit(
        `h('button', { onClick: () => startOAuth('google'), class: 'btn' }, 'Sign in')`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG button class="btn"',
        'TEXT "Sign in"',
        'CLOSE_TAG button',
      ]);
      // Neither the handler name nor a slot for it reaches the binary.
      expect(getStrings(binary)).toEqual(['button', 'class', 'btn', 'Sign in']);
      expect(getSlotNames(binary)).toEqual([]);
    });

    it('skips onSubmit handler', () => {
      const binary = walkAndEmit(`h('form', { onSubmit: handleRegister, id: 'reg-form' })`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG form id="reg-form"',
        'CLOSE_TAG form',
      ]);
      expect(getStrings(binary)).toEqual(['form', 'id', 'reg-form']);
    });

    it('does not skip "on" or "one" props (must be on + uppercase)', () => {
      const binary = walkAndEmit(`h('div', { one: 'val', on: 'test' })`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div one="val" on="test"',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 8: createShow() → SHOW_IF
  // -------------------------------------------------------------------------

  describe('Rule 8: createShow', () => {
    it('emits SHOW_IF with an empty else branch when no else is given', () => {
      const binary = walkCallAndEmit(
        `createShow(() => hasOAuth, () => h('div', { class: 'oauth-actions' }, 'OAuth'))`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'SHOW_IF show:hasOAuth then=25 else=0',
        'OPEN_TAG div class="oauth-actions"',
        'TEXT "OAuth"',
        'CLOSE_TAG div',
        'SHOW_ELSE',
      ]);
    });

    it('derives the slot name from the condition', () => {
      const binary = walkCallAndEmit(
        `createShow(() => visible(), () => h('span', null, 'Visible'))`,
      );
      expect(getSlotNames(binary)).toEqual(['show:visible']);
    });

    it('derives the slot name through a ! negation', () => {
      const binary = walkCallAndEmit(
        `createShow(() => !hidden(), () => h('span', null, 'Shown'))`,
      );
      expect(getSlotNames(binary)).toEqual(['show:hidden']);
    });

    it('derives the slot name from a function-expression condition', () => {
      const binary = walkCallAndEmit(
        `createShow(function () { return visible(); }, () => h('span', null, 'Visible'))`,
      );
      expect(getSlotNames(binary)).toEqual(['show:visible']);
    });

    it('derives the slot name from a block-body arrow condition', () => {
      const binary = walkCallAndEmit(
        `createShow(() => { return visible(); }, () => h('span', null, 'Visible'))`,
      );
      expect(getSlotNames(binary)).toEqual(['show:visible']);
    });

    it('dedupes two shows on the same signal with #n suffixes', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createShow(() => visible(), () => h('span', null, 'A')),
          createShow(() => visible(), () => h('span', null, 'B')),
        )`,
      );
      expect(getSlotNames(binary)).toEqual(['show:visible', 'show:visible#2']);
    });

    it('falls back to a positional name for a non-derivable condition', () => {
      const binary = walkCallAndEmit(
        `createShow(() => a() && b(), () => h('span', null, 'Both'))`,
      );
      expect(getSlotNames(binary)).toEqual(['show:#1']);
    });

    it('emits both branches when an else branch is provided', () => {
      const binary = walkCallAndEmit(
        `createShow(() => loggedIn, () => h('div', null, 'Welcome'), () => h('div', null, 'Please login'))`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'SHOW_IF show:loggedIn then=17 else=17',
        'OPEN_TAG div',
        'TEXT "Welcome"',
        'CLOSE_TAG div',
        'SHOW_ELSE',
        'OPEN_TAG div',
        'TEXT "Please login"',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 9: Spread .map() unroll
  // -------------------------------------------------------------------------

  describe('Rule 9: Spread .map() unroll', () => {
    it('unrolls item properties in attribute position', () => {
      // Substitution used to descend into CHILD arguments only, so the props
      // object passed through untouched: every attribute taken from the row
      // reached the walker as an unresolvable `item.href` and was emitted as
      // an EMPTY dynamic attribute. The links rendered with no href and
      // nothing said so — the same failure shape as ledger finding #10.
      const binary = walkAndEmit(
        `h('nav', null, ...NAV.map((item) => h('a', { href: item.href, class: 'nav-link' }, item.label)))`,
        {
          fileConstants: new Map<string, any[]>([
            ['NAV', [
              { href: '/', label: 'Home' },
              { href: '/reports', label: 'Reports' },
            ]],
          ]),
        },
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG nav',
        'OPEN_TAG a href="/" class="nav-link"',
        'TEXT "Home"',
        'CLOSE_TAG a',
        'OPEN_TAG a href="/reports" class="nav-link"',
        'TEXT "Reports"',
        'CLOSE_TAG a',
        'CLOSE_TAG nav',
      ]);
      // Fully static: no slot to inject, nothing deferred to the client.
      expect(getSlotNames(binary)).toEqual([]);
      expect(getIslands(binary)).toEqual([]);
    });

    it('unrolls numeric and boolean item properties in attribute position', () => {
      const binary = walkAndEmit(
        `h('ul', null, ...ROWS.map((r) => h('li', { 'data-n': r.n, hidden: r.off }, 'x')))`,
        {
          fileConstants: new Map<string, any[]>([
            ['ROWS', [{ n: 1, off: false }, { n: 2, off: true }]],
          ]),
        },
      );

      // `hidden: false` drops the attribute (HTML boolean semantics);
      // `hidden: true` renders it valueless.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG ul',
        'OPEN_TAG li data-n="1"',
        'TEXT "x"',
        'CLOSE_TAG li',
        'OPEN_TAG li data-n="2" hidden=""',
        'TEXT "x"',
        'CLOSE_TAG li',
        'CLOSE_TAG ul',
      ]);
    });

    it('unrolls static .map() with fileConstants', () => {
      const fileConstants = new Map<string, any[]>([
        ['CAPABILITIES', [
          { title: 'Multi-Tenant Auth', description: 'Isolated tenants' },
          { title: 'JWT Tokens', description: 'EdDSA signed' },
        ]],
      ]);

      const binary = walkAndEmit(
        `h('div', null, ...CAPABILITIES.map((cap) => h('div', { class: 'cap-card' }, h('h3', null, cap.title))))`,
        { fileConstants },
      );

      // One fully static copy per item, no island.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG div class="cap-card"',
        'OPEN_TAG h3',
        'TEXT "Multi-Tenant Auth"',
        'CLOSE_TAG h3',
        'CLOSE_TAG div',
        'OPEN_TAG div class="cap-card"',
        'OPEN_TAG h3',
        'TEXT "JWT Tokens"',
        'CLOSE_TAG h3',
        'CLOSE_TAG div',
        'CLOSE_TAG div',
      ]);
      // The unused `description` values are never interned.
      expect(getStrings(binary)).toEqual([
        'div', 'class', 'cap-card', 'h3', 'Multi-Tenant Auth', 'JWT Tokens',
      ]);
    });

    it('emits island for .map() without fileConstants', () => {
      const binary = walkAndEmit(
        `h('div', null, ...items.map((item) => h('div', null, item.name)))`,
        { fileConstants: new Map() },
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'ISLAND_START island_0#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END island_0#0',
        'CLOSE_TAG div',
      ]);
    });

    it('emits island for spread without .map()', () => {
      const binary = walkAndEmit(`h('div', null, ...children)`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'ISLAND_START island_0#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END island_0#0',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 10: Sub-component calls
  // -------------------------------------------------------------------------

  describe('Rule 10: Sub-component calls', () => {
    it('follows sub-component with resolveComponent', () => {
      const resolveComponent = (name: string) => name === 'Alert'
        ? {
          source: `export function Alert() { return h('div', { class: 'alert' }, 'Alert message'); }`,
          functionName: 'Alert',
        }
        : null;

      const binary = walkAndEmit(`h('div', null, Alert({ variant: 'error' }))`, { resolveComponent });

      // Inlined in place — no island markers, no wrapper element.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG div class="alert"',
        'TEXT "Alert message"',
        'CLOSE_TAG div',
        'CLOSE_TAG div',
      ]);
      expect(getIslands(binary)).toEqual([]);
    });

    it('asks the resolver for the file the CALL is in, not the entry point', () => {
      // A resolver closed over the entry's imports could only ever see what
      // the entry imported. Passing the current file is what lets a page
      // resolve its own components — the context is spread-copied on every
      // nested walk, so a closure captured once cannot be rebased.
      const asked: Array<string | undefined> = [];
      const resolveComponent = (name: string, fromFile?: string) => {
        asked.push(fromFile);
        return name === 'Alert'
          ? {
            source: `export function Alert() { return h('div', { class: 'alert' }, 'ok'); }`,
            functionName: 'Alert',
            path: '/proj/alert.ts',
          }
          : null;
      };

      walkAndEmit(`h('div', null, Alert())`, {
        resolveComponent,
        sourceFile: '/proj/page.ts',
      });

      expect(asked).toEqual(['/proj/page.ts']);
    });

    it('inlines a sub-component re-exported through an index barrel', () => {
      // The resolver lands on the barrel; the code is one file further on.
      const modules: Record<string, string> = {
        '/proj/card.ts': `export function Card() { return h('article', { class: 'card' }, 'body'); }`,
      };
      const binary = walkAndEmit(`h('div', null, Card())`, {
        sourceFile: '/proj/page.ts',
        resolveComponent: (name: string) => name === 'Card'
          ? {
            source: `export { Card } from './card';`,
            functionName: 'Card',
            path: '/proj/index.ts',
          }
          : null,
        loadModule: (_from: string, importPath: string) =>
          importPath === './card'
            ? { path: '/proj/card.ts', source: modules['/proj/card.ts']! }
            : null,
      });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG article class="card"',
        'TEXT "body"',
        'CLOSE_TAG article',
        'CLOSE_TAG div',
      ]);
      expect(getIslands(binary)).toEqual([]);
    });

    // Call-site props must reach the inlined body. Until they did, the
    // substitution helper returned its input unchanged on every path, so
    // `props.label` arrived at the walker unresolved and became an EMPTY
    // island nested inside the component's own markup — the text silently
    // absent from the server render.
    describe('call-site props', () => {
      function propsComponent(body: string, param = 'props') {
        return (name: string) => name === 'Badge'
          ? { source: `export function Badge(${param}) { return ${body}; }`, functionName: 'Badge' }
          : null;
      }

      it('substitutes a call-site prop into an inlined component', () => {
        const binary = walkAndEmit(`h('div', null, Badge({ label: 'New' }))`, {
          resolveComponent: propsComponent(`h('span', { class: 'badge' }, props.label)`),
        });

        expect(parseOpcodeList(binary)).toEqual([
          'OPEN_TAG div',
          'OPEN_TAG span class="badge"',
          'TEXT "New"',
          'CLOSE_TAG span',
          'CLOSE_TAG div',
        ]);
        // Two-sided: the value arrived AND nothing degraded to an island.
        expect(getIslands(binary)).toEqual([]);
      });

      it('substitutes a destructured prop, including one with a default', () => {
        const binary = walkAndEmit(`h('div', null, Badge({ label: 'New' }))`, {
          resolveComponent: propsComponent(
            `h('span', null, label, tone)`,
            `{ label, tone = 'plain' }`,
          ),
        });

        // `label` comes from the call site; `tone` is not passed, so its
        // reference stays unresolved and degrades visibly to an island.
        expect(parseOpcodeList(binary)).toEqual([
          'OPEN_TAG div',
          'OPEN_TAG span',
          'TEXT "New"',
          'ISLAND_START island_0#0',
          'OPEN_TAG div',
          'CLOSE_TAG div',
          'ISLAND_END island_0#0',
          'CLOSE_TAG span',
          'CLOSE_TAG div',
        ]);
      });

      it('substitutes into attribute values as well as children', () => {
        const binary = walkAndEmit(`h('div', null, Badge({ tone: 'warn', count: 3 }))`, {
          resolveComponent: propsComponent(`h('span', { class: props.tone, 'data-n': props.count })`),
        });

        expect(parseOpcodeList(binary)).toEqual([
          'OPEN_TAG div',
          'OPEN_TAG span class="warn" data-n="3"',
          'CLOSE_TAG span',
          'CLOSE_TAG div',
        ]);
        // Static attributes, not slots: nothing to inject at runtime.
        expect(getSlotNames(binary)).toEqual([]);
      });

      it('leaves a name alone where a nested function rebinds it', () => {
        const binary = walkAndEmit(`h('div', null, Badge({ label: 'New' }))`, {
          resolveComponent: propsComponent(
            `h('ul', null, createList(rows, (label) => label.id, (label) => h('li', null, label.label)))`,
            `{ label }`,
          ),
        });

        // The list's own `label` row parameter shadows the prop, so the row
        // template still reads from the list slot rather than the literal.
        expect(parseOpcodeList(binary)).toContain('PROP list:rows:item.label -> list:rows:label');
        expect(parseOpcodeList(binary)).toContain('DYN_TEXT list:rows:label marker=0');
        expect(getStrings(binary)).not.toContain('New');
      });
    });

    it('emits island when resolveComponent returns null', () => {
      const binary = walkAndEmit(`h('div', null, UnknownComponent())`, {
        resolveComponent: () => null,
      });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'ISLAND_START UnknownComponent#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END UnknownComponent#0',
        'CLOSE_TAG div',
      ]);
    });

    it('emits island when no resolveComponent provided', () => {
      const binary = walkAndEmit(`h('div', null, SomeComponent())`);

      expect(parseOpcodeList(binary)).toContain('ISLAND_START SomeComponent#0');
      expect(parseOpcodeList(binary)).toContain('ISLAND_END SomeComponent#0');
    });

    it('emits island when depth exceeded', () => {
      const resolveComponent = (name: string) => name === 'Deep'
        ? { source: `export function Deep() { return h('span', null, 'deep'); }`, functionName: 'Deep' }
        : null;

      const binary = walkAndEmit(`h('div', null, Deep())`, { resolveComponent, depth: 3 });

      // Shell only — the resolved <span>deep</span> must NOT be inlined.
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'ISLAND_START Deep#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END Deep#0',
        'CLOSE_TAG div',
      ]);
      expect(getStrings(binary)).not.toContain('deep');
    });

    it('detects cycles and emits island', () => {
      const resolveComponent = (name: string) => name === 'Recursive'
        ? {
          source: `export function Recursive() { return h('div', null, Recursive()); }`,
          functionName: 'Recursive',
        }
        : null;

      const binary = walkAndEmit(`h('div', null, Recursive())`, {
        resolveComponent,
        visited: new Set(['Recursive']),
      });

      expect(parseOpcodeList(binary)).toContain('ISLAND_START Recursive#0');
    });

    it('emits island when sub-component props contain non-static values', () => {
      const resolveComponent = (name: string) => name === 'Alert'
        ? {
          source: `export function Alert(props) { return h('div', { class: 'alert' }, 'msg'); }`,
          functionName: 'Alert',
        }
        : null;

      // 'error' is an identifier (signal reference), not a string literal.
      const binary = walkAndEmit(
        `h('div', null, Alert({ message: error, variant: 'error' }))`,
        { resolveComponent },
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'ISLAND_START Alert#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END Alert#0',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 11: Unknown → ISLAND_START / ISLAND_END
  // -------------------------------------------------------------------------

  describe('Rule 11: Unknown expressions', () => {
    it('emits ISLAND for computed tag name', () => {
      const binary = walkAndEmit(`h(tagName, null, 'text')`);

      expect(parseOpcodeList(binary)).toEqual([
        'ISLAND_START island_0#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END island_0#0',
      ]);
    });

    // A capitalized tag is what BOTH JSX transforms emit for <Card/>, so the
    // tag position holding an identifier is a component reference, not an
    // unknown expression. It used to fall through to the anonymous island
    // shell, which is unhydratable: the client registry is keyed by component
    // name, and `island_0` matches nothing in it.
    describe('component tags (what JSX compiles <Card/> to)', () => {
      const source = `export function Card() { return h('article', { class: 'card' }, 'Body'); }`;
      const resolveComponent = (name: string) =>
        name === 'Card' ? { source, functionName: 'Card' } : null;

      it('registers a JSX component tag under its own name', () => {
        // Unresolvable: still an island, but one the client can find.
        const binary = walkAndEmit(`h('main', null, h(Card, null))`);

        expect(parseOpcodeList(binary)).toEqual([
          'OPEN_TAG main',
          'ISLAND_START Card#0',
          'OPEN_TAG div',
          'CLOSE_TAG div',
          'ISLAND_END Card#0',
          'CLOSE_TAG main',
        ]);
        expect(getIslands(binary).map(i => i.name)).toEqual(['Card']);
      });

      it('inlines a resolvable component tag exactly like a Card() call', () => {
        const viaTag = parseOpcodeList(walkAndEmit(`h(Card, null)`, { resolveComponent }));
        const viaCall = parseOpcodeList(walkCallAndEmit(`Card()`, { resolveComponent }));

        expect(viaTag).toEqual([
          'OPEN_TAG article class="card"',
          'TEXT "Body"',
          'CLOSE_TAG article',
        ]);
        expect(viaTag).toEqual(viaCall);
      });

      it('honours the island registry for a component tag', () => {
        const binary = walkAndEmit(`h(Card, null)`, {
          resolveComponent,
          islandNames: new Set(['Card']),
        });

        // Registered islands are never inlined — but their SSR content is
        // still emitted inside the island span.
        expect(parseOpcodeList(binary)).toEqual([
          'ISLAND_START Card#0',
          'OPEN_TAG article class="card"',
          'TEXT "Body"',
          'CLOSE_TAG article',
          'ISLAND_END Card#0',
        ]);
      });

      it('keeps a lower-case identifier tag as a dynamic-tag island', () => {
        // `h(tagName, ...)` with a runtime tag string is not a component.
        expect(getIslands(walkAndEmit(`h(tagName, null)`)).map(i => i.name))
          .toEqual(['island_0']);
      });
    });

    it('emits ISLAND for unknown call in child position', () => {
      const binary = walkAndEmit(`h('div', null, someFunction())`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'ISLAND_START someFunction#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END someFunction#0',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 12: Null/undefined/false → skip
  // -------------------------------------------------------------------------

  describe('Rule 12: Null/undefined/false skip', () => {
    it('skips null children', () => {
      const binary = walkAndEmit(`h('div', null, null, 'text')`);
      expect(parseOpcodeList(binary)).toEqual(['OPEN_TAG div', 'TEXT "text"', 'CLOSE_TAG div']);
    });

    it('skips undefined children', () => {
      const binary = walkAndEmit(`h('div', null, undefined, 'text')`);
      expect(parseOpcodeList(binary)).toEqual(['OPEN_TAG div', 'TEXT "text"', 'CLOSE_TAG div']);
    });

    it('skips false children', () => {
      const binary = walkAndEmit(`h('div', null, false, 'text')`);
      expect(parseOpcodeList(binary)).toEqual(['OPEN_TAG div', 'TEXT "text"', 'CLOSE_TAG div']);
    });

    it('skips true children, the same as false', () => {
      // `h()` drops `null`, `true` and `false` children outright
      // (formajs src/dom/element.ts), so the server must emit nothing for
      // them too. This used to ship an empty island shell — a `<div>` the
      // client has no counterpart for, and one more fallback island in the
      // page's island table.
      const binary = walkAndEmit(`h('div', null, true, 'text')`);
      expect(parseOpcodeList(binary)).toEqual(['OPEN_TAG div', 'TEXT "text"', 'CLOSE_TAG div']);
    });

    it('skips a child that only EVALUATES to false', () => {
      // `ready() && 'Go'` with ready defaulting to false is the same nothing,
      // reached one fold later. Emitting the island shell here put an empty
      // <div> on the server-rendered page where the client renders nothing.
      const { ctx, walkCtx } = withSignals(`const [ready] = createSignal(false);`);
      const binary = walkIntoAndEmit(`h('div', null, ready() && 'Go', 'text')`, ctx, walkCtx);
      expect(parseOpcodeList(binary)).toEqual(['OPEN_TAG div', 'TEXT "text"', 'CLOSE_TAG div']);
    });
  });

  // -------------------------------------------------------------------------
  // walkCallExpression
  // -------------------------------------------------------------------------

  describe('walkCallExpression', () => {
    it('handles h() calls by delegating to walkHTree', () => {
      const binary = walkCallAndEmit(`h('div', { class: 'test' }, 'Hello')`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div class="test"',
        'TEXT "Hello"',
        'CLOSE_TAG div',
      ]);
    });

    it('handles unknown function as island', () => {
      const binary = walkCallAndEmit(`unknownFunc()`);

      expect(parseOpcodeList(binary)).toEqual([
        'ISLAND_START unknownFunc#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END unknownFunc#0',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Integration / combined rules
  // -------------------------------------------------------------------------

  describe('Combined rules', () => {
    it('handles a realistic component structure', () => {
      const binary = walkAndEmit(
        `h('div', { class: 'card' },
          h('h1', null, 'Title'),
          h('input', { type: 'email', placeholder: 'Enter email' }),
          h('p', null, () => message()),
          h('button', { onClick: handleClick, class: 'btn' }, 'Submit')
        )`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div class="card"',
        'OPEN_TAG h1',
        'TEXT "Title"',
        'CLOSE_TAG h1',
        'VOID_TAG input type="email" placeholder="Enter email"',
        'OPEN_TAG p',
        'DYN_TEXT text:0 marker=0',
        'CLOSE_TAG p',
        'OPEN_TAG button class="btn"',
        'TEXT "Submit"',
        'CLOSE_TAG button',
        'CLOSE_TAG div',
      ]);
      expect(getStrings(binary)).not.toContain('onClick');
    });

    it('handles deeply nested structure', () => {
      const binary = walkAndEmit(
        `h('div', null,
          h('section', null,
            h('article', null,
              h('p', null, 'Deep content')
            )
          )
        )`,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG section',
        'OPEN_TAG article',
        'OPEN_TAG p',
        'TEXT "Deep content"',
        'CLOSE_TAG p',
        'CLOSE_TAG article',
        'CLOSE_TAG section',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Slot-name collisions across combined constructs
  // -------------------------------------------------------------------------
  // Constructs used to be tested only in isolation, which is exactly how the
  // duplicate `attr:`/`text:` names shipped: every uniqueness fixture used
  // list/show slots only. These fixtures combine them.

  describe('page-wide slot-name uniqueness across combined constructs', () => {
    it('dedupes two dynamic attrs sharing a key on sibling elements', () => {
      const binary = walkAndEmit(
        `h('div', null, h('p', { class: () => a() }), h('p', { class: () => b() }))`,
      );

      expect(getSlotNames(binary)).toEqual(['attr:class', 'attr:class#2']);
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG p',
        'DYN_ATTR class -> attr:class',
        'CLOSE_TAG p',
        'OPEN_TAG p',
        'DYN_ATTR class -> attr:class#2',
        'CLOSE_TAG p',
        'CLOSE_TAG div',
      ]);
    });

    it('dedupes a dynamic attr on a child against the same key on its parent', () => {
      const binary = walkAndEmit(`h('div', { id: () => a() }, h('span', { id: () => b() }, 'x'))`);

      expect(getSlotNames(binary)).toEqual(['attr:id', 'attr:id#2']);
    });

    it('dedupes two dynamic text children at the same child index', () => {
      const binary = walkAndEmit(
        `h('div', null, h('span', null, () => a()), h('span', null, () => b()))`,
      );

      expect(getSlotNames(binary)).toEqual(['text:0', 'text:0#2']);
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG span',
        'DYN_TEXT text:0 marker=0',
        'CLOSE_TAG span',
        'OPEN_TAG span',
        'DYN_TEXT text:0#2 marker=1',
        'CLOSE_TAG span',
        'CLOSE_TAG div',
      ]);
    });

    it('dedupes a dynamic attr inside a list body against one at page level', () => {
      const binary = walkAndEmit(
        `h('div', { class: () => outer() },
          createList(rows, (r) => r.id, (r) => h('li', { class: () => inner() }, r.name)),
        )`,
      );

      expect(getSlotNames(binary)).toEqual([
        'attr:class',
        'list:rows:array',
        'list:rows:item',
        'list:rows:name',
        'attr:class#2',
      ]);
    });

    it('dedupes a dynamic attr inside an island against one on the page', () => {
      const resolveComponent = (name: string) => name === 'Widget'
        ? {
          source: `export function Widget() { return h('section', { class: () => inner() }, 'w'); }`,
          functionName: 'Widget',
        }
        : null;

      const binary = walkAndEmit(
        `h('div', null, Widget(), h('p', { class: () => outer() }))`,
        { resolveComponent, islandNames: new Set(['Widget']) },
      );

      expect(getSlotNames(binary)).toEqual(['attr:class', 'attr:class#2']);
    });

    it('dedupes a dynamic text child inside a show branch against one outside it', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createShow(() => visible(), () => h('span', null, () => a())),
          h('span', null, () => b()),
        )`,
      );

      expect(getSlotNames(binary)).toEqual(['show:visible', 'text:0', 'text:0#2']);
    });

    it('keeps single-occurrence attr and text names unsuffixed', () => {
      // The downstream consumer pins these exact spellings; only genuine
      // collisions may gain a suffix.
      const binary = walkAndEmit(`h('div', { id: () => a() }, () => b())`);

      expect(getSlotNames(binary)).toEqual(['attr:id', 'text:0']);
    });

    it('keeps the list and show names the ksx consumer pins', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createList(() => padTiles(), (t) => t.id, (t) => h('li', null, t.label)),
          createShow(() => pillRunning(), () => h('span', null, 'running')),
        )`,
      );

      expect(getSlotNames(binary)).toEqual([
        'list:padTiles:array',
        'list:padTiles:item',
        'list:padTiles:label',
        'show:pillRunning',
      ]);
    });
  });

  // =========================================================================
  // DYN_ATTR SSR defaults — evaluating expressions with signal defaults
  // =========================================================================

  describe('DYN_ATTR SSR defaults', () => {
    function attrDefault(binary: Uint8Array, slotName: string): string | undefined {
      return getSlots(binary).find(s => s.name === slotName)?.default;
    }

    it('computes default for ternary: showPassword() ? text : password', () => {
      const { ctx, walkCtx } = withSignals(`const [showPassword] = createSignal(false);`);
      const binary = walkIntoAndEmit(
        `h('input', { type: () => showPassword() ? 'text' : 'password' })`,
        ctx,
        walkCtx,
      );

      expect(attrDefault(binary, 'attr:type')).toBe('password');
    });

    it('computes default for concatenation: mfa-panel + hidden', () => {
      const { ctx, walkCtx } = withSignals(`const [showMfa] = createSignal(false);`);
      const binary = walkIntoAndEmit(
        `h('section', { class: () => 'mfa-panel' + (showMfa() ? '' : ' hidden') })`,
        ctx,
        walkCtx,
      );

      expect(attrDefault(binary, 'attr:class')).toBe('mfa-panel hidden');
    });

    it('computes default for caps lock warning class', () => {
      const { ctx, walkCtx } = withSignals(`const [capsLock] = createSignal(false);`);
      const binary = walkIntoAndEmit(
        `h('div', { class: () => 'field-hint field-hint--danger' + (capsLock() ? '' : ' hidden') })`,
        ctx,
        walkCtx,
      );

      expect(attrDefault(binary, 'attr:class')).toBe('field-hint field-hint--danger hidden');
    });

    it('computes default for a template literal with an embedded expression', () => {
      // The create-forma-app dashboard writes its sidebar class exactly like
      // this. Refusing interpolation meant the whole page server-rendered with
      // no class attribute anywhere and every control was unstyled until JS ran.
      const { ctx, walkCtx } = withSignals(`const [collapsed] = createSignal(true);`);
      const binary = walkIntoAndEmit(
        'h(\'nav\', { class: () => `sidebar ${collapsed() ? \'is-collapsed\' : \'\'}` })',
        ctx,
        walkCtx,
      );

      expect(attrDefault(binary, 'attr:class')).toBe('sidebar is-collapsed');
    });

    it('computes default through a block-bodied arrow that folds its own locals', () => {
      const { ctx, walkCtx } = withSignals(`const [tone] = createSignal('calm');`);
      const binary = walkIntoAndEmit(
        `h('div', { class: () => { const base = 'row '; return base + tone(); } })`,
        ctx,
        walkCtx,
      );

      expect(attrDefault(binary, 'attr:class')).toBe('row calm');
    });

    it('gives a boolean-valued attribute a BOOL slot, not the string "false"', () => {
      // As a Text slot the default bytes "false" render `disabled="false"`,
      // which the browser reads as DISABLED — the exact inversion of what the
      // client shows. A Bool slot omits the attribute instead.
      const { ctx, walkCtx } = withSignals(`const [busy] = createSignal(false);`);
      const binary = walkIntoAndEmit(`h('button', { disabled: () => !!busy() })`, ctx, walkCtx);

      const slot = getSlots(binary).find(s => s.name === 'attr:disabled')!;
      expect(slot.typeHint).toBe(0x02); // TYPE_BOOL
      expect(slot.default).toBe('false');
    });

    it('stores empty default when expression cannot be evaluated', () => {
      const binary = walkAndEmit(`h('div', { class: () => computeClass(a, b) })`);

      expect(attrDefault(binary, 'attr:class')).toBe('');
    });

    it('computes default for aria-label ternary', () => {
      const { ctx, walkCtx } = withSignals(`const [showPassword] = createSignal(false);`);
      const binary = walkIntoAndEmit(
        `h('button', { 'aria-label': () => showPassword() ? 'Hide password' : 'Show password' })`,
        ctx,
        walkCtx,
      );

      expect(attrDefault(binary, 'attr:aria-label')).toBe('Show password');
    });

    it('computes default for function prop referencing a module string const', () => {
      const { ctx, walkCtx } = withSignals(`const [suffix] = createSignal(' selected');`);
      const binary = walkIntoAndEmit(`h('path', { d: () => SIL_BODY + suffix() })`, ctx, {
        ...walkCtx,
        stringConstants: new Map([['SIL_BODY', 'M10 20 L30 40']]),
      });

      expect(attrDefault(binary, 'attr:d')).toBe('M10 20 L30 40 selected');
    });

    it('computes default for function prop that only references a const (no signals)', () => {
      const binary = walkAndEmit(`h('path', { d: () => SIL_BODY })`, {
        stringConstants: new Map([['SIL_BODY', 'M10 20 L30 40']]),
      });

      expect(attrDefault(binary, 'attr:d')).toBe('M10 20 L30 40');
    });
  });

  // =========================================================================
  // Eagerly-evaluated expressions: the same fold, OUTSIDE a function wrapper
  //
  // `'Player ' + name()` is what a page writes when the text is computed once
  // rather than bound. The walker had a fold for the `() => …` form and none
  // for this one, so the two halves of the same expression class diverged:
  // in child position it shipped an empty island shell, and in attribute
  // position it minted a slot with NO default and NO diagnostic — an
  // attribute with no value, silently, which is how ksx's controls lost
  // their tooltips for the whole life of that UI.
  // =========================================================================

  describe('eagerly-evaluated (non-function) expressions', () => {
    const slotByName = (binary: Uint8Array, name: string) =>
      getSlots(binary).find(s => s.name === name);

    it('folds a concatenated child into a DYN_TEXT slot with an SSR default', () => {
      const { ctx, walkCtx } = withSignals(`const [name] = createSignal('Xbox');`);
      const binary = walkIntoAndEmit(`h('span', null, 'Player ' + name())`, ctx, walkCtx);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG span',
        'DYN_TEXT text:0 marker=0',
        'CLOSE_TAG span',
      ]);
      expect(slotByName(binary, 'text:0')!.default).toBe('Player Xbox');
      // …and did NOT degrade to the island shell it used to emit.
      expect(getIslands(binary)).toEqual([]);
    });

    it('folds a concatenated attribute value into an SSR default', () => {
      const { ctx, walkCtx } = withSignals(`const [name] = createSignal('Xbox');`);
      const binary = walkIntoAndEmit(
        `h('button', { title: 'Enable ' + name() }, 'Enable')`,
        ctx,
        walkCtx,
      );

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG button',
        'DYN_ATTR title -> attr:title',
        'TEXT "Enable"',
        'CLOSE_TAG button',
      ]);
      expect(slotByName(binary, 'attr:title')!.default).toBe('Enable Xbox');
    });

    it('keeps a numeric operand TYPED through a multi-operand concatenation', () => {
      // The failure this pins is not "no default" but a WRONG one: a
      // stringly-typed evaluator renders `count()` as an object or drops it,
      // and the page ships "Slot [object Object] ready" or "Slot  ready".
      const { ctx, walkCtx } = withSignals(`const [count] = createSignal(3);`);
      const binary = walkIntoAndEmit(
        `h('b', { title: 'Slot ' + count() + ' ready' }, 'ok')`,
        ctx,
        walkCtx,
      );

      expect(slotByName(binary, 'attr:title')!.default).toBe('Slot 3 ready');
    });

    it('folds arithmetic on a numeric signal without coercing it to a string', () => {
      const { ctx, walkCtx } = withSignals(`const [count] = createSignal(3);`);
      const binary = walkIntoAndEmit(`h('p', null, count() - 1)`, ctx, walkCtx);

      expect(slotByName(binary, 'text:0')!.default).toBe('2');
    });

    it('folds a String() cast child instead of islanding it as a component', () => {
      // `String` is capitalized, so the sub-component path claimed it and
      // emitted `ISLAND_START String` — an island named after a built-in,
      // which no client registry can ever hydrate.
      const { ctx, walkCtx } = withSignals(`const [count] = createSignal(3);`);
      const binary = walkIntoAndEmit(`h('p', null, String(count()))`, ctx, walkCtx);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG p',
        'DYN_TEXT text:0 marker=0',
        'CLOSE_TAG p',
      ]);
      expect(slotByName(binary, 'text:0')!.default).toBe('3');
      expect(getIslands(binary)).toEqual([]);
    });

    it("binds a bare signal-read child to the signal's own slot", () => {
      // `h('span', null, name())` used to reach the sub-component resolver,
      // which cannot find a file for `name` and shipped an island shell
      // NAMED AFTER THE SIGNAL.
      const { ctx, walkCtx } = withSignals(`const [name] = createSignal('Xbox');`);
      const binary = walkIntoAndEmit(`h('span', null, name())`, ctx, walkCtx);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG span',
        'DYN_TEXT name marker=0',
        'CLOSE_TAG span',
      ]);
      expect(getIslands(binary)).toEqual([]);
    });

    it('folds a TypeScript cast rather than degrading on the annotation', () => {
      const { ctx, walkCtx } = withSignals(`const [name] = createSignal('Xbox');`);
      const binary = walkIntoAndEmit(
        `h('span', { title: ('Player ' + name()) as string })`,
        ctx,
        walkCtx,
      );

      expect(slotByName(binary, 'attr:title')!.default).toBe('Player Xbox');
    });

    it('gives an eagerly-folded boolean attribute a BOOL slot, not text "false"', () => {
      const { ctx, walkCtx } = withSignals(`const [busy] = createSignal(false);`);
      const binary = walkIntoAndEmit(`h('button', { disabled: !!busy() })`, ctx, walkCtx);

      const slot = slotByName(binary, 'attr:disabled')!;
      expect(slot.typeHint).toBe(0x02); // TYPE_BOOL
      expect(slot.default).toBe('false');
    });

    it('still degrades — loudly — when an operand cannot be resolved', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { ctx, walkCtx } = withSignals(`const [name] = createSignal('Xbox');`);
      const binary = walkIntoAndEmit(
        `h('span', null, 'Player ' + lookupName())`,
        ctx,
        { ...walkCtx, sourceFile: 'src/pages/Roster.ts' },
      );

      expect(getIslands(binary)).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('src/pages/Roster.ts'),
      );
      warnSpy.mockRestore();
    });

    it('does not fold a loose == comparison it cannot evaluate exactly', () => {
      // `null` and `undefined` are the SAME value to this evaluator, and
      // loose equality is the one operator whose answer depends on telling
      // them apart. Warning beats guessing.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { ctx, walkCtx } = withSignals(`const [sel] = createSignal(null);`);
      const binary = walkIntoAndEmit(`h('p', { title: sel() == 0 })`, ctx, walkCtx);

      expect(slotByName(binary, 'attr:title')!.default).toBe('');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // SHOW_IF SSR defaults — which branch the server renders
  // =========================================================================

  describe('SHOW_IF SSR defaults', () => {
    const showDefault = (binary: Uint8Array, name: string) =>
      getSlots(binary).find(s => s.name === name)?.default;

    it('writes true when the condition evaluates truthy', () => {
      const { ctx, walkCtx } = withSignals(`const [visible] = createSignal(true);`);
      const binary = walkIntoAndEmit(
        `h('div', null, () => visible() ? h('p', { class: 'on' }, 'THEN') : h('p', { class: 'off' }, 'ELSE'))`,
        ctx,
        walkCtx,
      );

      expect(showDefault(binary, 'show:visible')).toBe('true');
    });

    it('writes false when the condition evaluates falsy, including a zero number', () => {
      const { ctx, walkCtx } = withSignals(`const [count] = createSignal(0);`);
      const binary = walkIntoAndEmit(
        `h('div', null, () => count() ? 'some' : 'none')`,
        ctx,
        walkCtx,
      );

      expect(showDefault(binary, 'show:count')).toBe('false');
    });

    it('unwraps a negated condition to the branch the client would take', () => {
      const { ctx, walkCtx } = withSignals(`const [ready] = createSignal(false);`);
      const binary = walkCallAndEmit(
        `createShow(() => !ready(), () => h('em', null, 'waiting'), () => h('strong', null, 'ready'))`,
        walkCtx,
      );
      void ctx;

      expect(showDefault(binary, 'show:ready')).toBe('true');
    });

    it('leaves the slot defaultless and warns when the condition cannot be evaluated', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const binary = walkCallAndEmit(
          `createShow(() => isAdmin(user), () => h('b', null, 'yes'), () => h('i', null, 'no'))`,
        );
        expect(showDefault(binary, 'show:isAdmin')).toBe('');

        const warned = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
        expect(warned).toContain('renders its ELSE branch');
        expect(warned).toContain('hydration');
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Fragment handling
  // -------------------------------------------------------------------------

  describe('Fragment handling', () => {
    it('emits children inline at root level without wrapper', () => {
      const binary = walkAndEmit(`h(Fragment, null, h('div', null, 'A'), h('span', null, 'B'))`);

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'TEXT "A"',
        'CLOSE_TAG div',
        'OPEN_TAG span',
        'TEXT "B"',
        'CLOSE_TAG span',
      ]);
      expect(getStrings(binary)).toEqual(['div', 'A', 'span', 'B']);
    });

    it('emits Fragment children nested inside h() tree', () => {
      const binary = walkAndEmit(`h('main', null, h(Fragment, null, h('p', null, 'X'), h('p', null, 'Y')))`);

      // main contains both p elements directly (Fragment is transparent).
      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG main',
        'OPEN_TAG p',
        'TEXT "X"',
        'CLOSE_TAG p',
        'OPEN_TAG p',
        'TEXT "Y"',
        'CLOSE_TAG p',
        'CLOSE_TAG main',
      ]);
    });

    // A Fragment's children must go through the SAME emitChild path as an
    // element's. Until they did, anything that was not an h() call or a string
    // literal was dropped with no opcode, no island marker and no warning —
    // content that simply vanished from the page. These four run the same
    // constructs through an element and a Fragment and require identical
    // opcodes: a divergence is the bug returning.
    describe.each([
      ['a dynamic text child', `() => title()`, ['DYN_TEXT text:0 marker=0']],
      ['a numeric child', `7`, ['TEXT "7"']],
      [
        // Structurally asymmetric branches, so a swap of then_len/else_len is
        // detectable (equal-length branches hide it).
        'a ternary show child',
        `() => (ok() ? h('a', null, 'y') : h('b', null, h('i', null, 'no')))`,
        [
          'SHOW_IF show:ok then=17 else=29',
          'OPEN_TAG a', 'TEXT "y"', 'CLOSE_TAG a',
          'SHOW_ELSE',
          'OPEN_TAG b', 'OPEN_TAG i', 'TEXT "no"', 'CLOSE_TAG i', 'CLOSE_TAG b',
        ],
      ],
      [
        'a createList child',
        `createList(todos, (r) => r.id, (r) => h('li', null, r.name))`,
        [
          'LIST array=list:todos:array item=list:todos:item body=26',
          'PROP list:todos:item.name -> list:todos:name',
          'OPEN_TAG li',
          'DYN_TEXT list:todos:name marker=0',
          'CLOSE_TAG li',
        ],
      ],
    ])('emits %s of a Fragment', (_label, child, expected) => {
      it('the same way an element child is emitted', () => {
        expect(parseOpcodeList(walkAndEmit(`h(Fragment, null, ${child})`))).toEqual(expected);
      });

      it('and identically in the bare Fragment(...) call form', () => {
        expect(parseOpcodeList(walkCallAndEmit(`Fragment(${child})`))).toEqual(expected);
      });

      it('matching what the same child emits inside a real element', () => {
        expect(parseOpcodeList(walkAndEmit(`h('div', null, ${child})`))).toEqual([
          'OPEN_TAG div', ...expected, 'CLOSE_TAG div',
        ]);
      });
    });

    it('emits every child of a Fragment, not just the ones it understands', () => {
      // The original defect in one line: the h() call survived, the binding
      // beside it disappeared.
      expect(parseOpcodeList(walkAndEmit(
        `h(Fragment, null, h('p', null, 'kept'), () => alsoKept(), 'and this')`,
      ))).toEqual([
        'OPEN_TAG p',
        'TEXT "kept"',
        'CLOSE_TAG p',
        'DYN_TEXT text:1 marker=0',
        'TEXT "and this"',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Depth limit
  // -------------------------------------------------------------------------

  describe('depth limit', () => {
    it('inlines component at depth 2', () => {
      const resolveComponent = (name: string) => name === 'B'
        ? {
          source: `export function B() { return h('div', { class: 'inner' }, 'from-B'); }`,
          functionName: 'B',
        }
        : null;

      // Start at depth 2 — max is 3, so this should still inline.
      const binary = walkAndEmit(`h('div', null, B())`, { resolveComponent, depth: 2 });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG div class="inner"',
        'TEXT "from-B"',
        'CLOSE_TAG div',
        'CLOSE_TAG div',
      ]);
    });

    it('detects circular reference and emits island without infinite loop', () => {
      const resolveComponent = (name: string) => {
        if (name === 'A') {
          return { source: `export function A() { return h('div', null, B()); }`, functionName: 'A' };
        }
        if (name === 'B') {
          return { source: `export function B() { return h('div', null, A()); }`, functionName: 'B' };
        }
        return null;
      };

      // A calls B, B calls A — the cycle must terminate at an island.
      const binary = walkAndEmit(`h('div', null, A())`, { resolveComponent });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG div',
        'OPEN_TAG div',
        'ISLAND_START A#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END A#0',
        'CLOSE_TAG div',
        'CLOSE_TAG div',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Block-body component (createEffect + return)
  // -------------------------------------------------------------------------

  describe('Block-body component resolution', () => {
    it('only walks the return h() tree, ignoring createEffect', () => {
      const resolveComponent = (name: string) => name === 'Counter'
        ? {
          source: `export function Counter() {
              createEffect(() => { console.log('effect'); });
              return h('div', { class: 'counter' }, 'Count');
            }`,
          functionName: 'Counter',
        }
        : null;

      const binary = walkAndEmit(`h('main', null, Counter())`, { resolveComponent });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG main',
        'OPEN_TAG div class="counter"',
        'TEXT "Count"',
        'CLOSE_TAG div',
        'CLOSE_TAG main',
      ]);
      // Nothing from the createEffect body leaks into the binary.
      expect(getStrings(binary)).toEqual(['main', 'div', 'class', 'counter', 'Count']);
    });
  });

  // -------------------------------------------------------------------------
  // Local (non-exported) function inlining
  // -------------------------------------------------------------------------

  describe('Local function inlining', () => {
    it('inlines a non-exported function declaration', () => {
      const resolveComponent = (name: string) => name === 'Sidebar'
        ? {
          source: `function Sidebar() { return h('nav', { class: 'sidebar' }, 'Nav links'); }`,
          functionName: 'Sidebar',
        }
        : null;

      const binary = walkAndEmit(`h('div', null, Sidebar())`, { resolveComponent });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG nav class="sidebar"',
        'TEXT "Nav links"',
        'CLOSE_TAG nav',
        'CLOSE_TAG div',
      ]);
    });

    it('inlines a non-exported arrow function (const)', () => {
      const resolveComponent = (name: string) => name === 'TopBar'
        ? {
          source: `const TopBar = () => h('header', { class: 'topbar' }, 'Logo');`,
          functionName: 'TopBar',
        }
        : null;

      const binary = walkAndEmit(`h('div', null, TopBar())`, { resolveComponent });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG header class="topbar"',
        'TEXT "Logo"',
        'CLOSE_TAG header',
        'CLOSE_TAG div',
      ]);
    });

    it('inlines a non-exported arrow function with block body', () => {
      const resolveComponent = (name: string) => name === 'Footer'
        ? {
          source: `const Footer = () => { return h('footer', { class: 'ft' }, 'Copyright'); };`,
          functionName: 'Footer',
        }
        : null;

      const binary = walkAndEmit(`h('div', null, Footer())`, { resolveComponent });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG footer class="ft"',
        'TEXT "Copyright"',
        'CLOSE_TAG footer',
        'CLOSE_TAG div',
      ]);
    });

    it('inlines non-exported function expression (const Name = function)', () => {
      const resolveComponent = (name: string) => name === 'Panel'
        ? {
          source: `const Panel = function() { return h('section', { class: 'panel' }, 'Content'); };`,
          functionName: 'Panel',
        }
        : null;

      const binary = walkAndEmit(`h('div', null, Panel())`, { resolveComponent });

      expect(parseOpcodeList(binary)).toEqual([
        'OPEN_TAG div',
        'OPEN_TAG section class="panel"',
        'TEXT "Content"',
        'CLOSE_TAG section',
        'CLOSE_TAG div',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // createList slot naming — every list individually addressable by name
  // -------------------------------------------------------------------------

  describe('createList slot naming', () => {
    it('derives slot names from an identifier data source and binds the body to them', () => {
      const binary = walkCallAndEmit(
        `createList(todos, (r) => r.id, (r) => h('li', null, r.title))`,
      );

      expect(getSlotNames(binary)).toEqual([
        'list:todos:array', 'list:todos:item', 'list:todos:title',
      ]);
      // The key function is not scanned for props — only the map body is, so
      // `r.id` yields no slot here.
      expect(parseOpcodeList(binary)).toEqual([
        'LIST array=list:todos:array item=list:todos:item body=26',
        'PROP list:todos:item.title -> list:todos:title',
        'OPEN_TAG li',
        'DYN_TEXT list:todos:title marker=0',
        'CLOSE_TAG li',
      ]);
    });

    it('gives two lists over different sources distinct slot names', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createList(todos, (r) => r.id, (r) => h('li', null, r.title)),
          createList(users, (r) => r.id, (r) => h('li', null, r.name)),
        )`,
      );

      expect(getSlotNames(binary)).toEqual([
        'list:todos:array', 'list:todos:item', 'list:todos:title',
        'list:users:array', 'list:users:item', 'list:users:name',
      ]);
    });

    it('dedupes two lists over the same source with #n suffixes', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createList(todos, (r) => r.id, (r) => h('li', null, r.title)),
          createList(todos, (r) => r.id, (r) => h('span', null, r.title)),
        )`,
      );

      expect(getSlotNames(binary)).toEqual([
        'list:todos:array', 'list:todos:item', 'list:todos:title',
        'list:todos#2:array', 'list:todos#2:item', 'list:todos#2:title',
      ]);
    });

    it('derives names through arrows, calls, and member access', () => {
      const arrowCall = walkCallAndEmit(
        `createList(() => todos(), (r) => r.id, (r) => h('li', null, r.title))`,
      );
      expect(getSlotNames(arrowCall)).toContain('list:todos:array');

      const memberCall = walkCallAndEmit(
        `createList(state.todos(), (r) => r.id, (r) => h('li', null, r.title))`,
      );
      expect(getSlotNames(memberCall)).toContain('list:todos:array');
    });

    it('derives names from a function-expression data source', () => {
      const binary = walkCallAndEmit(
        `createList(function () { return todos(); }, (r) => r.id, (r) => h('li', null, r.title))`,
      );
      expect(getSlotNames(binary)).toContain('list:todos:array');
    });

    it('derives from the map param when the source has no name', () => {
      const binary = walkCallAndEmit(
        `createList([{ title: 'a' }], (r) => r.id, (r) => h('li', null, r.title))`,
      );

      expect(getSlotNames(binary)).toEqual([
        'list:r:array', 'list:r:item', 'list:r:title',
      ]);
    });

    it('falls back to a positional name when the map param is _', () => {
      const binary = walkCallAndEmit(
        `createList([{ title: 'a' }], (_) => _.id, (_) => h('li', null, _.title))`,
      );

      expect(getSlotNames(binary)).toEqual([
        'list:#1:array', 'list:#1:item', 'list:#1:title',
      ]);
    });

    it('does not consume a suffix for an unrelated list between occurrences', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createList(todos, (r) => r.id, (r) => h('li', null, r.title)),
          createList(users, (r) => r.id, (r) => h('li', null, r.name)),
          createList(todos, (r) => r.id, (r) => h('span', null, r.title)),
        )`,
      );
      const slotNames = getSlotNames(binary);

      expect(slotNames).toContain('list:todos:array');
      expect(slotNames).toContain('list:users:array');
      expect(slotNames).toContain('list:todos#2:array');
    });

    it('names two literal-source lists by their distinct map params', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createList([{ title: 'x' }], (a) => a.id, (a) => h('li', null, a.title)),
          createList([{ name: 'y' }], (b) => b.id, (b) => h('li', null, b.name)),
        )`,
      );
      const slotNames = getSlotNames(binary);

      expect(slotNames).toContain('list:a:array');
      expect(slotNames).toContain('list:b:array');
    });

    it('emits an island for a createList missing its map function', () => {
      const binary = walkCallAndEmit(`createList(todos, (r) => r.id)`);

      expect(parseOpcodeList(binary)).toEqual([
        'ISLAND_START createList#0',
        'OPEN_TAG div',
        'CLOSE_TAG div',
        'ISLAND_END createList#0',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Shared name registries across nested walk contexts
  // -------------------------------------------------------------------------
  // Island subtrees, inlined sub-components, and list bodies walk spread
  // COPIES of the WalkContext. The registries must live on the root context
  // (created eagerly at the walk entry) so a construct first seen inside a
  // copy still dedups against later page-level siblings — otherwise the page
  // mints duplicate slot names that collapse in the Rust name→id map.
  describe('shared name registries across nested walk contexts', () => {
    const todoWidgetResolver = (name: string) => name === 'TodoWidget'
      ? {
        source: `export function TodoWidget() {
            return h('section', null,
              createList(todos, (r) => r.id, (r) => h('li', null, r.title))
            );
          }`,
        functionName: 'TodoWidget',
      }
      : null;

    it('dedupes a sub-component list against a later page-level list over the same source', () => {
      // The FAILING order pre-fix: the first list lives inside the inlined
      // sub-component's copied context, so the page-level list used to
      // recreate the registry and mint a duplicate 'list:todos:array'.
      const binary = walkAndEmit(
        `h('div', null,
          TodoWidget(),
          createList(todos, (r) => r.id, (r) => h('ul', null, r.title)),
        )`,
        { resolveComponent: todoWidgetResolver },
      );
      const slotNames = getSlotNames(binary);

      expect(slotNames).toContain('list:todos:array');
      expect(slotNames).toContain('list:todos#2:array');
    });

    it('dedupes a page-level list against a later sub-component list (reversed order)', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createList(todos, (r) => r.id, (r) => h('ul', null, r.title)),
          TodoWidget(),
        )`,
        { resolveComponent: todoWidgetResolver },
      );
      const slotNames = getSlotNames(binary);

      expect(slotNames).toContain('list:todos:array');
      expect(slotNames).toContain('list:todos#2:array');
    });

    it('dedupes same-signal shows across two sibling island subtrees', () => {
      const resolveComponent = (name: string) =>
        name === 'AlphaIsland' || name === 'BetaIsland'
          ? {
            source: `export function ${name}() {
                return h('div', null,
                  createShow(() => visible(), () => h('span', null, 'shown'))
                );
              }`,
            functionName: name,
          }
          : null;

      const binary = walkAndEmit(`h('div', null, AlphaIsland(), BetaIsland())`, {
        resolveComponent,
        islandNames: new Set(['AlphaIsland', 'BetaIsland']),
      });
      const slotNames = getSlotNames(binary);

      expect(slotNames).toContain('show:visible');
      expect(slotNames).toContain('show:visible#2');
    });

    it('dedupes a show inside a list body against a later page-level show', () => {
      const binary = walkAndEmit(
        `h('div', null,
          createList(todos, (r) => r.id, (r) =>
            h('li', null, createShow(() => visible(), () => h('b', null, 'row')))
          ),
          createShow(() => visible(), () => h('span', null, 'page')),
        )`,
      );
      const slotNames = getSlotNames(binary);

      expect(slotNames).toContain('show:visible');
      expect(slotNames).toContain('show:visible#2');
    });
  });
});
