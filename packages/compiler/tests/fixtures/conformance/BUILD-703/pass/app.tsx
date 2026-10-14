import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [tab] = createSignal('a');
const Guarded = browserOnly(() => createSwitch(() => tab(), [{ match: 'a', render: () => <p>a</p> }]));
activateIslands({ Guarded });

mount(() => (
  <main>
    <Guarded />
  </main>
), '#app');
