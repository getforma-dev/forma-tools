import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const Chart = browserOnly(() => <canvas />);
function Other() { return <aside>other</aside>; }
activateIslands({ Other });

mount(() => (
  <main>
    <Chart />{/* expect: BUILD-708 */}
    <Other />
  </main>
), '#app');
