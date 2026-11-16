'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const health = require('../route-health');
const registry = { sources: [{ id: 'fixture-router', endpoint: 'https://example.invalid/v1' }] };
const completion = (finish = 'stop', content = 'OK') => ({
  model: 'fixture-model',
  choices: [{ message: { role: 'assistant', content }, finish_reason: finish }],
});
async function probe(body, status = 200, headers = {}) {
  let request;
  const result = await health.probeGatewayModel('fixture-model', 'fixture-router', {
    registry,
    fetch: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers,
      });
    },
  });
  return { result, request };
}
test('plain-text probe requests non-streaming and stores no successful response content', async () => {
  for (const body of [completion(), completion('length', '')]) {
    const { result, request } = await probe(body);
    assert.equal(request.stream, false);
    assert.equal(request.max_tokens, 1);
    assert.equal(result.ok, true);
    assert.equal(result.message, undefined);
    assert.equal(JSON.stringify(result).includes('"content"'), false);
    assert.equal(result.model, 'fixture-model');
  }
});
test('unverified HTTP 2xx never becomes AVAILABLE', async () => {
  const cases = [
    'data: {}\n\n',
    '',
    'not-json',
    {},
    { choices: [] },
    { choices: [null] },
    completion('stop', ''),
    completion(null, ''),
    completion('weird'),
    completion('content_filter'),
    completion('stop', {}),
    completion('stop', 1),
    { ...completion(), error: { message: 'refused' } },
    {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [] },
        },
      ],
    },
  ];
  for (const body of cases) {
    const { result } = await probe(body);
    assert.equal(result.ok, false);
    const store = { version: 1, paths: {}, events: [] };
    health.recordResult(store, 'fixture-model', 'fixture-router', result, 1000);
    assert.notEqual(Object.values(store.paths)[0].status, 'AVAILABLE');
  }
  assert.equal(
    (await probe(completion(), 200, { 'content-type': 'text/event-stream' })).result.ok,
    false
  );
});
test('HTTP failure stays failure and retains retry/classification without echoed secrets', async () => {
  const secret = 'sk-' + 'fixture-redaction-check';
  const { result } = await probe(
    {
      error: {
        type: 'rate_limit',
        code: '429',
        message: secret + ' a@example.invalid Reply with OK.',
      },
    },
    429,
    { 'retry-after': '60' }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.ok(Number.isFinite(Date.parse(result.resetAt)));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('a@example.invalid'), false);
  assert.equal(JSON.stringify(result).includes('Reply with OK.'), false);
  assert.equal(health.classifyFailure(result.status, result.message), 'RATE_LIMITED');
  assert.equal((await probe(completion(), 402)).result.ok, false);
  const bodyFailure = await probe({ error: { message: 'model not found' } });
  assert.equal(health.classifyFailure(200, bodyFailure.result.message), 'UNSUPPORTED');
  assert.equal(bodyFailure.result.reasonCode, 'ALIAS_MISMATCH');
  const invalidRetry = await probe({ error: { message: 'rate limit' } }, 429, {
    'retry-after': 'not-a-date',
  });
  assert.equal(invalidRetry.result.status, 429);
  assert.equal(invalidRetry.result.resetAt, null);
});
