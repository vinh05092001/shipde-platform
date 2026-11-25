'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../routing');

function profile(overrides = {}) {
  return Object.assign(
    {
      taskId: 'TASK-AI-142-H3',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 1000,
      expectedDuration: 10000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 100,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      riskDomains: [],
    },
    overrides
  );
}

test('quality-only reasoning scores retain known values and order despite unknown quota', () => {
  const assessment = {
    weights: routing.WEIGHT_PROFILES.QUALITY_FIRST,
    renormalizeKnownScores: true,
  };
  const candidates = [0, 19, 95].map((quality) => ({
    harness: 'hermes',
    accessPath: 'https://example.test/v1',
    gateway: '',
    upstream: 'test',
    accountId: 'account',
    quotaScope: 'account',
    modelId: `reasoner-${quality}`,
    contextWindow: 128000,
    quality,
    evidence: [],
    headroomStatus: 'unknown',
  }));
  const context = {
    priors: { ranking: [] },
    useStoredQuota: false,
    headrooms: { default: 'unknown' },
  };
  const scores = candidates.map((c) => routing.scoreForProfile(c, assessment, context));
  assert.deepEqual(
    scores.map((s) => s.score),
    [0, 4, 80]
  );
  for (const s of scores) {
    assert.equal(s.breakdown.latency, null);
    assert.equal(s.breakdown.cost, null);
    assert.equal(s.breakdown.reliability, null);
  }
  const ranked = routing.rankForProfile(
    candidates,
    profile({ requiredHarness: 'hermes' }),
    assessment,
    context
  );
  assert.deepEqual(
    ranked.ranking.map((c) => c.modelId),
    ['reasoner-95', 'reasoner-19', 'reasoner-0']
  );
});

test('healthy reasoning candidates use existing benchmark priors to choose the strongest', () => {
  const priors = require('../priors').loadPriors(
    require('path').join(__dirname, 'fixtures', 'priors-20261013.json')
  );
  const rows = ['deepseek-v4-1-flash', 'gpt-6-astra', 'claude-opus-5-5'].map((modelId) => ({
    harness: 'hermes',
    accessPath: 'https://example.test/v1',
    gateway: '',
    upstream: 'test',
    accountId: 'account',
    quotaScope: 'account',
    modelId,
    contextWindow: 128000,
    evidence: [],
  }));
  const result = routing.rankForProfile(
    rows,
    profile({ role: 'planner', requiredHarness: 'hermes' }),
    { weights: routing.WEIGHT_PROFILES.QUALITY_FIRST, renormalizeKnownScores: true },
    {
      priors,
      now: Date.parse('2026-10-14T01:08:00Z'),
      useStoredQuota: false,
      headrooms: { default: 'open' },
    }
  );
  assert.equal(result.ranking.length, 3);
  assert.equal(result.ranking[0].modelId, 'gpt-6-astra');
  assert.equal(result.chosen, result.ranking[0].candidateKey);
  assert.ok(result.ranking[0].score > result.ranking[1].score);
  assert.ok(result.ranking[1].score > result.ranking[2].score);
});
