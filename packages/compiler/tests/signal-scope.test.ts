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
  createSignalImportResolver,
  enterComponentScope,
  enterSignalScope,
  lookupSignal,
  newSignalRegistry,
  type SignalImportResolver,
} from '../src/signal-scope';
import { type ModuleLoader } from '../src/module-loader';
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

  it('unwraps TypeScript cast expressions down to their literal', () => {
    // `createSignal(null as string | null)` is how a store widens a signal's
    // type — gatewasm's login store declares five signals this way. The cast
    // is erased at runtime; refusing to look through it cost each one its
    // slot, and every binding that read one degraded.
    const result = collect(`
      import { createSignal } from 'formajs';
      const [error] = createSignal(null as string | null);
      const [mode] = createSignal('idle' as 'idle' | 'busy');
      const [count] = createSignal(0 as const);
      const [label] = createSignal('ok' satisfies string);
      const [flag] = createSignal(false!);
    `);
    expect([...result]).toEqual([
      ['error', { type: 'null', default: null }],
      ['mode', { type: 'text', default: 'idle' }],
      ['count', { type: 'number', default: 0 }],
      ['label', { type: 'text', default: 'ok' }],
      ['flag', { type: 'bool', default: false }],
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

// ===========================================================================
// Imported signals: a default declared in another module folds here
// ===========================================================================

describe('enterComponentScope — imported signals', () => {
  /** In-memory module loader, keyed by bare specifier (same shape as
   *  export-resolver.test.ts). */
  function loaderFor(files: Record<string, string>): ModuleLoader {
    return (_fromFile, importPath) => {
      for (const candidate of [importPath, `${importPath}.ts`, `${importPath}/index.ts`]) {
        if (candidate in files) return { path: candidate, source: files[candidate]! };
      }
      return null;
    };
  }

  /**
   * Component scope of `entry` with imports followed across `files`.
   * Pass `shared` to enter a second component against the same page state,
   * which is how slot identity across importers is observed.
   */
  function importScope(
    files: Record<string, string>,
    entry: string,
    fnName: string,
    shared?: {
      ctx: IrEmitContext;
      registry: ReturnType<typeof newSignalRegistry>;
      imports: SignalImportResolver;
    },
  ) {
    const ctx = shared?.ctx ?? new IrEmitContext();
    const registry = shared?.registry ?? newSignalRegistry();
    const imports = shared?.imports ?? createSignalImportResolver(
      loaderFor(files),
      (source, filePath) =>
        collectSignalDeclarations(
          (parse(source, PARSE_OPTS).program.body) as T.Statement[],
          { filePath },
        ),
    );
    const ast = parse(files[entry]!, PARSE_OPTS) as unknown as T.File;

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

    return {
      ctx, registry, imports,
      scope: enterComponentScope({
        ast, fn, fnName, filePath: entry, ctx, registry, imports,
      }),
    };
  }

  const STORE = `
    import { createSignal } from 'formajs';
    export const [ownerInviteToken, setOwnerInviteToken] = createSignal('');
  `;

  it('folds an imported signal\'s literal default', () => {
    // The gatewasm shape: the signal lives in store.ts, the page reads it.
    const { ctx, scope } = importScope({
      './store.ts': STORE,
      './page.ts': `
        import { createSignal, h } from 'formajs';
        import { ownerInviteToken } from './store';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');

    const binding = lookupSignal(scope, 'ownerInviteToken');
    expect(binding).toBeDefined();
    expect(binding!.default).toEqual({ type: 'text', default: '' });
    expect(getSlots(ctx.toBinary()).map((s) => s.name)).toContain('ownerInviteToken');
  });

  it('two files importing the same signal resolve to ONE slot', () => {
    const files = {
      './store.ts': STORE,
      './a.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './store';
        export function A() { return h('a', null); }
      `,
      './b.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './store';
        export function B() { return h('b', null); }
      `,
    };
    const first = importScope(files, './a.ts', 'A');
    const second = importScope(files, './b.ts', 'B', first);

    const a = lookupSignal(first.scope, 'ownerInviteToken')!;
    const b = lookupSignal(second.scope, 'ownerInviteToken')!;
    expect(a.slotId).toBe(b.slotId);
    // One signal, one slot — not ownerInviteToken plus ownerInviteToken#2.
    expect(getSlots(first.ctx.toBinary()).filter((s) => s.name.startsWith('ownerInviteToken')))
      .toHaveLength(1);
  });

  it('a renamed import resolves under its local name', () => {
    const { scope } = importScope({
      './store.ts': STORE,
      './page.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken as tok } from './store';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');

    const binding = lookupSignal(scope, 'tok');
    expect(binding).toBeDefined();
    // The slot belongs to the defining module's name, not the alias.
    expect(binding!.slotName).toBe('ownerInviteToken');
    expect(binding!.default).toEqual({ type: 'text', default: '' });
  });

  it('a re-exported signal resolves through the barrel', () => {
    const files = {
      './store.ts': STORE,
      './index.ts': `export { ownerInviteToken } from './store';`,
      './page.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './index';
        export function Page() { return h('a', null); }
      `,
      './direct.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './store';
        export function Direct() { return h('a', null); }
      `,
    };
    const viaBarrel = importScope(files, './page.ts', 'Page');
    const direct = importScope(files, './direct.ts', 'Direct', viaBarrel);

    const b1 = lookupSignal(viaBarrel.scope, 'ownerInviteToken');
    expect(b1).toBeDefined();
    expect(b1!.default).toEqual({ type: 'text', default: '' });
    // Barrel or not, it is the same signal in the same defining module.
    expect(b1!.slotId).toBe(lookupSignal(direct.scope, 'ownerInviteToken')!.slotId);
  });

  it('an import cycle terminates instead of recursing', () => {
    const { scope } = importScope({
      './a.ts': `export { s } from './b';`,
      './b.ts': `export { s } from './a';`,
      './page.ts': `
        import { h } from 'formajs';
        import { s } from './a';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 's')).toBeUndefined();
  });

  it('a nested local shadowing the imported name blocks the fold', () => {
    // page.ts imports `status` AND declares its own `status` inside the
    // component. lookupSignal cannot see non-signal locals, so installing the
    // import binding would fold the STORE's default into a read that actually
    // hits the component's local — a silently wrong SSR value where the
    // pre-fix behavior was a flagged degradation. The import must be skipped.
    const { scope } = importScope({
      './store.ts': STORE,
      './page.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './store';
        export function Page() {
          const helper = () => {
            const ownerInviteToken = () => sessionStorage.getItem('tok');
            return h('i', null, () => ownerInviteToken());
          };
          return h('div', null, helper());
        }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 'ownerInviteToken')).toBeUndefined();
  });

  it('a nested function DECLARATION shadowing the imported name blocks the fold', () => {
    // Same hazard as the const shadow, different declaration form: a
    // `function tok() {}` inside a component binds the name too, and the
    // scope chain cannot see it — folding the store's default at a tok()
    // read site would be silently wrong.
    const { scope } = importScope({
      './store.ts': STORE,
      './page.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './store';
        export function Page() {
          function ownerInviteToken() { return sessionStorage.getItem('tok'); }
          return h('i', null, () => ownerInviteToken());
        }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 'ownerInviteToken')).toBeUndefined();
  });

  it('a nested class declaration shadowing the imported name blocks the fold', () => {
    const { scope } = importScope({
      './store.ts': STORE,
      './page.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './store';
        export function Page() {
          class ownerInviteToken {}
          return h('i', null, String(ownerInviteToken));
        }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 'ownerInviteToken')).toBeUndefined();
  });

  it('a type-only RE-EXPORT through a barrel binds nothing', () => {
    // `export type { tok } from './store'` is erased at runtime — following
    // it as a value edge would fold the store's default (and mint its slot
    // table) for an import that cannot exist at runtime.
    const { ctx, scope } = importScope({
      './store.ts': STORE,
      './barrel.ts': `export type { ownerInviteToken } from './store';`,
      './page.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken } from './barrel';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 'ownerInviteToken')).toBeUndefined();
    expect(getSlots(ctx.toBinary()).map((s) => s.name)).not.toContain('ownerInviteToken');
  });

  it('an inline type re-export specifier binds nothing while value siblings resolve', () => {
    const { scope } = importScope({
      './store.ts': `
        import { createSignal } from 'formajs';
        export const [ownerInviteToken, setOwnerInviteToken] = createSignal('');
        export const [status, setStatus] = createSignal('idle');
      `,
      './barrel.ts': `export { status, type ownerInviteToken } from './store';`,
      './page.ts': `
        import { h } from 'formajs';
        import { status, ownerInviteToken } from './barrel';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 'status')).toBeDefined();
    expect(lookupSignal(scope, 'ownerInviteToken')).toBeUndefined();
  });

  it('a type-only import is skipped without following the module', () => {
    // `import type` is erased at runtime — it must not bind a slot, and it
    // must not drag the store's slot table into the page.
    const files = {
      './store.ts': STORE,
      './page.ts': `
        import { h } from 'formajs';
        import type { ownerInviteToken } from './store';
        export function Page() { return h('a', null); }
      `,
    };
    const { ctx, scope } = importScope(files, './page.ts', 'Page');
    expect(lookupSignal(scope, 'ownerInviteToken')).toBeUndefined();
    expect(getSlots(ctx.toBinary()).map((s) => s.name)).not.toContain('ownerInviteToken');
  });

  it('an inline type specifier is skipped while its value siblings resolve', () => {
    const { ctx, scope } = importScope({
      './store.ts': `
        import { createSignal } from 'formajs';
        export const [ownerInviteToken, setOwnerInviteToken] = createSignal('');
        export type Invite = { token: string };
      `,
      './page.ts': `
        import { h } from 'formajs';
        import { ownerInviteToken, type Invite } from './store';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 'ownerInviteToken')).toBeDefined();
    expect(lookupSignal(scope, 'Invite')).toBeUndefined();
    expect(getSlots(ctx.toBinary()).filter((s) => s.name === 'ownerInviteToken')).toHaveLength(1);
  });

  it('importing a signal SETTER binds nothing', () => {
    // Only the getter (elements[0] of the destructuring) is a signal binding.
    const { scope } = importScope({
      './store.ts': STORE,
      './page.ts': `
        import { h } from 'formajs';
        import { setOwnerInviteToken } from './store';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');
    expect(lookupSignal(scope, 'setOwnerInviteToken')).toBeUndefined();
  });

  it('a non-literal initialiser still degrades with the existing diagnostic', () => {
    // The fix must not invent a default it cannot honour: no binding, and the
    // collector's existing warning still names the signal and the cause.
    const { scope } = importScope({
      './store.ts': `
        import { createSignal } from 'formajs';
        export const [x, setX] = createSignal(compute());
      `,
      './page.ts': `
        import { h } from 'formajs';
        import { x } from './store';
        export function Page() { return h('a', null); }
      `,
    }, './page.ts', 'Page');

    expect(lookupSignal(scope, 'x')).toBeUndefined();
    expect(warnings()).toContain("signal 'x' is initialized with a CallExpression");
  });
});
