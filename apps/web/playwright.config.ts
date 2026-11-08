import { defineConfig, devices } from '@playwright/test';

// TASK GOAL-AUTOCLAW-REPOS-6: browser accessibility gate (axe-core) against the built app.
const port = Number(process.env.SHIPDE_A11Y_PORT || 3100);

export default defineConfig({
  testDir: './e2e',
  reporter: [['list'], ['json', { outputFile: 'test-results/a11y-report.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
