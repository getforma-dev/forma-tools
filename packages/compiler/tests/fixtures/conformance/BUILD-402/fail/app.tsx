import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function makeWidget(label: string) { return () => <span>{label}</span>; }
const Widget = makeWidget('w');

mount(() => (
  <main>
    <div><Widget /></div>{/* expect: BUILD-402 */}
  </main>
), '#app');
