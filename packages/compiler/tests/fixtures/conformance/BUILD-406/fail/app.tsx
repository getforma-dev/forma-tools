import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Empty() { const label = 'x'; void label; }

mount(() => (
  <main>
    <Empty />{/* expect: BUILD-406 */}
  </main>
), '#app');
