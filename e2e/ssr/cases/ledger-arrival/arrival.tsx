// The arrival island, after Ledger's household arrival (admin/src/household/
// arrival.tsx in the private Ledger repository; nothing here is copied from it).
// The pattern under test is Ledger's bridge for server state: the signals keep
// literal defaults, and `seedArrival` feeds them from the island's props, by
// slot name and including the `show:` slot, BEFORE the component runs. Audit
// verification run 7 found that this keeps the server's values through
// activation, where the generic mount() path loses them (case generic-state).
import { h, createShow, createSignal } from '@getforma/core';

const [arrivalTitle, setArrivalTitle] = createSignal('Household');
const [arrivalCash, setArrivalCash] = createSignal('$0.00');
const [arrivalSummary, setArrivalSummary] = createSignal(false);
const [arrivalStatus, setArrivalStatus] = createSignal('pending');
const [retryVisible, setRetryVisible] = createSignal(false);

let attempts = 0;

/** Seed the island's signals from its server props, before the component runs. */
export function seedArrival(props: Record<string, unknown> | null): void {
  if (typeof props?.arrivalTitle === 'string') setArrivalTitle(props.arrivalTitle);
  if (typeof props?.arrivalCash === 'string') setArrivalCash(props.arrivalCash);
  if (typeof props?.arrivalStatus === 'string') setArrivalStatus(props.arrivalStatus);
  // SHOW_IF reads a derived boolean slot, not the signal declaration.
  if (typeof props?.['show:arrivalSummary'] === 'boolean') setArrivalSummary(props['show:arrivalSummary']);
}

/**
 * Load the live workspace. The fixture server has no API, so this fails, and
 * the island shows Ledger's offline state: the snapshot stays, the status says
 * it is not live, and a Retry button appears. (Ledger's Retry reloads the page;
 * this one tries again in place, so the test can see the handler run.)
 */
export async function loadWorkspace(): Promise<void> {
  attempts += 1;
  setRetryVisible(false);
  try {
    const response = await fetch('/api/v1/instance');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setArrivalStatus('live');
  } catch {
    setArrivalStatus(`The workspace could not load (attempt ${attempts}). This snapshot is not live.`);
    setRetryVisible(true);
  }
}

export function Arrival() {
  return (
    <section class="arrival">
      <h1 id="arrival-title">{() => arrivalTitle()}</h1>
      {createShow(
        () => arrivalSummary(),
        () => (
          <dl id="arrival-summary">
            <dt>Cash</dt>
            <dd id="arrival-cash">{() => arrivalCash()}</dd>
          </dl>
        ),
      )}
      <p id="arrival-status">{() => arrivalStatus()}</p>
      {createShow(
        () => retryVisible(),
        () => <button id="arrival-retry" type="button" onClick={() => { void loadWorkspace(); }}>Retry</button>,
      )}
    </section>
  );
}
