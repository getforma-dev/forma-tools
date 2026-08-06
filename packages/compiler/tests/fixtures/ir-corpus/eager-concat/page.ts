import { h, createSignal } from 'formajs';

// A string signal and a NUMERIC one. The numeric default is what makes the
// multi-operand concatenation below a real test: an evaluator that worked in
// strings would render "Slot 3 ready" too, but one that lost the type renders
// "Slot [object Object] ready" or drops the operand entirely.
const [name] = createSignal('Xbox');
const [count] = createSignal(3);

export function ConcatPage() {
  return h('section', { id: 'app' },
    // CHILD position: the reported defect. Used to be ISLAND_START/ISLAND_END
    // around an empty <div> — nothing server-side until the bundle hydrated.
    h('span', null, 'Player ' + name()),

    // ATTRIBUTE position: the silent half. `title` shipped with no value.
    h('button', { title: 'Enable ' + name(), type: 'button' }, 'Enable'),

    // Multi-operand, mixing a string literal and a NUMBER on both sides of
    // the numeric operand, in both positions.
    h('b', { title: 'Slot ' + count() + ' ready' }, 'ok'),
    h('p', null, 'Slot ' + count() + ' of 8'),

    // The folded child sits BETWEEN two static text siblings, so the goldens
    // pin its position in the stream, not just its content.
    h('em', null, 'before ', 'Player ' + name(), ' after'),
  );
}
