import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

mount(() => (
  <main>
    {h('div', { title() { return 'x'; } }, 'y')}{/* expect: BUILD-204 */}
  </main>
), '#app');
