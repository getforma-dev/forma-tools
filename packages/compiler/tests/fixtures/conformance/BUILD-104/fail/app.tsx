import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
let rows = [{ name: 'a' }, { name: 'b' }];

mount(() => (
  <main>
    {h('ul', null, ...rows.map((r) => h('li', null, r.name)))}{/* expect: BUILD-104 */}
  </main>
), '#app');
