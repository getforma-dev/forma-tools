import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [caption] = createSignal('Hello');

mount(() => (
  <main>
    <p>{() => caption()}</p>
  </main>
), '#app');
