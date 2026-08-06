/**
 * Build diagnostics: every construct the walker cannot translate must SAY SO.
 *
 * This is the file that pins the lesson behind most of the ksx dogfood ledger:
 * the compiler understood a page only partly, emitted a placeholder or an empty
 * island for the rest, and reported nothing — so a pad silhouette shipped with
 * no `d` attribute for four versions (#10) and a whole class of signals landed
 * in anonymous slots (#9). The defect was never "the compiler cannot do X"; it
 * was "the compiler cannot do X and does not tell you".
 *
 * The rules asserted here:
 *   1. Every degradation warns, and the warning names WHERE (file), WHAT
 *      (construct) and SO WHAT (consequence for the rendered page).
 *   2. The IR really did degrade — a warning without the island shell (or an
 *      island shell without a warning) is just as wrong.
 *   3. A page the compiler fully understands emits NOTHING on the console.
 *      Without this, a warn-on-everything implementation would pass rule 1.
 *   4. No `emitIsland` call site in the walker skips the diagnostic (a static
 *      completeness check over the source, so a new fallback path cannot be
 *      added silently).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';

import { IrEmitContext } from '../src/ir-emit';
import { walkHTree, walkCallExpression, type WalkContext } from '../src/ir-walk';
import {
  collectSignalDeclarations,
  enterSignalScope,
  newSignalRegistry,
} from '../src/signal-scope';
import { assertBinaryInvariants, getIslands, parseOpcodeList } from './helpers/fmir';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseExpr(code: string): T.Expression {
  const ast = parse(`const __x = ${code}`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  return (ast.program.body[0] as T.VariableDeclaration).declarations[0]!.init!;
}

/**
 * Walk an expression, capturing every console.warn the walk produces.
 *
 * `signals` is source for the declarations that must be IN SCOPE — a binding
 * to a signal the compiler cannot resolve is itself a degradation (the value
 * renders empty server-side), so a fixture that is supposed to be CLEAN has to
 * declare the signals it reads, exactly as a real page does. The scope's slots
 * are minted into the same context the walk emits into, or the ids the walk
 * writes would name slots that do not exist.
 */
