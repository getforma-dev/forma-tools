import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const Chart = browserOnly(() => <canvas />);
function Other() { return <aside>other</aside>; }
activateIslands({ Other, Chart });

mount(() => (
  <main>
    <Chart />
    <Other />
  </main>
), '#app');
