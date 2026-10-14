import { h, mount, createSignal } from '@getforma/core';

const [count] = createSignal(1);

function Panel() {
  const [panelCount] = createSignal(7);
  return h('span', null, () => panelCount());
}

mount(() => h('main', null, h('p', null, () => count()), Panel()), '#app');
