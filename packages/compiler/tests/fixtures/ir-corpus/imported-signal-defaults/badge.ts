// The registered island. It reads the SAME store signal the page reads, but
// through the aliasing barrel — and an island is walked with its own module
// scope, which is exactly where an imported signal used to be unreachable.
import { h } from 'formajs';
import { liveStatus } from './stores';

export function StatusBadge() {
  return h('i', { class: 'badge' }, () => liveStatus());
}
