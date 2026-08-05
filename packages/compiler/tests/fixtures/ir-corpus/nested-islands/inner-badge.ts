// Island component used twice: once nested inside OuterPanel, once at page
// level. Two island entries, one component name, one shared string-table entry.
import { h, createSignal } from 'formajs';

const [badgeLabel] = createSignal('beta');

export function InnerBadge() {
  return h('span', { class: 'badge', title: () => badgeTitle() },
    () => badgeLabel(),
  );
}
