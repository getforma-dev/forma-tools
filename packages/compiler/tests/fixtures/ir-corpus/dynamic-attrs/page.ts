import { h, createSignal } from 'formajs';

// Module-scope signals: the root-component path only reads createSignal calls
// declared INSIDE the exported component, so these deliberately do not become
// named signal slots — every dynamic attribute below mints its own attr:* slot.
const [busy] = createSignal(false);
const [tone] = createSignal('calm');
const [query] = createSignal('');

const docsHref = () => '/docs';

export function AttrsPage() {
  return h('section', { id: 'app' },
    h('div', { class: () => busy() ? 'row busy' : 'row', 'data-role': 'primary' }, 'first'),
    h('div', { class: () => tone() + ' row' }, 'second'),
    h('input', { type: 'search', placeholder: 'Filter', value: () => query() }),
    h('a', { href: () => docsHref(), title: 'Docs' }, 'Docs'),
  );
}
