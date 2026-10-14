import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Empty() { const label = 'x'; void label; return <span>x</span>; }

mount(() => (
  <main>
    <Empty />
  </main>
), '#app');
