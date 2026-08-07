# Handoff — the compiler cannot resolve imported signal defaults

**Repo:** `getforma-dev/forma-tools`, package `@getforma/compiler` (currently 0.3.1)
**Written:** 2026-08-07, from a gatewasm SSR migration that stalled on this.
**Status:** diagnosed, not started. No code changed in this repo.

You are picking up a single, well-bounded compiler gap. Everything below was
verified by reading the source and by reproducing the symptom in a real app;
where something is an inference rather than a measurement it says so.

---

## 1. The symptom, in one page

`gatewasm`'s platform login page server-rendered its "New here?" link like this:

```html
<div class="new-here …">New here? <a>Start onboarding</a></div>
```

The `<a>` is there. The `href` is **not**. With JavaScript on, hydration adds it
and nobody notices; with JavaScript off — and on every first paint — the link is
dead. It shipped that way for months.

The source is ordinary:

```ts
// admin/src/platform/login/LoginPage.ts
import { ownerInviteToken } from './store';
…
h('a', {
  href: () => ownerInviteToken()
    ? '/platform/onboarding?owner_invite=' + encodeURIComponent(ownerInviteToken())
    : '/platform/onboarding',
}, 'Start onboarding')
```

```ts
// admin/src/platform/login/store.ts
export const [ownerInviteToken, setOwnerInviteToken] = createSignal('');
```

The signal has a literal `''` default. The ternary's else-branch is a literal.
Everything the compiler asks for is present — and it still cannot fold it,
because `ownerInviteToken` is declared in a **different file**.

The compiler says so on every build:

```
IR: attribute 'href' on <a> binds `() => a bare '+' expression`, which the
compiler cannot evaluate in …/platform/login/LoginPage.ts — the attribute is
OMITTED server-side and only appears once the client hydrates — initialize the
signals it reads with literal defaults, or fold the value into a module-level const
```

That advice is **unactionable in this architecture**: the default exists, is
literal, and is invisible from the consuming file.

---

## 2. The cause, exactly

`packages/compiler/src/ir-walk.ts:676`:

```ts
callerScope: sub.filePath === walkCtx.sourceFile ? walkCtx.signalScope ?? null : null,
```

Signal scope is deliberately nulled when the walk crosses a file boundary.

`packages/compiler/src/signal-scope.ts:462` — `enterComponentScope` then builds a
module scope from **this file's own program body only**:

