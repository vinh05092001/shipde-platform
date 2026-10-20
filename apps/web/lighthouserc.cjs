// GOAL-AUTOCLAW-REPOS-6: Lighthouse CI budgets for the public web routes.
// Chrome comes from the Playwright install the a11y gate already provisions.
const { chromium } = require('@playwright/test');

const port = Number(process.env.SHIPDE_LHCI_PORT || 3200);
const base = `http://127.0.0.1:${port}`;

module.exports = {
  ci: {
    collect: {
      startServerCommand: `pnpm exec next start -p ${port}`,
      startServerReadyPattern: 'Ready',
      url: ['/', '/register', '/forgot-password', '/reset-password'].map((p) => base + p),
      numberOfRuns: 3,
      chromePath: process.env.CHROME_PATH || chromium.executablePath(),
      settings: { preset: 'desktop', chromeFlags: '--headless=new --no-sandbox' },
    },
    assert: {
      assertions: {
        // Blocking: TECH-STACK-REPOSITORY "targeted Lighthouse CI budgets";
        // DESIGN-SYSTEM-UX-RULES requires WCAG AA.
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:performance': ['warn', { minScore: 0.8, aggregationMethod: 'median-run' }],
        'categories:seo': ['warn', { minScore: 0.8, aggregationMethod: 'median-run' }],
      },
    },
    upload: { target: 'filesystem', outputDir: './lhci-report' },
  },
};
