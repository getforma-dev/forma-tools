import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Panel() { return <span>panel</span>; }
const Wrapped = browserOnly(Panel);
activateIslands({ Wrapped });

mount(() => (
  <main>
    <div><Wrapped /></div>
  </main>
), '#app');
