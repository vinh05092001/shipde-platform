'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probeRoute, classifyProbeFailure, failureReason } = require('../route-probe');
const candidate = { endpoint: 'https://example.invalid/v1', modelId: 'fixture-model' };
const completion = {
  model: 'fixture-model',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
};
async function probe(body, status = 200, headers = {}) {
  let request;
  const result = await probeRoute(
    candidate,
    'FIXTURE_KEY',
    { FIXTURE_KEY: 'fixture-not-a-real-key' },
    {
      fetch: async (_url, options) => {
        request = JSON.parse(options.body);
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers,
        });
      },
    }
  );
  return { result, request };
}
test('shared preflight validates completion while preserving realistic request budget', async () => {
  const { result, request } = await probe(completion);
  assert.equal(request.stream, false);
  assert.equal(request.max_tokens, 8192);
  assert.ok(request.messages[0].content.length >= 8000);
  assert.equal(result.ok, true);
  assert.equal(result.body, undefined);
});
test('shared preflight refuses unverified 2xx bodies', async () => {
  for (const body of [
    'OK',
    '',
    'data: {}\n\n',
    {},
    { choices: [] },
    { choices: [null] },
    { ...completion, error: { message: 'refused' } },
    { choices: [{ finish_reason: null, message: { role: 'assistant', content: '' } }] },
  ]) {
    assert.equal((await probe(body)).result.ok, false);
  }
  assert.equal(
    (await probe(completion, 200, { 'content-type': 'text/event-stream' })).result.ok,
    false
  );
});
test('shared preflight preserves quota and TPM evidence without provider text', async () => {
  const marker = 'fixture-private-echo a@example.invalid';
  const { result } = await probe(
    {
      error: {
        message: 'quota exhausted; tokens per minute (TPM): Limit 1200, Requested 2400 ' + marker,
      },
    },
    429,
    {
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-limit-tokens': '1200',
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.tokensPerMinuteLimit, 1200);
  assert.equal(result.requestedTokens, 2400);
  assert.equal(result.quota.status, 'exhausted');
  assert.equal(failureReason(classifyProbeFailure(result)), 'UPSTREAM_CREDIT_OR_QUOTA');
  assert.equal(JSON.stringify(result).includes(marker), false);
});
test('shared preflight retains provider-unavailable identity without raw error text', async () => {
  const { result } = await probe(
    {
      error: { message: 'No active credentials for provider: fixture-provider; a@example.invalid' },
    },
    503
  );
  const cause = classifyProbeFailure(result);
  assert.equal(failureReason(cause), 'PROVIDER_UNAVAILABLE');
  assert.equal(cause.provider, 'fixture-provider');
  assert.equal(JSON.stringify(result).includes('a@example.invalid'), false);
});

test('shared preflight preserves timeout classification and injected classifier ownership', async () => {
  const options = {
    fetch: async () => {
      const error = new Error('private transport details');
      error.name = 'AbortError';
      throw error;
    },
  };
  const timeout = await probeRoute(
    candidate,
    'FIXTURE_KEY',
    { FIXTURE_KEY: 'fixture-only' },
    options
  );
  assert.equal(timeout.body, 'Request timeout');
  assert.equal(failureReason(classifyProbeFailure(timeout)), 'TIMEOUT');
  const real = require('../failure-classifier');
  let calls = 0;
  const result = await probeRoute(
    candidate,
    'FIXTURE_KEY',
    { FIXTURE_KEY: 'fixture-only' },
    {
      failureClassifier: {
        ...real,
        classifyFailure() {
          calls++;
          return { cause: real.Cause.UNKNOWN, scope: real.Scope.MODEL };
        },
      },
      fetch: async () => new Response('private provider error', { status: 500 }),
    }
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.classification, { cause: real.Cause.UNKNOWN, scope: real.Scope.MODEL });
  assert.equal(JSON.stringify(result).includes('private provider error'), false);
});

test('safe metadata preserves the legacy Hermes classifier over representative raw failures', async (t) => {
  t.mock.method(Date, 'now', () => 1800000000000);
  const classifier = require('../failure-classifier');
  const { PROVIDER_LEVEL_FAILURE_CAUSES, safeProbeClassification } = require('../route-probe');
  const cases = [
    ...[...PROVIDER_LEVEL_FAILURE_CAUSES].map((code) => [503, code]),
    [503, 'insufficient_credits'],
    [500, 'internal error'],
    [503, 'service unavailable'],
    [402, 'payment required'],
    [401, 'invalid api key'],
    [403, 'subscription required'],
    [404, 'model not found'],
    [429, 'rate limit'],
    [451, 'region blocked'],
    [413, 'tokens per minute (TPM): Limit 1200, Requested 2400'],
  ];
  for (const [status, raw] of cases) {
    const body = raw + ' private-echo@example.invalid';
    const legacy = classifier.classifyFailure({
      httpStatus: status,
      exitCode: 0,
      body:
        status === 503 && /insufficient[_ ]credits?|quota|credit_exhausted/i.test(body)
          ? `[402] ${body}`
          : body,
      stderr: '',
    });
    const providerCause = body
      .match(new RegExp(`\\b(${[...PROVIDER_LEVEL_FAILURE_CAUSES].join('|')})\\b`, 'i'))?.[1]
      ?.toLowerCase();
    const expected = {};
    for (const key of ['cause', 'scope', 'cooldownMs', 'retryAfterMs', 'resetTime', 'retryable']) {
      if (legacy[key] !== undefined) expected[key] = legacy[key];
    }
    if (providerCause) expected.providerCause = providerCause;
    const result = (await probe(body, status)).result;
    assert.deepEqual(result.classification, expected, status + ' ' + raw);
    assert.equal(JSON.stringify(result).includes('private-echo@example.invalid'), false);
    assert.equal(result.classification.evidence, undefined);
    assert.equal(safeProbeClassification(result.classification, classifier).cause, legacy.cause);
  }
  assert.equal(safeProbeClassification({ cause: 'invented', scope: 'account' }, classifier), null);
  assert.equal(
    safeProbeClassification({ cause: 'unknown', scope: 'model', cooldownMs: '10' }, classifier),
    null
  );
});

test('onboarding trusts verified completion and never revives invalid HTTP 200', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-probe-onboard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { step3ProbeModels, step5RecordEvidence } = require('../source-onboarding');
  const source = {
    id: 'fixture-router',
    endpoint: 'https://example.invalid/v1',
    harness: 'direct-http',
    credential: { env: 'FIXTURE_KEY' },
  };
  for (const [name, body, expected] of [
    ['invalid', { error: { message: 'refused' } }, false],
    ['valid', completion, true],
  ]) {
    const rows = await step3ProbeModels(
      source,
      ['fixture-model'],
      { FIXTURE_KEY: 'fixture-only' },
      {
        fetch: async () => new Response(JSON.stringify(body), { status: 200 }),
      }
    );
    assert.equal(rows[0].ok, expected);
    const file = path.join(dir, name + '.json');
    step5RecordEvidence(source, rows, {
      routeHealthFile: file,
      persistRouteHealth: true,
      now: 1800000000000,
    });
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(
      Object.values(store.paths).some((row) => row.status === 'AVAILABLE'),
      expected
    );
  }
});
