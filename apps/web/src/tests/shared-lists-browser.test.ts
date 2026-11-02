import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';

// Run against the real Next app, with HTTP fixtures at its API boundary.
// Start `pnpm --filter @shipde/web dev --hostname 127.0.0.1 --port 3217` first.
const baseUrl = process.env.SHIPDE_LIST_TEST_URL ?? 'http://127.0.0.1:3217';
const artifactDir = process.env.SHIPDE_LIST_TEST_ARTIFACTS;
const check = expect.configure({ timeout: 15_000 });
const createdAt = '2026-10-30T00:00:00.000Z';

interface FixtureState {
  status: number;
  malformed: boolean;
  requests: URL[];
  created: Record<string, unknown>[];
}

async function installFixtures(context: BrowserContext, tenantId = 'tenant-a', userId = 'actor-a') {
  const state: FixtureState = { status: 200, malformed: false, requests: [], created: [] };
  await context.addInitScript(
    ({ tenantId, userId, createdAt }) => {
      if (localStorage.getItem('shipde_token')) return;
      localStorage.setItem('shipde_token', 'fixture-session');
      localStorage.setItem(
        'shipde_user',
        JSON.stringify({
          id: userId,
          merchant_id: tenantId,
          full_name: 'Review actor',
          email: 'actor@example.test',
          phone: '0900000000',
          role: 'OWNER',
          permissions: ['iam:manage_users', 'iam:shop_config', 'iam:shop_view'],
          store_scopes: ['*'],
          warehouse_scopes: ['*'],
          status: 'active',
          created_at: createdAt,
        })
      );
      localStorage.setItem(
        'shipde_merchant',
        JSON.stringify({
          id: tenantId,
          code: tenantId,
          name: 'Review tenant',
          status: 'active',
          created_at: createdAt,
        })
      );
    },
    { tenantId, userId, createdAt }
  );
  const rows = {
    branches: Array.from({ length: 105 }, (_, i) => ({
      id: `branch-${i + 1}`,
      merchant_id: tenantId,
      name: `Branch ${String(i + 1).padStart(3, '0')}`,
      code: `BR-${String(i + 1).padStart(3, '0')}`,
      address: 'Test address',
      phone: '0901234567',
      status: i % 2 ? 'INACTIVE' : 'ACTIVE',
      is_default: i === 0,
      created_at: createdAt,
      updated_at: createdAt,
    })),
    warehouses: Array.from({ length: 15 }, (_, i) => ({
      id: `warehouse-${i + 1}`,
      merchant_id: tenantId,
      name: `Warehouse ${String(i + 1).padStart(3, '0')}`,
      code: `WH-${String(i + 1).padStart(3, '0')}`,
      contact_name: 'Test contact',
      contact_phone: '0901234567',
      contact_email: 'contact@example.test',
      address_line: 'Test address',
      district: 'Test district',
      city: 'Test city',
      address_json: {},
      status: i % 2 ? 'inactive' : 'active',
      is_default: i === 0,
      use_different_return_address: false,
      printer_paper_size: 'A6',
      printer_dpi: 203,
      printer_auto_print: false,
      created_at: createdAt,
      updated_at: createdAt,
    })),
    users: Array.from({ length: 25 }, (_, i) => ({
      id: `user-${i + 1}`,
      merchant_id: tenantId,
      full_name: `User ${String(i + 1).padStart(3, '0')}`,
      email: `user${i + 1}@example.test`,
      phone: '0901234567',
      role: 'OPS_CSKH',
      status: 'ACTIVE',
      store_scopes: ['BR-001'],
      warehouse_scopes: [],
      carrier_account_scopes: [],
      created_at: createdAt,
      last_active_at: null,
    })),
  };
  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split('/').at(-1) as keyof typeof rows;
    if (!(resource in rows)) {
      await route.fulfill({ json: { success: true, data: [] } });
      return;
    }
    state.requests.push(url);
    if (route.request().method() === 'POST') {
      const saved = {
        ...route.request().postDataJSON(),
        id: `created-${resource}`,
        merchant_id: tenantId,
        status: resource === 'branches' ? 'ACTIVE' : 'active',
        created_at: createdAt,
        updated_at: createdAt,
      };
      state.created.push(saved);
      (rows[resource] as Record<string, unknown>[]).push(saved);
      await route.fulfill({
        status: 201,
        json: { success: true, data: saved, meta: { correlation_id: 'review-create' } },
      });
      return;
    }
    if (state.status !== 200) {
      await route.fulfill({
        status: state.status,
        json: {
          success: false,
          error: {
            code: state.status === 403 ? 'FORBIDDEN' : 'TEMPORARILY_UNAVAILABLE',
            message: 'unsafe-database-diagnostic',
          },
        },
      });
      return;
    }
    if (state.malformed) {
      await route.fulfill({ json: { success: true, data: [], meta: { total: 'invalid' } } });
      return;
    }
    const page = Number(url.searchParams.get('page') ?? 1);
    const limit = Number(url.searchParams.get('limit') ?? (resource === 'users' ? 20 : 10));
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const status = url.searchParams.get('status');
    let filtered = rows[resource].filter(
      (row) =>
        (!status || row.status === status) && JSON.stringify(row).toLowerCase().includes(search)
    );
    const field = url.searchParams.get('sort_by') ?? (resource === 'users' ? 'created_at' : 'name');
    const direction = url.searchParams.get('sort_order') === 'desc' ? -1 : 1;
    filtered = [...filtered].sort(
      (a, b) =>
        String(a[field as keyof typeof a] ?? a.id).localeCompare(
          String(b[field as keyof typeof b] ?? b.id)
        ) * direction
    );
    const meta = {
      page,
      limit,
      total: filtered.length,
      total_pages: Math.max(1, Math.ceil(filtered.length / limit)),
      correlation_id: 'review-browser',
    };
    const data = filtered.slice((page - 1) * limit, page * limit);
    await route.fulfill({
      json: {
        success: true,
        data: resource === 'branches' ? { branches: data, can_edit: true, meta } : data,
        meta,
      },
    });
  });
  return state;
}

