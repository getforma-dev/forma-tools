# FormaJS Full-Stack E2E Tests

Browser-level verification of the entire Forma pipeline. Tests run in a real Chromium browser via Playwright.

## What's Tested

| Test Group | What It Verifies |
|------------|-----------------|
| **HTML Runtime** (8 tests) | data-text, data-on:click, data-model, data-show, data-class, data-computed, $refs — all via data-* directives with zero JavaScript |
| **Programmatic h() API** (2 tests) | createSignal + h() + mount() renders DOM, signals update reactively |
| **Compiled template path** (3 tests) | template() + cloneNode() (what the compiler generates) creates working DOM with reactive effects |
| **Cross-cutting** (2 tests) | No console errors on page load, all three approaches coexist on the same page without interference |

## How to Run

```bash
# From the forma-tools root:
npm run test:e2e

# Or directly:
npx playwright test
```

## When to Run

Run these tests whenever you:
- Update `@getforma/core` (signals, h(), template, runtime)
- Update `@getforma/compiler` (transform output format)
- Change the HTML Runtime (data-* directive handling)
- Add new directives or magic variables
- Upgrade alien-signals

## How It Works

```
e2e/
├── fixtures/
│   ├── full-stack.html              ← Test page with all three entry points
│   ├── formajs-runtime.global.js    ← HTML Runtime (IIFE, from @getforma/core build)
│   ├── formajs.global.js            ← Full API (IIFE, for h()/mount()/template())
│   └── compiled-counter.js          ← Compiler output example (for reference)
├── full-stack.spec.ts               ← Playwright test file (15 tests)
└── README.md                        ← This file
```

The test:
1. Starts a local static server (`serve`) on port 3457
2. Opens `full-stack.html` in headless Chromium
3. Verifies DOM content, clicks buttons, fills inputs, checks visibility/classes
4. Asserts reactivity works across all three approaches

## Refreshing Fixtures

If you rebuild FormaJS, update the fixtures:

```bash
# From FormaStack/formajs:
npm run build

# Copy to forma-tools e2e:
cp dist/formajs-runtime.global.js ../forma-tools/e2e/fixtures/
cp dist/formajs.global.js ../forma-tools/e2e/fixtures/
```

## Adding Tests

Add new test blocks to `full-stack.spec.ts`. For new directives or features:
1. Add the HTML to `fixtures/full-stack.html` with unique IDs
2. Add a `test()` block that interacts with the new elements
3. Run `npx playwright test` to verify
