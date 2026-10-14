import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Tree() {
  return <ul><Tree /></ul>; // expect: BUILD-404
}

mount(() => (
  <main>
    <Tree />
  </main>
), '#app');
