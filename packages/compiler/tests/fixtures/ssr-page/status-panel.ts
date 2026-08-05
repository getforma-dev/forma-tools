// Island component: registered in activateIslands(), so it must emit
// ISLAND_START/ISLAND_END around its walked subtree rather than being inlined.
import { h, createSignal } from 'formajs';

const [statusText] = createSignal('idle');

export function StatusPanel() {
  return h('aside', { class: () => panelClass() },
    h('strong', null, () => statusText()),
  );
}
