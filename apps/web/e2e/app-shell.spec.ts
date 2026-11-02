import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI contract fixtures only: no live API or authorization claims are made by this suite.
const permissions = [
  'order:view_create',
  'shipment:receive_return',
  'iam:shop_config',
  'iam:connect_observe_token',
];
async function session(page: Page, grants = permissions, status = 200) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'shipde_user',
      JSON.stringify({ id: 'shell-user', full_name: 'Shell Test', role: 'OWNER' })
    );
    localStorage.setItem(
      'shipde_merchant',
      JSON.stringify({ id: 'shell-shop', name: 'Shell Test Shop' })
    );
    localStorage.setItem('shipde_token', 'shell-ui-fixture');
  });
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ json: { data: { role: 'OWNER', custom_role_id: 'shell-role' } } })
  );
  await page.route('**/api/v1/roles', (route) =>
    route.fulfill({
      status,
      json: {
        data: {
          roles: [
            {
              id: 'shell-role',
              code: null,
              is_system: false,
              permissions: grants.map((code) => ({ code })),
            },
          ],
        },
      },
    })
  );
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('desktop navigation, palette keyboard controls, focus return and persisted collapse', async ({
  page,
}, info) => {
  await session(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('link', { name: 'Hồ sơ shop', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Hồ Sơ Bồi Thường' })).toHaveCount(0);
  await screenshot(page, info, 'desktop-expanded');
  const trigger = page.getByRole('button', { name: 'Thu gọn hoặc mở rộng điều hướng' });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await screenshot(page, info, 'desktop-collapsed');
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Chuyển đến trang', exact: true });
  await expect(page.getByLabel('Tìm trang', { exact: true })).toBeFocused();
  // The palette exposes exactly the same permitted destinations as the sidebar.
  await expect(palette.locator('.shell-command-target')).toHaveCount(
    await nav.getByRole('link').count()
  );
  await page.getByLabel('Tìm trang', { exact: true }).fill('don');
  await expect(palette.getByRole('button', { name: /Quản Lý Vận Đơn/ })).toBeVisible();
  await page.getByLabel('Tìm trang', { exact: true }).fill('zzzz');
  await expect(palette.getByRole('status')).toContainText('Không tìm thấy');
  await screenshot(page, info, 'palette-no-results');
  await page.getByLabel('Tìm trang', { exact: true }).fill('hoan');
  await screenshot(page, info, 'palette-search');
  await page.keyboard.press('ArrowDown');
  await expect(palette.getByRole('button', { name: /Quản Lý Nhập Hoàn/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/view=returns/);
  await expect(palette).toHaveCount(0);
  // Selection lands in the new screen: the returns view focuses its scan input.
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('#shell-content')))
    .toBe(true);
  await expect(page.getByRole('navigation', { name: 'Đường dẫn trang' })).toContainText(
    'Quản Lý Nhập Hoàn'
  );
  await trigger.focus();
  await page.keyboard.press('Meta+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.locator('summary').click();
  await expect(page.getByRole('link', { name: 'Hồ sơ cá nhân', exact: true })).toBeVisible();
  await screenshot(page, info, 'user-menu');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Hồ sơ cá nhân', exact: true })).toBeHidden();
});

test('360px sheet traps focus, closes with Escape and keeps the primary action reachable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await session(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Mở điều hướng', exact: true });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Điều hướng ứng dụng', exact: true });
  await expect(sheet).toBeVisible();
  await screenshot(page, info, 'mobile-sheet');
  const last = sheet.getByRole('link').last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Đóng Điều hướng ứng dụng' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await sheet.getByRole('link', { name: 'Quản Lý Vận Đơn', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/view=shipments/);
  const create = page.getByRole('button', { name: '+ Tạo Đơn Hàng', exact: true });
  await expect(create).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await screenshot(page, info, 'mobile-primary-action');
  await create.click();
  await expect(
    page.getByRole('heading', { name: 'Tạo Vận Đơn Mới & So Sánh Cước Phí', exact: true })
  ).toBeVisible();
});

test('loading, zero-permission and forbidden shells retain recovery', async ({ page }, info) => {
  await session(page, []);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/roles', async (route) => {
    await pending;
    await route.fulfill({ json: { data: { roles: [] } } });
  });
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Đang tải ứng dụng' })).toBeVisible();
  await screenshot(page, info, 'shell-loading');
  release();
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toContainText(
    'Chưa có mục điều hướng'
  );
  await screenshot(page, info, 'shell-empty');
  // Empty roles still retain the personal menu, logout and existing page content.
  await page.locator('summary').click();
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
});

for (const status of [403, 503]) {
  test(`navigation ${status} is actionable and retry restores permitted links`, async ({
    page,
  }, info) => {
    await session(page, permissions, status);
    await page.goto('/');
    const alert = page.getByRole('alert').filter({ hasText: /điều hướng/ });
    await expect(alert).toContainText(status === 403 ? 'không có quyền' : 'Không thể tải');
    await screenshot(page, info, status === 403 ? 'shell-forbidden' : 'shell-error');
    await page.route('**/api/v1/roles', (route) =>
      route.fulfill({
        json: {
          data: {
            roles: [
              {
                id: 'shell-role',
                is_system: false,
                code: null,
                permissions: permissions.map((code) => ({ code })),
              },
            ],
          },
        },
      })
    );
    await alert.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Điều hướng chính' })
        .getByRole('link', { name: 'Tài khoản hãng', exact: true })
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('.shell-header')
      .include('.shell-sidebar')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
