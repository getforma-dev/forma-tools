import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
import { LiveChart } from './live-chart';
activateIslands({ LiveChart });

mount(() => (
  <main>
    <LiveChart />
  </main>
), '#app');
