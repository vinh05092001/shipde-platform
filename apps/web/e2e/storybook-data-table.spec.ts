import { expect, test, type Page } from '@playwright/test';

const SEARCH_LABEL = 'Tìm theo mã vận đơn, mã đơn, khách hàng...';
const PAGE_SIZE_LABEL = 'Chọn số dòng hiển thị mỗi trang';

test('AC-AI-155: mounted /storybook table restores state on real browser back/forward', async ({ page }) => {
  await page.goto('/storybook?per_page=5');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toBeVisible();
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Interaction 1: next page via the real pagination control (pushes page=2)
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();

  // Interaction 2: search while on page 2 (pushes search=GHTK, resets page)
  await search.fill('GHTK');
  await page.waitForURL(/search=GHTK/);
  await expect(search).toHaveValue('GHTK');

  // Real browser Back: returns to the page=2 history entry
  await page.goBack();
  await page.waitForURL(
    (url) => url.searchParams.get('page') === '2' && !url.searchParams.has('search')
  );
  await expect(search).toHaveValue('');
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();

  // Real browser Forward: restores the search=GHTK entry
  await page.goForward();
  await page.waitForURL(/search=GHTK/);
  await expect(search).toHaveValue('GHTK');
});

test('AC-AI-155: mounted pagination dropdown synchronizes per_page without state loss', async ({ page }) => {
  await page.goto('/storybook');
  const pageSizeSelect = page.getByRole('combobox', { name: PAGE_SIZE_LABEL });
  await expect(pageSizeSelect).toBeVisible();

  await pageSizeSelect.selectOption('5');
  await page.waitForURL(/per_page=5/);
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Change page to 2
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);

  // Switch to per_page=20: page count drops to 1, clamps page safely
  await pageSizeSelect.selectOption('20');
  await page.waitForURL(/per_page=20/);
  await expect(page.getByText(new RegExp(`^Trang 1 / 1$`))).toBeVisible();
});

test('AC-AI-155: mounted column sorting updates URL and preserves filters', async ({ page }) => {
  await page.goto('/storybook?search=An');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toHaveValue('An');

  // Sort by Thu hộ COD
  const codHeader = page.getByRole('button', { name: /^Sắp xếp theo Thu hộ COD:/ });
  await expect(codHeader).toBeVisible();
  await codHeader.click();

  // Click Tăng dần
  await page.getByRole('menuitem', { name: 'Tăng dần' }).click();
  await page.waitForURL((url) => url.searchParams.get('sort') === 'codAmount.asc');

  // Verify search filter was preserved
  expect(new URL(page.url()).searchParams.get('search')).toBe('An');
  await expect(search).toHaveValue('An');
});

test('AC-AI-155: mounted reset filters clears search and facet filters but retains default view', async ({ page }) => {
  await page.goto('/storybook?search=An&status=DELIVERED');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toHaveValue('An');

  const resetButton = page.getByRole('button', { name: 'Đặt lại tất cả bộ lọc' });
  await expect(resetButton).toBeVisible();
  await resetButton.click();

  await page.waitForURL(
    (url) => !url.searchParams.has('search') && !url.searchParams.has('status')
  );
  await expect(search).toHaveValue('');
  await expect(resetButton).not.toBeVisible();
});

test('AC-AI-155: mounted pagination remains synchronized after Back then Next', async ({ page }) => {
  await page.goto('/storybook?per_page=5');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toBeVisible();
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Click Next: advances to page 2
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();

  // Real browser Back: restores page 1
  await page.goBack();
  await page.waitForURL(
    (url) => !url.searchParams.has('page') || url.searchParams.get('page') === '1'
  );
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Click Next again: URL contains page=2, indicator reads Trang 2 / 2
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  await expect(page.getByText('GHN512938472VN')).toBeVisible();
});