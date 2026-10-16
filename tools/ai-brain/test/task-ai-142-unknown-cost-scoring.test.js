'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../routing');

function sampleProfile(overrides = {}) {
  return Object.assign(
    {
      taskId: 'TASK-AI-142-UNKNOWN-COST',
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

function sampleCandidate(overrides = {}) {
  const c = Object.assign(
    {
      harness: 'test-harness',
      accessPath: 'cli',
      gateway: 'test-gw',
      upstream: 'test-upstream',
      accountId: 'test-account',
      quotaScope: 'test-account',
      modelId: 'test-upstream/test-model',
      contextWindow: 64000,
      evidence: [],
    },
    overrides
  );
  c.candidateKey = routing.candidateKey(c);
  return c;
}

test('scoreForProfile: unknown cost excludes cost dimension from totalWeight without renormalizeKnownScores flag', () => {
  const candidateUnpriced = sampleCandidate({
    modelId: 'test-upstream/model-unpriced',
    quality: 59,
    cost: null,
  });

  const candidateFree = sampleCandidate({
    modelId: 'test-upstream/model-free',
    quality: 24,
    cost: 0,
  });

  // Standard assessment without renormalizeKnownScores (e.g. JEV weights)
  const assessment = {
    weightProfile: 'CUSTOM',
    weights: { quality: 51, latency: 34, cost: 15 },
  };
  const ctx = { priors: { ranking: [] } };

  const scoreUnpriced = routing.scoreForProfile(candidateUnpriced, assessment, ctx);
  const scoreFree = routing.scoreForProfile(candidateFree, assessment, ctx);

  assert.equal(scoreUnpriced.breakdown.cost, null);
  assert.equal(scoreFree.breakdown.cost, 100);

  // Unpriced candidate with quality 59 should have score 59 (only quality known: 33 * 59 / 33 = 59)
  // rather than being penalized as 0 cost divided by 100 weight (19)
  assert.equal(scoreUnpriced.score, 59);

  // Free candidate: quality 24 (weight 33) + cost 100 (weight 15) -> (33*24 + 15*100) / (33+15) = 2292 / 48 = 48
  assert.equal(scoreFree.score, 48);

  // High-quality unpriced candidate must score higher than low-quality free candidate
  assert.ok(
    scoreUnpriced.score > scoreFree.score,
    `unpriced candidate score (${scoreUnpriced.score}) must exceed free candidate score (${scoreFree.score})`
  );
});

test('rankForProfile: higher quality candidate with unknown cost beats lower quality free candidate', () => {
  const candidateUnpriced = sampleCandidate({
    upstream: 'provider-alpha',
    modelId: 'provider-alpha/model-high-quality-unpriced',
    quality: 59,
    cost: null,
  });

  const candidateFree = sampleCandidate({
    upstream: 'provider-beta',
    modelId: 'provider-beta/model-low-quality-free',
    quality: 24,
    cost: 0,
  });

  const profile = sampleProfile();
  const assessment = {
    weightProfile: 'CUSTOM',
    weights: { quality: 51, latency: 34, cost: 15 },
  };
  const ctx = { priors: { ranking: [] }, headrooms: { default: 'open' } };

  const result = routing.rankForProfile(
    [candidateUnpriced, candidateFree],
    profile,
    assessment,
    ctx
  );

  assert.equal(result.ranking.length, 2);
  assert.equal(
    result.chosen,
    candidateUnpriced.candidateKey,
    `high quality candidate with unknown cost should win over lower quality free candidate; chosen was ${result.chosen}`
  );
  assert.equal(result.ranking[0].candidateKey, candidateUnpriced.candidateKey);
  assert.ok(result.ranking[0].score > result.ranking[1].score);
});

test('scoreForProfile: candidate with all unknown dimensions scores 0', () => {
  const candidateUnknown = sampleCandidate({
    evidence: [],
  });
  const assessment = {
    weights: { quality: 33, latency: 34, cost: 33 },
  };
  const ctx = { priors: { ranking: [] } };

  const scored = routing.scoreForProfile(candidateUnknown, assessment, ctx);
  assert.equal(scored.score, 0);
  assert.equal(scored.breakdown.quality, null);
  assert.equal(scored.breakdown.reliability, null);
  assert.equal(scored.breakdown.latency, null);
  assert.equal(scored.breakdown.cost, null);
});
