import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [tab] = createSignal('a');

mount(() => (
  <main>
    {createSwitch(() => tab(), [{ match: 'a', render: () => <p>a</p> }])}{/* expect: BUILD-703 */}
  </main>
), '#app');