function emitWithWarnings(code: string, walkCtx: WalkContext = {}, signals?: string) {
  const warnings: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(' '));
  });
  try {
    const expr = parseExpr(code);
    const ctx = new IrEmitContext();
    if (signals) {
      const registry = newSignalRegistry();
      walkCtx = {
        ...walkCtx,
        signalRegistry: registry,
        signalScope: enterSignalScope(
          null,
          'fixture.ts#module',
          collectSignalDeclarations(
            parse(signals, { sourceType: 'module', plugins: ['typescript'] })
              .program.body as T.Statement[],
            { filePath: 'fixture.ts' },
          ),
          ctx,
          registry,
        ),
      };
    }
    if (t.isCallExpression(expr)) {
      if (t.isIdentifier(expr.callee) && expr.callee.name === 'h') {
        walkHTree(expr, 'h', ctx, walkCtx);
      } else {
        walkCallExpression(expr, 'h', ctx, walkCtx);
      }
    }
    const binary = ctx.toBinary();
    assertBinaryInvariants(binary);
    return { warnings, ops: parseOpcodeList(binary), islands: getIslands(binary) };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1 + 2: every degradation warns, and the IR really degraded
// ---------------------------------------------------------------------------

/** [label, source, walk context, fragments the warning must contain, in-scope signals] */
const DEGRADATIONS: Array<[string, string, WalkContext, string[], string?]> = [
  [
    'dynamic tag',
    `h(tagName, null, 'x')`,
    {},
    ['dynamic tag h(tagName, ...)', 'renders nothing server-side'],
  ],
  [
    'bare identifier child',
    `h('div', null, caption)`,
    {},
    ['child caption', 'wrap it in a function'],
  ],
  [
    'template literal child',
    `h('div', null, \`hi \${name}\`)`,
    {},
    ['child a template literal', 'renders nothing server-side'],
  ],
  [
    'bare ternary child',
    `h('div', null, ok ? h('a', null, 'y') : h('b', null, 'n'))`,
    {},
    ['a bare ternary (not wrapped in a function)'],
  ],
  [
    'bare && child',
    `h('div', null, ok && h('a', null, 'y'))`,
    {},
    ["a bare '&&' expression (not wrapped in a function)"],
  ],
  [
    'un-unrollable spread',
    `h('ul', null, ...rows.map((r) => h('li', null, r.name)))`,
    {},
    ['spread child ...rows.map(...)', 'use createList for runtime data'],
  ],
  [
    'createList with too few arguments',
    `h('div', null, createList(todos, (r) => r.id))`,
    {},
    ['createList(...) was called with 2 argument(s)', 'the whole list is'],
  ],
  [
    'createList with a non-inline map function',
    `h('div', null, createList(todos, keyFn, renderRow))`,
    {},
    ['third argument that is renderRow rather than a function'],
  ],
  [
    'createList with a destructured row parameter',
    `h('div', null, createList(todos, (r) => r.id, ({ name }) => h('li', null, name)))`,
    {},
    ['destructured map parameter', 'name the row parameter'],
  ],
  [
    'createShow branch that is not an h() call',
    `createShow(() => open(), () => renderPanel(), () => h('p', null, 'closed'))`,
    {},
    ['renderPanel'],
    // `open` is in scope, so the condition resolves and the ONLY thing left to
    // report is the branch — which is what "exactly one diagnostic" asserts.
    `const [open] = createSignal(true);`,
  ],
  [
    'unresolvable component',
    `h('div', null, Sidebar())`,
    {},
    ['component Sidebar(...) could not be resolved to a source file', 'relative imports only'],
  ],
  [
    'component past the inlining depth limit',
    `h('div', null, Deep())`,
    {
      resolveComponent: () => ({
        source: `export function Deep() { return h('span', null, 'deep'); }`,
        functionName: 'Deep',
      }),
      depth: 3,
    },
    ['nests deeper than the 3-level inlining limit'],
  ],
  [
    'recursive component',
    `h('div', null, Loop())`,
    {
      resolveComponent: () => ({
        source: `export function Loop() { return h('span', null, 'x'); }`,
        functionName: 'Loop',
      }),
      visited: new Set(['Loop']),
    },
    ['is recursive'],
  ],
  [
    'component passed a non-static prop',
    `h('div', null, Card({ title: computeTitle() }))`,
    {
      resolveComponent: () => ({
        source: `export function Card() { return h('article', null, 'x'); }`,
        functionName: 'Card',
      }),
    },
    ["prop the compiler cannot evaluate ('title')", 'pass literal values'],
  ],
  [
    'component with no followable return',
    `h('div', null, Empty())`,
    {
      resolveComponent: () => ({
        source: `export function Empty() { const x = 1; }`,
        functionName: 'Empty',
      }),
    },
    ['no return statement the compiler can follow'],
  ],
  [
    'island component that will not resolve',
    `h('div', null, LiveChart())`,
    { islandNames: new Set(['LiveChart']) },
    ['island component \'LiveChart\'', 'renders nothing server-side'],
  ],
];

describe('build diagnostics', () => {
  describe.each(DEGRADATIONS)('%s', (_label, code, walkCtx, fragments, signals) => {
    it('warns, naming the construct and the consequence', () => {
      const { warnings } = emitWithWarnings(code, walkCtx, signals);

      expect(warnings, 'the degradation must produce exactly one diagnostic')
        .toHaveLength(1);
      for (const fragment of fragments) {
        expect(warnings[0]).toContain(fragment);
      }
    });

    it('really did degrade to a client island', () => {
      // The other half of the contract: a diagnostic must correspond to real
      // lost server-side content, or it is noise that trains people to ignore
      // the channel.
      const { islands } = emitWithWarnings(code, walkCtx, signals);
      expect(islands.length).toBeGreaterThan(0);
    });
  });

  it('names the file, the construct and the consequence', () => {
    const { warnings } = emitWithWarnings(`h('div', null, caption)`, {
      sourceFile: 'src/pages/StatusPage.ts',
    });

    // WHERE / WHAT / SO WHAT — the three things a build warning has to carry
    // to be actionable without opening the compiler.
    expect(warnings[0]).toContain('in src/pages/StatusPage.ts');
    expect(warnings[0]).toContain('caption');
    expect(warnings[0]).toContain('renders nothing server-side');
  });

  it('reports the resolved component file, not the page that included it', () => {
    const { warnings } = emitWithWarnings(`h('div', null, Panel())`, {
      sourceFile: 'src/pages/HomePage.ts',
      resolveComponent: () => ({
        source: `export function Panel() { return h('section', null, caption); }`,
        functionName: 'Panel',
        path: 'src/components/Panel.ts',
      }),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('in src/components/Panel.ts');
    expect(warnings[0]).not.toContain('HomePage');
  });

  // -------------------------------------------------------------------------
  // 3: negative space — a page the compiler understands says nothing
  // -------------------------------------------------------------------------

  const CLEAN_PAGES: Array<[string, string, WalkContext, string?]> = [
    ['static markup', `h('main', { id: 'app' }, h('h1', null, 'Title'))`, {}],
    [
      'dynamic text and attributes',
      `h('p', { class: () => cls() }, () => body())`,
      {},
      `const [cls] = createSignal('row'); const [body] = createSignal('hi');`,
    ],
    [
      'a void element',
      `h('input', { type: 'search', value: () => q() })`,
      {},
      `const [q] = createSignal('');`,
    ],
    ['an event handler (deliberately skipped)', `h('button', { onClick: () => go() }, 'Go')`, {}],
    ['null / undefined / false children', `h('div', null, null, undefined, false, 'kept')`, {}],
    [
      'a createShow',
      `createShow(() => visible(), () => h('p', null, 'yes'), () => h('p', null, 'no'))`,
      {},
      `const [visible] = createSignal(true);`,
    ],
    [
      'a createList',
      `h('ul', null, createList(todos, (r) => r.id, (r) => h('li', null, r.title)))`,
      {},
    ],
    [
      'an inlined sub-component with literal props',
      `h('div', null, Badge({ label: 'New' }))`,
      {
        resolveComponent: () => ({
          source: `export function Badge(props) { return h('span', null, props.label); }`,
          functionName: 'Badge',
        }),
      },
    ],
    [
      'a resolvable island component',
      `h('div', null, Live())`,
      {
        islandNames: new Set(['Live']),
        resolveComponent: () => ({
          source: `export function Live() { return h('section', null, 'live'); }`,
          functionName: 'Live',
        }),
      },
    ],
    [
      'a statically unrolled spread',
      `h('nav', null, ...NAV.map((i) => h('a', { href: i.href }, i.label)))`,
      {
        fileConstants: new Map([
          ['NAV', [{ href: '/', label: 'Home' }, { href: '/about', label: 'About' }]],
        ]),
      },
    ],
  ];

  it.each(CLEAN_PAGES)('stays silent for %s', (_label, code, walkCtx, signals) => {
    const { warnings, islands } = emitWithWarnings(code, walkCtx, signals);
    expect(warnings).toEqual([]);
    // …and stayed silent because it compiled, not because it emitted nothing.
    if (_label !== 'a resolvable island component') {
      expect(islands).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // 4: completeness — no fallback path may skip the diagnostic
  // -------------------------------------------------------------------------

  it('warns at every emitIsland call site in the walker', () => {
    const source = readFileSync(resolve(__dirname, '../src/ir-walk.ts'), 'utf8');
    const lines = source.split('\n');

    const unguarded: string[] = [];
    lines.forEach((line, i) => {
      if (!/(?<!function )emitIsland\(ctx/.test(line)) return;
      // A diagnostic must be reachable immediately before the fallback: either
      // a direct warnDegraded(...) or the local bailOut(...) helper, both of
      // which name construct and consequence.
      const window = lines.slice(Math.max(0, i - 14), i).join('\n');
      if (!/warnDegraded\(/.test(window)) {
        unguarded.push(`${i + 1}: ${line.trim()}`);
      }
    });

    expect(
      unguarded,
      'every fallback-island emission must be preceded by a diagnostic',
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Signal defaults — the ledger #9 class
  // -------------------------------------------------------------------------

  describe('signal defaults', () => {
    function extract(source: string) {
      const warnings: string[] = [];
      const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.join(' '));
      });
      try {
        const defaults = collectSignalDeclarations(
          parse(source, { sourceType: 'module', plugins: ['typescript'] })
            .program.body as T.Statement[],
          { filePath: 'src/StatusIsland.ts' },
        );
        return { warnings, defaults };
      } finally {
        spy.mockRestore();
      }
    }

    it('warns that a non-literal signal default gets no named slot', () => {
      const { warnings, defaults } = extract(
        `import { createSignal } from 'formajs';
         export const [rows, setRows] = createSignal([]);
         export function StatusPanel() { return null; }`,
      );

      expect(defaults.has('rows')).toBe(false);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("signal 'rows'");
      expect(warnings[0]).toContain('src/StatusIsland.ts');
      expect(warnings[0]).toContain('no named slot');
    });

    it('stays silent for every default it can evaluate', () => {
      const { warnings, defaults } = extract(
        `import { createSignal } from 'formajs';
         export const [label, setLabel] = createSignal('idle');
         export const [count, setCount] = createSignal(0);
         export const [busy, setBusy] = createSignal(false);
         export const [sel, setSel] = createSignal(null);`,
      );

      expect(warnings).toEqual([]);
      expect([...defaults.keys()].sort()).toEqual(['busy', 'count', 'label', 'sel']);
    });
  });
});
