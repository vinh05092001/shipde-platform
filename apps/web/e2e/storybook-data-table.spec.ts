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

  // Real browser Forward: restores the search=GHTK entry
  await page.goForward();
  await page.waitForURL(/search=GHTK/);
  await expect(search).toHaveValue('GHTK');
});

test('mounted toolbar rejects stale draft when navigation arrives during editing', async ({
  page,
}) => {
  await page.goto('/storybook');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toBeVisible();

  const held = await holdTableNavigation(page);
  try {
    // User types "N", trigger URL push
    await search.fill('N');
    await expect
      .poll(() => held.requests.some((url) => url.searchParams.get('search') === 'N'))
      .toBe(true);

    // User continues typing "Ng" and "Ngu" while the first navigation is in-flight
    await search.fill('Ng');
    await search.fill('Ngu');
    await expect(search).toHaveValue('Ngu');
  } finally {
    await held.finish();
  }

  // Once all navigations settle, input draft must hold the latest user text "Ngu"
  await page.waitForURL((url) => url.searchParams.get('search') === 'Ngu');
  await expect(search).toHaveValue('Ngu');
});

test('mounted pagination dropdown synchronizes per_page without state loss', async ({ page }) => {
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

test('mounted column sorting updates URL and preserves filters', async ({ page }) => {
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

test('mounted reset filters clears search and facet filters but retains default view', async ({
  page,
}) => {
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

test('mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment', async ({
  page,
}) => {
  // Scenario: the user navigated through "" -> "N" -> "Ng". Later, while editing
  // "Ngu" on top of "N", the user navigates Back to "Ng". The committed value
  // "Ng" matches an entry in pending edits ["Ng", "Ngu"], so a naive equality
  // check would treat it as an acknowledgment of the older "Ng" edit and KEEP
  // the draft at "Ngu". Surfacing useDataTable `historyEpoch` into the toolbar
  // marks the change as a real navigation event, forcing the draft to resync.
  await page.goto('/storybook');
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

    // In the same dropdown, before first request commits, select second option: Giao thành công (DELIVERED) (Finding 11 P1)
    await page.getByRole('option', { name: /Giao thành công/ }).click();
    await expect
      .poll(() =>
        held.requests.some((url) => {
          const s = url.searchParams.get('status');
          return Boolean(s && s.includes('FAILED') && s.includes('DELIVERED'));
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

  const drawer = page.getByRole('dialog', { name: 'Điều hướng chính' });
  await expect(drawer).toBeVisible();

  // Query focusable elements inside the drawer
  const focusables = drawer.locator(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const first = focusables.first();
  const last = focusables.last();

  // Test Shift+Tab wrapping from first element wraps to last element (backward wrap - Finding 3 P2)
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();

  // Test Tab wrapping from last element wraps to first element (forward wrap - Finding 3 P2)
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();

  // Test Escape key closes drawer and restores focus to hamburger trigger
  await page.keyboard.press('Escape');
  await expect(closeButton).not.toBeVisible();
  await expect(hamburger).toBeFocused();
});

test('review 6 / finding 8 P2: table thead remains sticky at top during vertical scrolling', async ({
  page,
}) => {
  await page.goto('/storybook');
  const scrollContainer = page.getByTestId('table-scroll-container');
  await expect(scrollContainer).toBeVisible();

  const thead = scrollContainer.locator('thead');
  await expect(thead).toBeVisible();

  // Initial header bounding box
  const initialTheadBox = await thead.boundingBox();
  expect(initialTheadBox).not.toBeNull();

  // Scroll the table container vertically
  await scrollContainer.evaluate((el) => {
    el.scrollTop = 150;
  });

  // Verify thead remains stuck at top of scroll container
  const scrolledTheadBox = await thead.boundingBox();
  const containerBox = await scrollContainer.boundingBox();

  expect(scrolledTheadBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  if (scrolledTheadBox && containerBox) {
    // Top of the sticky thead should align with or stay within top border of scroll container
    expect(Math.abs(scrolledTheadBox.y - containerBox.y)).toBeLessThanOrEqual(2);
  }
});
