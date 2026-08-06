/**
 * Emit the FMIR cross-implementation contract corpus.
 *
 * Runs the REAL compiler (`generateRealIr`, the same entry point the esbuild
 * SSR plugin calls for a production page) over every case in
 * `tests/fixtures/ir-corpus/` and writes `<case>.ir` — the exact bytes a build
 * would ship — into the output directory.
 *
 * The `.ir` files are the input to `crates/forma-ir/tests/js_emitter_contract.rs`
 * in the `forma` repo, which parses and renders them with the real Rust
 * consumer. That is the only check on this emitter that is not written from
 * the emitter's own mental model.
 *
 * Usage:
 *   npm run emit:corpus                # -> packages/compiler/ir-corpus/
 *   npm run emit:corpus -- <out-dir>   # -> <out-dir>/
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateRealIr } from '../dist/index.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(scriptDir, '../tests/fixtures/ir-corpus');
const DEFAULT_OUT_DIR = resolve(scriptDir, '../ir-corpus');

/** Island names the emitter mints when it does NOT understand a construct: an
 *  unresolvable subtree becomes `island_<id>` and a createList it cannot walk
 *  becomes `createList` (ir-walk.ts `emitIsland`). Either one means the case
 *  silently degraded to a client-rendered stub and stopped exercising the
 *  opcode it was written for — a downstream golden would happily pin the
 *  empty `<div>` shell instead. */
function isFallbackIslandName(name) {
  return name === 'createList' || /^island_\d+$/.test(name);
}

const outDir = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : DEFAULT_OUT_DIR;

if (!existsSync(CORPUS_DIR)) {
  console.error(`emit:corpus: corpus directory not found: ${CORPUS_DIR}`);
  process.exit(1);
}

const cases = readdirSync(CORPUS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (cases.length === 0) {
  console.error(`emit:corpus: no cases in ${CORPUS_DIR}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

let failed = 0;

for (const name of cases) {
  // A real JSX project's entry point is `app.tsx`, and that extension is the
  // ONLY thing that makes the compiler run esbuild over it — which is what
  // rewrites `export function Page()` into the specifier form the analyzer has
  // to resolve. A corpus that could only hold `app.ts` could not cover it.
  const entryPoint = ['app.ts', 'app.tsx']
    .map((f) => join(CORPUS_DIR, name, f))
    .find((p) => existsSync(p));
  if (!entryPoint) {
    console.error(`  FAIL ${name}: no app.ts or app.tsx entry point`);
    failed++;
    continue;
  }

  let result;
  try {
    result = generateRealIr(entryPoint);
  } catch (err) {
    console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
    continue;
  }

  if (!result) {
    // The plugin would fall back to placeholder IR here. A corpus case that
    // compiles to a placeholder pins nothing.
    console.error(`  FAIL ${name}: generateRealIr returned null (would fall back to placeholder IR)`);
    failed++;
    continue;
  }

  const degraded = result.islands
    .map((i) => i.name)
    .filter(isFallbackIslandName);
  if (degraded.length > 0) {
    console.error(`  FAIL ${name}: emitter fell back to client islands for ${degraded.join(', ')}`);
    failed++;
    continue;
  }

  writeFileSync(join(outDir, `${name}.ir`), result.binary);
  const islands = result.islands.length === 0
    ? 'no islands'
    : result.islands.map((i) => `${i.id}:${i.name}`).join(', ');
  console.log(`  ok   ${name}.ir  ${result.binary.length} bytes  (${islands})`);
}

console.log(`emit:corpus: ${cases.length - failed}/${cases.length} cases -> ${outDir}`);

if (failed > 0) process.exit(1);
