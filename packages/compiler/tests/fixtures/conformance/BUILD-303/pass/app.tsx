import { h, mount, createSignal, createList } from '@getforma/core';
import { rows } from './store';

// Both sides start empty; the server fills the list by its slot name.
const [items] = createSignal([] as Array<{ id: number; n: string }>); // expect: BUILD-504

mount(() => (
  <main>
    <ul>{createList(items, (r) => r.id, (r) => <li>{r.n}</li>)}</ul>
    <ol>{createList(() => rows(), (r) => r.id, (r) => <li>{r.n}</li>)}</ol>
  </main>
), '#app');
