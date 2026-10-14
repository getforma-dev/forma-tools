// A textarea bound through its `value` prop. Audit verification run 2 (extra
// variant): the server writes a value="" attribute, which a textarea ignores,
// so it is empty before JavaScript; at the pinned core the binding never
// reaches the live control, even client-rendered.
import { h, mount, createSignal } from '@getforma/core';

const [text, setText] = createSignal('hello');

mount(() => (
  <main>
    <form id="f">
      <textarea id="ta" name="ta" value={() => text()}></textarea>
    </form>
    <button id="update" onClick={() => setText('updated')}>update</button>
  </main>
), '#app');
