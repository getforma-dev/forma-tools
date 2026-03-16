/**
 * FormaJS Full-Stack E2E Tests
 *
 * Verifies the complete Forma pipeline in a real browser:
 *   1. HTML Runtime (data-* directives) — zero JS, reactive via CDN
 *   2. Programmatic h() API — createSignal + h() + mount()
 *   3. Compiled template path — template() + cloneNode() (compiler output pattern)
 *
 * Run: npx playwright test
 * Guide: See e2e/README.md
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/full-stack.html');
});

// ═══════════════════════════════════════════════════════════════════════
// Test 1: HTML Runtime (data-* directives)
// ═══════════════════════════════════════════════════════════════════════

test.describe('HTML Runtime — data-* directives', () => {
  test('renders initial state as text', async ({ page }) => {
    await expect(page.locator('#rt-text')).toHaveText('Hello World');
    await expect(page.locator('#rt-count')).toHaveText('0');
  });

  test('increments counter on click', async ({ page }) => {
    await page.click('#rt-inc');
    await expect(page.locator('#rt-count')).toHaveText('1');
    await page.click('#rt-inc');
    await expect(page.locator('#rt-count')).toHaveText('2');
  });

  test('resets counter', async ({ page }) => {
    await page.click('#rt-inc');
    await page.click('#rt-inc');
    await expect(page.locator('#rt-count')).toHaveText('2');
    await page.click('#rt-reset');
    await expect(page.locator('#rt-count')).toHaveText('0');
  });

  test('two-way binding with data-model', async ({ page }) => {
    await page.fill('#rt-input', 'Forma');
    await expect(page.locator('#rt-text')).toHaveText('Hello Forma');
  });

  test('data-show toggles visibility', async ({ page }) => {
    // count=0, should be hidden
    await expect(page.locator('#rt-show')).toBeHidden();
    await page.click('#rt-inc');
    // count=1, should be visible
    await expect(page.locator('#rt-show')).toBeVisible();
    await page.click('#rt-reset');
    // count=0 again, hidden
    await expect(page.locator('#rt-show')).toBeHidden();
  });

  test('data-class toggles CSS class', async ({ page }) => {
    await expect(page.locator('#rt-class')).not.toHaveClass(/active/);
    // Click 3 times to get count > 2
    await page.click('#rt-inc');
    await page.click('#rt-inc');
    await page.click('#rt-inc');
    await expect(page.locator('#rt-class')).toHaveClass(/active/);
  });

  test('data-computed derives values', async ({ page }) => {
    await expect(page.locator('#rt-computed')).toHaveText('0');
    await page.click('#rt-inc');
    await expect(page.locator('#rt-computed')).toHaveText('2');
    await page.click('#rt-inc');
    await expect(page.locator('#rt-computed')).toHaveText('4');
  });

  test('$refs resolves data-ref elements', async ({ page }) => {
    await expect(page.locator('#rt-ref-check')).toHaveText('ref-found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Test 2: Programmatic h() API
// ═══════════════════════════════════════════════════════════════════════

test.describe('Programmatic h() API', () => {
  test('mount() renders h() tree into DOM', async ({ page }) => {
    await expect(page.locator('#h-container')).toBeVisible();
    await expect(page.locator('#h-count')).toHaveText('0');
  });

  test('signal updates DOM reactively', async ({ page }) => {
    await page.click('#h-btn');
    await expect(page.locator('#h-count')).toHaveText('1');
    await page.click('#h-btn');
    await expect(page.locator('#h-count')).toHaveText('2');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Test 3: Compiled template path (compiler output pattern)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Compiled template path — template() + cloneNode()', () => {
  test('template creates DOM from HTML string', async ({ page }) => {
    await expect(page.locator('#tpl-container')).toBeVisible();
  });

  test('cloneNode produces working DOM with reactive text', async ({ page }) => {
    await expect(page.locator('#tpl-count')).toHaveText('0');
  });

  test('createEffect updates cloned text node on signal change', async ({ page }) => {
    await page.click('#tpl-btn');
    await expect(page.locator('#tpl-count')).toHaveText('1');
    await page.click('#tpl-btn');
    await expect(page.locator('#tpl-count')).toHaveText('2');
    await page.click('#tpl-btn');
    await expect(page.locator('#tpl-count')).toHaveText('3');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Test 4: Cross-cutting concerns
// ═══════════════════════════════════════════════════════════════════════

test.describe('Cross-cutting', () => {
  test('no console errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/full-stack.html');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('all three approaches coexist on same page', async ({ page }) => {
    // Runtime
    await expect(page.locator('#rt-count')).toHaveText('0');
    // h() API
    await expect(page.locator('#h-count')).toHaveText('0');
    // Compiled template
    await expect(page.locator('#tpl-count')).toHaveText('0');

    // Click all three independently
    await page.click('#rt-inc');
    await page.click('#h-btn');
    await page.click('#tpl-btn');

    // Each updates independently
    await expect(page.locator('#rt-count')).toHaveText('1');
    await expect(page.locator('#h-count')).toHaveText('1');
    await expect(page.locator('#tpl-count')).toHaveText('1');
  });
});
