'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const routing = require('../routing');
const { loadPriors, priorFor } = require('../priors');

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const ASSESSMENT = {
  weightProfile: 'BALANCED',
  weights: { latency: 34, quality: 33, cost: 33 },
};

function profile(overrides) {
  return Object.assign(
    {
      taskId: 'TASK-AI-100-TEST',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'API_PASS',
      contextSize: 4000,
      expectedDuration: 30000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 10000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 4,
      currentWorkload: 0,
    },
    overrides || {}
  );
}

function candidate(overrides) {
  return Object.assign(
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'gw-task-ai-100',
      upstream: 'up-task-ai-100',
      accountId: 'acct-task-ai-100',
      quotaScope: 'acct-task-ai-100',
      modelId: 'provider/unknown-model',
      contextWindow: 64000,
      evidence: [
        {
          status: 'passed',
          proofLevel: 'HARNESS_PASS',
          ts: new Date(NOW - 1000).toISOString(),
        },
      ],
    },
    overrides || {}
  );
}

function rank(candidates, taskProfile, priors) {
  return routing.rankForProfile(candidates, taskProfile, ASSESSMENT, {
    now: NOW,
    priors,
    headrooms: { default: 'open' },
  });
}

describe('TASK-AI-100 external benchmark priors', () => {
  test('same-proof candidates use the prior as a strict tie-break and report it', () => {
    const strong = candidate({
      accountId: 'acct-strong',
      quotaScope: 'acct-strong',
      modelId: 'provider/gpt_6.luna:free',
    });
    const other = candidate({
      accountId: 'acct-other',
      quotaScope: 'acct-other',
      modelId: 'provider/other-model',
    });
    const priors = {
      ranking: [{ canonical: 'gpt-6-luna', codingTier: 'T1', reviewTier: 'T2' }],
    };

    const result = rank([other, strong], profile(), priors);

    assert.equal(result.ranking[0].modelId, strong.modelId);
    assert.deepEqual(result.ranking[0].scoreBreakdown.prior, {
      canonical: 'gpt-6-luna',
      tier: 'T1',
      bonus: 6,
    });
    assert.equal(result.ranking[0].score, result.ranking[1].score + 6);
  });

  test('a T1 prior cannot make a candidate pass the proof floor', () => {
    const unproven = candidate({
      modelId: 'provider/gpt-6-luna',
      evidence: [],
    });
    const result = rank([unproven], profile({ proofFloor: 'WORK_ITEM_PASS' }), {
      ranking: [{ canonical: 'gpt-6-luna', codingTier: 'T1', reviewTier: 'T1' }],
    });

    assert.equal(result.chosen, null);
    assert.equal(result.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');
  });

  test('unknown models have no prior and retain their score', () => {
    const unknown = candidate({ modelId: 'provider/not-listed' });
    const withoutPriors = rank([unknown], profile(), { ranking: [] }).ranking[0];
    const withUnrelatedPrior = rank([unknown], profile(), {
      ranking: [{ canonical: 'gpt-6-luna', codingTier: 'T1', reviewTier: 'T1' }],
    }).ranking[0];

    assert.equal(withUnrelatedPrior.scoreBreakdown.prior, null);
    assert.equal(withUnrelatedPrior.score, withoutPriors.score);
    assert.equal(priorFor(unknown, 'writer', { ranking: [] }), null);
  });

  test('review roles use reviewTier, while other roles use codingTier', () => {
    const model = candidate({ modelId: 'provider/gpt-6-luna' });
    const priors = {
      ranking: [{ canonical: 'gpt-6-luna', codingTier: 'T4', reviewTier: 'T1' }],
    };

    assert.deepEqual(priorFor(model, 'writer', priors), {
      canonical: 'gpt-6-luna',
      tier: 'T4',
      bonus: 0,
    });
    assert.deepEqual(priorFor(model, 'reviewer', priors), {
      canonical: 'gpt-6-luna',
      tier: 'T1',
      bonus: 6,
    });
    assert.deepEqual(priorFor(model, 'security-review', priors), {
      canonical: 'gpt-6-luna',
      tier: 'T1',
      bonus: 6,
    });
  });

  test('missing or malformed files return an empty ranking without throwing', () => {
    assert.deepEqual(
      loadPriors(path.join(os.tmpdir(), `task-ai-100-missing-${process.pid}.json`)),
      { ranking: [] }
    );
    assert.deepEqual(loadPriors(__filename), { ranking: [] });
  });
});
