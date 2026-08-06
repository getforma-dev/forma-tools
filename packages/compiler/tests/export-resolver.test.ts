import { describe, it, expect } from 'vitest';
import { transformSync } from 'esbuild';

import {
  readImportBindings,
  resolveExportedFunction,
  returnExpressionOf,
  type ExportLookup,
  type ModuleLoader,
} from '../src/export-resolver';
import { parse } from '@babel/parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A module loader over an in-memory file map, keyed by bare specifier. */
function loaderFor(files: Record<string, string>): ModuleLoader {
  return (_fromFile, importPath) => {
    for (const candidate of [importPath, `${importPath}.ts`, `${importPath}/index.ts`]) {
      if (candidate in files) return { path: candidate, source: files[candidate]! };
    }
    return null;
  };
}

function expectFound(lookup: ExportLookup) {
  if (lookup.kind !== 'found') {
    throw new Error(`expected a resolved export, got: ${lookup.detail}`);
  }
  return lookup;
}

function expectUnresolved(lookup: ExportLookup): string {
  if (lookup.kind !== 'unresolved') {
    throw new Error('expected an unresolved result, got a resolved export');
  }
  return lookup.detail;
}

/** The tag name of the h() call a component returns — enough to tell WHICH
 *  function was resolved when several are in play. */
function returnedTag(lookup: ExportLookup): string {
  const found = expectFound(lookup);
  const node = returnExpressionOf(found.fn);
  if (!node || node.type !== 'CallExpression') {
    throw new Error(`expected the function to return an h() call, got ${node?.type}`);
  }
  const first = node.arguments[0];
  if (!first || first.type !== 'StringLiteral') {
    throw new Error('expected a literal tag name');
  }
  return first.value;
}

// ===========================================================================
// The export forms a real project actually produces
// ===========================================================================

describe('resolveExportedFunction — declaration exports', () => {
  it('resolves export function', () => {
    const source = `export function Card() { return h('article', null); }`;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('article');
  });

  it('resolves export const with an arrow', () => {
    const source = `export const Card = () => h('aside', null);`;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('aside');
  });

  it('resolves export const with a function expression', () => {
    const source = `export const Card = function () { return h('section', null); };`;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('section');
  });

  it('reports an export that is bound to a non-function', () => {
    const source = `export const Card = 'not a component';`;
    const detail = expectUnresolved(resolveExportedFunction(source, 'card.ts', 'Card'));
    // Naming the CONSTRUCT is the point: "no export named Card" would send the
    // author looking for a missing export that is right there.
    expect(detail).toContain('card.ts');
    expect(detail).toContain('StringLiteral');
  });
});

describe('resolveExportedFunction — specifier exports', () => {
  it('resolves export { X }', () => {
    const source = `
      function Card() { return h('article', null); }
      export { Card };
    `;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('article');
  });

  it('follows the alias in export { XImpl as X } to the real declaration', () => {
    const source = `
      function Decoy() { return h('div', null); }
      function CardImpl() { return h('article', null); }
      export { CardImpl as Card };
    `;
    // Resolving the ALIAS rather than the local name is what makes this a
    // different assertion from the one above: 'Card' is never declared.
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('article');
  });

  it('follows a specifier that re-exports an imported binding', () => {
    const files = {
      './real': `export function Card() { return h('article', null); }`,
    };
    const source = `
      import { Card } from './real';
      export { Card };
    `;
    const lookup = resolveExportedFunction(source, 'index.ts', 'Card', {
      loadModule: loaderFor(files),
    });
    expect(returnedTag(lookup)).toBe('article');
    expect(expectFound(lookup).filePath).toBe('./real');
  });

  it("esbuild's own .tsx output resolves through the specifier form", () => {
    // Not a hand-written imitation of what esbuild emits — the real transform.
    // The rewrite this depends on is the reason 100% of .tsx pages used to
    // compile to placeholder IR.
    const tsx = `export function Card(props: { n: number }) { return <article>{props.n}</article>; }`;
    const transformed = transformSync(tsx, {
      loader: 'tsx', jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm',
    }).code;

    // Guard the premise: if esbuild ever stops rewriting, this test would pass
    // for the wrong reason.
    expect(transformed).toContain('export {');
    expect(transformed).not.toContain('export function');

    expect(returnedTag(resolveExportedFunction(transformed, 'card.tsx', 'Card'))).toBe('article');
  });
});

