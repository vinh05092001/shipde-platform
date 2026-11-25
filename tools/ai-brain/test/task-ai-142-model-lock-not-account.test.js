'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const routeProbe = require('../route-probe');

const lockedBody = JSON.stringify({
  error: {
    message:
      'model_requires_purchase: aion-2.0 is locked on your account until you make a purchase.',
    type: 'insufficient_quota',
    code: 'insufficient_quota',
  },
});

test('a purchase-locked model is a model-scoped refusal, not account credit loss', () => {
  const cause = routeProbe.failureReason(
    routeProbe.classifyProbeFailure({ ok: false, status: 429, body: lockedBody })
  );
  assert.equal(cause, 'MODEL_LOCKED');
});

test('genuine credit exhaustion is still account-level', () => {
  const cause = routeProbe.failureReason(
    routeProbe.classifyProbeFailure({
      ok: false,
      status: 402,
      body: 'Your account balance is insufficient. Please recharge.',
    })
  );
  assert.equal(cause, 'UPSTREAM_CREDIT_OR_QUOTA');
});
