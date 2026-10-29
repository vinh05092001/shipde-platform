'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const quotaScan = require('../quota-scan');
const { probeRoute } = require('../route-probe');
const { preferKnownGood } = require('../probe-order');

test('getQuotaScopeState resolves canonical vendor aliases for opencode-provider options', () => {
  const now = 1700000000000;
  const quotaState = {
    scopes: {
      'tokenharbor::claude-haiku-5.5': {
        source: 'tokenharbor',
        scope: 'claude-haiku-5.5',
        code: 'QUOTA',
        status: 402,
        at: now - 1000,
        retryAfter: now + 60000,
      },
      'iteracompute::qwen/qwen3.8-27b': {
        source: 'iteracompute',
        scope: 'qwen/qwen3.8-27b',
        code: 'OK',
        status: 200,
        at: now - 1000,
      },
      'iteracompute::anthropic/claude-opus-5-5': {
        source: 'iteracompute',
        scope: 'anthropic/claude-opus-5-5',
        code: 'QUOTA',
        status: 429,
        at: now - 1000,
        retryAfter: now + 60000,
      },
    },
  };

  // 1. Candidate with OpenCode provider gateway should resolve tokenharbor scope
  const candTokenHarbor = {
    gateway: 'opencode-provider-tokenharbor-options',
    modelId: 'claude-haiku-5.5',
  };
  const thbState = quotaScan.getQuotaScopeState(candTokenHarbor, quotaState, { now });
  assert.ok(thbState, 'Must resolve tokenharbor scope via gateway alias');
  assert.equal(thbState.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(thbState, now), true);

  // 2. Candidate with OpenCode iteracompute gateway and free model should be OK
  const candIteraFree = {
    gateway: 'opencode-provider-iteracompute-options',
    modelId: 'qwen/qwen3.8-27b',
  };
  const iteraFreeState = quotaScan.getQuotaScopeState(candIteraFree, quotaState, { now });
  assert.ok(iteraFreeState, 'Must resolve iteracompute scope for qwen3.8-27b');
  assert.equal(iteraFreeState.code, 'OK');
  assert.equal(quotaScan.isScopeBlocked(iteraFreeState, now), false);

  // 3. Candidate with OpenCode iteracompute gateway and paid model should be QUOTA blocked
  const candIteraPaid = {
    gateway: 'opencode-provider-iteracompute-options',
    modelId: 'anthropic/claude-opus-5-5',
  };
  const iteraPaidState = quotaScan.getQuotaScopeState(candIteraPaid, quotaState, { now });
  assert.ok(iteraPaidState, 'Must resolve iteracompute scope for claude-opus-5-5');
  assert.equal(iteraPaidState.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(iteraPaidState, now), true);
});

test('preferKnownGood filters out candidate whose alias is in blocked quota scope', () => {
  const now = 1700000000000;
  const quotaState = {
    scopes: {
      'tokenharbor::claude-haiku-5.5': {
        source: 'tokenharbor',
        scope: 'claude-haiku-5.5',
        code: 'QUOTA',
        status: 402,
        at: now - 1000,
        retryAfter: now + 60000,
      },
    },
  };

  const candidateKey = 'opencode::direct::tokenharbor::claude-haiku-5.5';
  const cand = {
    candidateKey,
    gateway: 'opencode-provider-tokenharbor-options',
    modelId: 'claude-haiku-5.5',
    score: 85,
  };

  const result = {
    ranking: [{ candidateKey, score: 85 }],
    rejected: [],
    chosen: candidateKey,
  };

  const updated = preferKnownGood(result, [cand], { quotaState, now });
  assert.equal(updated.ranking.length, 0, 'Blocked candidate must be filtered out of ranking');
  assert.equal(updated.rejected.length, 1, 'Blocked candidate must be recorded in rejected');
  assert.equal(updated.rejected[0].reasonCode, 'QUOTA_SCOPE_QUOTA');
});

test('probeRoute handles direct-http candidate without throwing invalid URL on accessPath: direct', async () => {
  let requestedUrl = null;
  const mockFetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    };
  };

  const candidate = {
    harness: 'direct-http',
    accessPath: 'direct',
    endpoint: 'https://api.example.com/v1',
    modelId: 'test-model',
  };

  const res = await probeRoute(
    candidate,
    'MOCK_KEY',
    { MOCK_KEY: 'mock-secret' },
    {
      fetch: mockFetch,
    }
  );

  assert.equal(res.ok, true);
  assert.equal(requestedUrl, 'https://api.example.com/v1/chat/completions');
});
