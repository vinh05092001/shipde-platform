import { defineConfig, devices } from '@playwright/test';

// TASK GOAL-AUTOCLAW-REPOS-6: browser accessibility gate (axe-core) against the built app.
const port = Number(process.env.SHIPDE_A11Y_PORT || 3100);
// The targeted interaction suite serves its HTML and API responses through page.route.
const interactionsOnly = process.argv.some((arg) =>
  /(?:^|[/\\])carrier-catalog\.interactions\.spec\.ts$/.test(arg)
);

export default defineConfig({
  testDir: './e2e',
  reporter: [['list'], ['json', { outputFile: 'test-results/a11y-report.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: interactionsOnly
    ? undefined
    : {
        command: `pnpm exec next start -p ${port}`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
