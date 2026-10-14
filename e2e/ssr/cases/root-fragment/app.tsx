// A page whose root is a JSX Fragment. Audit verification run 1: the server
// renders it, activation removes data-forma-ssr, and the button does nothing;
// client-rendered, the same page works.
import { h, Fragment, mount, createSignal } from '@getforma/core';

const [note, setNote] = createSignal('hello');

mount(() => (
  <>
    <span id="note">{() => note()}</span>
    <button id="go" onClick={() => setNote('bye')}>go</button>
  </>
), '#app');
