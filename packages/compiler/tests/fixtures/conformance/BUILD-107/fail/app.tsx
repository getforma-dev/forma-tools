import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const todos = () => [{ id: 1, title: 'a' }];

mount(() => (
  <main>
    <ul>{createList(todos, (r) => r.id)}</ul>{/* expect: BUILD-107 */}
  </main>
), '#app');
