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

    console.log('✅ All 7 MSW Canonical State Handler tests passed successfully.');
  } finally {
    server.close();
  }
}

runMswTests().catch((err) => {
  console.error('❌ MSW test failed:', err);
  process.exit(1);
});
