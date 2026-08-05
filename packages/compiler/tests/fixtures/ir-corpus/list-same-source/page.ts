import { h, createList } from 'formajs';

const todos = [
  { id: 1, title: 'Write the corpus', owner: 'ada' },
  { id: 2, title: 'Feed it to Rust', owner: 'grace' },
];

export function ListPage() {
  return h('section', { id: 'app' },
    // First list over `todos`: mints list:todos:array (TYPE_ARRAY),
    // list:todos:item (TYPE_OBJECT) and one TYPE_TEXT slot per property the
    // body reads, each filled by a PROP opcode at the top of the row body.
    h('ul', { class: 'todos' },
      createList(todos, (t) => t.id, (t) => h('li', { class: 'todo' }, t.title)),
    ),
    // The SAME source again. Both derive the base name `todos`, so this one
    // must be minted under `todos#2` — and it reads a different property set,
    // so a base-name collision would also cross-wire the PROP targets.
    h('ol', { class: 'recap' },
      createList(todos, (t) => t.id, (t) => h('li', null, t.owner, ' - ', t.title)),
    ),
  );
}
