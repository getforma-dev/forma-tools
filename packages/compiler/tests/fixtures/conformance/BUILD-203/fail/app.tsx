import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const attrName = 'title';

mount(() => (
  <main>
    {h('div', { [attrName]: 'v' }, 'x')}{/* expect: BUILD-203 */}
  </main>
), '#app');
