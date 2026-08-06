// The registered island. Every table it spreads is declared somewhere else.
//
// An island is walked with its OWN module scope — that is what makes a signal
// declared here into a named page slot — and it is exactly why an imported
// table was unreachable from in here: the constants extracted for this walk
// are this file's, and this file declares none.
import { h, createSignal } from 'formajs';
import { KEYS } from './page';
import { MODIFIERS } from './vocabulary';

const [selected] = createSignal('A');

export function KeyPicker() {
  return h('form', { class: 'picker', method: 'post' },
    h('select', { name: 'key', 'data-selected': () => selected() },
      // Cross-file, through the inert page↔island cycle.
      h('optgroup', { label: 'Keys' },
        ...KEYS.map((ko) => h('option', null, ko.k)),
      ),
      // Cross-file, through a barrel that ALIASES the export.
      h('optgroup', { label: 'Modifiers' },
        ...MODIFIERS.map((mo) => h('option', { value: mo.code }, mo.k)),
      ),
    ),
    h('button', { type: 'submit' }, 'Bind'),
  );
}
