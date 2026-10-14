// Form controls a user edits before the module runs. DR-5: formajs 042e353
// writes value, checked and selected as live properties at adoption whenever
// they differ from the client's state, so what was typed, ticked or picked
// before activation is overwritten. The select's initial choice is its first
// option, so this case does not depend on the server's `selected` (FORMA-002).
import { h, mount, createSignal } from '@getforma/core';

const [name, setName] = createSignal('server');
const [agreed, setAgreed] = createSignal(false);
const [size, setSize] = createSignal('s');

mount(() => (
  <main>
    <form id="f">
      <input id="name" name="name" value={() => name()} onInput={(e: Event) => setName((e.target as HTMLInputElement).value)} />
      <input id="agreed" name="agreed" type="checkbox" checked={() => agreed()} onChange={(e: Event) => setAgreed((e.target as HTMLInputElement).checked)} />
      <select id="size" name="size" value={() => size()} onChange={(e: Event) => setSize((e.target as HTMLSelectElement).value)}>
        <option value="s">S</option>
        <option value="m">M</option>
        <option value="l">L</option>
      </select>
    </form>
  </main>
), '#app');
