'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const routeProbe = require('../route-probe');
const capabilityProbe = require('../capability-probe');

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

test('one locked model does not block probing the same account’s other models', async () => {
  const base = {
    harness: 'direct-http',
    accessPath: 'direct',
    gateway: 'fixture-src',
    upstream: 'fixture-src',
    sourceId: 'fixture-src',
    accountId: 'source-fixture-src',
    quotaScope: 'source-fixture-src',
  };
  const locked = { ...base, modelId: 'locked-model' };
  const open = { ...base, modelId: 'open-model' };
  const probed = [];
  await capabilityProbe.probeCapabilities(
    [locked, open],
    { role: 'writer', requiredCapabilities: ['tools'] },
    {
      registry: { sources: [], dispatch: { probeRoundRobinBatch: 1 } },
      capabilityEvidence: {},
      priors: { ranking: [] },
      persistRouteHealth: false,
      httpRoute: (c) => ({
        accessPath: 'https://fixture.invalid/v1',
        apiKeyEnv: 'FIXTURE_KEY',
        modelId: c.modelId,
      }),
      env: { FIXTURE_KEY: 'fixture' },
      fetch: async (_url, init) => {
        const model = JSON.parse(init.body).model;
        probed.push(model);
        if (model === 'locked-model') return new Response(lockedBody, { status: 429 });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    { id: 't', type: 'function', function: { name: 'ping', arguments: '{}' } },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    }
  );
  assert.ok(probed.includes('open-model'), 'the open model on the same account is still probed');
  assert.notEqual(open.capabilityEvidence?.tools?.reason, 'MODEL_LOCKED');
});