describe('resolveExportedFunction — default exports', () => {
  it("resolves the name 'default' to an anonymous default export", () => {
    const source = `export default function () { return h('article', null); }`;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'default'))).toBe('article');
  });

  it('resolves a default export through an identifier', () => {
    const source = `
      function Card() { return h('article', null); }
      export default Card;
    `;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'default'))).toBe('article');
  });

  it('accepts a default export whose function name matches the request', () => {
    const source = `export default function Card() { return h('article', null); }`;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('article');
  });

  it('refuses a default export whose function is named something else', () => {
    // The import site asked for 'Card' by NAME. Handing it `Widget` because it
    // happens to be the default would inline the wrong component silently,
    // which is strictly worse than declining.
    const source = `export default function Widget() { return h('aside', null); }`;
    const detail = expectUnresolved(resolveExportedFunction(source, 'card.ts', 'Card'));
    expect(detail).toContain("no export named 'Card'");
  });
});

describe('resolveExportedFunction — cross-file re-exports', () => {
  const files = {
    './card': `export function Card() { return h('article', null); }`,
    './tag': `export function Tag() { return h('span', null); }`,
    './chip': `
      function ChipImpl() { return h('em', null); }
      export { ChipImpl as Chip };
    `,
  };

  it('follows export { X } from', () => {
    const lookup = resolveExportedFunction(
      `export { Card } from './card';`, 'index.ts', 'Card', { loadModule: loaderFor(files) },
    );
    expect(returnedTag(lookup)).toBe('article');
    // The DECLARING file, not the barrel: module-scope constants and imports
    // have to be read from where the code actually lives.
    expect(expectFound(lookup).filePath).toBe('./card');
  });

  it('follows an aliased re-export to the name the target module exports', () => {
    const lookup = resolveExportedFunction(
      `export { Chip as StatusChip } from './chip';`,
      'index.ts',
      'StatusChip',
      { loadModule: loaderFor(files) },
    );
    expect(returnedTag(lookup)).toBe('em');
  });

  it('searches every module an export * spreads', () => {
    const source = `
      export * from './card';
      export * from './tag';
    `;
    const lookup = resolveExportedFunction(source, 'index.ts', 'Tag', {
      loadModule: loaderFor(files),
    });
    expect(returnedTag(lookup)).toBe('span');
  });

  it('does not let export * forward a default export', () => {
    // Matching the language: `export *` skips `default`. Resolving it would
    // inline a component the importing file cannot actually name.
    const starred = { './card': `export default function () { return h('article', null); }` };
    const detail = expectUnresolved(resolveExportedFunction(
      `export * from './card';`, 'index.ts', 'default', { loadModule: loaderFor(starred) },
    ));
    expect(detail).toContain("no export named 'default'");
  });

  it('terminates on a circular re-export instead of recursing forever', () => {
    const circular = {
      './a': `export { Card } from './b';`,
      './b': `export { Card } from './a';`,
    };
    const detail = expectUnresolved(resolveExportedFunction(
      `export { Card } from './a';`, 'index.ts', 'Card', { loadModule: loaderFor(circular) },
    ));
    expect(detail).toContain('cycle');
  });

  it('says so when a re-export cannot be followed for want of a loader', () => {
    const detail = expectUnresolved(
      resolveExportedFunction(`export { Card } from './card';`, 'index.ts', 'Card'),
    );
    expect(detail).toContain("re-exported from './card'");
  });

  it('never follows a package import', () => {
    const detail = expectUnresolved(resolveExportedFunction(
      `export { Button } from 'some-ui-kit';`, 'index.ts', 'Button', { loadModule: loaderFor({}) },
    ));
    expect(detail).toContain('package import');
  });
});

