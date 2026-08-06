// Island component containing another island.
import { h, createSignal } from 'formajs';
import { InnerBadge } from './inner-badge';

const [panelTitle] = createSignal('Panel');

export function OuterPanel() {
  // The shell element opens BEFORE the nested island starts: an island whose
  // body reaches another ISLAND_START first has no element to carry its own
  // data-forma-* attributes, and the walker refuses to render that rather
  // than shipping an island that can never hydrate.
  return h('div', { class: () => panelClass() },
    h('h3', null, () => panelTitle()),
    InnerBadge(),
  );
}
