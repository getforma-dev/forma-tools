import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function isOpen() { return true; }

mount(() => (
  <main>
    <div>{() => isOpen() ? <p>open</p> : <p>closed</p>}</div>{/* expect: BUILD-302 */}
  </main>
), '#app');
