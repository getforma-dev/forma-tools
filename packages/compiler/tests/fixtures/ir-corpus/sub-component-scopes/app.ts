// Corpus case: signals declared in the scopes the walk INLINES.
//
// Every other case declares its signals where the old hand-written extractors
// happened to look: the root component's body, or a registered island's file.
// This one declares them in the four places they were NOT looked for, all of
// which end up in the page's markup all the same:
//
//   1. the ROOT PAGE FILE's module scope        (`heading`)
//   2. an inlined FILE-LOCAL sub-component's body (`count`, `ready` in Card)
//   3. an inlined CROSS-FILE sub-component's module scope (`count`, `open`
//      in panel.ts — a plain component, not an island)
//   4. below the top level of a scope, inside an `if` block (`note`)
//
// Before the walk drove extraction, every one of those bindings compiled to an
// anonymous `text:`/`attr:` slot with no default, so the server rendered a
// zero-width space where the client renders text, omitted attributes the client
// sets, and — worst — rendered the ELSE branch of `createShow(() => open())`
// for a signal whose default is `true`. Hydration does not repair that last
// one: both branches produce content, so neither mismatch-repair arm fires and
// the page shows the wrong branch until the signal changes value.
//
// The case also pins the COLLISION rule: `Card` and `panel.ts` each declare a
// `count`, they are different signals at runtime, and they get `count` and
// `count#2` — one slot each, carrying their own defaults.
import { mount } from 'formajs';
import { ScopesPage } from './page';

mount(() => ScopesPage(), '#app');
