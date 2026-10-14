/**
 * SSR regression fixtures across the whole stack (FORMA-001, stage 0).
 *
 * Each case in e2e/ssr/cases/ is compiled by THIS repo's compiler and build
 * package, rendered by forma's Rust walker through `forma_server::render_page`,
 * and adopted in Chromium by the FormaJS checkout under test (e2e/ssr/build.sh;
 * served by e2e/ssr/serve.mjs with each page's own CSP). The tests read the
 * parsed DOM, live control values and FormData before JavaScript, after
 * activation and after interaction.
 *
 * The defects the Forma Stack audit verification reproduced (runs 1, 2, 3 and
 * 7; the v2 decision brief, DR-5 and DR-7) are written as the behaviour v2
 * requires and marked `test.fail`, each naming the ticket whose fix flips it.
 * When that fix lands, the case passes, `test.fail` reports it as an
 * unexpected pass, and CI goes red until the marker is removed.
 *
 * An expected-fail test passes whenever ANY assertion in it fails, including a
 * broken harness. The table "every case is server-rendered and activates"
 * guards against that: it must pass for every case, so an expected-fail case
 * can only be failing on the behaviour it names.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3458';

/** Every case under e2e/ssr/cases/, and how its page reports activation. */
const CASES = {
  'generic-state': 'mount',
  'root-fragment': 'mount',
  'textarea-child': 'mount',
  'textarea-value': 'mount',
  title: 'mount',
  select: 'mount',
  'edited-controls': 'mount',
  'ledger-arrival': 'island',
} as const;
type CaseName = keyof typeof CASES;

/** How long an assertion after activation may wait. Effects are synchronous. */
const SETTLE = { timeout: 2_000 };

test.use({ baseURL: ORIGIN });

/**
 * Collect page errors and console errors (CSP violations are console errors).
 * A failed request to /api/ is not one: the fixture server has no API, and the
 * ledger-arrival case calls it to reach its offline state on purpose.
 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (new URL(message.location().url || ORIGIN).pathname.startsWith('/api/')) return;
    errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/**
 * The page as the HTML parser built it from the server's response, with
 * JavaScript disabled: what a user sees, and what a form submits, before the
 * module runs.
 */
async function openWithoutJs(browser: Browser, path: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: ORIGIN, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(path);
  return { page, close: () => context.close() };
}

/**
 * Load the Phase 2 page with its module held until parsing is done, so the
 * server's DOM can be read and edited before any FormaJS code runs.
 * `activate()` releases the module and waits for the case's activation signal.
 */
