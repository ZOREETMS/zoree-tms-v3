// ═══════════════════════════════════════════════════════════════════
// Playwright config — REQ-01+ end-to-end tests against the local TMS.
// Put test specs under ./test/ as described in the tms-test skill.
// ═══════════════════════════════════════════════════════════════════

const { defineConfig, devices } = require('@playwright/test');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

module.exports = defineConfig({
  testDir: './test',
  testMatch: ['**/REQ-*.spec.js'],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'test/results/playwright-report', open: 'never' }]],
  outputDir: 'test/results/playwright-artifacts',
  use: {
    baseURL: FRONTEND_URL,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
