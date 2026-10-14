import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const tag = 'section';

mount(() => (
  <main>
    {h(tag, null, 'section body')}{/* expect: BUILD-103 */}
  </main>
), '#app');