async function saveView(page: Page, prefix: string, name: string) {
  await page.getByTestId(`${prefix}-save-view-btn`).click();
  await page.getByTestId(`${prefix}-view-name-input`).fill(name);
  await page.getByTestId(`${prefix}-view-name-input`).press('Enter');
  await check(page.getByTestId(`${prefix}-saved-views-select`)).toContainText(name);
}

async function capture(page: Page, name: string) {
  if (!artifactDir) return;
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: resolve(artifactDir, `${name}.png`), fullPage: true });
}

async function runBrowserRegressions() {
  const browser = await chromium.launch({ headless: true });
  let passed = 0;
  const scenario = async (
    name: string,
    work: (page: Page, state: FixtureState, context: BrowserContext) => Promise<void>
  ) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const state = await installFixtures(context);
    const page = await context.newPage();
    try {
      await work(page, state, context);
      passed++;
      console.log(`PASS: ${name}`);
    } catch (error) {
      await capture(page, `failed-${passed + 1}`);
      throw error;
    } finally {
      await context.close();
    }
  };
  try {
    await scenario(
      'branches use server pages/counts and issue filtered/sorted HTTP queries',
      async (page, state) => {
        await page.goto(`${baseUrl}/settings/branches`);
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await check(page.getByTestId('branch-total-count')).toHaveText('105 chi nhánh');
        await check(page.getByTestId('branch-item-branch-1')).toBeVisible();
        await check(page.getByTestId('branch-item-branch-11')).toHaveCount(0);
        await page.getByTestId('branch-pagination-next-btn').click();
        await check(page.getByTestId('branch-item-branch-11')).toBeVisible();
        await check(page.getByTestId('branch-total-count')).toHaveText('105 chi nhánh');
        await check(page.getByTestId('branch-item-branch-1')).toHaveCount(0);
        assert.ok(
          state.requests.some(
            (url) => url.searchParams.get('page') === '2' && url.searchParams.get('limit') === '10'
          )
        );
        await page.getByTestId('branch-search-input').fill('Branch 105');
        await check(page.getByTestId('branch-item-branch-105')).toBeVisible();
        await check(page.getByTestId('branch-pagination-total')).toHaveText('1');
        assert.ok(
          state.requests.some(
            (url) =>
              url.searchParams.get('search') === 'Branch 105' &&
              url.searchParams.get('page') === '1'
          )
        );
        await page.getByTestId('branch-search-input').fill('');
        await page.getByTestId('filter-tab-inactive').click();
        await check(page.getByTestId('branch-pagination-total')).toHaveText('52');
        await page.locator('#branch-sort-by').selectOption('code');
        await page.getByRole('button', { name: 'Đổi chiều sắp xếp' }).click();
        await check(page.getByTestId('branch-item-branch-104')).toBeVisible();
        assert.ok(
          state.requests.some(
            (url) =>
              url.searchParams.get('sort_by') === 'code' &&
              url.searchParams.get('status') === 'INACTIVE' &&
              url.searchParams.get('sort_order') === 'desc'
          )
        );
        await capture(page, 'branches-server-pagination');
      }
    );
    await scenario(
      'warehouses preserve metadata, keyboard pagination and column settings',
      async (page, state) => {
        await page.goto(`${baseUrl}/settings/warehouses`);
        await check(page.getByTestId('warehouse-pagination-total')).toHaveText('15');
        await page.getByTestId('warehouse-pagination-next-btn').focus();
        await page.keyboard.press('Enter');
        await check(page.getByTestId('warehouse-card-warehouse-11')).toBeVisible();
        await check(page.getByTestId('warehouse-card-warehouse-1')).toHaveCount(0);
        assert.ok(
          state.requests.some(
            (url) => url.pathname.endsWith('/warehouses') && url.searchParams.get('page') === '2'
          )
        );
        await page.getByTestId('warehouse-column-settings-btn').click();
        await page.getByTestId('warehouse-col-toggle-contact').getByRole('checkbox').uncheck();
        await check(page.getByTestId('warehouse-card-warehouse-11')).not.toContainText(
          '0901234567'
        );
        await page.reload();
        await check(page.getByTestId('warehouse-card-warehouse-11')).not.toContainText(
          '0901234567'
        );
        await capture(page, 'warehouses-page-two-columns');
      }
    );
    await scenario(
      'saved views save, restore and delete through the actual branch toolbar',
      async (page) => {
        await page.goto(`${baseUrl}/settings/branches`);
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await page.getByTestId('branch-search-input').fill('Branch 105');
        await check(page.getByTestId('branch-pagination-total')).toHaveText('1');
        await saveView(page, 'branch', 'Last branch');
        await page.getByTestId('branch-search-input').fill('');
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await page.getByTestId('branch-saved-views-select').selectOption({ label: 'Last branch' });
        await check(page.getByTestId('branch-item-branch-105')).toBeVisible();
        await check(page.getByTestId('branch-pagination-total')).toHaveText('1');
        await page.reload();
        await check(page.getByTestId('branch-saved-views-select')).toContainText('Last branch');
        await page.getByTestId('branch-saved-views-select').selectOption({ label: 'Last branch' });
        await page.getByTestId('branch-delete-saved-view-btn').click();
        await check(page.getByTestId('branch-saved-views-select')).toHaveCount(0);
        await page.reload();
        await check(page.getByTestId('branch-saved-views-select')).toHaveCount(0);
      }
    );
    await scenario('saved preferences are isolated by both tenant and user', async (page) => {
      await page.goto(`${baseUrl}/settings/branches`);
      await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
      await saveView(page, 'branch', 'Private view');
      await page.getByTestId('branch-column-settings-btn').click();
      await page.getByTestId('branch-col-toggle-phone').getByRole('checkbox').uncheck();
      await check(page.getByTestId('branch-item-branch-1')).not.toContainText('0901234567');
      for (const [tenantId, userId] of [
        ['tenant-a', 'actor-b'],
        ['tenant-b', 'actor-a'],
      ]) {
        await page.evaluate(
          ({ tenantId, userId }) => {
            const current = JSON.parse(localStorage.getItem('shipde_user') ?? '{}');
            localStorage.setItem(
              'shipde_user',
              JSON.stringify({ ...current, id: userId, merchant_id: tenantId })
            );
            localStorage.setItem(
              'shipde_merchant',
              JSON.stringify({
                id: tenantId,
                name: 'Review tenant',
                created_at: '2026-10-30T00:00:00.000Z',
              })
            );
          },
          { tenantId, userId }
        );
        await page.goto(`${baseUrl}/settings/branches`);
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await check(page.getByTestId('branch-saved-views-select')).toHaveCount(0);
        await check(page.getByTestId('branch-item-branch-1')).toContainText('0901234567');
      }
    });
    await scenario(
      'storage failure is visible and cannot pretend a view was saved',
      async (page) => {
        await page.goto(`${baseUrl}/settings/branches`);
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await page.evaluate(() => {
          Storage.prototype.setItem = () => {
            throw new DOMException('Fixture storage unavailable', 'QuotaExceededError');
          };
        });
        await page.getByTestId('branch-save-view-btn').click();
        await page.getByTestId('branch-view-name-input').fill('Must not persist');
        await page.getByTestId('branch-confirm-save-view-btn').click();
        await check(
          page.getByTestId('branch-saved-views-columns-container').getByRole('alert')
        ).toContainText('Không thể lưu tùy chọn');
        await check(page.getByTestId('branch-saved-views-select')).toHaveCount(0);
      }
    );
    await scenario(
      'users and embedded branches fetch all pages; scope options are not truncated',
      async (page, state) => {
        await page.goto(`${baseUrl}/settings/users`);
        await check(page.getByTestId('user-row-user-1')).toBeVisible();
        await check(page.getByTestId('user-count')).toHaveText('25');
        await page.getByTestId('users-pagination-next-btn').last().click();
        await check(page.getByTestId('user-row-user-21')).toBeVisible();
        await check(page.getByTestId('user-row-user-1')).toHaveCount(0);
        await page.getByTestId('edit-scopes-btn-user-21').click();
        await check(
          page
            .getByTestId('scope-edit-modal')
            .getByRole('checkbox', { name: 'Branch 105', exact: true })
        ).toBeVisible();
        assert.ok(
          state.requests.some(
            (url) =>
              url.pathname.endsWith('/branches') &&
              url.searchParams.get('limit') === '100' &&
              url.searchParams.get('page') === '2'
          )
        );
        await page.goto(`${baseUrl}/settings/users`);
        await page.getByRole('button', { name: /3\. Quản Lý Cửa Hàng/ }).click();
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await page.getByTestId('branch-pagination-next-btn').click();
        await check(page.getByTestId('branch-item-branch-11')).toBeVisible();
        await check(page.getByTestId('branch-item-branch-1')).toHaveCount(0);
        await capture(page, 'users-embedded-branches-page-two');
      }
    );
    await scenario(
      'out-of-range branch and warehouse pages recover by fetching the last real page',
      async (page, state) => {
        for (const [resource, prefix, lastPage, expectedItem] of [
          ['branches', 'branch', 11, 'branch-item-branch-105'],
          ['warehouses', 'warehouse', 2, 'warehouse-card-warehouse-15'],
        ] as const) {
          await page.goto(`${baseUrl}/settings/${resource}?page=99`);
          await check(page.getByTestId(`${prefix}-out-of-range-state`)).toBeVisible();
          await page.getByTestId(`${prefix}-recover-page-btn`).click();
          await check(page.getByTestId(expectedItem)).toBeVisible();
          assert.ok(
            state.requests.some(
              (url) =>
                url.pathname.endsWith(`/${resource}`) &&
                url.searchParams.get('page') === String(lastPage)
            )
          );
        }
      }
    );
    await scenario(
      'empty filtered pages cannot silently promote new branches or warehouses to default',
      async (page, state) => {
        await page.goto(`${baseUrl}/settings/branches`);
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await page.getByTestId('branch-search-input').fill('No existing branch');
        await check(page.getByTestId('branch-empty-state')).toBeVisible();
        await page.getByTestId('create-branch-button').click();
        await check(page.getByTestId('input-branch-default')).not.toBeChecked();
        await page.getByTestId('input-branch-name').fill('Created branch');
        await page.getByTestId('input-branch-code').fill('BR-NEW');
        await page.getByTestId('submit-branch-button').click();
        await check(page.getByTestId('branch-success-banner')).toBeVisible();
        assert.equal(
          state.created[0].is_default,
          false,
          'a filtered page is not evidence that this is the first branch'
        );
        await page.goto(`${baseUrl}/settings/warehouses`);
        await check(page.getByTestId('warehouse-pagination-total')).toHaveText('15');
        await page.getByTestId('input-search-warehouse').fill('No existing warehouse');
        await check(page.getByTestId('warehouse-no-results-state')).toBeVisible();
        await page.getByTestId('create-warehouse-button').click();
        await check(page.getByTestId('checkbox-warehouse-default')).not.toBeChecked();
        await page.getByTestId('input-warehouse-name').fill('Created warehouse');
        await page.getByTestId('input-warehouse-code').fill('WH-NEW');
        await page.getByTestId('input-warehouse-contact-name').fill('Test contact');
        await page.getByTestId('input-warehouse-contact-phone').fill('0901234567');
        await page.getByTestId('input-warehouse-address-line').fill('Test address');
        await page.getByTestId('input-warehouse-district').fill('Test district');
        await page.getByTestId('input-warehouse-city').fill('Test city');
        await page.getByTestId('submit-warehouse-button').click();
        await check(page.getByTestId('warehouse-success-banner')).toBeVisible();
        assert.equal(
          state.created[1].is_default,
          false,
          'a filtered page is not evidence that this is the first warehouse'
        );
      }
    );
    await scenario(
      'HTTP errors and malformed metadata cannot become empty success; forbidden stays distinct',
      async (page, state) => {
        state.status = 503;
        await page.goto(`${baseUrl}/settings/branches`);
        await check(page.getByTestId('branch-error-banner')).toContainText(
          'Không thể tải danh sách'
        );
        await check(page.getByTestId('branch-error-banner')).not.toContainText(
          'unsafe-database-diagnostic'
        );
        await check(page.getByTestId('branch-empty-state')).toHaveCount(0);
        state.status = 200;
        await page.getByTestId('retry-error-button').click();
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        state.malformed = true;
        await page.getByTestId('refresh-branches-button').click();
        await check(page.getByTestId('branch-error-banner')).toContainText(
          'Dữ liệu danh sách không hợp lệ'
        );
        state.malformed = false;
        state.status = 403;
        await page.goto(`${baseUrl}/settings/warehouses`);
        await check(page.getByTestId('warehouse-forbidden-state')).toBeVisible();
        await check(page.getByTestId('warehouse-empty-state')).toHaveCount(0);
        await capture(page, 'warehouse-forbidden');
      }
    );
    await scenario(
      'no-results recovery resets server filters and mobile controls remain usable',
      async (page, state) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${baseUrl}/settings/branches`);
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await page.getByTestId('branch-search-input').fill('No matching branch');
        await check(page.getByTestId('branch-empty-state')).toContainText(
          'Không tìm thấy chi nhánh phù hợp'
        );
        await check(page.getByTestId('empty-create-branch-button')).toHaveCount(0);
        await page.getByTestId('branch-empty-clear-btn').click();
        await check(page.getByTestId('branch-pagination-total')).toHaveText('105');
        await page.goto(`${baseUrl}/settings/warehouses`);
        await check(page.getByTestId('warehouse-pagination-total')).toHaveText('15');
        await page.getByTestId('input-search-warehouse').fill('No matching warehouse');
        await check(page.getByTestId('warehouse-pagination-total')).toHaveCount(0);
        await page.getByTestId('warehouse-empty-clear-btn').click();
        await check(page.getByTestId('warehouse-pagination-total')).toHaveText('15');
        assert.ok(
          state.requests.some(
            (url) =>
              url.pathname.endsWith('/warehouses') &&
              !url.searchParams.has('search') &&
              url.searchParams.get('page') === '1'
          )
        );
        await page.getByTestId('warehouse-pagination-next-btn').click();
        await check(page.getByTestId('warehouse-card-warehouse-15')).toBeVisible();
        await capture(page, 'warehouse-mobile-page-two');
      }
    );
    const loggedOut = await browser.newContext();
    try {
      let reads = 0;
      await loggedOut.route('**/api/v1/users*', async (route) => {
        reads++;
        await route.fulfill({ status: 401, json: { success: false } });
      });
      const page = await loggedOut.newPage();
      const response = await page.goto(`${baseUrl}/settings/users`);
      assert.ok(
        (await response?.text())?.includes('users-loading-skeleton'),
        'server hydration must render loading before exposing content'
      );
      await check(page.getByTestId('users-forbidden-state')).toBeVisible();
      await check(page.getByTestId('users-table')).toHaveCount(0);
      assert.equal(reads, 0, 'an absent authenticated identity must not trigger a list query');
      await check(page.getByTestId('users-save-view-btn')).toBeDisabled();
      passed++;
      console.log('PASS: hydration and missing identity deny data and preference writes');
    } finally {
      await loggedOut.close();
    }
    console.log(`Shared list browser regressions: ${passed} passed`);
  } finally {
    await browser.close();
  }
}

void runBrowserRegressions().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
