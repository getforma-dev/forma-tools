import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

mount(() => (
  <main>
    <div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />{/* expect: BUILD-205 */}
  </main>
), '#app');
