import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const Chart = browserOnly((props: { title?: string }) => <canvas aria-label={props.title} />);
activateIslands({ Chart });

mount(() => (
  <main>
    <Chart title="Sales" />
  </main>
), '#app');
