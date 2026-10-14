import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

mount(() => (
  <main>
    {createErrorBoundary(() => <p>ok</p>, () => <p>failed</p>)}{/* expect: BUILD-702 */}
  </main>
), '#app');
