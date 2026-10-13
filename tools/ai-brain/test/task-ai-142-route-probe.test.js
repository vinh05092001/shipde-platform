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
        return { ok: true, status: 200, text: async () => 'OK' };
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

test('reviewer gateway routes are probed on every harness before launch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-route-'));
  try {
    for (const harness of ['opencode', 'paseo', 'hermes', 'cline', 'codex']) {
      let probes = 0;
      const { lane, options } = reviewerFixture(harness, dir, async () => {
        probes++;
        return { ok: false, status: 403 };
      });
      options.isolatedWorker = harness !== 'codex';
      const result = await lane('a'.repeat(40));
      assert.equal(result.cause, 'REVIEWER_ROUTE_PROBE_FAILED', harness);
      assert.equal(probes, 1, harness);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reviewer providers share the canonical-model cap; another model has its own cap', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cap-'));
  try {
    const probed = [];
    const { candidate, registry } = reviewerFixture('hermes', dir, async (c) => {
      probed.push(c.modelId);
      return { ok: false, status: 403 };
    });
    candidate.modelId = 'model';
    // Rebuild once with the stable candidate identity; route metadata can change on retry.
    const retryLane = reviewLane(
      {
        reviewerIdentity: candidateKey(candidate),
        routeProbe: async (c) => {
          probed.push(c.modelId);
          return { ok: false, status: 403 };
        },
      },
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
    for (const prefix of ['provider-a/', 'provider-b/', 'provider-c/', 'provider-c/other-']) {
      registry.dispatch = { providers: { 'gateway-a': { provider: prefix, modelPrefix: prefix } } };
      registry.sources[0].endpoint = 'https://' + prefix.split('/')[0] + '.example/v1';
      await retryLane('a'.repeat(40));
    }
    assert.deepEqual(probed, ['provider-a/model', 'provider-b/model', 'provider-c/other-model']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI-only reviewer records an explicit probe skip without borrowing another model route', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-skip-'));
  try {
    let probes = 0;
    const { lane, candidate, options, registry } = reviewerFixture('codex', dir, async () => {
      probes++;
      return { ok: false, status: 403 };
    });
    options.isolatedWorker = false;
    options.reviewRoot = path.join(dir, 'review');
    registry.sources = [
      {
        id: 'unrelated',
        endpoint: 'https://unrelated.example/v1',
        credential: { env: 'KEY' },
        models: [candidate.modelId],
      },
    ];
    // Later launch setup may refuse the CLI, but preflight must record why it skipped.
    try {
      await lane('a'.repeat(40));
    } catch (error) {
      assert.ok(error instanceof Error);
    }
    assert.equal(probes, 0);
    assert.ok(
      decisions
        .readDecisions({ dir })
        .some(
          (entry) =>
            entry.role === 'reviewer' &&
            entry.detail ===
              'REVIEWER_ROUTE_PROBE_SKIPPED: NO_HTTP_ROUTE_OR_PROBE_CREDENTIAL_CONFIG'
        )
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
