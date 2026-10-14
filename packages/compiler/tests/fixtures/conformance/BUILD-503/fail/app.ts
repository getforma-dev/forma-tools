import { h, mount, createSignal } from '@getforma/core';

const [count] = createSignal(1);

function Panel() {
  const [count] = createSignal(7); // expect: BUILD-503
  return h('span', null, () => count());
}

mount(() => h('main', null, h('p', null, () => count()), Panel()), '#app');
