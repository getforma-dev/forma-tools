import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [count] = createSignal(3);

mount(() => (
  <main>
    <p>{() => count() + ' items'}</p>
  </main>
), '#app');
