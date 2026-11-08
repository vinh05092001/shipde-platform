import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Live Slice B journey: run against the built web app and seeded Slice A API.
 * The calling browser project must supply an authenticated shop session with
 * iam:carrier_catalog:read. This spec never fabricates session or catalog data,
 * reads credentials, or intercepts API requests. Missing prerequisites fail.
 */
test('catalog browsing, service and taxonomy dialogs, filters and keyboard recovery', async ({
  page,
}) => {
  await page.goto('/settings/carriers');
  await page.getByTestId('tab-catalog').click();
  const catalog = page.getByTestId('carrier-catalog-view');
  await expect(catalog.getByTestId('carrier-grid')).toBeVisible();
  const cards = catalog.locator('article[data-testid^="carrier-card-"]');
  expect(await cards.count()).toBeGreaterThan(0);
  const first = cards.first();
  const code = await first.locator('[data-testid^="carrier-monogram-"]').getAttribute('aria-label');
  expect(code).toBeTruthy();

  const search = catalog.getByTestId('input-search-carrier');
  await search.fill(code!);
  await expect(first).toBeVisible();
  await page.getByTestId('tab-accounts').click();
  await expect(page.getByRole('button', { name: /Kết nối/ })).toHaveCount(0);
  await page.getByTestId('tab-catalog').click();
  await expect(search).toHaveValue(code!);
  await catalog.getByRole('button', { name: 'Làm mới danh mục' }).click();
  await expect(first).toBeVisible();
  await expect(search).toHaveValue(code!);

  for (const opener of [
    first.getByRole('button', { name: /Xem dịch vụ/ }),
    catalog.getByRole('button', { name: 'Trạng thái Canonical', exact: true }),
    catalog.getByRole('button', { name: 'Hệ thống Phí', exact: true }),
  ]) {
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await search.fill('no-carrier-matches-this-search');
  await expect(catalog.getByTestId('carrier-grid-empty')).toContainText('phù hợp với bộ lọc');
  await catalog.getByTestId('carrier-grid-empty').getByRole('button').click();
  await expect(search).toHaveValue('');
  await expect(cards.first()).toBeVisible();
  await search.fill('x'.repeat(201));
  await expect(search).toHaveAttribute('aria-invalid', 'true');
  await expect(catalog.locator('#search-error')).toBeVisible();
});
