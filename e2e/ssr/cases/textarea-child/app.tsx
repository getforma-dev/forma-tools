// A textarea whose content is a reactive child. Audit verification run 2: the
// walker writes its f:t markers inside the textarea, where HTML parses them as
// text, so before JavaScript the value (and what a form submits) is
// `<!--f:t0-->hello<!--/f:t0-->`.
import { h, mount, createSignal } from '@getforma/core';

const [text, setText] = createSignal('hello');

mount(() => (
  <main>
    <form id="f">
      <textarea id="ta" name="ta">{() => text()}</textarea>
    </form>
    <button id="update" onClick={() => setText('updated')}>update</button>
  </main>
), '#app');
