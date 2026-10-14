/**
 * `browserOnly()`, the one marker for a subtree that renders in the browser
 * alone (DR-1, L-1; FORMA-119).
 *
 * The compiler emits a component declared `const X = browserOnly(Impl)` as a
 * registered island whose server output is its empty host element with its
 * declared props, wherever it stands and however it was imported. The browser
 * half (core activates the empty host and renders the component) is the SSR
 * lane's `browser-only` case in `e2e/ssr/`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { collectDiagnostics } from '../src/diagnostics';
import { assertBinaryInvariants, getIslands, getSlots, parseOpcodeList } from './helpers/fmir';

const CORE = "import { h, mount, activateIslands, browserOnly } from '@getforma/core';\n";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'forma-browser-only-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

function compile(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const full = join(tmpDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const { result, diagnostics } = collectDiagnostics(() => generateRealIr(join(tmpDir, 'app.tsx')));
  expect(result, 'the page compiled, not a placeholder').not.toBeNull();
  assertBinaryInvariants(result!.binary);
  return {
    diagnostics,
    islands: getIslands(result!.binary),
    slots: getSlots(result!.binary),
    ops: parseOpcodeList(result!.binary),
  };
}

const CHART = `${CORE}
export const Chart = browserOnly((props: { title?: string }) => <canvas aria-label={props.title} />);
`;

describe('browserOnly()', () => {
  it('emits a registered island whose server output is its empty host with its declared props', () => {
    const { diagnostics, islands, slots, ops } = compile({
      'chart.tsx': CHART,
      'app.tsx': `${CORE}import { Chart } from './chart';
const LABEL = 'Quarterly';
activateIslands({ Chart });
mount(() => (
  <main>
    <h1>Report</h1>
    <Chart title="Sales" count={3} live={true} none={null} neg={-2} label={LABEL} skipped={undefined} />
  </main>
), '#app');
`,
    });

    expect(diagnostics).toEqual([]);
    expect(islands.map((i) => [i.name, i.trigger, i.propsMode, i.slotIds])).toEqual([['Chart', 1, 1, []]]);
    // The props are static: no slot, so nothing collides in the page's slot namespace.
    expect(slots).toEqual([]);
    const start = ops.indexOf('ISLAND_START Chart#0');
    expect(ops.slice(start, start + 4)).toEqual([
      'ISLAND_START Chart#0',
      `OPEN_TAG div data-forma-props=${JSON.stringify(JSON.stringify({
        title: 'Sales', count: 3, live: true, none: null, neg: -2, label: 'Quarterly',
      }))}`,
      'CLOSE_TAG div',
      'ISLAND_END Chart#0',
    ]);
  });

  it('writes no props attribute for a component given none', () => {
    const { ops } = compile({
      'chart.tsx': CHART,
      'app.tsx': `${CORE}import { Chart } from './chart';
activateIslands({ Chart });
mount(() => <main><Chart /></main>, '#app');
`,
    });
    expect(ops).toContain('OPEN_TAG div');
    expect(ops.join('\n')).not.toContain('data-forma-props');
  });

  it('follows the declaration through a barrel, `export *`, a default export and the same file', () => {
    const forms: Array<[string, Record<string, string>, string]> = [
      ['a barrel', {
        'chart.tsx': CHART,
        'index.ts': "export { Chart } from './chart';\n",
      }, "import { Chart } from './index';"],
      ['export *', {
        'chart.tsx': CHART,
        'index.ts': "export * from './chart';\n",
      }, "import { Chart } from './index';"],
      ['an aliased import of a default export', {
        'chart.tsx': `${CORE}export default browserOnly(() => <canvas />);\n`,
      }, "import Chart from './chart';"],
      ['a declaration in the page file', {}, 'const Chart = browserOnly(() => <canvas />);'],
    ];
    for (const [label, files, head] of forms) {
      rmSync(tmpDir, { recursive: true, force: true });
      mkdirSync(tmpDir, { recursive: true });
      const { diagnostics, islands } = compile({
        ...files,
        'app.tsx': `${CORE}${head}
activateIslands({ Chart });
mount(() => <main><Chart /></main>, '#app');
`,
      });
      expect(diagnostics, label).toEqual([]);
      expect(islands.map((i) => i.name), label).toEqual(['Chart']);
    }
  });

  it('is an island at any depth, with any props, registered or not', () => {
    // Inlining stops at depth 3, and a component given a prop the compiler
    // cannot evaluate is not inlined: neither applies to a browser-only
    // component, which is never inlined. On a page with no registry (the
    // mount() path) it is still the island, named for its registration.
    const { diagnostics, islands } = compile({
      'chart.tsx': CHART,
      'app.tsx': `${CORE}import { Chart } from './chart';
function A() { return <section><B /></section>; }
function B() { return <article><C /></article>; }
function computeTitle() { return "t"; }
function C() { return <div><Chart title={computeTitle()} /></div>; }
mount(() => <main><A /></main>, '#app');
`,
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['BUILD-706']);
    expect(islands.map((i) => i.name)).toEqual(['Chart']);
  });

  it('changes nothing for a component not declared with it', () => {
    // A look-alike: a const initialized by another call stays a component the
    // compiler cannot find, reported and emitted as at 0.3.6.
    const { diagnostics, islands } = compile({
      'app.tsx': `${CORE}
function clientOnly(component: () => unknown) { return component; }
const Chart = clientOnly(() => <canvas />);
mount(() => <main><Chart /></main>, '#app');
`,
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['BUILD-402']);
    expect(islands.map((i) => i.name)).toEqual(['Chart']);
  });

  it('is not followed into a package', () => {
    const { diagnostics } = compile({
      'app.tsx': `${CORE}import { Chart } from 'some-chart-package';
mount(() => <main><Chart /></main>, '#app');
`,
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['BUILD-401']);
  });
});
