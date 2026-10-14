import { h, mount, createSignal } from '@getforma/core';

const [mode] = createSignal('a');
if (Math.random() > 2) {
  const [mode] = createSignal('a');
  void mode;
}

mount(() => h('main', null, h('p', null, () => mode())), '#app');
