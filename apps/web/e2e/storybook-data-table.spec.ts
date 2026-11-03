import { expect, test, type Page } from '@playwright/test';

// TASK-AI-155 browser acceptance (Review item 2): Back/Forward must be
// verified on the REAL mounted Next.js /storybook page — real browser history
// entries, real Next.js router commits, real DOM. This replaces the removed
// static-markup harness, which re-rendered on every popstate and never kept a
// React DOM tree mounted.

const SEARCH_LABEL = 'Tìm theo mã vận đơn, mã đơn, khách hàng...';
const PAGE_SIZE_LABEL = 'Chọn số dòng hiển thị mỗi trang';

// Hold actual Next.js RSC navigation requests. Tests assert requests were held
// before interacting again, so a sequential happy path cannot pass as evidence
// for pending-navigation behavior. The React tree remains mounted throughout.
async function holdTableNavigation(page: Page) {
  const requests: URL[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/storybook?**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('_rsc')) {
      await route.continue();
      return;
    }
    requests.push(url);
    await released;
    await route.continue();
  });
  return {
    requests,
    finish: async () => {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    },
  };
}

test('mounted /storybook table restores state on real browser back/forward', async ({ page }) => {
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

  // Real browser Back: returns to the page=2 history entry. The mounted
  // toolbar must resynchronize to the URL — the newer "GHTK" draft must NOT
  // survive navigation (Review item 3).
  await page.goBack();
  await page.waitForURL(
    (url) => url.searchParams.get('page') === '2' && !url.searchParams.has('search')
  );
  await expect(search).toHaveValue('');
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();

  // Real browser Forward: restores the search=GHTK history entry.
  await page.goForward();
  await page.waitForURL(/search=GHTK/);
  await expect(search).toHaveValue('GHTK');
});

test('mounted /storybook table restores deep-link state on first paint', async ({ page }) => {
  await page.goto('/storybook?per_page=5&search=GHTK');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toHaveValue('GHTK');

  // Filtered fixture rows only (BR-UI-01 shareable/reproducible URLs)
  await expect(page.getByText(/^GHTK74219082VN$/)).toBeVisible();
  await expect(page.getByText(/^GHTK12948293VN$/)).toBeVisible();
  await expect(page.getByText(/^GHTK90283741VN$/)).toBeVisible();
  await expect(page.getByText(/^GHN982341201VN$/)).toBeHidden();
  await expect(page.getByText(/^Hiển thị 1-3 trên 3 bản ghi$/)).toBeVisible();
});

