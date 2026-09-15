import assert from 'node:assert/strict';
import { setupServer } from 'msw/node';
import { handlers, setMswScenario, resetMswScenario, BASE_API_URL } from './handlers.js';

const server = setupServer(...handlers);

async function runMswTests() {
  console.log('🧪 Testing MSW Canonical State Handlers...');

  server.listen({ onUnhandledRequest: 'error' });

  try {
    // 1. Test SUCCESS State
    resetMswScenario();
    const resSuccess = await fetch(`${BASE_API_URL}/api/v1/orders`);
    assert.equal(resSuccess.status, 200);
    const dataSuccess: any = await resSuccess.json();
    assert.equal(dataSuccess.length, 2);

    // 2. Test EMPTY State
    setMswScenario({ state: 'EMPTY' });
    const resEmpty = await fetch(`${BASE_API_URL}/api/v1/orders`);
    assert.equal(resEmpty.status, 200);
    const dataEmpty: any = await resEmpty.json();
    assert.equal(dataEmpty.length, 0);

    // 3. Test ERROR State
    setMswScenario({ state: 'ERROR' });
    const resError = await fetch(`${BASE_API_URL}/api/v1/orders`);
    assert.equal(resError.status, 500);
    const dataError: any = await resError.json();
    assert.equal(dataError.code, 'INTERNAL_SERVER_ERROR');

    // 4. Test FORBIDDEN State
    setMswScenario({ state: 'FORBIDDEN' });
    const resForbidden = await fetch(`${BASE_API_URL}/api/v1/orders`);
    assert.equal(resForbidden.status, 403);
    const dataForbidden: any = await resForbidden.json();
    assert.equal(dataForbidden.code, 'FORBIDDEN');

    // 5. Test PARTIAL State
    setMswScenario({ state: 'PARTIAL' });
    const resPartial = await fetch(`${BASE_API_URL}/api/v1/shipping/quotes`, { method: 'POST' });
    assert.equal(resPartial.status, 200);
    const dataPartial: any = await resPartial.json();
    assert.equal(dataPartial.length, 2); // only GHN & VTP returned

    // 6. Test RECOVERY State
    setMswScenario({ state: 'RECOVERY', recoveryAttemptsBeforeSuccess: 1 });
    // First attempt fails with 503
    const resAttempt1 = await fetch(`${BASE_API_URL}/api/v1/orders`);
    assert.equal(resAttempt1.status, 503);
    // Second attempt recovers with 200
    const resAttempt2 = await fetch(`${BASE_API_URL}/api/v1/orders`);
    assert.equal(resAttempt2.status, 200);
    const dataRecovered: any = await resAttempt2.json();
    assert.equal(dataRecovered.length, 2);

    // 7. Test Auth Registration via MSW
    resetMswScenario();
    const regRes = await fetch(`${BASE_API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_name: 'MSW Shop',
        full_name: 'MSW User',
        email: 'msw@shipde.vn',
        password: 'Password123!',
        terms_accepted: true,
        terms_version: '2026.1',
      }),
    });
    assert.equal(regRes.status, 200);
    const regData: any = await regRes.json();
    assert.equal(regData.data.status, 'PENDING_VERIFICATION');

    // 8. Test Auth Registration Duplicate via MSW
    const dupRes = await fetch(`${BASE_API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'duplicate@shipde.vn' }),
    });
    assert.equal(dupRes.status, 400);
    const dupData: any = await dupRes.json();
    assert.equal(dupData.error.code, 'VALIDATION_ERROR');

    // 9. Test Auth Registration Rate Limited via MSW
    const limitRes = await fetch(`${BASE_API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ratelimit@shipde.vn' }),
    });
    assert.equal(limitRes.status, 429);
    const limitData: any = await limitRes.json();
    assert.equal(limitData.error.code, 'RATE_LIMITED');

    // 10. Test Auth Verify Expired Token via MSW
    const expRes = await fetch(`${BASE_API_URL}/api/v1/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'test-token-expired' }),
    });
    assert.equal(expRes.status, 410);
    const expData: any = await expRes.json();
    assert.equal(expData.error.code, 'TOKEN_EXPIRED');

    // 11. Test Auth Verify Consumed Token via MSW
    const conRes = await fetch(`${BASE_API_URL}/api/v1/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'test-token-consumed' }),
    });
    assert.equal(conRes.status, 410);
    const conData: any = await conRes.json();
    assert.equal(conData.error.code, 'TOKEN_ALREADY_CONSUMED');

    // 12. Test Auth Resend Cooldown via MSW
    const resendRes = await fetch(`${BASE_API_URL}/api/v1/auth/verify/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'ratelimit@shipde.vn', channel: 'email' }),
    });
    assert.equal(resendRes.status, 429);

    console.log('✅ All MSW Canonical State Handler and Auth tests passed successfully.');
  } finally {
    server.close();
  }
}

runMswTests().catch((err) => {
  console.error('❌ MSW test failed:', err);
  process.exit(1);
});
