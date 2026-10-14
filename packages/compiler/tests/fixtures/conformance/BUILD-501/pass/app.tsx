import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [rows] = createSignal('r');
void rows;

mount(() => (
  <main>
    <p>static</p>
  </main>
), '#app');
