import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import type {
  CarrierResponse,
  CarrierDetailResponseEnvelope,
  CanonicalStatusResponse,
  FeeComponentResponse,
} from '../src/features/carriers/catalog/types';

// Controlled transport fixtures exercise real React effects, DOM events and API decoding.
const MOCK_CARRIERS: CarrierResponse[] = [
  {
    id: 'car_ghn_01',
    code: 'GHN',
    name: 'Giao Hàng Nhanh',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description: 'Hãng vận chuyển hàng đầu Việt Nam với API công khai chính thức',
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    id: 'car_ghtk_01',
    code: 'GHTK',
    name: 'Giao Hàng Tiết Kiệm',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description: 'Hãng vận chuyển tiết kiệm với OpenAPI công khai',
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    id: 'car_vtp_01',
    code: 'VIETTEL_POST',
    name: 'Viettel Post',
    logo_url: null,
    is_active: true,
    evidence_level: 'CONFIRMATION_REQUIRED',
    description: 'Đối tác Viettel - cần xác nhận OI-001',
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    id: 'car_jt_01',
    code: 'JT',
    name: 'J&T Express Vietnam',
    logo_url: null,
    is_active: true,
    evidence_level: 'CONFIRMATION_REQUIRED',
    description: 'Đối tác J&T Việt Nam - cần xác nhận OI-002',
    catalog_revision: 'CATALOG-2026-10-31',
  },
];

const MOCK_CARRIER_DETAIL: CarrierDetailResponseEnvelope = {
  catalog_revision: 'CATALOG-2026-10-31',
  data: {
    id: 'car_ghn_01',
    code: 'GHN',
    name: 'Giao Hàng Nhanh',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description: 'Hãng vận chuyển hàng đầu Việt Nam',
    catalog_revision: 'CATALOG-2026-10-31',
    services: [
      {
        id: 'svc_ghn_std',
        code: 'GHN_STANDARD',
        name: 'GHN tiêu chuẩn',
        service_type: 'STANDARD',
        description: 'Dịch vụ tiêu chuẩn GHN',
        is_active: true,
        evidence_level: 'VERIFIED_OFFICIAL',
        source_revision: 'GHN-PUBLIC-API-2026-08-24',
      },
      {
        id: 'svc_ghn_fast',
        code: 'GHN_FAST',
        name: 'GHN hoả tốc',
        service_type: 'FAST',
        description: 'Dịch vụ nhanh GHN',
        is_active: true,
        evidence_level: 'VERIFIED_OFFICIAL',
        source_revision: 'GHN-PUBLIC-API-2026-08-24',
      },
    ],
  },
};

const MOCK_STATUSES: CanonicalStatusResponse[] = [
  {
    code: 'CREATING',
    category: 'COMMAND',
    label: 'Đang tạo vận đơn',
    description: 'Đang tạo vận đơn: canonical shipment status. Not a provider raw status.',
    stage_order: 10,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'CREATED',
    category: 'COMMAND',
    label: 'Đã tạo vận đơn',
    description: 'Đã tạo vận đơn: canonical shipment status. Not a provider raw status.',
    stage_order: 20,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'READY_TO_PICK',
    category: 'OPERATIONAL_PRE_TRANSIT',
    label: 'Sẵn sàng lấy',
    description: 'Sẵn sàng lấy: canonical shipment status. Not a provider raw status.',
    stage_order: 120,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'PICKING',
    category: 'OPERATIONAL_PRE_TRANSIT',
    label: 'Đang lấy',
    description: 'Đang lấy: canonical shipment status. Not a provider raw status.',
    stage_order: 130,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'IN_TRANSIT',
    category: 'OPERATIONAL_IN_TRANSIT',
    label: 'Đang luân chuyển',
    description: 'Đang luân chuyển: canonical shipment status. Not a provider raw status.',
    stage_order: 210,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'DELIVERED',
    category: 'OPERATIONAL_TERMINAL',
    label: 'Đã giao',
    description: 'Đã giao: canonical shipment status. Not a provider raw status.',
    stage_order: 340,
    catalog_revision: 'CATALOG-2026-10-31',
  },
];

