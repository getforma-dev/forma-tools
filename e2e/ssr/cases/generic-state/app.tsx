// The minimal template's page (create-forma-app templates/minimal), with the
// handler's slot data set to `{"count": 7}` by slots.json, as the template's own
// comment tells an application to do. Audit verification: v1 code run 1.
import { h, mount, createSignal } from '@getforma/core';

const [count, setCount] = createSignal(0);

mount(() => {
  return (
    <main class="page">
      <p class="count">
        Count: <span id="count">{() => count()}</span>
      </p>
      <p class="actions">
        <button id="increment" onClick={() => setCount(count() + 1)}>Increment</button>
      </p>
    </main>
  );
}, '#app');
