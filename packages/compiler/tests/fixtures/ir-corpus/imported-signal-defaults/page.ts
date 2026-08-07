import { h } from 'formajs';
// Both signals come from the store — this file declares none of its own, so
// every binding below folds only if the import resolution works.
import { ownerInviteToken, status } from './store';
import { StatusBadge } from './badge';

export function InvitePage() {
  return h('main', { id: 'app' },
    // The dead-link shape. With the store's literal '' default in scope the
    // ternary folds to its else branch, and the server-rendered <a> carries
    // href="/platform/onboarding" with JavaScript off.
    h('a', {
      href: () => ownerInviteToken()
        ? '/platform/onboarding?owner_invite=' + encodeURIComponent(ownerInviteToken())
        : '/platform/onboarding',
    }, 'Start onboarding'),
    // A bare `() => sig()` binding over an import reuses the signal's OWN
    // slot rather than minting an anonymous one.
    h('b', { class: 'page-status' }, () => status()),
    StatusBadge(),
  );
}
