import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running web app (BASE_URL, default http://localhost:3001). The live tests also
 * need the API, broker, database and simulator (`pnpm infra:up && pnpm dev`); they skip themselves when
 * the API is not reachable, and say so.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
