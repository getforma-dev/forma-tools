import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

mount(() => (
  <main>
    {createSuspense(() => <p>loading</p>, () => <p>loaded</p>)}{/* expect: BUILD-705 */}
  </main>
), '#app');
