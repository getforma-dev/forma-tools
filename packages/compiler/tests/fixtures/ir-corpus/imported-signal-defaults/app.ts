// Corpus case: signal defaults declared in ANOTHER module — the store.ts
// architecture Forma's own docs recommend, and the shape that shipped
// gatewasm's login page with a dead onboarding link for months.
//
// A signal's scope chain used to stop at the file boundary: `enterComponentScope`
// built a module frame from the file's own program body only, so a signal
// imported from a store had no binding, no slot, and no SSR default. Every
// attribute, text node and condition that read one degraded to "whatever is
// static" — 158 diagnostics across 17 files in gatewasm alone — and hydration
// papered over all of it unless JavaScript was off, which is exactly when a
// login page matters.
//
// The shape here:
//
//   * `store.ts` declares both signals with literal defaults, `export const
//     [get, set] = createSignal(…)` — the recommended store form.
//   * `page.ts` reads `ownerInviteToken` in an href TERNARY (the dead-link
//     shape: the else branch must fold into the attribute's SSR default) and
//     reads `status` directly from the store.
//   * `badge.ts` is a REGISTERED ISLAND that reads the same `status` signal
//     through a barrel that ALIASES it (`export { status as liveStatus }`).
//     Page and island must resolve to ONE slot — `status#2` appearing in the
//     slot table is the one-signal-two-slots hazard, where a server injecting
//     'status' fills the page copy and leaves the island stale.
//
// The golden is the assertion: the <a> below carries its href server-side,
// and the slot table has exactly one 'status' slot with default 'idle'. If
// resolution regresses, the href slot loses its default (dead link with JS
// off) and `resolution_cases_ship_named_islands_over_named_slots` fails
// before the golden diff is even read.
import { mount, activateIslands } from 'formajs';
import { InvitePage } from './page';
import { StatusBadge } from './badge';

activateIslands({ StatusBadge });

mount(() => InvitePage(), '#app');
