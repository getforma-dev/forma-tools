import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const rest = { id: 'a' };

mount(() => (
  <main>
    <div {...rest}>x</div>{/* expect: BUILD-202 */}
  </main>
), '#app');
