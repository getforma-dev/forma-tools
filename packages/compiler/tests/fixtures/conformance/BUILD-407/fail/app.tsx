import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
function Card() { return <div class="card">card</div>; }

mount(() => (
  <main>
    <Card><b>bold</b></Card>{/* expect: BUILD-407 */}
  </main>
), '#app');
