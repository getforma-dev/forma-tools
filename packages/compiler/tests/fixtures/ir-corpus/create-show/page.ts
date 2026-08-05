import { h, createSignal, createShow } from 'formajs';

const [visible] = createSignal(true);
const [ready] = createSignal(false);

export function ShowPage() {
  return h('section', { id: 'app' },
    createShow(() => visible(),
      () => h('p', { class: 'on' }, 'shown'),
      () => h('p', { class: 'off' }, 'hidden'),
    ),
    // Same condition again — a second `show:visible` slot name would collide.
    createShow(() => visible(),
      () => h('b', null, 'and again'),
    ),
    // Negated condition: the base name unwraps the `!`.
    createShow(() => !ready(),
      () => h('em', null, 'waiting'),
      () => h('strong', null, 'ready'),
    ),
  );
}
