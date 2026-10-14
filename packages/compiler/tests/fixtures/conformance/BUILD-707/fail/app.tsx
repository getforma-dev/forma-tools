import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Panel() { return <span>panel</span>; }

mount(() => (
  <main>
    <div>{browserOnly(Panel)}</div>{/* expect: BUILD-707 */}
  </main>
), '#app');
