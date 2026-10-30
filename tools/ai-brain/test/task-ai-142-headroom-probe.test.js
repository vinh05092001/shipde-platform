'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../routing');
const sources = require('../sources');

function sampleProfile(overrides = {}) {
  return Object.assign(
    {
      taskId: 'TASK-AI-142-HEADROOM-PROBE',
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
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'test-gw',
      upstream: 'test-upstream',
      accountId: 'test-account',
      quotaScope: 'test-account',
      modelId: 'test-upstream/test-model',
      contextWindow: 64000,
      evidence: [],
      qualifiedRoles: ['author.foundation'],
    },
    overrides
  );
  c.candidateKey = routing.candidateKey(c);
  return c;
}

test('probed-OK unknown-headroom candidate with higher quality outranks lower-quality open-headroom candidate', () => {
  const candidateProbedUnknown = sampleCandidate({
    accountId: 'account-probed-unknown',
    quotaScope: 'account-probed-unknown',
    modelId: 'provider-explabs/opus',
    quality: 82,
    cost: null,
    routeEvidence: {
      configured: true,
      probeSucceeded: true,
      status: 200,
    },
  });

  candidateProbedUnknown.quotaProbe = {
    candidateKey: candidateProbedUnknown.candidateKey,
    ok: true,
    httpStatus: 200,
    observedAt: new Date().toISOString(),
    quotaStatus: 'unknown',
  };

  const candidateOpen = sampleCandidate({
    accountId: 'account-open',
    quotaScope: 'account-open',
    modelId: 'provider-open/qwen',
    quality: 70,
    cost: null,
  });

  const profile = sampleProfile();
  const assessment = {
    weightProfile: 'CUSTOM',
    weights: { quality: 100, latency: 0, cost: 0, reliability: 0 },
  };
  const ctx = {
    priors: { ranking: [] },
    headrooms: {
      'account-probed-unknown': { status: 'unknown' },
      'account-open': { status: 'open', observedAt: new Date().toISOString() },
    },
  };

  const result = routing.rankForProfile(
    [candidateProbedUnknown, candidateOpen],
    profile,
    assessment,
    ctx
  );

  assert.equal(result.ranking.length, 2);
  const scoredUnknown = result.ranking.find(
    (c) => c.candidateKey === candidateProbedUnknown.candidateKey
  );
  const scoredOpen = result.ranking.find((c) => c.candidateKey === candidateOpen.candidateKey);

  assert.equal(
    scoredUnknown.scoreBreakdown.headroomPenalty,
    0,
    'probed-OK unknown headroom must take 0 headroom penalty'
  );
  assert.equal(
    scoredOpen.scoreBreakdown.headroomPenalty,
    0,
    'open headroom takes 0 headroom penalty'
  );
  assert.equal(scoredUnknown.score, 82);
  assert.equal(scoredOpen.score, 70);
  assert.equal(
    result.chosen,
    candidateProbedUnknown.candidateKey,
    `higher quality probed-OK candidate must be chosen over lower quality open candidate; chosen was ${result.chosen}`
  );
});

test('unprobed unknown-headroom candidate is excluded and its score remains penalized', () => {
  const candidateUnprobedUnknown = sampleCandidate({
    accountId: 'account-unprobed-unknown',
    quotaScope: 'account-unprobed-unknown',
    modelId: 'provider-unprobed/opus',
    quality: 82,
    cost: null,
    routeEvidence: null,
  });

  const candidateOpen = sampleCandidate({
    accountId: 'account-open',
    quotaScope: 'account-open',
    modelId: 'provider-open/qwen',
    quality: 70,
    cost: null,
  });

  const profile = sampleProfile();
  const assessment = {
    weightProfile: 'CUSTOM',
    weights: { quality: 100, latency: 0, cost: 0, reliability: 0 },
  };
  const ctx = {
    priors: { ranking: [] },
    headrooms: {
      'account-unprobed-unknown': { status: 'unknown' },
      'account-open': { status: 'open', observedAt: new Date().toISOString() },
    },
  };

  const result = routing.rankForProfile(
    [candidateUnprobedUnknown, candidateOpen],
    profile,
    assessment,
    ctx
  );

  assert.equal(result.ranking.length, 1);
  assert.ok(
    result.rejected.some(
      (c) =>
        c.candidateKey === candidateUnprobedUnknown.candidateKey &&
        c.reasonCode === 'QUOTA_UNKNOWN_REQUIRES_LIVE_PROBE'
    )
  );
  const scoredOpen = result.ranking[0];
  const scoredUnknown = routing.scoreForProfile(candidateUnprobedUnknown, assessment, ctx);
  assert.equal(scoredUnknown.breakdown.headroomPenalty, 15);
  assert.equal(scoredUnknown.score, 67);
  assert.equal(scoredOpen.scoreBreakdown.headroomPenalty, 0);
  assert.equal(scoredOpen.score, 70);
  assert.equal(
    result.chosen,
    candidateOpen.candidateKey,
    `lower quality open candidate outranks unprobed unknown candidate; chosen was ${result.chosen}`
  );
});

test('tight headroom candidate is still penalized even if probe succeeded', () => {
  const candidateTight = sampleCandidate({
    accountId: 'account-tight',
    quotaScope: 'account-tight',
    modelId: 'provider-tight/model',
    quality: 82,
    cost: null,
    routeEvidence: {
      configured: true,
      probeSucceeded: true,
      status: 200,
    },
  });

  const profile = sampleProfile();
  const assessment = {
    weightProfile: 'CUSTOM',
    weights: { quality: 100, latency: 0, cost: 0, reliability: 0 },
  };
  const ctx = {
    priors: { ranking: [] },
    headrooms: {
      'account-tight': { status: 'tight', observedAt: new Date().toISOString() },
    },
  };

  const result = routing.rankForProfile([candidateTight], profile, assessment, ctx);
  assert.equal(result.ranking.length, 1);
  const scored = result.ranking[0];
  assert.equal(
    scored.scoreBreakdown.headroomPenalty,
    10,
    'tight headroom takes configured tight penalty'
  );
  assert.equal(scored.score, 72); // 82 - 10 = 72
});

test('getDispatchConfig provides configured headroom penalty values and defaults', () => {
  const defaults = sources.getDispatchConfig();
  assert.equal(defaults.headroomUnknownPenalty, 15);
  assert.equal(defaults.headroomTightPenalty, 10);

  const customRegistry = {
    sources: [],
    dispatch: {
      headroomUnknownPenalty: 25,
      headroomTightPenalty: 8,
    },
  };
  const customConfig = sources.getDispatchConfig(customRegistry);
  assert.equal(customConfig.headroomUnknownPenalty, 25);
  assert.equal(customConfig.headroomTightPenalty, 8);
});
