import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [rows] = createSignal([] as Array<{ id: number; name: string }>); // expect: BUILD-504

mount(() => (
  <main>
    <ul>{createList(rows, (r) => r.id, (r) => <li>{r.name}</li>)}</ul>
  </main>
), '#app');
