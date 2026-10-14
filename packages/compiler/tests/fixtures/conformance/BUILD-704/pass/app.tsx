import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const Guarded = browserOnly(() => createPortal(() => <p>overlay</p>, document.body));
activateIslands({ Guarded });

mount(() => (
  <main>
    <Guarded />
  </main>
), '#app');
