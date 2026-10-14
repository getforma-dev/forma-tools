import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
import { Fancy } from 'fixture-fancy-ui';

mount(() => (
  <main>
    <div><Fancy /></div>{/* expect: BUILD-401 */}
  </main>
), '#app');
