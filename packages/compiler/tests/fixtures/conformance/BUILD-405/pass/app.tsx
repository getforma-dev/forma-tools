import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Card(props: { title: string }) { return <h2>{props.title}</h2>; }

mount(() => (
  <main>
    <Card title="Hi" />
  </main>
), '#app');
