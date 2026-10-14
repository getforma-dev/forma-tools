import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
let caption = 'Hello';

mount(() => (
  <main>
    <p>{caption}</p>{/* expect: BUILD-102 */}
  </main>
), '#app');
