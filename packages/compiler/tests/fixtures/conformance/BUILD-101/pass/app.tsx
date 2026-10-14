import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Extra() { return <em>extra</em>; }

mount(() => (
  <main>
    <div>{Extra()}</div>
  </main>
), '#app');
