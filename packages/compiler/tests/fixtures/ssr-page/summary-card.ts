// Plain sub-component: inlined into the page IR (no island markers).
import { h } from 'formajs';

export function SummaryCard() {
  return h('article', { class: 'summary' },
    h('h2', null, 'Summary'),
    h('p', { class: () => tone() }, 'All systems nominal'),
  );
}
