# FormaJS Full-Stack E2E Tests

Browser-level verification of the entire Forma pipeline. Tests run in a real Chromium browser via Playwright. Fixtures are **auto-synced** from the FormaJS build — no manual copying.

## What's Tested

| Test Group | Tests | What It Verifies |
|------------|-------|-----------------|
| **HTML Runtime** | 8 | data-text, data-on:click, data-model, data-show, data-class, data-computed, $refs |
| **Programmatic h() API** | 2 | createSignal + h() + mount() renders DOM, signals update reactively |
| **Compiled template path** | 3 | template() + cloneNode() (compiler output) creates working DOM with reactive effects |
| **Cross-cutting** | 2 | No console errors on page load, all three approaches coexist |

## How to Run

### Locally (auto-syncs FormaJS build)

```bash
npm run test:e2e
```

This automatically:
1. Builds FormaJS from the sibling `../formajs/` directory
2. Copies `formajs-runtime.global.js` and `formajs.global.js` to `e2e/fixtures/`
3. Starts a local static server on port 3457
4. Runs 15 Playwright tests in headless Chromium

### Custom FormaJS path

```bash
FORMAJS_DIR=/path/to/formajs npm run test:e2e
```

### In CI

The GitHub Actions CI workflow runs E2E automatically on every push to main — clones formajs from GitHub, builds it, copies fixtures, runs Playwright. On failure, the report is uploaded as an artifact.

## When to Run

- After updating `@getforma/core`
- After updating `@getforma/compiler`
- After changing HTML Runtime directives or magic variables
- After upgrading alien-signals
- Before every release

## File Structure

```
e2e/
├── fixtures/
│   ├── full-stack.html              ← Test page with all three entry points
│   ├── formajs-runtime.global.js    ← Auto-synced from formajs build
│   ├── formajs.global.js            ← Auto-synced from formajs build
│   └── compiled-counter.js          ← Compiler output example (reference)
├── full-stack.spec.ts               ← 15 Playwright tests
├── sync-fixtures.sh                 ← Builds FormaJS and copies dist files
└── README.md                        ← This file
```

## Adding Tests

1. Add HTML to `fixtures/full-stack.html` with unique IDs
2. Add a `test()` block in `full-stack.spec.ts`
3. Run `npm run test:e2e` to verify

## Troubleshooting

| Error | Fix |
|-------|-----|
| "FormaJS directory not found" | `FORMAJS_DIR=~/path/to/formajs npm run test:e2e` |
| "Cannot find module serve" | `npm install` |
| "Browser not found" | `npx playwright install chromium` |
