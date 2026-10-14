import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function loadRows() { return 'r'; }
const [rows] = createSignal(loadRows()); // expect: BUILD-501
void rows;

mount(() => (
  <main>
    <p>static</p>
  </main>
), '#app');
