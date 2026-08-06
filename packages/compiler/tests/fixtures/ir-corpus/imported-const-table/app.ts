// Corpus case: Rule 9's static spread unroll over a table declared in ANOTHER
// module — including inside an island, which is where it mattered most.
//
// `...CONST.map(item => h(…))` is the compiler's escape hatch for a large
// static vocabulary: it expands at BUILD time into plain markup, which is what
// makes a 122-option <select> affordable on a page that has twenty-five of
// them and must still work with JavaScript off.
//
// The tables were only ever visible when they were declared in the module the
// walk happened to be in. `fileConstants` is re-extracted per resolved file —
// correct, and the reason an IMPORTED table was invisible — so a spread over
// one degraded to an empty island shell: nothing server-side, nothing at all
// without JavaScript, and the build said only "use createList for runtime
// data" about a table that was as static as data gets.
//
// ksx's map route hit this 34 times on one page. The shape here is that shape,
// minus the size:
//
//   * `page.ts` declares the tables as bare `const` + `export { … }` at the
//     bottom — the form a compile-time twin uses, and neither `export const`
//     nor a re-export.
//   * `picker.ts` is a REGISTERED ISLAND that imports those tables back from
//     the page module. The import cycle that creates is inert (nothing reads
//     the arrays at module init) and resolution must not trip on it.
//   * `vocabulary/index.ts` forwards a third table with `export { X as Y }
//     from './modifiers'`, so an aliased cross-file re-export is covered too.
//
// The golden is the assertion: every `<option>` and every `<li>` below is
// static markup emitted server-side. If the resolution regresses, the island's
// whole subtree collapses to `<div data-forma-island>` with nothing in it, and
// `resolution_cases_ship_named_islands_over_named_slots` fails on the minted
// `island_<n>` before the golden diff is even read.
import { mount, activateIslands } from 'formajs';
import { KeyPage } from './page';
import { KeyPicker } from './picker';

activateIslands({ KeyPicker });

mount(() => KeyPage(), '#app');