```ts
const moduleScope = enterSignalScope(
  null,
  `${filePath}#module`,
  collectSignalDeclarations(ast.program.body, { filePath, constants }),
  ctx,
  registry,
);
```

So `lookupSignal` (`signal-scope.ts:396`) walks a chain that never contains a
signal declared elsewhere. Rule 6 (`ir-walk.ts:923`) then falls to
`tryEvalExprDefault`, which cannot resolve the call, and mints a slot with **no
default** — which is what "omitted server-side" means.

Note the asymmetry that makes this clearly a gap rather than a design choice:
the compiler **already** resolves imported *constants* across modules
(`resolveImportedConstant`, used from `component-analyzer.ts` and
`esbuild-ssr-plugin.ts`). Only signal defaults stop at the file boundary.

---

## 3. Why this matters more than one dead link

Any app that keeps signals in a `store.ts` and consumes them from page and
island files — **the architecture Forma's own docs recommend** — cannot fold a
single signal-backed attribute, conditional, or text node. Server-rendered
output silently degrades to "whatever is static", and hydration papers over it.

Measured in gatewasm on 2026-08-07: **158 such diagnostics across 17 files**,
33 of them on the login route alone. Every one is a place the server-rendered
HTML differs from what the user ends up seeing.

`gatewasm` now gates this (`admin/scripts/check-ir-degradations.mjs`, run by
`npm run check:ssr` in CI) against a committed baseline, so the count can only
go down. **That gate is the regression test for your fix**: when this lands,
the number should drop sharply and the baseline gets re-recorded.

---

## 4. The decision already taken — do not relitigate without new evidence

An earlier note in gatewasm's `SSR-MIGRATION-PLAN.md` proposed making forma-ir
emit `DYN_ATTR` differently for closure attributes. **That was investigated and
rejected**, and the plan has been corrected. Rule 6 already emits `DYN_ATTR`,
already reuses a signal's own slot for `() => sig()`, and already folds a
default when it can. Nothing there needs changing.

The decision was bound to output cost, not implementation effort:

| | per-request SSR cost | IR size |
|---|---|---|
| folded / static attribute | none — a string-table entry copied during the walk | one string |
| `DYN_ATTR` + server-supplied slot | slot lookup + write on every request | slot + default |
| `DYN_ATTR`, no default (today) | none, but the attribute is omitted — output is wrong | slot |

Fixing resolution makes attributes **fold**, which is the cheapest of the three.
Any design that instead pushes more attributes onto the slot path is a
regression in both output size and per-request cost, and should be rejected on
that basis.

---

## 5. The shape of the fix

Teach `enterComponentScope` to include signals this module *imports*, resolving
each to the binding in its **defining** module.

Every piece of infrastructure already exists:

| need | use |
|---|---|
| local name → `{ source, imported }` | `readImportBindings(ast)` — `export-resolver.ts:101` |
| specifier → absolute path | `resolveFilePath(fromDir, importPath)` — `module-loader.ts:37` |
| read + parse the defining file | `loadComponentSource(filePath)` — `module-loader.ts:78`. **Note:** `ComponentScopeInput` (`signal-scope.ts:434`) carries only `ast, fn, fnName, filePath, constants, ctx, registry` — there is no loader on it today, so you will need to thread one in (or import `fsModuleLoader`, `module-loader.ts:103`, and keep it injectable for tests) |
| signals in a program body | `collectSignalDeclarations(body, { filePath, constants })` — exported, `signal-scope.ts:216` |
| a frame for that module | `enterSignalScope(null, \`${definingPath}#module\`, …)` — `signal-scope.ts:360` |

**The critical property — slot identity — falls out for free.** `enterSignalScope`
memoizes on `` `${parent?.key ?? ''}>${scopeId}` `` in `registry.frames`, and the
registry is shared page-wide. So entering `` `${storePath}#module` `` from three
different importers returns *the same frame with the same slotId*. Do not mint a
new binding in the importing scope — resolve to the defining module's frame.
Getting this wrong means one signal becomes N slots and a server injecting it
fills only the first; there is already a warning in `enterSignalScope` about
exactly that hazard for same-page name collisions.

Sketch, deliberately not a patch — write it to fit the file's conventions:

```
in enterComponentScope, after building moduleScope:
  for each [localName, binding] of readImportBindings(ast):
    if binding.imported is '*' or 'default' -> skip (out of scope, see §7)
    definingPath = resolveFilePath(dirname(filePath), binding.source)
    if !definingPath or already visiting definingPath -> skip   // cycle guard
    src = loadComponentSource(definingPath); parse it
    defScope = enterSignalScope(null, `${definingPath}#module`,
                                collectSignalDeclarations(defAst.program.body, …),
                                ctx, registry)
    if lookupSignal(defScope, binding.imported) exists:
      expose it in this module's scope under localName
