import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [open] = createSignal(true);

mount(() => (
  <main>
    {createShow(() => open(), () => <p>open</p>, () => <p>closed</p>)}
  </main>
), '#app');
