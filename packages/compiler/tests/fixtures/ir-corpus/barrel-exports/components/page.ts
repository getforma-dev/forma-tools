import { h, createSignal } from 'formajs';
// The page imports its siblings back THROUGH the barrel — the circular-looking
// shape every barrelled component directory has. Resolution must terminate:
// index re-exports './page', and './page' imports index again.
import { Tag, StatusChip } from './index';

export function BarrelPage() {
  const [heading] = createSignal('Fleet');

  return h('main', { id: 'app' },
    h('h1', null, () => heading()),
    // Inlined through `export * from './tag'`.
    Tag({ label: 'stable' }),
    // An ISLAND reached through an ALIASED re-export: the barrel exports it as
    // `StatusChip`, but the file declares it as `StatusChipImpl`. Looking up
    // 'StatusChip' in status-chip.ts finds nothing — the alias has to be
    // followed to the real declaration.
    StatusChip(),
  );
}
