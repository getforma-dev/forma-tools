import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
import { Fancy } from './fancy';

mount(() => (
  <main>
    <div><Fancy /></div>
  </main>
), '#app');
