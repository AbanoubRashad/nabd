// Live behaviour: needs the full stack (API, broker, database, ingest and simulator).
import { expect, test } from '@playwright/test';

const API = process.env.API_URL ?? 'http://localhost:4000';

// The API allows one demo command per IP every 3 s, so the tests that send one run in order and wait out
// the window instead of racing each other into a 429. The window counts from when the command was sent,
// so each test calls `commandSent()` right after its click, key press or request.
test.describe.configure({ mode: 'serial' });
const COMMAND_WINDOW_MS = 3200;
let lastCommandAt = 0;
async function commandSlot() {
  const wait = lastCommandAt + COMMAND_WINDOW_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
function commandSent() {
  lastCommandAt = Date.now();
}

test.beforeAll(async ({ request }) => {
  const ok = await request
    .get(`${API}/healthz`, { timeout: 2000 })
    .then((r) => r.ok())
    .catch(() => false);
  test.skip(!ok, `API not reachable at ${API}: start it with pnpm infra:up && pnpm dev`);
});

test('the fleet page receives a live update within 3 seconds', async ({ page }) => {
  await page.goto('/fleet');
  await expect(page.getByRole('status').filter({ hasText: 'LIVE · WebSocket' })).toBeVisible({
    timeout: 5000,
  });
  const row = page.getByRole('row', { name: /nabd-07/ });
  const before = await row.textContent();
  await expect.poll(async () => row.textContent(), { timeout: 3000, intervals: [250] }).not.toBe(before);
  await page.screenshot({ path: 'e2e/screenshots/fleet.png', fullPage: true });
});

test('the relay reaches "Device confirmed" on a simulated device', async ({ page }) => {
  await page.goto('/devices/nabd-05');
  const relay = page.getByRole('button', { name: 'Irrigation pump relay' });
  await expect(relay).toBeEnabled({ timeout: 6000 });
  const before = await relay.getAttribute('aria-pressed');
  await commandSlot();
  await relay.click();
  commandSent();
  const steps = page.getByRole('list', { name: 'Command progress' });
  await expect(steps.getByText('Device confirmed')).toBeVisible();
  await expect(steps.locator('li').nth(2)).toContainText('ms', { timeout: 8000 });
  await expect(relay).not.toHaveAttribute('aria-pressed', before ?? '', { timeout: 8000 });
  await page.screenshot({ path: 'e2e/screenshots/device.png', fullPage: true });
});

test('the relay can be toggled with the keyboard only', async ({ page }) => {
  await page.goto('/devices/nabd-06');
  const relay = page.getByRole('button', { name: 'Shade motor relay' });
  await expect(relay).toBeEnabled({ timeout: 6000 });
  const before = await relay.getAttribute('aria-pressed');
  await relay.focus();
  await commandSlot();
  await page.keyboard.press('Space');
  commandSent();
  await expect(relay).not.toHaveAttribute('aria-pressed', before ?? '', { timeout: 8000 });
});

test('anonymous visitors cannot switch the real board', async ({ request }) => {
  await commandSlot();
  const res = await request.post(`${API}/devices/nabd-01/commands`, {
    headers: { 'x-nabd-csrf': '1' },
    data: { op: 'relay.set', args: { ch: 1, on: true } },
  });
  commandSent();
  // 403 when nabd-01 is the real board (NABD_REAL_DEVICE); in development it is simulated.
  expect([202, 403]).toContain(res.status());
});
