// A reactive <title> element inside a component. Audit verification run 2: its
// text before JavaScript is the marker text. It never becomes document.title,
// because render_page writes the page's own <title> in <head> first.
import { h, mount, createSignal } from '@getforma/core';

const [heading, setHeading] = createSignal('hello');

mount(() => (
  <main>
    <div id="title-host">
      <title id="tt">{() => heading()}</title>
    </div>
    <button id="update" onClick={() => setHeading('updated')}>update</button>
  </main>
), '#app');
