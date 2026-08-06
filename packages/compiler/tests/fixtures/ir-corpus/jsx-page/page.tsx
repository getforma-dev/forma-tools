import { h, createSignal } from 'formajs';
import { SummaryCard } from './summary-card';
import { CounterBadge } from './counter-badge';

export function JsxPage() {
  // A component-scope signal on the ROOT page: this is the pair that used to
  // differ purely by file extension — `.ts` gave a named `headline` slot with
  // its default, the byte-identical `.tsx` gave an anonymous `text:0` with
  // none, and no build output mentioned it.
  const [headline] = createSignal('Live');

  return (
    <main id="app">
      <h1>{() => headline()}</h1>
      {/* A sub-component imported from a SIBLING file, inlined into the page.
          Its props are literals, so the whole subtree renders server-side. */}
      <SummaryCard title="Requests" body="Steady since noon." />
      {/* An island: never inlined, always ISLAND_START/ISLAND_END, and it must
          carry its own component NAME so activateIslands can find it. */}
      <CounterBadge />
    </main>
  );
}