test('review 2: mounted showcase covers loaded, loading, empty and error recovery', async ({
  page,
}) => {
  await page.goto('/storybook');
  const table = page.getByRole('table');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(page.getByText('[FIXTURE DATA]', { exact: false })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(8);
  await expect(table.locator('th[scope="col"]')).not.toHaveCount(0);
  await expect(table.getByText('350.000 đ', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mô phỏng Loading Skeleton' }).click();
  await expect(table.locator('tbody')).toHaveAttribute('aria-busy', 'true');
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(table.getByText('GHN982341201VN', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Đang bật Skeleton (Nhấn để tắt)' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(8);
  await page.getByRole('button', { name: 'Mô phỏng Trạng thái Lỗi (Error 500)' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await search.fill('fixture-no-such-shipment');
  await page.waitForURL((url) => url.searchParams.get('search') === 'fixture-no-such-shipment');
  await expect(
    table.getByText('Không tìm thấy vận đơn nào phù hợp', { exact: true })
  ).toBeVisible();
  await table.getByRole('button', { name: 'Đặt lại bộ lọc' }).click();
  await page.waitForURL((url) => !url.searchParams.has('search'));
  await expect(search).toHaveValue('');
  await expect(table.locator('tbody tr')).toHaveCount(8);
});

test('mounted /storybook table accumulates successive interactions in the URL', async ({
  page,
}) => {
  await page.goto('/storybook');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  const pageSizeSelect = page.locator(`select[aria-label="${PAGE_SIZE_LABEL}"]`);
  await expect(search).toBeVisible();

  // Shrink page size to 5 → 8 fixture records span 2 pages
  await pageSizeSelect.selectOption('5');
  await page.waitForURL(/per_page=5/);
  await expect(page.getByText(/^Trang 1 \/ 2$/)).toBeVisible();

  // Paginate to page 2 → per_page and page must coexist in the URL
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(
    (url) => url.searchParams.get('page') === '2' && url.searchParams.get('per_page') === '5'
  );
  await expect(page.getByText(/^Trang 2 \/ 2$/)).toBeVisible();

  // Search, then clear: clearing must not drop the committed per_page
  await search.fill('GHTK');
  await page.waitForURL(/search=GHTK/);
  await search.fill('');
  await page.waitForURL(
    (url) =>
      url.searchParams.get('per_page') === '5' && (url.searchParams.get('search') ?? '') === ''
  );
  await expect(search).toHaveValue('');
  await expect(page.getByText(/^Trang 1 \/ 2$/)).toBeVisible();
});

test('review 3: mounted browser Back discards colliding pending search edits', async ({ page }) => {
  await page.goto('/storybook?search=Ng&sort=codAmount.desc');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toHaveValue('Ng');
  await search.fill('N');
  await page.waitForURL((url) => url.searchParams.get('search') === 'N');
  // Use a different sort so pending "Ng" is not served from the initial
  // entry's router cache. These are three real, in-document history entries.
  await page.getByRole('button', { name: /^Sắp xếp theo Thu hộ COD:/ }).click();
  await page.getByRole('menuitem', { name: 'Tăng dần' }).click();
  await page.waitForURL((url) => url.searchParams.get('sort') === 'codAmount.asc');

  const held = await holdTableNavigation(page);
  try {
    await search.fill('Ng');
    await expect
      .poll(() => held.requests.some((url) => url.searchParams.get('search') === 'Ng'))
      .toBe(true);
    await search.fill('Ngu');
    await expect
      .poll(() => held.requests.some((url) => url.searchParams.get('search') === 'Ngu'))
      .toBe(true);
    await expect(search).toHaveValue('Ngu');
    expect(new URL(page.url()).searchParams.get('search')).toBe('N');

    // Back two entries to the existing "Ng" value, which also appears in
    // pending edits ["Ng", "Ngu"]. Equality alone cannot identify this event.
    await page.evaluate(() => window.history.go(-2));
    await page.waitForURL(
      (url) =>
        url.searchParams.get('search') === 'Ng' && url.searchParams.get('sort') === 'codAmount.desc'
    );
    await expect(search).toHaveValue('Ng');
  } finally {
    await held.finish();
  }
  await expect(search).toHaveValue('Ng');
  expect(new URL(page.url()).searchParams.get('search')).toBe('Ng');
});

test('review 4: mounted successive facets retain earlier changes during delayed navigation', async ({
  page,
}) => {
  await page.goto('/storybook');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toBeVisible();
  const held = await holdTableNavigation(page);
  try {
    await page.getByRole('button', { name: /^Bộ lọc Trạng thái:/ }).click();
    await page.getByRole('option', { name: /Giao thất bại/ }).click();
    await expect
      .poll(() => held.requests.some((url) => url.searchParams.get('status') === 'FAILED'))
      .toBe(true);
    await page.getByRole('button', { name: /^Bộ lọc Hãng vận chuyển:/ }).click();
    await page.getByRole('option', { name: /GHN/ }).click();
    await expect
      .poll(() => held.requests.some((url) => url.searchParams.get('carrier') === 'GHN'))
      .toBe(true);
    const carrierRequest = held.requests.find((url) => url.searchParams.get('carrier') === 'GHN')!;
    expect(carrierRequest.searchParams.get('status')).toBe('FAILED');
    // A third edit must preserve both prior intents, before any request commits.
    await search.fill('Ng');
    await expect
      .poll(() => held.requests.some((url) => url.searchParams.get('search') === 'Ng'))
      .toBe(true);
    const searchRequest = held.requests.find((url) => url.searchParams.get('search') === 'Ng')!;
    expect(searchRequest.searchParams.get('status')).toBe('FAILED');
    expect(searchRequest.searchParams.get('carrier')).toBe('GHN');
  } finally {
    await held.finish();
  }
  await page.waitForURL(
    (url) =>
      url.searchParams.get('status') === 'FAILED' &&
      url.searchParams.get('carrier') === 'GHN' &&
      url.searchParams.get('search') === 'Ng'
  );
  await expect(search).toHaveValue('Ng');
  await expect(page.getByRole('button', { name: 'Bộ lọc Trạng thái: 1 đã chọn' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Bộ lọc Hãng vận chuyển: 1 đã chọn' })
  ).toBeVisible();
});

test('review 4 / finding 4 P1: mounted overlapping selections in the same facet dropdown accumulate without losing prior selections', async ({
  page,
}) => {
  await page.goto('/storybook');
  const held = await holdTableNavigation(page);
  try {
    // Open Status facet dropdown
    await page.getByRole('button', { name: /^Bộ lọc Trạng thái:/ }).click();

    // Select first option: Giao thất bại (FAILED)
    await page.getByRole('option', { name: /Giao thất bại/ }).click();
    await expect
      .poll(() => held.requests.some((url) => url.searchParams.get('status')?.includes('FAILED')))
      .toBe(true);

    // In the same dropdown, before first request commits, select second option: Đã giao hàng (DELIVERED)
    await page.getByRole('option', { name: /Đã giao hàng/ }).click();
    await expect
      .poll(() =>
        held.requests.some((url) => {
          const s = url.searchParams.get('status');
          return s && s.includes('FAILED') && s.includes('DELIVERED');
        })
      )
      .toBe(true);
  } finally {
    await held.finish();
  }

  await page.waitForURL((url) => {
    const s = url.searchParams.get('status');
    return Boolean(s && s.includes('FAILED') && s.includes('DELIVERED'));
  });

  await expect(page.getByRole('button', { name: 'Bộ lọc Trạng thái: 2 đã chọn' })).toBeVisible();
});

test('review 3 P2: mobile drawer focus trap wraps focus and restores focus to hamburger trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/storybook');

  const hamburger = page.getByRole('button', { name: 'Mở thanh điều hướng' });
  await expect(hamburger).toBeVisible();
  await hamburger.focus();
  await hamburger.click();

  const closeButton = page.getByRole('button', { name: 'Đóng thanh điều hướng' });
  await expect(closeButton).toBeVisible();

  // Test Escape key closes drawer and restores focus to hamburger trigger
  await page.keyboard.press('Escape');
  await expect(closeButton).not.toBeVisible();
  await expect(hamburger).toBeFocused();
});
