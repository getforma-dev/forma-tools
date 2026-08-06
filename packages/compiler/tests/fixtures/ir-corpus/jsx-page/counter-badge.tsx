// Island component whose signals are declared INSIDE the function — the path
// that silently lost its named slot and its SSR default whenever the file was
// .tsx. The island still appeared in the table, so nothing looked wrong until
// server-side injection by name failed at runtime.
import { h, createSignal } from 'formajs';

export function CounterBadge() {
  const [hits] = createSignal(42);
  const [live] = createSignal(true);

  return (
    <span class="badge" data-live={() => live()}>
      {() => hits()}
    </span>
  );
}