async function openHeld(page: Page, name: CaseName): Promise<{ activate: () => Promise<void> }> {
  const held: Route[] = [];
  let holding = true;
  await page.route('**/_assets/*.js', (route) => {
    if (holding) held.push(route);
    else void route.continue();
  });
  await page.goto(`/${name}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.readyState !== 'loading');
  await expect.poll(() => held.length, { message: 'the page module is held before it runs' }).toBeGreaterThan(0);
  return {
    async activate() {
      holding = false;
      for (const route of held.splice(0)) await route.continue();
      await waitForActivation(page, name);
    },
  };
}

async function waitForActivation(page: Page, name: CaseName): Promise<void> {
  if (CASES[name] === 'island') {
    await expect(page.locator('[data-forma-island]')).toHaveAttribute('data-forma-status', 'active');
  } else {
    await page.waitForFunction(() => !document.getElementById('app')?.hasAttribute('data-forma-ssr'));
  }
}

/** The Phase 2 page, loaded and activated. */
async function openActivated(page: Page, name: CaseName): Promise<void> {
  await page.goto(`/${name}/`);
  await waitForActivation(page, name);
}

/** The same build client-rendered (Phase 1), mounted. */
async function openClientRendered(page: Page, name: CaseName): Promise<void> {
  await page.goto(`/${name}/csr`);
  await page.waitForFunction(() => (document.getElementById('app')?.childElementCount ?? 0) > 0);
}

/** What submitting the form would send for one field. */
function submitted(page: Page, field: string): Promise<string[]> {
  return page.evaluate((name) => {
    const form = document.querySelector('form');
    if (!form) throw new Error('no form on the page');
    return new FormData(form).getAll(name).map(String);
  }, field);
}

/** A select's live state: its value and selected index. */
function selectState(page: Page, selector: string): Promise<{ value: string; index: number }> {
  return page.locator(selector).evaluate((el: HTMLSelectElement) => ({ value: el.value, index: el.selectedIndex }));
}

// ── The harness control: every expected-fail below depends on it ──────────

test.describe('every case is server-rendered and activates', () => {
  test('the table covers every case directory', () => {
    const dirs = readdirSync(join(__dirname, 'cases'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(CASES).sort()).toEqual(dirs);
  });

  // "Activates" here means the module ran to its activation signal (for a
  // mount() root, data-forma-ssr removed). That is not proof that anything was
  // adopted, as root-fragment shows; the behaviour tests below check that.
  for (const name of Object.keys(CASES) as CaseName[]) {
    test(`${name}: walker HTML present, Phase 2 activates, Phase 1 mounts, no errors`, async ({ browser, page }) => {
      const noJs = await openWithoutJs(browser, `/${name}/`);
      await expect(noJs.page.locator('#app'), 'a Phase 2 page').toHaveAttribute('data-forma-ssr', '');
      const serverHtml = await noJs.page.locator('#app').innerHTML();
      await noJs.close();
      expect(serverHtml.trim().length, 'the walker rendered content into #app').toBeGreaterThan(0);

      const errors = watchErrors(page);
      await openActivated(page, name);
      await openClientRendered(page, name);
      expect(errors).toEqual([]);
    });
  }
});

// ── Generic state on the mount() path (audit verification: v1 run 1) ──────

test.describe('generic-state', () => {
  test('generic-state: the walker renders the server value 7 before JavaScript', async ({ browser, page }) => {
    const noJs = await openWithoutJs(browser, '/generic-state/');
    await expect(noJs.page.locator('#count')).toHaveText('7');
    await noJs.close();

    const held = await openHeld(page, 'generic-state');
    await expect(page.locator('#count')).toHaveText('7');
    await held.activate();
  });

  // Expected to fail until release B gives server state a channel to the
  // signals (FORMA-103, DR-4) and adoption stops writing on its first run
  // (FORMA-104, DR-5); whichever makes it pass removes the marker. Today the
  // first effect run writes the client default 0 over the server's 7. (DR-6,
  // FORMA-105, ends mount() adoption of a server page; this case then moves
  // into an island.)
  test.fail('generic-state: the server value 7 survives activation', async ({ page }) => {
    const held = await openHeld(page, 'generic-state');
    await held.activate();
    await expect(page.locator('#count')).toHaveText('7', SETTLE);
  });
});

// ── Root JSX Fragment (audit verification run 1) ──────────────────────────

test.describe('root-fragment', () => {
  test('root-fragment: client-rendered, the button updates the text', async ({ page }) => {
    await openClientRendered(page, 'root-fragment');
    await expect(page.locator('#note')).toHaveText('hello');
    await page.click('#go');
    await expect(page.locator('#note')).toHaveText('bye', SETTLE);
  });

  // Expected to fail until FORMA-003 adopts a Fragment as the range of its
  // children (DR-7 a). Today h(Fragment) builds a real DocumentFragment while
  // hydrating, adoption treats it as nothing to adopt, removes data-forma-ssr,
  // and binds no handler.
  test.fail('root-fragment: after Phase 2 activation, the button updates the text', async ({ page }) => {
    await openActivated(page, 'root-fragment');
    await expect(page.locator('#note')).toHaveText('hello');
    await page.click('#go');
    await expect(page.locator('#note')).toHaveText('bye', SETTLE);
  });
});

// ── textarea and title: RCDATA (audit verification run 2) ─────────────────

test.describe('textarea-child', () => {
  // Expected to fail until FORMA-002 stops the walker writing f: markers inside
  // RCDATA parents (DR-7 b). Today the value is `<!--f:t0-->hello<!--/f:t0-->`.
  test.fail('textarea-child: before JavaScript the value and FormData are "hello"', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/textarea-child/');
    const value = await noJs.page.locator('#ta').inputValue();
    expect({ value, submitted: await submitted(noJs.page, 'ta') }).toEqual({ value: 'hello', submitted: ['hello'] });
    await noJs.close();
  });

  test('textarea-child: after activation the value follows the signal', async ({ page }) => {
    await openActivated(page, 'textarea-child');
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
    expect(await submitted(page, 'ta')).toEqual(['updated']);
  });

  test('textarea-child: client-rendered, the value follows the signal', async ({ page }) => {
    await openClientRendered(page, 'textarea-child');
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
  });
});

test.describe('textarea-value', () => {
  // Expected to fail until FORMA-002 writes a textarea's value binding as its
  // text (DR-7 c). Today the server writes value="hello", which a textarea
  // ignores, so it is empty and submits "".
  test.fail('textarea-value: before JavaScript the value and FormData are "hello"', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/textarea-value/');
    const value = await noJs.page.locator('#ta').inputValue();
    expect({ value, submitted: await submitted(noJs.page, 'ta') }).toEqual({ value: 'hello', submitted: ['hello'] });
    await noJs.close();
  });

  // Expected to fail until FORMA-003 writes `value` as the live property
  // (042e353's writer, kept for writes after activation). Today only the
  // attribute is written, which a textarea ignores.
  test.fail('textarea-value: after activation the value follows the signal', async ({ page }) => {
    await openActivated(page, 'textarea-value');
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
  });

  // Expected to fail until FORMA-003, as above: the client-rendered path
  // writes the same attribute.
  test.fail('textarea-value: client-rendered, the value follows the signal', async ({ page }) => {
    await openClientRendered(page, 'textarea-value');
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
  });
});

test.describe('title', () => {
  // Expected to fail until FORMA-002 stops the walker writing f: markers inside
  // RCDATA parents (DR-7 b). Today the element's text is the marker text.
  test.fail('title: before JavaScript the element text is "hello"', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/title/');
    expect(await noJs.page.locator('#tt').textContent()).toBe('hello');
    await noJs.close();
  });

  test('title: after activation the element text follows the signal; document.title stays the page title', async ({ page }) => {
    await openActivated(page, 'title');
    await expect(page.locator('#tt')).toHaveText('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#tt')).toHaveText('updated', SETTLE);
    // render_page writes the page's <title> into <head> first, so a
    // component's <title> never becomes the document title.
    expect(await page.title()).toBe('Forma SSR fixture');
  });
});

// ── select bound to a later option (audit verification run 3) ─────────────

test.describe('select', () => {
  // Expected to fail until FORMA-002 writes `selected` on the matching option
  // (DR-7 c). Today the server writes value="b" on the select, which HTML
  // ignores, so the first option is selected and submitted.
  test.fail('select: before JavaScript "b" is selected and submitted', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/select/');
    const state = await selectState(noJs.page, '#choice');
    expect({ ...state, submitted: await submitted(noJs.page, 'choice') }).toEqual({ value: 'b', index: 1, submitted: ['b'] });
    await noJs.close();
  });

  // Expected to fail until FORMA-003 writes a select's value as the live
  // property after its options exist (042e353's writer). Today only the
  // attribute is written, and the first option stays selected.
  test.fail('select: after activation "b" is selected, and an update selects "c"', async ({ page }) => {
    await openActivated(page, 'select');
    expect(await selectState(page, '#choice')).toEqual({ value: 'b', index: 1 });
    await page.click('#pick-c');
    await expect(page.locator('#choice')).toHaveValue('c', SETTLE);
    expect(await submitted(page, 'choice')).toEqual(['c']);
  });

  // Expected to fail until FORMA-003, as above, on the client-rendered path.
  test.fail('select: client-rendered, "b" is selected, and an update selects "c"', async ({ page }) => {
    await openClientRendered(page, 'select');
    expect(await selectState(page, '#choice')).toEqual({ value: 'b', index: 1 });
    await page.click('#pick-c');
    await expect(page.locator('#choice')).toHaveValue('c', SETTLE);
  });
});

// ── Controls edited before activation (DR-5) ──────────────────────────────
//
// These pass on FormaJS main, which writes only attributes at adoption, and a
// user-edited control ignores attribute writes. They fail with the checkpoint
// commit 042e353, whose live-property writer assigns the client's value at
// adoption. FORMA-003 keeps that writer for later writes and must keep these
// green.

test.describe('edited-controls', () => {
  test('edited-controls: text typed before activation survives it, with focus', async ({ page }) => {
    const held = await openHeld(page, 'edited-controls');
    const input = page.locator('#name');
    await expect(input).toHaveValue('server');
    await input.click();
    await input.press('End');
    await input.pressSequentially(' typed');
    await expect(input).toHaveValue('server typed');

    await held.activate();
    await expect(input).toHaveValue('server typed', SETTLE);
    await expect(input).toBeFocused();
    expect(await submitted(page, 'name')).toEqual(['server typed']);
  });

  test('edited-controls: a checkbox ticked before activation stays ticked', async ({ page }) => {
    const held = await openHeld(page, 'edited-controls');
    const box = page.locator('#agreed');
    await expect(box).not.toBeChecked();
    await box.check();

    await held.activate();
    await expect(box).toBeChecked(SETTLE);
    expect(await submitted(page, 'agreed')).toEqual(['on']);
  });

  test('edited-controls: an option picked before activation stays picked', async ({ page }) => {
    const held = await openHeld(page, 'edited-controls');
    const select = page.locator('#size');
    await expect(select).toHaveValue('s');
    await select.selectOption('l');

    await held.activate();
    await expect(select).toHaveValue('l', SETTLE);
    expect(await submitted(page, 'size')).toEqual(['l']);
  });
});

// ── Ledger's arrival pattern: the positive fixture (audit verification run 7)

test.describe('ledger-arrival', () => {
  test('ledger-arrival: the walker renders the seeded snapshot before JavaScript', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/ledger-arrival/');
    const island = noJs.page.locator('[data-forma-component="Arrival"]');
    await expect(island).toHaveAttribute('data-forma-status', 'pending');
    await expect(noJs.page.locator('#arrival-title')).toHaveText('Fixture Household');
    await expect(noJs.page.locator('#arrival-cash')).toHaveText('$123.45');
    await expect(noJs.page.locator('#arrival-status')).toHaveText('pending');
    await expect(noJs.page.locator('#arrival-retry')).toHaveCount(0);
    await noJs.close();
  });

  test('ledger-arrival: seeding keeps the server values through activation, and Retry runs', async ({ page }) => {
    const errors = watchErrors(page);
    const held = await openHeld(page, 'ledger-arrival');
    await expect(page.locator('#arrival-title')).toHaveText('Fixture Household');
    await held.activate();

    // The server's values, not the signals' literal defaults ('Household', '$0.00').
    await expect(page.locator('#arrival-title')).toHaveText('Fixture Household');
    await expect(page.locator('#arrival-cash')).toHaveText('$123.45');

    // The workspace cannot load (the fixture server has no API): the snapshot
    // stays, the status says so, and Retry appears.
    const status = page.locator('#arrival-status');
    await expect(status).toHaveText('The workspace could not load (attempt 1). This snapshot is not live.', SETTLE);
    await expect(page.locator('#arrival-title')).toHaveText('Fixture Household');
    await expect(page.locator('#arrival-cash')).toHaveText('$123.45');

    await page.click('#arrival-retry');
    await expect(status).toHaveText('The workspace could not load (attempt 2). This snapshot is not live.', SETTLE);
    await expect(page.locator('#arrival-retry')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
