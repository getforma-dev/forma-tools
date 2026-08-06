/**
 * Signal scopes — the unit level of the pass that replaced the hand-enumerated
 * signal-default extractors.
 *
 * These tests pin the two things the old pre-pass could not express: which
 * scope a declaration belongs to, and what happens when two scopes declare the
 * same name. The end-to-end proof that the WALK pushes these scopes at the
 * right moments lives in ssr-emission.test.ts, and the proof that the resulting
 * IR renders the same markup the client does lives in ssr-render.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';

import {
  collectSignalDeclarations,
  enterComponentScope,
  enterSignalScope,
  lookupSignal,
  newSignalRegistry,
} from '../src/signal-scope';
import { IrEmitContext } from '../src/ir-emit';
import { getSlots } from './helpers/fmir';

const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

const warnings = () => warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');

function moduleBody(source: string): T.Statement[] {
  return parse(source, PARSE_OPTS).program.body as T.Statement[];
}

/** Declarations of a module's top level, as the walk reads them. */
function collect(source: string, constants?: Map<string, string>) {
  return collectSignalDeclarations(moduleBody(source), {
    filePath: 'page.ts',
    constants,
  });
}

// ===========================================================================
// What counts as a signal default
// ===========================================================================

describe('collectSignalDeclarations — evaluating initial values', () => {
  it('reads every literal type the slot table can encode', () => {
    const result = collect(`
      import { createSignal } from 'formajs';
      const [email] = createSignal('');
      const [name] = createSignal('Alice');
      const [submitting] = createSignal(false);
      const [visible] = createSignal(true);
      const [count] = createSignal(0);
      const [price] = createSignal(9.99);
      const [error] = createSignal<string | null>(null);
    `);
    expect([...result]).toEqual([
      ['email', { type: 'text', default: '' }],
      ['name', { type: 'text', default: 'Alice' }],
      ['submitting', { type: 'bool', default: false }],
      ['visible', { type: 'bool', default: true }],
      ['count', { type: 'number', default: 0 }],
      ['price', { type: 'number', default: 9.99 }],
      ['error', { type: 'null', default: null }],
    ]);
    expect(warnings()).toBe('');
  });

  it('reads a negative number, which the AST spells as a unary expression', () => {
    expect(collect(`const [offset] = createSignal(-1);`).get('offset'))
      .toEqual({ type: 'number', default: -1 });
  });

  it('reads an expression-less template literal', () => {
    expect(collect('const [tone] = createSignal(`calm`);').get('tone'))
      .toEqual({ type: 'text', default: 'calm' });
  });

  it('folds a module string const named as the initial value', () => {
    // ksx declares its defaults once as consts and reuses them at the setter
    // call site. Refusing to follow the const cost those signals their slots
    // and forced a duplicate literal into a second file.
    const constants = new Map([['SEL_TOGGLE_OFF', 'btn btn-row seltoggle']]);
    expect(collect(`const [cls] = createSignal(SEL_TOGGLE_OFF);`, constants).get('cls'))
      .toEqual({ type: 'text', default: 'btn btn-row seltoggle' });
    expect(warnings()).toBe('');
  });

  it('treats a zero-argument createSignal as the null default', () => {
    expect(collect(`const [maybe] = createSignal();`).get('maybe'))
      .toEqual({ type: 'null', default: null });
  });

  it('ignores declarations that are not createSignal', () => {
    const result = collect(`
      const [a, b] = someOtherFunction('hello');
      const items = [1, 2, 3];
      const name = 'test';
    `);
    expect(result.size).toBe(0);
  });

  it('warns, naming the file and the consequence, for a default it cannot evaluate', () => {
    const result = collect(`
      const [config] = createSignal({ key: 'val' });
      const [label] = createSignal('ok');
    `);
    expect([...result]).toEqual([['label', { type: 'text', default: 'ok' }]]);

    const warned = warnings();
    expect(warned).toContain("signal 'config'");     // which signal
    expect(warned).toContain('page.ts');             // the file to edit
    expect(warned).toContain('ObjectExpression');    // the construct
    expect(warned).toContain('render EMPTY server-side'); // the consequence
  });

  it('warns when one frame collects a name twice with different defaults', () => {
    // Two sibling BLOCKS are separate scopes to JavaScript but one frame here,
    // because the walk has no block boundaries in the tree it inlines. The
    // ambiguity is real, so it is reported rather than resolved by luck.
    const result = collect(`
      if (a) { const [mode] = createSignal('list'); }
      if (b) { const [mode] = createSignal('grid'); }
    `);
    // The first declaration owns the slot, and the warning says so rather than
    // letting the second silently replace it.
    expect(result.get('mode')).toEqual({ type: 'text', default: 'list' });
    expect(warnings()).toContain("declared twice in the same scope");
  });
});

// ===========================================================================
// Which statements belong to a scope
// ===========================================================================

