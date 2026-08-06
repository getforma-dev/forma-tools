# Contributing to forma-tools

## Before your first PR

Read the
[stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md).
This repo sits in the middle of the pipeline: everything it emits is read by a
Rust parser in another repo and adopted by a runtime in a third. §3 of that
document lists the four contracts that cross those boundaries — the FMIR binary
layout, slot naming, the hydration marker grammar and the island props protocol.

**A change to any of them is a cross-repo change.** The binary layout and the
hydration wire contract are shared byte-for-byte with `forma`, `formajs` and
downstream consumers; they are not this repo's to change alone.

## Setup

```bash
git clone https://github.com/getforma-dev/forma-tools.git
cd forma-tools
npm install
npm test
```

## The gates

| Command | What it protects |
|---|---|
| `npm test` | The unit suites in both packages |
| `npm run emit:corpus` | Re-emits the FMIR corpus with the current compiler |
| `npm run test:e2e` | Playwright, against a FormaJS build from the sibling repo — see [`e2e/README.md`](e2e/README.md) |
| `npm run build --workspaces` | Both packages build |

CI adds two jobs that are easy to forget locally:

- **`fmir-contract`** checks out `forma`, emits the corpus with *this*
  compiler, and makes the real Rust parser read it and diff the rendered HTML
  against committed goldens. It also fails if the `.ir` fixtures committed in
  `forma` are no longer what this compiler emits. When that job fails, decide
  which side changed before touching a golden, and open the paired PR.
- **A Windows runner.** This toolchain's first field-reported bug was
  Windows-only and structural — a tool spawned with `execFileSync` and no
  shell, which `CreateProcess` cannot use to run a `.cmd` shim. The same shape
  recurred twice more, and module-id matching in the Vite plugin never handled
  backslash-separated paths. A Linux-only matrix cannot see any of it, and the
  primary consumer develops on Windows.

A weekly `compat.yml` job installs `@getforma/core@latest` and asserts that
every symbol the compiler generates imports still exists there. Compiled output
naming another package's API is a dependency, even though nothing in
`package.json` records it.

## Tests

The standard is
[`docs/TESTING.md`](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md)
— eight rules, a reviewer's checklist, and the citation contract. Three of them
bite hardest in this repo:

- **Test the real consumer, not your model of it.** The compiler's hand-written
  FMIR readers inside the vitest suite were written from the same mental model
  as the emitter, so they agreed with it by construction — including where both
  were wrong about what the Rust parser requires. Over 32 binary mutation
  probes the JS suite killed 22 and the Rust lane killed 22, but the union
  killed 27. Anything about emitted bytes belongs in the corpus.
- **Fixtures must be distinguishable.** A ternary whose two branches encode to
  the same byte length cannot detect a swap of the two length fields; that
  probe survived every test *and* the byte-exact snapshot.
- **No self-skipping tests.** The two tests carrying the only assertions on a
  real compiler-emitted binary once resolved their fixture to a path outside
  the repo, so 28 assertions never ran and CI stayed green. Fixtures live in
  the repo; a check that needs a build artifact is its own CI job that fails
  loudly.

Cite the test that proves a claim, in the same convention the code uses:

```ts
// Verified by: packages/compiler/tests/ir-walk.test.ts > "emits ISLAND for unknown call in child position"
```

(Repo-relative from wherever the citation lives: inside `packages/compiler/`
that same citation reads `tests/ir-walk.test.ts`.)

A citation is honest only if that specific test fails when the property breaks.
Break it and watch it go red before you open the PR.

## Documentation

- Both packages publish their README to npm; that is the user-facing reference.
  Repo-level and contributor-facing material goes in [`docs/`](docs/).
- Do not copy a number (test count, size, version) between documents without
  re-running the thing that produces it. Prefer naming the command that prints
  the number over pasting the number.
- Version a migration note by the release it ships in, and check it against
  `CHANGELOG.md` — a note dated to a version that does not exist yet is a claim
  nobody can check.
- Superseded documents move to [`docs/archive/`](docs/archive/) with an index
  entry saying what, when and why. Nothing is deleted.

## Pull requests

1. Branch from `main`.
2. Add tests that would fail without your change.
3. `npm test` clean; `npm run emit:corpus` if you touched the emitter, and say
   in the PR whether the goldens in `forma` move.
4. Update the affected package's `CHANGELOG.md` under `[Unreleased]`, plus any
   document your change makes untrue.
5. State the mutation probe you ran against your new tests.
