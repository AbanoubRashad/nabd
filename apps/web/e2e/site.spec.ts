// Marketing pages, Arabic RTL, keyboard and accessibility. Needs only the web app.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/screenshots';

test('landing renders the hero, numbers strip and five platform tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Every device has a pulse.' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(5);
  await expect(page.getByText(/AI-generated/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/landing.png`, fullPage: true });
});

test('platform tabs follow the WAI-ARIA tabs pattern with arrow keys', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Platform capabilities' }).getByRole('tab');
  await tabs.first().focus();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Live without refreshing');
  await page.keyboard.press('End');
  await expect(tabs.nth(4)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight'); // wraps around
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
});

test('the products mega-menu opens by keyboard and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const products = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Products' });
  await products.focus();
  await page.keyboard.press('Enter');
  await expect(products).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: /P1 Power Node/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(products).toHaveAttribute('aria-expanded', 'false');
  await expect(products).toBeFocused();
});

test('product filters sync to the URL and the FAQ toggles', async ({ page }) => {
  await page.goto('/products');
  await page.getByRole('button', { name: /^Controllers/ }).click();
  await expect(page).toHaveURL(/cat=controllers/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Planned', exact: true }).click();
  await expect(page).toHaveURL(/cat=controllers&status=planned/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 3, name: /W1/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /R1/ })).toHaveCount(0);

  await page.goto('/products?cat=gateways');
  await expect(page.getByRole('heading', { level: 3, name: /G1/ })).toBeVisible();

  const q = page.getByRole('button', { name: 'Can I use my own sensors?' });
  await q.click();
  await expect(q).toHaveAttribute('aria-expanded', 'true');
});

for (const path of ['/ar', '/ar/products', '/ar/fleet']) {
  test(`Arabic ${path} is right-to-left with no horizontal scroll at 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/ar-${path.replaceAll('/', '_')}-390.png`, fullPage: false });
  });
}

for (const path of ['/', '/products', '/ar', '/fleet']) {
  test(`axe finds no serious or critical issues on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      serious.map(
        (v) =>
          `${v.id}: ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(', ')}`,
      ),
    ).toEqual([]);
  });
}
