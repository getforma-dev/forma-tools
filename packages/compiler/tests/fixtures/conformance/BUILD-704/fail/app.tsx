import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

mount(() => (
  <main>
    {createPortal(() => <p>overlay</p>, document.body)}{/* expect: BUILD-704 */}
  </main>
), '#app');
