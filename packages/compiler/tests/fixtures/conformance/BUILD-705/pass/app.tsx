import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const Guarded = browserOnly(() => createSuspense(() => <p>loading</p>, () => <p>loaded</p>));
activateIslands({ Guarded });

mount(() => (
  <main>
    <Guarded />
  </main>
), '#app');
