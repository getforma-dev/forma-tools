import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Leaf() { return <li>leaf</li>; }
function Tree() {
  return <ul><Leaf /></ul>;
}

mount(() => (
  <main>
    <Tree />
  </main>
), '#app');
