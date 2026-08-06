import { h, createSignal } from 'formajs';

// Module-scope signals of the ROOT PAGE file. These are named slots carrying
// their defaults, so the two `class` attributes below can be EVALUATED at
// compile time ("row" and "calm row") instead of shipping empty. `query` is
// bound bare by the `value` attribute, so that binding reuses the `query` slot
// and mints no `attr:value` name at all.
const [busy] = createSignal(false);
const [tone] = createSignal('calm');
const [query] = createSignal('');

// NOT a signal — a plain module arrow. Nothing can evaluate it at compile
// time, so `href` ships empty and the compiler warns; this case is here to
// keep an un-evaluable dynamic attribute in the corpus.
const docsHref = () => '/docs';

export function AttrsPage() {
  // Component-scope signals are named too, and a dynamic attribute whose body
  // is a bare signal call reuses that slot rather than minting an
  // attr:* one. That is the only way the corpus gets a DYN_ATTR over a
  // TYPE_BOOL slot — which is where the two implementations have to agree that
  // an HTML boolean attribute is ON whenever it is present: true emits the
  // bare name, false omits the attribute entirely. `disabled="false"` is a
  // DISABLED control, so getting this wrong ships a dead form to every visitor
  // until hydration un-breaks it, and forever with JS off.
  const [disabled] = createSignal(true);
  const [hidden] = createSignal(false);

  return h('section', { id: 'app' },
    h('div', { class: () => busy() ? 'row busy' : 'row', 'data-role': 'primary' }, 'first'),
    h('div', { class: () => tone() + ' row' }, 'second'),
    h('input', { type: 'search', placeholder: 'Filter', value: () => query() }),
    h('a', { href: () => docsHref(), title: 'Docs' }, 'Docs'),
    h('button', { type: 'submit', disabled: () => disabled() }, 'Apply'),
    h('p', { hidden: () => hidden(), class: 'note' }, 'Both polarities, one page.'),
  );
}
