import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Widget() { return <span>w</span>; }

mount(() => (
  <main>
    <div><Widget /></div>
  </main>
), '#app');
