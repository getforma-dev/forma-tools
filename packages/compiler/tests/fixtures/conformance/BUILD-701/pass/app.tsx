import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const rows = () => [{ id: 1, name: 'a' }];

mount(() => (
  <main>
    <ul>{createList(rows, (r) => r.id, (r) => <li>{r.name}</li>)}</ul>
  </main>
), '#app');
