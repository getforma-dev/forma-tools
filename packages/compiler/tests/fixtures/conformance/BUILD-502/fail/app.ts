import { h, mount, createSignal } from '@getforma/core';

const [mode] = createSignal('a');
if (Math.random() > 2) {
  const [mode] = createSignal('b'); // expect: BUILD-502
  void mode;
}

mount(() => h('main', null, h('p', null, () => mode())), '#app');
