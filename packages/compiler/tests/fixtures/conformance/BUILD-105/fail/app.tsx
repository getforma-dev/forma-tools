import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
import { ROWS } from 'fixture-rows-package';

mount(() => (
  <main>
    {h('ul', null, ...ROWS.map((r) => h('li', null, r.name)))}{/* expect: BUILD-105 */}
  </main>
), '#app');