```

Two details worth deciding explicitly rather than by accident:

- **Renaming imports.** `import { ownerInviteToken as tok }` must bind local
  `tok` to the binding found under `ownerInviteToken` in the defining module.
  `ImportBinding.imported` already carries that distinction — use it.
- **Re-exports.** `export { x } from './y'` is common in barrel files.
  `resolveExportedFunction` (`export-resolver.ts:133`) already handles
  re-export chains, `export *` barrels and the specifier shape esbuild emits;
  prefer reusing that traversal over writing a second one.

---

## 6. How to verify

**In this repo.** Add cases to `packages/compiler/tests/signal-scope.test.ts`,
which already has the vocabulary for this ("a nested helper sees the signals
declared beside it"). At minimum:

1. an imported signal's literal default folds into an attribute;
2. two files importing the *same* signal resolve to **one** slotId;
3. a renamed import (`as`) resolves to the exported name, not the local one;
4. a re-exported signal (`export { s } from './store'`) resolves;
5. an import cycle terminates rather than recursing;
6. a signal with a non-literal initialiser still degrades with the existing
   diagnostic — this fix must not silence a warning it cannot honour.

Mutation-check each: revert the fix and confirm the test goes red. Three tests
written during the gatewasm work looked correct and could not fail — worth
assuming yours might too until you have seen them fail.

**Getting your change into gatewasm at all.** `gatewasm` consumes the
*published* `@getforma/compiler`, not your working copy — so editing this repo
and rebuilding gatewasm changes nothing, with no error to explain why. Link it
first:

```bash
cd forma-tools/packages/compiler && npm run build && npm link
cd gatewasm/admin && npm link @getforma/compiler
npm run build:ssr        # now runs YOUR compiler
```

Undo with `npm unlink @getforma/compiler && npm ci` before committing anything
in gatewasm, so its lockfile never records a linked package.

Only once it works linked: tag `compiler-v0.3.2` from the CLI (that is what
triggers publishing — there is no GitHub Release step), then bump
`gatewasm/admin/package.json` and re-record its IR baseline in the same commit,
so the two can never disagree about how many degradations are expected.

**End to end, in gatewasm.** This is the real proof:

```bash
cd C:/Projects/gatewasm/admin
npm run build:ssr 2>&1 | grep -c "   IR: "     # 158 before
npm run check:ssr                              # gate; re-record when it drops
```

Then confirm the original symptom is gone — the href must be present in the
server-rendered HTML with JavaScript disabled:

```bash
# temporarily add "/platform/login" to SSR_ROUTES in
# crates/server/src/ir/mod.rs, rebuild assets, restart, then:
curl -s localhost:3001/platform/login | grep -o '<a[^>]*>Start onboarding'
# expect: <a href="/platform/onboarding">Start onboarding
```

`gatewasm`'s e2e already asserts it: `admin/e2e/login.spec.ts:111`
(`"New here?" link navigates to /platform/onboarding`) and the no-JS boot-shell
specs in `admin/e2e/smoke.spec.ts`.

---

## 7. Scope, hazards, and what to leave alone

- **This is platform infrastructure, not a two-consumer package.** `ksx` and
  `gatewasm` consume it today and more products are intended to build on it, so
  a regression here fans out rather than staying local. Keep the change strictly
  additive: a signal that cannot be resolved must behave exactly as it does
  today, warning included, and no existing IR output should change byte-for-byte
  except where a default is now correctly folded. Diffing emitted `.ir` for an
  unrelated app before and after is a cheap way to prove that.
- **Namespace and default imports** (`import * as store`, `import store from`)
  are out of scope for a first pass. Skipping them is correct; silently
  half-resolving them is not.
- **Do not fold across a dynamic boundary.** If a signal's initialiser is not a
  literal (or a folded module const), leave the existing diagnostic alone.
  Silencing a warning without making the output correct is the failure mode
  this whole exercise exists to prevent.
- **Release process.** Publishing is triggered by a CLI-pushed git tag
  (`compiler-v0.3.2`), not a GitHub Release. Bump `@getforma/compiler`, then
  gatewasm's `admin/package.json`, and re-record its IR baseline in the same
  change so the two never disagree.
- **Performance regression check.** Resolving imports means parsing more files
  at build time. The parse is already cached per module by the loader
  (**verify this** — it is an inference from the loader's shape, not something
  measured). If a large app's build slows noticeably, memoise the parsed AST
  per `definingPath` before considering anything cleverer.

---

## 8. Where the rest of the context lives

- `C:/Projects/gatewasm/SSR-MIGRATION-PLAN.md` — the corrected migration plan;
  the "Why attributes go missing" section states this decision and the cost
  table, and the status table records which routes are held on Phase 1 and why.
- `C:/Projects/gatewasm/crates/server/src/ir/mod.rs` — `SSR_ROUTES`, the
  explicit allowlist. A route is opted in only after its SSR output is verified;
  it exists because keying Phase 2 off "IR exists" silently server-rendered
  unmigrated pages when compiler 0.3.1 started emitting IR for every route.
- `C:/Projects/gatewasm/admin/scripts/check-ir-degradations.mjs` — the gate and
  its committed baseline.
- `packages/compiler/src/ir-walk.ts` Rule 6 (`:923`) and the file-boundary line
  (`:676`); `packages/compiler/src/signal-scope.ts` for the scope machinery.
