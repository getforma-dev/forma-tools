import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [isOpen] = createSignal(true);

mount(() => (
  <main>
    <div>{() => isOpen() ? <p>open</p> : <p>closed</p>}</div>
  </main>
), '#app');
