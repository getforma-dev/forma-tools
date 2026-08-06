# forma-tools documentation

The user-facing reference for each package is its README, because that is what
npm shows. This directory holds what does not belong on a package page:
repo-level material, contributor guidance, and the record of what has been
retired.

## Start here

| Document | What it answers |
|---|---|
| [Stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md) | What the four repos are, what crosses each boundary, and why. Read before your first PR. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup, the gates, and what a reviewer will ask |
| [Testing policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md) | The eight rules, the reviewer's checklist, the `Verified by:` contract |

## Package references

| Document | What it answers |
|---|---|
| [`../packages/compiler/README.md`](../packages/compiler/README.md) | The Vite plugin, `"use server"` transforms, the esbuild SSR plugin, **what renders server-side and what degrades to an island**, and the slot-naming contract |
| [`../packages/build/README.md`](../packages/build/README.md) | Bundling, content hashing, Brotli/gzip, the asset manifest, SSR `.ir` wiring |

The section to read before debugging an empty page is *What renders
server-side* in the compiler README: the compiler walks source rather than
executing it, so a construct it cannot prove becomes an empty island shell that
renders nothing until the client bundle hydrates. Every such degradation warns
at build time, naming the file, the construct, and what the page loses.

## Test corpora and suites

| Document | What it answers |
|---|---|
| [`../packages/compiler/tests/fixtures/ir-corpus/README.md`](../packages/compiler/tests/fixtures/ir-corpus/README.md) | The cross-implementation FMIR corpus: why a second implementation reads these bytes, and which defect classes only it can see |
| [`../e2e/README.md`](../e2e/README.md) | The browser-level suite: what it covers, how fixtures are synced from a real FormaJS build, how to run it |

## Where the binary contract is specified

The FMIR layout this compiler emits — and the rule for which bytes may never
move — is in
[FMIR-FORMAT.md](https://github.com/getforma-dev/forma/blob/main/docs/FMIR-FORMAT.md)
in the `forma` repo, next to the parser that enforces it.

## Archive

[`archive/`](archive/) records what has been retired from this repo's
documentation, when, and why.
