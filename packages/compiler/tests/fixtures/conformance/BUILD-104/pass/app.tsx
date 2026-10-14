import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const ROWS = [{ name: 'a' }, { name: 'b' }];

mount(() => (
  <main>
    {h('ul', null, ...ROWS.map((r) => h('li', null, r.name)))}
  </main>
), '#app');
