import { h, createSignal } from 'formajs';
// The page imports the island; the island imports the tables below back out of
// this file. That cycle is INERT — nothing touches the arrays until the island
// renders — and it is the shape a compile-time twin always has.
import { KeyPicker } from './picker';

// Declared bare and exported by specifier at the bottom of the file. This is
// the form a page module uses when its markup lives elsewhere, and it is
// neither `export const` (which a declaration scan finds) nor a re-export
// (which the barrel path finds): the local binding has to be matched to the
// specifier that exports it.
const KEYS = [
  { k: 'A' },
  { k: 'B' },
  // A row whose value needs escaping in text position, so the unroll cannot
  // quietly stop being HTML-safe.
  { k: '<F1>' },
];

// A table read in ATTRIBUTE position as well as child position. Substitution
// used to descend into children only, so an imported row's attributes would
// come out empty even once the table itself resolved.
const ZONES = [
  { id: 'left', label: 'Left stick', span: 2 },
  { id: 'right', label: 'Right stick', span: 1 },
];

export { KEYS, ZONES };

export function KeyPage() {
  const [heading] = createSignal('Bindings');

  return h('main', { id: 'app' },
    h('h1', null, () => heading()),
    // The page spreads an imported table too — the defect was never specific
    // to islands, it just cost the most there.
    h('ul', { class: 'zones' },
      ...ZONES.map((z) => h('li', { 'data-zone': z.id, 'data-span': z.span }, z.label)),
    ),
    KeyPicker(),
  );
}
