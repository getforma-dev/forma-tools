import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

function A() { return <section><B /></section>; }
function B() { return <article><C /></article>; }
function C() {
  return (
    <div>
      <span>leaf</span>
    </div>
  );
}

mount(() => (
  <main>
    <A />
  </main>
), '#app');
