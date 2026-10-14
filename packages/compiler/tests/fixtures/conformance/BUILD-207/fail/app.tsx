import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function lookupName() { return 'pad'; }

mount(() => (
  <main>
    <button title={'Enable ' + lookupName()}>Go</button>{/* expect: BUILD-207 */}
  </main>
), '#app');
