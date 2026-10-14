import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const props = { id: 'a' };

mount(() => (
  <main>
    {h('div', props, 'x')}{/* expect: BUILD-201 */}
  </main>
), '#app');
