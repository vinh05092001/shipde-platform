import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Public routes that render without a signed-in session.
const ROUTES = ['/', '/register', '/forgot-password', '/reset-password'];

for (const route of ROUTES) {
  test(`${route} has no WCAG 2.1 A/AA violations`, async ({ page }, testInfo) => {
    const response = await page.goto(route);
    expect(response?.ok(), `GET ${route} returned ${response?.status()}`).toBeTruthy();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    await testInfo.attach('axe-results', {
      body: JSON.stringify(
        { violations: results.violations, incomplete: results.incomplete },
        null,
        2
      ),
      contentType: 'application/json',
    });
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`
    );
    expect(summary, summary.join('\n')).toEqual([]);
  });
}
