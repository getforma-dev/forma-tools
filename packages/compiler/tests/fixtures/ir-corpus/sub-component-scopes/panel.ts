// Scope 3: an inlined CROSS-FILE sub-component's module scope.
//
// This file is a plain component, NOT a registered island — which is the whole
// point. `barrel-exports` reads its chip's module scope only because that chip
// is in the `activateIslands` registry, and the extractor had a method for
// island files. Nothing had a method for this file.
import { h, createSignal, createShow } from 'formajs';

// A SECOND `count`, deliberately: `Card` in page.ts declares one too. They are
// different signals at runtime and must not share a slot, so the second one
// the walk reaches becomes `count#2` — and the compiler says so at build time,
// because injecting `count` would otherwise silently fill only the first.
const [count] = createSignal(7);
const [open] = createSignal(true);

export function Panel() {
  return h('section', { class: () => open() ? 'panel is-open' : 'panel is-closed' },
    // The critical case. A TRUTHY show default rendered the ELSE branch
    // server-side, and hydration adopted it silently: both branches produce a
    // <p>, so the tags match, `adoptNode` takes the server's element, and the
    // static class and text are never rewritten. The page showed `is-closed`
    // content while `open()` was `true`, with no warning from either side,
    // until the signal changed value.
    createShow(() => open(),
      () => h('p', { class: 'on' }, 'THEN'),
      () => h('p', { class: 'off' }, 'ELSE'),
    ),
    h('b', null, () => count()),
  );
}
