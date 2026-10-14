import { reconcile } from './ledger';

// reconcile(el, html) in a comment.
export const drift = reconcile([], []);
export function sync(store: { reconcile(a: unknown): void }) {
  store.reconcile({});
}
