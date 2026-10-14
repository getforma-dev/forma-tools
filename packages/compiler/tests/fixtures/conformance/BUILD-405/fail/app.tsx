import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function computeTitle() { return 'Hi'; }
function Card(props: { title: string }) { return <h2>{props.title}</h2>; }

mount(() => (
  <main>
    <Card title={computeTitle()} />{/* expect: BUILD-405 */}
  </main>
), '#app');
