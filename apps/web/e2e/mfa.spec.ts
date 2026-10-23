import AxeBuilder from '@axe-core/playwright';
import { createHmac } from 'node:crypto';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

/**
 * FEAT-AUTH-05 / AC-AUTH-05-17 — browser acceptance of the MFA UI:
 *   owner login -> enrollment required -> setup -> activation -> sign-out -> MFA login challenge.
 *
 * The browser talks to a stateful in-test fake of the auth API (page.route) that enforces the same
 * contract rules as the real service (6-digit TOTP, +/-1 step window, replayed step rejected,
 * single-use challenge). The real API and database behaviour of the same flow is proved by the
 * Nest supertest suites; this spec proves the UI wiring, state coverage, keyboard flow and axe.
 */
const API = /\/\/(localhost|127\.0\.0\.1):3001\/auth\//;
const SECRET = 'JBSWY3DPEHPK3PXP';
const PASSWORD = 'TestPassword123!';
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `A1B${i}-C2D${i}-E3F${i}-9A8${i}`);

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAtStep(step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(SECRET)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30_000);

const USER = {
  id: 'b0000000-0000-0000-0000-0000000005e1',
  merchant_id: 'a0000000-0000-0000-0000-000000000001',
  email: 'owner@shipde.vn',
  phone: null,
  full_name: 'Chủ Shop Demo',
  role: 'OWNER',
  status: 'ACTIVE',
  email_verified_at: '2026-09-01T00:00:00.000Z',
  phone_verified_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  auth_assurance: 'MFA',
  mfa_verified_at: '2026-10-23T00:00:00.000Z',
};
const MERCHANT = {
  id: USER.merchant_id,
  name: 'Shop Demo',
  business_code: 'SHOP_DEMO_01',
  status: 'active',
  created_at: '2026-09-01T00:00:00.000Z',
};
// Structural placeholders (header.payload.signature) built at runtime; not credentials.
const fakeJwt = (claims: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'placeholder'].join('.');
const FAR_FUTURE_EXP = 4_102_444_800;
const FULL_TOKEN = fakeJwt({ scope: 'full', exp: FAR_FUTURE_EXP });
const SETUP_TOKEN = fakeJwt({ scope: 'setup', exp: FAR_FUTURE_EXP });

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    body: JSON.stringify(body),
  });

async function installFakeAuthApi(page: Page, opts: { enrolled?: boolean } = {}) {
  const state = {
    active: Boolean(opts.enrolled),
    setupStarted: false,
    lastAcceptedStep: -1,
    challengeUsed: false,
  };
  const accept = (code: string): boolean => {
    for (const step of [stepNow(), stepNow() - 1, stepNow() + 1]) {
      if (code === totpAtStep(step) && step > state.lastAcceptedStep) {
        state.lastAcceptedStep = step;
        return true;
      }
    }
    return false;
  };

  await page.route(API, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return json(route, 204, {});
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;

    if (path === '/auth/login') {
      if (body.password !== PASSWORD) {
        return json(route, 401, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Thông tin đăng nhập không đúng' },
        });
      }
      if (state.active) {
        state.challengeUsed = false;
        return json(route, 200, {
          data: { status: 'MFA_REQUIRED', challenge_id: 'chal-opaque-1', expires_in: 300 },
          meta: { correlation_id: 'c-1' },
        });
      }
      return json(route, 403, {
        error: {
          code: 'MFA_ENROLLMENT_REQUIRED',
          message: 'Tài khoản yêu cầu thiết lập xác thực hai yếu tố (MFA).',
          setup_token: SETUP_TOKEN,
          expires_in: 600,
        },
      });
    }
    if (path === '/auth/mfa/status') {
      return json(route, 200, {
        data: {
          status: state.active ? 'ACTIVE' : 'NOT_ENROLLED',
          required: true,
          recovery_codes_remaining: state.active ? 10 : 0,
          mfa_verified_at: state.active ? '2026-10-23T00:00:00.000Z' : null,
        },
        meta: { correlation_id: 'c-2' },
      });
    }
    if (path === '/auth/mfa/setup') {
      if (body.password !== PASSWORD) {
        return json(route, 401, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Mật khẩu không chính xác' },
        });
      }
      state.setupStarted = true;
      return json(route, 200, {
        data: {
          secret_key: SECRET,
          provisioning_uri: `otpauth://totp/Ship%20De:owner%40shipde.vn?secret=${SECRET}&issuer=Ship%20De`,
          expires_at: '2099-01-01T00:10:00.000Z',
          expires_in_seconds: 600,
        },
        meta: { correlation_id: 'c-3' },
      });
    }
    if (path === '/auth/mfa/setup/verify') {
      if (!state.setupStarted || !accept(String(body.code))) {
        return json(route, 400, {
          error: {
            code: 'MFA_CODE_INVALID',
            message: 'Mã xác thực không chính xác hoặc đã hết hạn',
          },
        });
      }
      state.active = true;
      return json(route, 200, {
        data: {
          status: 'AUTHENTICATED',
          recovery_codes: RECOVERY_CODES,
          access_token: FULL_TOKEN,
          expires_in: 43200,
          user: USER,
          merchant: MERCHANT,
        },
        meta: { correlation_id: 'c-4' },
      });
    }
    if (path === '/auth/mfa/challenge/verify') {
      if (
        body.challenge_id !== 'chal-opaque-1' ||
        state.challengeUsed ||
        !accept(String(body.code))
      ) {
        return json(route, 400, {
          error: { code: 'MFA_CODE_INVALID', message: 'Mã xác thực không chính xác.' },
        });
      }
      state.challengeUsed = true;
      return json(route, 200, {
        data: {
          status: 'AUTHENTICATED',
          access_token: FULL_TOKEN,
          expires_in: 43200,
          user: USER,
          merchant: MERCHANT,
        },
        meta: { correlation_id: 'c-5' },
      });
    }
    return json(route, 404, { error: { code: 'NOT_FOUND', message: `unmocked ${path}` } });
  });
}

