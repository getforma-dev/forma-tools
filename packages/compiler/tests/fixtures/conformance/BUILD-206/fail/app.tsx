import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function docsHref() { return '/docs'; }

mount(() => (
  <main>
    <a href={() => docsHref()}>Docs</a>{/* expect: BUILD-206 */}
  </main>
), '#app');
