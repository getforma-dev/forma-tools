import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';

function A() { return <section><B /></section>; }
function B() { return <article><C /></article>; }
function C() {
  return (
    <div>
      <D />{/* expect: BUILD-403 */}
    </div>
  );
}
function D() { return <span>leaf</span>; }

mount(() => (
  <main>
    <A />
  </main>
), '#app');