const MOCK_FEES: FeeComponentResponse[] = [
  {
    code: 'BASE_FREIGHT',
    name: 'Cước chính',
    category: 'BASE',
    description: 'Core transport charge before surcharges and tax.',
    is_refundable: true,
    vat_applicable: true,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'SURCHARGE',
    name: 'Phụ phí',
    category: 'SURCHARGE',
    description: 'Catch-all surcharge.',
    is_refundable: true,
    vat_applicable: true,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'VAT',
    name: 'Thuế GTGT',
    category: 'VAT',
    description: 'VAT amount line.',
    is_refundable: false,
    vat_applicable: false,
    catalog_revision: 'CATALOG-2026-10-31',
  },
];

let script: string;
let styles: string;

test.beforeAll(async () => {
  const require = createRequire(resolve('package.json'));
  const { build } = require(createRequire(require.resolve('tsx')).resolve('esbuild'));
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { CarrierCatalogView } from './src/features/carriers/catalog/CarrierCatalogView';
        import Settings from './src/app/settings/carriers/page';
        import { AuthProvider } from './src/context/AuthContext';
        const root = createRoot(document.getElementById('root'));
        window.mountCatalog = (settings = false) => root.render(
          settings ? <AuthProvider><Settings /></AuthProvider> : <CarrierCatalogView />);`,
      resolveDir: resolve(process.cwd()),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NODE_ENV': '"test"',
      'process.env.NEXT_PUBLIC_API_URL': '"http://catalog.test"',
    },
    tsconfig: resolve('tsconfig.json'),
  });
  const { compile } = require('tailwindcss');
  const css = (await compile('@tailwind utilities;')).build([
    'opacity-0',
    'group-hover:opacity-100',
    'group-focus-within:opacity-100',
  ]);
  script = bundle.outputFiles[0].text;
  styles = css;
});

test.beforeEach(async ({ page }) => {
  await page.route('http://catalog.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
  );
  await page.goto('http://catalog.test/');
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/carriers')
      ? MOCK_CARRIERS
      : path.endsWith('/statuses')
        ? MOCK_STATUSES
        : path.endsWith('/fee-components')
          ? MOCK_FEES
          : path.endsWith('/carrier-accounts')
            ? [
                {
                  id: 'account-fixture',
                  carrier_code: 'GHN',
                  alias: 'Test account',
                  environment: 'sandbox',
                  status: 'ACTIVE',
                },
              ]
            : path.includes('/carriers/')
              ? MOCK_CARRIER_DETAIL.data
              : [];
    return route.fulfill({ json: { catalog_revision: 'CATALOG-2026-10-31', data } });
  });
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  await page.evaluate(() => (window as unknown as { mountCatalog: () => void }).mountCatalog());
  await expect(page.getByTestId('carrier-card-GHN')).toBeVisible();
});

test('late detail responses cannot replace the selected carrier', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/carrier-catalog/carriers/GHN', async (route) => {
    await pending;
    await route.fulfill({ json: MOCK_CARRIER_DETAIL });
  });
  await page.route('**/carrier-catalog/carriers/GHTK', (route) =>
    route.fulfill({ json: { data: { ...MOCK_CARRIERS[1], services: [] } } })
  );
  await page.getByTestId('view-services-GHN').click();
  await expect(page.getByRole('dialog').getByRole('status')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('view-services-GHTK').click();
  await expect(page.getByRole('dialog')).toContainText('chưa có dịch vụ');
  const lateResponse = page.waitForResponse('**/carrier-catalog/carriers/GHN');
  release();
  await lateResponse;
  // Flush the delivered response through fetch and React before inspecting the dialog.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expect(page.getByRole('dialog')).toContainText(MOCK_CARRIERS[1].name);
  await expect(page.getByRole('dialog')).toContainText('chưa có dịch vụ');
  await expect(page.getByRole('dialog')).not.toContainText(
    MOCK_CARRIER_DETAIL.data.services[0].code
  );
});
for (const suffix of ['?tab=catalog', '?tab=catalog&carrier=UNKNOWN']) {
  test(`direct catalog URL ${suffix}`, async ({ page }) => {
    await page.route('**/carrier-catalog/carriers/UNKNOWN', (route) =>
      route.fulfill({ status: 404, json: { error: { code: 'RESOURCE_NOT_FOUND' } } })
    );
    await page.evaluate((query) => {
      history.replaceState(null, '', '/settings/carriers' + query);
      (window as unknown as { mountCatalog: (settings: boolean) => void }).mountCatalog(true);
    }, suffix);
    await expect(page.getByTestId('tab-catalog')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('carrier-accounts-tab')).toHaveCount(0);
    if (suffix.includes('UNKNOWN')) {
      await expect(page.getByTestId('catalog-not-found')).toBeVisible();
      await page.getByRole('button', { name: 'Quay lại danh mục' }).click();
      await expect(page.getByTestId('catalog-not-found')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.has('carrier')).toBe(false);
    }
    await expect(page.getByTestId('carrier-card-GHN')).toBeVisible();
  });
}
test('keyboard detail control is visibly revealed without hover', async ({ page }) => {
  await page.mouse.move(0, 0);
  const detail = page.getByRole('button', { name: 'Chi tiết Giao Hàng Nhanh', exact: true });
  for (let i = 0; i < 20 && !(await detail.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(detail).toBeFocused();
  await expect
    .poll(() => detail.evaluate((el) => getComputedStyle(el.parentElement!).opacity))
    .toBe('1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(MOCK_CARRIER_DETAIL.data.services[0].code);
});
for (const status of [500, 403]) {
  test(`detail ${status}, loading and retry`, async ({ page }) => {
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/carrier-catalog/carriers/GHN', async (route) => {
      calls++;
      if (calls === 1) await pending;
      await route.fulfill(
        calls === 1
          ? {
              status,
              json: {
                error: { message: 'unsafe backend diagnostic' },
                meta: { correlation_id: 'detail-correlation' },
              },
            }
          : { json: { data: { ...MOCK_CARRIERS[0], services: [] } } }
      );
    });
    const opener = page.getByTestId('view-services-GHN');
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('status')).toBeVisible();
    release();
    await expect(dialog.getByRole('alert')).toContainText('detail-correlation');
    await expect(dialog).not.toContainText('unsafe backend diagnostic');
    if (status === 403) await expect(dialog).toContainText('iam:carrier_catalog:read');
    await dialog.getByRole('button', { name: 'Thử lại' }).click();
    await expect(dialog).toContainText('chưa có dịch vụ');
    expect(calls).toBe(2);
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  });
}
test('partial taxonomy and reference retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/carrier-catalog/fee-components', (route) => {
    calls++;
    return route.fulfill(
      calls === 1
        ? { status: 500, json: { meta: { correlation_id: 'fee-correlation' } } }
        : { json: { data: MOCK_FEES } }
    );
  });
  await page.getByRole('button', { name: 'Làm mới danh mục' }).click();
  await page.getByRole('button', { name: 'Hệ thống Phí', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('fee-correlation');
  await expect(page.getByRole('dialog')).not.toContainText('BASE_FREIGHT');
  await page.getByRole('dialog').getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('dialog')).toContainText('BASE_FREIGHT');
  expect(calls).toBe(2);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Trạng thái Canonical', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(MOCK_STATUSES[0].code);
});
for (const status of [500, 403]) {
  test(`status reference ${status}, partial success and retry`, async ({ page }) => {
    let calls = 0;
    await page.route('**/carrier-catalog/statuses', (route) => {
      calls++;
      return route.fulfill(
        calls === 1
          ? { status, json: { meta: { correlation_id: 'status-correlation' } } }
          : { json: { data: MOCK_STATUSES } }
      );
    });
    await page.getByRole('button', { name: 'Làm mới danh mục' }).click();
    await page.getByRole('button', { name: 'Trạng thái Canonical', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('status-correlation');
    if (status === 403)
      await expect(page.getByRole('dialog')).toContainText('iam:carrier_catalog:read');
    await page.getByRole('dialog').getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByRole('dialog')).toContainText(MOCK_STATUSES[0].code);
    expect(calls).toBe(2);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Hệ thống Phí', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('BASE_FREIGHT');
  });
}
test('accounts expose no unfinished operations', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'shipde_user',
      JSON.stringify({ id: 'test-owner', role: 'OWNER', full_name: 'Test Owner' })
    );
    localStorage.setItem('shipde_merchant', JSON.stringify({ id: 'test-shop', name: 'Test Shop' }));
    localStorage.setItem('shipde_token', 'ui-test-fixture');
    (window as unknown as { mountCatalog: (settings: boolean) => void }).mountCatalog(true);
  });
  await expect(page.getByTestId('carrier-account-account-fixture')).toBeVisible();
  await expect(page.getByRole('button', { name: /Kết nối/ })).toHaveCount(0);
  await expect(page.locator('button[title="Chỉnh sửa"], button[title="Kiểm tra"]')).toHaveCount(0);
  await page.getByTestId('tab-catalog').click();
  await page.getByTestId('input-search-carrier').fill('GHN');
  await page.getByTestId('tab-accounts').click();
  await page.getByTestId('tab-catalog').click();
  await expect(page.getByTestId('input-search-carrier')).toHaveValue('GHN');
  await expect(page.getByTestId('carrier-card-GHTK')).toHaveCount(0);
});
test('inline validation and filtered empty recovery', async ({ page }) => {
  const search = page.getByTestId('input-search-carrier');
  await search.fill('x'.repeat(201));
  await expect(search).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#search-error')).toBeVisible();
  await search.fill('no-matching-carrier');
  await expect(search).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByTestId('carrier-grid-empty')).toContainText('phù hợp với bộ lọc');
  await page.getByTestId('carrier-grid-empty').getByRole('button').click();
  await expect(search).toHaveValue('');
  for (const id of ['filter-evidence', 'filter-active']) {
    const filter = page.getByTestId(id);
    await filter.evaluate((element: HTMLSelectElement) => {
      element.add(new Option('invalid', 'INVALID'));
      element.value = 'INVALID';
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(filter).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('carrier-card-GHN')).toBeVisible();
    await filter.selectOption('ALL');
    await expect(filter).toHaveAttribute('aria-invalid', 'false');
  }
});
for (const name of ['Trạng thái Canonical', 'Hệ thống Phí', 'Xem dịch vụ (GHN)']) {
  test(`focus contract: ${name}`, async ({ page }) => {
    const opener = page.getByRole('button', { name, exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}
test('carrier detail action opens real detail', async ({ page }) => {
  await page.getByRole('button', { name: 'Chi tiết Giao Hàng Nhanh', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Dịch vụ của Giao Hàng Nhanh');
  await expect(page.getByRole('dialog')).toContainText(MOCK_CARRIER_DETAIL.data.services[0].code);
});
test('list failure retry preserves filters and calls API', async ({ page }) => {
  await page.getByTestId('input-search-carrier').fill('GHN');
  await page.getByTestId('filter-evidence').selectOption('VERIFIED_OFFICIAL');
  let calls = 0;
  await page.route('**/carrier-catalog/carriers', (route) => {
    calls++;
    return route.fulfill(
      calls === 1
        ? { status: 500, json: { meta: { correlation_id: 'list-correlation' } } }
        : { json: { data: MOCK_CARRIERS } }
    );
  });
  await page.getByRole('button', { name: 'Làm mới danh mục' }).click();
  await expect(page.getByTestId('catalog-error-banner')).toContainText('list-correlation');
  await page.getByTestId('catalog-retry-button').click();
  await expect(page.getByTestId('carrier-card-GHN')).toBeVisible();
  await expect(page.getByTestId('carrier-card-GHTK')).toHaveCount(0);
  await expect(page.getByTestId('input-search-carrier')).toHaveValue('GHN');
  await expect(page.getByTestId('filter-evidence')).toHaveValue('VERIFIED_OFFICIAL');
  expect(calls).toBe(2);
});
test('real list 403 envelope', async ({ page }) => {
  await page.route('**/carrier-catalog/carriers', (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } })
  );
  await page.getByRole('button', { name: 'Làm mới danh mục' }).click();
  await expect(page.getByTestId('catalog-forbidden-banner')).toContainText(
    'iam:carrier_catalog:read'
  );
  await expect(page.getByTestId('carrier-grid')).toHaveCount(0);
});
