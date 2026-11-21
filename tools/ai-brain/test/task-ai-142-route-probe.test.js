'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probeRoute, classifyProbeFailure, boundedProbe } = require('../route-probe');

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
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
            }),
        };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://gateway.example/v1/chat/completions');
  assert.equal(request.body.model, 'vendor/actual-model-id');
  assert.equal(request.body.max_tokens, 4096);
  assert.match(request.body.messages[0].content, /^Reply only OK\./);
  assert.ok(request.body.messages[0].content.length >= 8000);
  assert.match(request.init.headers.authorization, /^Bearer test-secret$/);
});

test('probe default budget is realistic while requesting a one-word reply (PR #288)', async () => {
  await probeRoute(
    { endpoint: 'https://gateway.example/v1', modelId: 'model' },
    'KEY',
    { KEY: 'fixture' },
    {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.max_tokens, 8192);
        assert.match(body.messages[0].content, /^Reply only OK\./);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
            }),
        };
      },
    }
  );
});

const { reviewLane } = require('../orchestrate');
const { candidateKey } = require('../candidates');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const decisions = require('../decisions');

function reviewerFixture(harness, dir, probe) {
  const candidate = {
    harness,
    source: 'gateway-a',
    gateway: 'gateway-a',
    upstream: 'vendor',
    accountId: 'fixture',
    quotaScope: 'fixture',
    modelId: 'vendor/model',
  };
  const registry = {
    sources: ['gateway-a', 'gateway-b', 'gateway-c'].map((id) => ({
      id,
      endpoint: 'https://' + id + '.example/v1',
      credential: { env: 'KEY' },
    })),
  };
  const options = {
    reviewerIdentity: candidateKey(candidate),
    isolatedWorker: true,
    routeProbe: probe,
  };
  const lane = reviewLane(
    options,
    { id: 'TASK-AI-142' },
    null,
    {},
    { dir },
    () => {
      throw new Error('launch must not run');
    },
    null,
    Date.now(),
    [candidate],
    {},
    registry
  );
  return { candidate, options, lane, registry };
}

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
  assert.deepEqual(
    classifyProbeFailure({
      status: 404,
      body: 'No active credentials for provider: azure',
    }),
    { reason: 'PROVIDER_UNAVAILABLE', provider: 'azure' }
  );
});

test('bounded probe aborts the signal received by a timed-out injected probe', async () => {
  let signal;
  const result = await boundedProbe(
    async (_candidate, _key, _env, opts) => {
      signal = opts.signal;
      return new Promise(() => {});
    },
    {},
    'KEY',
    {},
    { timeoutMs: 10 }
  );
  assert.equal(signal.aborted, true);
  assert.equal(classifyProbeFailure(result), 'TIMEOUT');
});

test('bounded probe cancellation reaches the HTTP client', async () => {
  let signal;
  await boundedProbe(
    probeRoute,
    { endpoint: 'https://gateway.example/v1', modelId: 'model' },
    'KEY',
    { KEY: 'fixture' },
    {
      timeoutMs: 10,
      fetch: async (_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true }
          );
        });
      },
    }
  );
  assert.equal(signal.aborted, true);
});
