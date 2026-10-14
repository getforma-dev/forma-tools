import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [count] = createSignal(3);
function format(n: number) { return `${n} items`; }

mount(() => (
  <main>
    <p>{() => format(count())}</p>{/* expect: BUILD-301 */}
  </main>
), '#app');
