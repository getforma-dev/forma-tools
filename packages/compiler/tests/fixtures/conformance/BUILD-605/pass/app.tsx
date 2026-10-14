import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

const A = '0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789';
const B = A + A + A + A + A + A + A + A + A + A;
const C = B + B + B + B + B + B + B + B + B + B;
export const D = C + C + C + C + C + C;

mount(() => (
  <main>
    <p>short</p>
  </main>
), '#app');
