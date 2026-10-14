import { h, mount, createSignal, createList } from '@getforma/core';
import { rows } from './store';

const [items] = createSignal([{ id: 1, n: 'alpha' }, { id: 2, n: 'beta' }]); // expect: BUILD-504

mount(() => (
  <main>
    <ul>{createList(items, (r) => r.id, (r) => <li>{r.n}</li>)}</ul>{/* expect: BUILD-303 */}
    <ol>{createList(() => rows(), (r) => r.id, (r) => <li>{r.n}</li>)}</ol>{/* expect: BUILD-303 */}
  </main>
), '#app');
