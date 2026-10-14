import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
import { LiveChart } from 'fixture-charts';
activateIslands({ LiveChart });

mount(() => (
  <main>
    <LiveChart />{/* expect: BUILD-408 */}
  </main>
), '#app');
