import { h, createSignal } from 'formajs';

const [headline] = createSignal('Today');
const [subhead] = createSignal('in review');
const [count] = createSignal(0);
const [badge] = createSignal('new');

export function TextPage() {
  return h('section', { id: 'app' },
    // Two dynamic text children at child index 0 under different parents.
    h('h1', null, () => headline()),
    h('h2', null, () => subhead()),
    // A dynamic text child at index 1, after a static text sibling.
    h('p', null, 'open issues: ', () => count()),
    // Back to index 0, with a static sibling after it.
    h('span', null, () => badge(), ' items'),
  );
}
