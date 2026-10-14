import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

const A = '0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789';
const B = A + A + A + A + A + A + A + A + A + A;
const C = B + B + B + B + B + B + B + B + B + B;

mount(() => (
  <main>
    <p>{C + C + C + C + C + C + C}</p>{/* expect: BUILD-604 */}
  </main>
), '#app');