describe('collectSignalDeclarations — scope boundaries', () => {
  it('reads a declaration nested inside an if block', () => {
    // The walk inlines the tree such a block builds, so a signal declared
    // there is as real as one at the top. `collectSignalDefaults` iterated a
    // flat Statement[] and could not see it at all.
    const result = collect(`
      if (FLAG) {
        const [text] = createSignal('Ready');
      }
    `);
    expect(result.get('text')).toEqual({ type: 'text', default: 'Ready' });
  });

  it('reads a declaration nested inside try/catch and a loop', () => {
    const result = collect(`
      try { const [a] = createSignal('a'); } catch (e) { const [b] = createSignal('b'); }
      for (const x of xs) { const [c] = createSignal('c'); }
    `);
    expect([...result.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('does not read a declaration inside a nested function', () => {
    // A function is its own scope. It gets its own frame when — and only
    // when — the walk decides to inline it, which is what keeps two
    // components' `count` declarations apart.
    const result = collect(`
      const [outer] = createSignal('page');
      function Sidebar() { const [collapsed] = createSignal(true); }
      const navItem = () => { const [hovered] = createSignal(false); };
    `);
    expect([...result.keys()]).toEqual(['outer']);
  });
});

// ===========================================================================
// Slots, chaining and collisions
// ===========================================================================

describe('signal scopes — slots and lookup', () => {
  /** A one-frame scope over a module's top level, plus its emit context. */
  function scopeOf(source: string, key = 'a.ts#module') {
    const ctx = new IrEmitContext();
    const registry = newSignalRegistry();
    const scope = enterSignalScope(null, key, collect(source), ctx, registry);
    return { ctx, registry, scope };
  }

  it('mints one slot per declaration, typed and carrying its default', () => {
    const { ctx, scope } = scopeOf(`
      const [label] = createSignal('Ready');
      const [open] = createSignal(true);
      const [count] = createSignal(7);
      const [error] = createSignal(null);
    `);
    // Slot ids are handed out in declaration order.
    expect(lookupSignal(scope, 'label')!.slotId).toBe(0);
    expect(lookupSignal(scope, 'count')!.slotId).toBe(2);

    expect(getSlots(ctx.toBinary()).map((s) => [s.name, s.typeHint, s.default])).toEqual([
      ['label', 0x01, 'Ready'],
      ['open', 0x02, 'true'],
      ['count', 0x03, '7'],
      // Null keeps a Text slot with NO default bytes: the reader leaves it
      // Null, which renders as empty text and an omitted attribute.
      ['error', 0x01, ''],
    ]);
  });

  it('resolves an inner name before an outer one, and finds outer names through the chain', () => {
    const ctx = new IrEmitContext();
    const registry = newSignalRegistry();
    const outer = enterSignalScope(
      null,
      'page.ts#module',
      collect(`const [tone] = createSignal('calm'); const [count] = createSignal(1);`),
      ctx,
      registry,
    );
    const inner = enterSignalScope(
      outer,
      'page.ts#fn:Page',
      collect(`const [count] = createSignal(99);`),
      ctx,
      registry,
    );

    expect(lookupSignal(inner, 'count')!.default).toEqual({ type: 'number', default: 99 });
    expect(lookupSignal(inner, 'tone')!.default).toEqual({ type: 'text', default: 'calm' });
    expect(lookupSignal(outer, 'count')!.default).toEqual({ type: 'number', default: 1 });
    expect(lookupSignal(inner, 'missing')).toBeUndefined();
  });

  it('suffixes the second scope to declare a name', () => {
    // Two sub-components can each declare `count`. They are different signals
    // and need different slots; the second gets the same `#N` occurrence
    // suffix every other slot family uses.
    const ctx = new IrEmitContext();
    const registry = newSignalRegistry();
    const first = enterSignalScope(null, 'a.ts#module', collect(`const [count] = createSignal(1);`), ctx, registry);
    const second = enterSignalScope(null, 'b.ts#module', collect(`const [count] = createSignal(2);`), ctx, registry);

    expect(lookupSignal(first, 'count')!.slotName).toBe('count');
    expect(lookupSignal(second, 'count')!.slotName).toBe('count#2');
    expect(getSlots(ctx.toBinary()).map((s) => [s.name, s.default])).toEqual([
      ['count', '1'],
      ['count#2', '2'],
    ]);
  });

  it('reuses one slot when the same component is inlined twice', () => {
    // One slot per DECLARATION SITE. Re-entering the same scope must not mint
    // a second copy, or an island used twice would double its slot table and
    // name-addressed injection would reach only the first instance.
    const ctx = new IrEmitContext();
    const registry = newSignalRegistry();
    const decls = collect(`const [badgeLabel] = createSignal('beta');`);
    const a = enterSignalScope(null, 'badge.ts#module', decls, ctx, registry);
    const b = enterSignalScope(null, 'badge.ts#module', decls, ctx, registry);

    expect(b).toBe(a);
    expect(getSlots(ctx.toBinary()).map((s) => s.name)).toEqual(['badgeLabel']);
  });

  it('does not put a declared-but-unread signal into an island capture', () => {
    // Declaring a signal is not the same as a binding on the page reading it.
    // Only the latter belongs in an island's slot_ids, or every island ships
    // props for state nothing on the page renders.
    const ctx = new IrEmitContext();
    const registry = newSignalRegistry();
    ctx.beginSlotCapture();
    enterSignalScope(null, 'x.ts#module', collect(`const [unused] = createSignal('x');`), ctx, registry);
    expect(ctx.endSlotCapture()).toEqual([]);
  });
});

// ===========================================================================
// Component scopes: file + function body, and where a nested helper hangs
// ===========================================================================

describe('enterComponentScope', () => {
  function componentScope(source: string, fnName: string, callerSource?: string) {
    const ctx = new IrEmitContext();
    const registry = newSignalRegistry();
    const ast = parse(source, PARSE_OPTS) as unknown as T.File;

    // Find the function the way the export resolver does — by name, at any depth.
    let fn: any = null;
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'FunctionDeclaration' && node.id?.name === fnName) fn = node;
      if (node.type === 'VariableDeclarator' && node.id?.name === fnName) fn = node.init;
      for (const key of Object.keys(node)) {
        const child = (node as any)[key];
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object' && child.type) visit(child);
      }
    };
    visit(ast.program);

    const callerScope = callerSource
      ? enterSignalScope(null, 'caller', collect(callerSource), ctx, registry)
      : null;

    return {
      ctx,
      scope: enterComponentScope({
        ast, fn, fnName, filePath: 'card.ts', ctx, registry, callerScope,
      }),
    };
  }

  it('chains the component file\'s module scope under the component body', () => {
    const { scope } = componentScope(`
      import { createSignal, h } from 'formajs';
      const [shared] = createSignal('module');
      export function Card() {
        const [local] = createSignal(true);
        return h('div', null);
      }
    `, 'Card');

    expect(lookupSignal(scope, 'local')!.default).toEqual({ type: 'bool', default: true });
    expect(lookupSignal(scope, 'shared')!.default).toEqual({ type: 'text', default: 'module' });
  });

  it('ignores signals declared in a SIBLING component in the same file', () => {
    const { scope } = componentScope(`
      import { createSignal, h } from 'formajs';
      export function Other() { const [other] = createSignal('nope'); return h('div', null); }
      export function Card() { const [mine] = createSignal('yes'); return h('div', null); }
    `, 'Card');

    expect(lookupSignal(scope, 'mine')!.default).toEqual({ type: 'text', default: 'yes' });
    expect(lookupSignal(scope, 'other')).toBeUndefined();
  });

  it('reads a component declared as an exported const arrow', () => {
    const { scope } = componentScope(`
      import { createSignal, h } from 'formajs';
      const [open] = createSignal(false);
      export const Menu = () => { const [selected] = createSignal(null); return h('nav', null); };
    `, 'Menu');

    expect(lookupSignal(scope, 'open')!.default).toEqual({ type: 'bool', default: false });
    expect(lookupSignal(scope, 'selected')!.default).toEqual({ type: 'null', default: null });
  });

  it('reads `export const [count] = createSignal(0)` at module scope', () => {
    const { scope } = componentScope(`
      import { createSignal, h } from 'formajs';
      export const [count] = createSignal(0);
      export function Card() { return h('span', null); }
    `, 'Card');
    expect(lookupSignal(scope, 'count')!.default).toEqual({ type: 'number', default: 0 });
  });

  it('reads the esbuild `export { X }` rewrite a .tsx file arrives as', () => {
    // The .ts and .tsx twins are byte-identical source; only the .tsx one
    // arrives rewritten. When the lookup could not see the rewrite, the slot
    // was renamed `text:0`, lost its default, and no build output said a word.
    const { scope } = componentScope(`
      import { createSignal, h } from 'formajs';
      function Counter() {
        const [hits] = createSignal(42);
        return h('button', null, () => hits());
      }
      export { Counter };
    `, 'Counter');
    expect(lookupSignal(scope, 'hits')!.default).toEqual({ type: 'number', default: 42 });
  });

  it('a nested helper sees the signals declared beside it', () => {
    // `navItem` is declared INSIDE the mount callback and reads a signal
    // declared there too. Its lexical environment is the caller's chain, not
    // the file's top level — the dashboard sidebar is exactly this shape.
    const { scope } = componentScope(
      `mount(() => {
        const [collapsed] = createSignal(true);
        const navItem = (props) => { return h('li', null); };
        return h('ul', null, navItem({ label: 'Home' }));
      }, '#app');`,
      'navItem',
      `const [collapsed] = createSignal(true);`,
    );
    expect(lookupSignal(scope, 'collapsed')!.default).toEqual({ type: 'bool', default: true });
  });

  it('a program-scope component does NOT see the caller\'s inner scope', () => {
    const { scope } = componentScope(`
      import { createSignal, h } from 'formajs';
      export function Card() { return h('div', null); }
    `, 'Card', `const [pageOnly] = createSignal('page');`);
    expect(lookupSignal(scope, 'pageOnly')).toBeUndefined();
  });
});
