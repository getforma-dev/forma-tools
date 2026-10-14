import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [name] = createSignal('pad');

mount(() => (
  <main>
    <button title={'Enable ' + name()}>Go</button>
  </main>
), '#app');