async function expectNoAxeViolations(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  await testInfo.attach(`axe-${name}`, {
    body: JSON.stringify({ violations: results.violations }, null, 2),
    contentType: 'application/json',
  });
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help} :: ${v.nodes.map((n) => n.html.slice(0, 160)).join(' | ')}`
  );
  expect(summary, `${name}\n${summary.join('\n')}`).toEqual([]);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

async function submitPasswordLogin(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('email@cuahang.vn hoặc 09xx.xxx.xxx').fill('owner@shipde.vn');
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng Nhập', exact: true }).click();
}

test.describe('FEAT-AUTH-05 MFA UI (AC-AUTH-05-17)', () => {
  test('owner enrolls, activates, then passes the MFA login challenge', async ({
    page,
  }, testInfo) => {
    await installFakeAuthApi(page);

    // 1. Owner password login -> enrollment required notice
    await submitPasswordLogin(page);
    await expect(page.getByTestId('mfa-enrollment-notice')).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'enrollment-notice');
    await shot(page, testInfo, '01-enrollment-required');

    // 2. Security settings: setup-only token reaches the page; start setup
    await page.getByRole('link', { name: /Kích Hoạt Bảo Mật 2FA Ngay/ }).click();
    await expect(page.getByRole('heading', { name: 'Bảo mật tài khoản' })).toBeVisible();
    await expect(page.getByText('Chưa kích hoạt')).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'security-not-enrolled');
    await shot(page, testInfo, '02-security-not-enrolled');

    await page.getByRole('button', { name: /Bắt đầu thiết lập MFA/ }).click();
    await page.getByLabel('Mật khẩu tài khoản').fill('wrong-password');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.locator('div[role="alert"][aria-live="polite"]')).toContainText(
      'Mật khẩu không chính xác'
    );
    await expectNoAxeViolations(page, testInfo, 'security-setup-auth-error');
    await shot(page, testInfo, '03-setup-password-error');

    await page.getByLabel('Mật khẩu tài khoản').fill(PASSWORD);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByText(SECRET)).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'security-setup-verify');
    await shot(page, testInfo, '04-setup-verify-manual-key');

    // A code outside the accepted window is rejected by the server and stays on the step.
    const codeInput = page.getByLabel('Nhập mã 6 chữ số từ ứng dụng');
    await codeInput.fill(totpAtStep(stepNow() + 40));
    await codeInput.press('Enter');
    await expect(page.locator('div[role="alert"][aria-live="polite"]')).toContainText(
      'không chính xác'
    );
    await shot(page, testInfo, '05-setup-code-rejected');

    await codeInput.fill(totpAtStep(stepNow()));
    await codeInput.press('Enter');

    // 3. Activation: recovery codes shown once, acknowledgement required
    await expect(page.getByRole('heading', { name: 'Lưu mã dự phòng của bạn' })).toBeVisible();
    for (const code of RECOVERY_CODES) {
      await expect(page.getByText(code, { exact: true })).toBeVisible();
    }
    const finish = page.getByRole('button', { name: 'Hoàn tất thiết lập' });
    await expect(finish).toBeDisabled();
    await expectNoAxeViolations(page, testInfo, 'security-recovery-codes');
    await shot(page, testInfo, '06-recovery-codes');
    await page.getByRole('checkbox').check();
    await finish.click();
    await expect(page.getByText('Đã kích hoạt', { exact: true })).toBeVisible();
    await expect(page.getByText('Còn lại: 10/10 mã chưa sử dụng')).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'security-active');
    await shot(page, testInfo, '07-security-active');

    // 4. Sign out (drop persisted session) and log in again -> MFA challenge
    await page.evaluate(() => localStorage.clear());
    await submitPasswordLogin(page);
    await expect(page.getByTestId('mfa-challenge-form')).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'mfa-challenge');
    await shot(page, testInfo, '08-mfa-challenge');

    await page.locator('#mfa-totp-code').fill('000000');
    await page.getByRole('button', { name: 'Xác Nhận Đăng Nhập' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Mã xác thực không chính xác' })
    ).toBeVisible();
    await shot(page, testInfo, '09-mfa-challenge-error');

    // The activation step is spent (replay rejected), so the next step's code is used.
    await page.locator('#mfa-totp-code').fill(totpAtStep(stepNow() + 1));
    await page.getByRole('button', { name: 'Xác Nhận Đăng Nhập' }).click();
    await expect(page.getByTestId('mfa-challenge-form')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('shipde_token'))).toBe(FULL_TOKEN);
  });

  test('recovery-code challenge view is accessible and keyboard focused', async ({
    page,
  }, testInfo) => {
    await installFakeAuthApi(page, { enrolled: true });
    await submitPasswordLogin(page);
    await expect(page.getByTestId('mfa-challenge-form')).toBeVisible();
    await page.getByRole('button', { name: /Sử dụng mã dự phòng/ }).click();
    await expect(page.getByTestId('mfa-recovery-form')).toBeVisible();
    await expect(page.locator('#mfa-recovery-code')).toBeFocused();
    await expectNoAxeViolations(page, testInfo, 'mfa-recovery');
    await shot(page, testInfo, '10-mfa-recovery');
  });

  test('an expired stored token is dropped on load instead of replayed', async ({ page }) => {
    await installFakeAuthApi(page);
    const expired = fakeJwt({ scope: 'setup', exp: 1 });
    await page.addInitScript((value) => localStorage.setItem('shipde_token', value), expired);
    await page.goto('/');
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('shipde_token'))).toBeNull();
  });
});
