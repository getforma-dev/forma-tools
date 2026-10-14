import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const Guarded = browserOnly(() => createErrorBoundary(() => <p>ok</p>, () => <p>failed</p>));
activateIslands({ Guarded });

mount(() => (
  <main>
    <Guarded />
  </main>
), '#app');
