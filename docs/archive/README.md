# Archive — `forma-tools`

Nothing here is current. Everything here was once published or relied on, and
is kept so a reader who meets a stale claim can find out what replaced it and
why.

**How to add an entry.** Never delete a superseded document: move it into this
directory with a `YYYY-MM-DD-` prefix and add a row below. If you corrected a
false claim inside a live document instead of retiring the whole file, still
add a row — the next person to write that sentence should be able to find out
why it was wrong the first time.

---

## Retired documents

*(none yet — this directory was created 2026-08-05 with the docs restructure)*

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| "`npm test` — run all workspace tests (162 tests)" | `README.md`, Development | 2026-08-05 | False. The suite is 336 tests across 10 files, measured by running `npm test` on 2026-08-05. The count was **removed rather than refreshed**: a hard-coded total in a README is wrong again within days, and the command itself prints the number. |
| Migration notes dated `(0.2.1)` and `(0.2.x)` for the show-slot renaming, the literal-source list naming, and the `attr:` / `text:` occurrence suffixes | `packages/compiler/README.md`, Slot Naming → Migration | 2026-08-05 | Version-shaped claims nobody could check. `0.2.1` does not exist — npm's latest is 0.2.0 — and the two `(0.2.x)` items describe changes that are still under `[Unreleased]` in `CHANGELOG.md`, i.e. *later* than the versions they were attributed to. All three are now labelled `(unreleased)` with `CHANGELOG.md` named as the authority, and the one change that really did ship in 0.2.0 (per-list slot names) is listed under its own version. |
| The repo had no `CONTRIBUTING.md`, no `docs/` directory, and no link to the stack it belongs to | repo root | 2026-08-05 | A reader landing here learned nothing about the pipeline this compiler sits in the middle of. Added [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md), [`../README.md`](../README.md), and an orientation header in the repo README linking the other three repos and the stack architecture. |

## Notes on material that is *not* archived

- **The historical notes inside `packages/compiler/README.md` and
  `packages/build/README.md`** — "through 0.2.0 the plugin also dropped a
  `<page>.islands.json` sidecar", "through 0.1.9 it also wrote
  `<page>.islands.js`" — stay where they are on purpose. They describe files a
  user's `outputDir` may still contain after upgrading, so they are current
  guidance about the past, not retired documentation.
- **Package CHANGELOGs** are the record of what changed and when. This archive
  is for material that was *wrong or superseded*, which is a different
  question.