describe('resolveExportedFunction — local and nested declarations', () => {
  const source = `
    function Sidebar() { return h('nav', null); }
    export function Page() { return h('main', null, Sidebar()); }
  `;

  it('refuses a non-exported declaration by default', () => {
    // The name arrived through an `import`. A binding the importer cannot
    // import must not be server-rendered as though it could.
    expect(expectUnresolved(resolveExportedFunction(source, 'page.ts', 'Sidebar')))
      .toContain("no export named 'Sidebar'");
  });

  it('accepts a non-exported declaration when the caller allows it', () => {
    // A sub-component call in the SAME file needs no export at all.
    const lookup = resolveExportedFunction(source, 'page.ts', 'Sidebar', { allowLocal: true });
    expect(returnedTag(lookup)).toBe('nav');
  });

  it('finds a helper declared inside another function when allowed', () => {
    const nested = `
      mount(() => {
        const navItem = (props) => h('li', null, props.label);
        return h('ul', null, navItem({ label: 'Home' }));
      }, '#app');
    `;
    const lookup = resolveExportedFunction(nested, 'app.ts', 'navItem', { allowNested: true });
    expect(returnedTag(lookup)).toBe('li');
  });

  it('refuses to guess when a nested name is declared more than once', () => {
    const ambiguous = `
      function A() { const row = () => h('tr', null); return row(); }
      function B() { const row = () => h('li', null); return row(); }
    `;
    const detail = expectUnresolved(
      resolveExportedFunction(ambiguous, 'app.ts', 'row', { allowNested: true }),
    );
    expect(detail).toContain('2 times in different scopes');
  });

  it('prefers an exported declaration over a nested one of the same name', () => {
    const both = `
      export function Row() { return h('tr', null); }
      function Wrapper() { const Row = () => h('li', null); return Row(); }
    `;
    const lookup = resolveExportedFunction(both, 'app.ts', 'Row', {
      allowLocal: true, allowNested: true,
    });
    expect(returnedTag(lookup)).toBe('tr');
  });
});

// ===========================================================================
// returnExpressionOf
// ===========================================================================

describe('returnExpressionOf', () => {
  it('takes the body of an expression-bodied arrow', () => {
    const lookup = resolveExportedFunction(
      `export const Card = () => h('article', null);`, 'card.ts', 'Card',
    );
    expect(returnedTag(lookup)).toBe('article');
  });

  it('finds a return nested inside an if statement', () => {
    const source = `
      export function Card() {
        if (true) { return h('article', null); }
        return h('div', null);
      }
    `;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('article');
  });

  it('does not take a return from a nested function', () => {
    // A helper's return is not the component's. Taking it would emit the
    // helper's subtree as the whole page.
    const source = `
      export function Card() {
        function inner() { return h('span', null); }
        return h('article', null, inner());
      }
    `;
    expect(returnedTag(resolveExportedFunction(source, 'card.ts', 'Card'))).toBe('article');
  });

  it('returns null for a function with no return', () => {
    const lookup = expectFound(resolveExportedFunction(
      `export function Card() { doSomething(); }`, 'card.ts', 'Card',
    ));
    expect(returnExpressionOf(lookup.fn)).toBeNull();
  });
});

// ===========================================================================
// readImportBindings
// ===========================================================================

describe('readImportBindings', () => {
  it('records the name the TARGET module exports each binding under', () => {
    const ast = parse(
      `
        import Page from './page';
        import { CardImpl as Card, Tag } from './card';
        import * as icons from './icons';
      `,
      { sourceType: 'module', plugins: ['typescript', 'jsx'] },
    ) as any;

    expect([...readImportBindings(ast)]).toEqual([
      ['Page', { source: './page', imported: 'default' }],
      ['Card', { source: './card', imported: 'CardImpl' }],
      ['Tag', { source: './card', imported: 'Tag' }],
      ['icons', { source: './icons', imported: '*' }],
    ]);
  });
});
