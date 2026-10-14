import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const items = ['a', 'b'];

mount(() => (
  <main>
    <ul>{items.map((i) => <li>{i}</li>)}</ul>{/* expect: BUILD-701 */}
    <ol>{() => items.map((i) => <li>{i}</li>)}</ol>{/* expect: BUILD-701 */}
  </main>
), '#app');
