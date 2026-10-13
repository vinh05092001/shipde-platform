'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probeRoute, classifyProbeFailure } = require('../route-probe');

test('shared route probe sends the worker model id and realistic request to its gateway', async () => {
  let request;
  const result = await probeRoute(
    {
      accessPath: 'https://gateway.example/v1/',
      modelId: 'vendor/actual-model-id',
      maxOutputTokens: 4096,
    },
    'ROUTE_API_KEY',
    { ROUTE_API_KEY: 'test-secret' },
    {
      fetch: async (url, init) => {
        request = { url, init, body: JSON.parse(init.body) };
        return { ok: true, status: 200, text: async () => 'OK' };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://gateway.example/v1/chat/completions');
  assert.equal(request.body.model, 'vendor/actual-model-id');
  assert.equal(request.body.max_tokens, 4096);
  assert.ok(request.body.messages[0].content.length >= 8000);
  assert.match(request.init.headers.authorization, /^Bearer test-secret$/);
});

test('shared route probe classifies quota and alias failures without preserving response text', () => {
  assert.equal(
    classifyProbeFailure({ status: 402, body: 'payment required' }),
    'UPSTREAM_CREDIT_OR_QUOTA'
  );
  assert.equal(
    classifyProbeFailure({ status: 400, body: 'alias mismatch: unknown model' }),
    'ALIAS_MISMATCH'
  );
  assert.equal(classifyProbeFailure({ status: 429, body: 'rate limited' }), 'RATE_LIMITED');
});
