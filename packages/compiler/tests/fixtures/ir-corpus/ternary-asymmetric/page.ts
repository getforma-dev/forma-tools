import { h, createSignal } from 'formajs';

const [expanded] = createSignal(false);
const [compact] = createSignal(true);

export function TernaryPage() {
  return h('section', { id: 'app' },
    // Long then-branch, one-byte-payload else-branch.
    h('div', { class: 'detail' }, () => expanded()
      ? h('article', { class: 'body' },
          h('h2', null, 'Details'),
          h('p', null, 'The expanded branch carries several nested elements.'),
        )
      : 'collapsed'),
    // The mirror image: short then-branch, long else-branch.
    h('div', { class: 'mode' }, () => compact()
      ? 'compact'
      : h('span', { class: 'roomy' },
          h('b', null, 'roomy'),
          h('i', null, 'layout'),
        )),
  );
}
