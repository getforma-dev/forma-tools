import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const rows = () => [1, 2, 3];
const Chart = browserOnly((props: { data?: number[] }) => <canvas data-n={String(props.data?.length)} />);
activateIslands({ Chart });

mount(() => (
  <main>
    <Chart data={rows()} />{/* expect: BUILD-706 */}
  </main>
), '#app');
