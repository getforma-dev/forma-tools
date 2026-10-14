// The per-application cache-name contract as data, shared with forma-server.
//
// COPIED from getforma-dev/forma, `crates/forma-server/tests/js/retiring_worker.mjs`
// (`CACHE_VECTORS`), at commit 3d92f57 (forma PR 15, FORMA-130's forma-server
// half). The two repositories cannot import each other's tests, so the table
// is copied; a change to the contract changes both copies in paired PRs.
//
// [cache name, deleted by an unnamed retiring worker, deleted by "ledger"'s]
// The "ledger" column is also what ledger's PRODUCTION worker deletes on
// activation, except its own current cache, which it keeps.
export const CACHE_VECTORS: ReadonlyArray<readonly [string, boolean, boolean]> = [
  // v1 and build 0.3.0 names: Forma's, unattributable, retired by every app.
  ['forma-dev', true, true],
  ['forma-0123456789ab', true, true],
  ['forma-0123456789ab-on-demand-v1', true, true],
  // ledger's own caches under the per-application contract.
  ['forma:ledger:0123456789ab', false, true],
  ['forma:ledger:fedcba987654', false, true],
  // another application's: never.
  ['forma:other:0123456789ab', false, false],
  ['forma:ledgers:0123456789ab', false, false], // a prefix of the name is not the name
  ['forma:ledger', false, false], // no build segment: not a cache this contract writes
  // near misses of the v1 shape: not Forma's v1 names.
  ['forma-0123456789AB', false, false],
  ['forma-0123456789abc', false, false],
  ['forma-0123456789a', false, false],
  ['forma-notes', false, false],
  ['forma-', false, false],
  ['forma-dev-extra', false, false],
  // unrelated caches on the origin.
  ['my-app-data', false, false],
  ['workbox-precache-v2-https://example.com/', false, false],
];
