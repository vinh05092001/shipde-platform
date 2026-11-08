import { defineConfig, devices } from '@playwright/test';

// Stubbed carrier-catalog interaction suite: it serves its own HTML and API responses through
// page.route, so it needs no app server. The full a11y run (playwright.config.ts) keeps its server.
export default defineConfig({
  testDir: './e2e',
  testMatch: /carrier-catalog\.interactions\.spec\.ts$/,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
