import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [href] = createSignal('/docs');

mount(() => (
  <main>
    <a href={() => href()}>Docs</a>
  </main>
), '#app');
