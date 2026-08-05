import { h, createSignal } from 'formajs';

// Module-scope signals: the root-component path only reads createSignal calls
// declared INSIDE the exported component, so these deliberately do not become
// named signal slots — every dynamic attribute below mints its own attr:* slot.
const [busy] = createSignal(false);
const [tone] = createSignal('calm');
const [query] = createSignal('');

const docsHref = () => '/docs';

export function AttrsPage() {
  // Component-scope signals DO become named slots, and a dynamic attribute
  // whose body is a bare signal call reuses that slot rather than minting an
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
