import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Card(props: { label: string }) { return <div class="card">{props.label}</div>; }

mount(() => (
  <main>
    <Card label="bold" />
  </main>
), '#app');
