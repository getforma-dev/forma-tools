// A select bound to its second option. Audit verification run 3: the server
// writes value="b" on the select, which HTML ignores, and marks no option
// selected, so before JavaScript `a` is selected and submitted. At the pinned
// core the binding never reaches the live control either.
import { h, mount, createSignal } from '@getforma/core';

const [choice, setChoice] = createSignal('b');

mount(() => (
  <main>
    <form id="f">
      <select id="choice" name="choice" value={() => choice()}>
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
    </form>
    <button id="pick-c" onClick={() => setChoice('c')}>pick c</button>
  </main>
), '#app');
