'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../routing');
const ranking = require('../ranking');

const now = Date.parse('2026-11-07T00:00:00Z');
const profile = {
  taskId: 'TASK-AI-171',
  role: 'researcher',
  proofFloor: 'NONE',
  requiredCapabilities: [],
  qualityFloor: 0,
  contextSize: 1,
  costCeiling: 100,
};
// The retired scoring policy is no longer read; the default snapshot carries none.
const assessment = {};
function candidate(modelId, value) {
  return {
    harness: 'opencode',
    accessPath: 'fixture',
    upstream: 'fixture',
    gateway: '',
    accountId: modelId,
    quotaScope: modelId,
    modelId,
    modelVersion: 'fixture-revision',
    contextWindow: 64000,
    cost: 1,
    qualifiedRoles: ['researcher'],
    evidence: [],
    measurements: {
      quality: {
        value,
        unit: 'fixture-points',
        source: 'fixture://benchmark',
        samples: 4,
        observedAt: new Date(now).toISOString(),
        modelId,
        modelVersion: 'fixture-revision',
      },
    },
  };
}
function context() {
  return {
    now,
    role: profile.role,
    profile,
    assessment,
    priors: { ranking: [] },
    dryRun: true,
    useStoredQuota: false,
    loadQuotaState: false,
    quotaState: {},
    reservations: [],
    evidenceData: { combinations: [] },
    headrooms: {},
    reported: {},
  };
}
for (const [name, snapshot, withProfile] of [
  ['empty assessment with researcher profile', {}, true],
  ['weights with researcher profile', { weights: { quality: 1 } }, true],
  ['weights without profile', { weights: { quality: 1 } }, false],
  ['absent assessment with researcher profile', undefined, true],
  ['null assessment with researcher profile', null, true],
  ['null scoring policy with researcher profile', { scoringPolicy: null }, true],
]) {
  test(`no-policy scoring keeps the legacy score parts: ${name}`, (t) => {
    const rows = [candidate('fixture/evidenced', null), candidate('fixture/high-quality', null)];
    rows[0].quality = 10;
    rows[0].evidence = [{ status: 'passed', level: 'OUTCOME' }];
    rows[1].quality = 90;
    const ctx = { ...context(), assessment: snapshot };
    if (!withProfile) delete ctx.profile;
    const baselineContext = { ...ctx, profile: undefined, assessment: undefined };
    const scorer = t.mock.method(routing, 'scoreForProfile', () => {
      assert.fail('no-policy scoring must not enter the shared profile scorer');
    });
    const scored = rows.map((row) => ranking.scoreCandidate(row, rows, profile.role, ctx));
    assert.deepEqual(
      scored.map((r) => r.total),
      [51, 33]
    );
    assert.deepEqual(
      scored,
      rows.map((row) => ranking.scoreCandidate(row, rows, profile.role, baselineContext))
    );
    for (const r of scored) {
      for (const part of Object.keys(ranking.WEIGHTS)) {
        assert.equal(r.breakdown.sources[part], 'unsourced', part);
      }
    }
    assert.equal(scorer.mock.callCount(), 0);
  });
}

test('no-policy execute direct scoring cannot enter the shared scorer', (t) => {
  t.mock.method(routing, 'scoreForProfile', () => assert.fail('unexpected shared scorer'));
  const row = candidate('fixture/direct', null);
  const ctx = { ...context(), assessment: { weights: { quality: 1 } } };
  const scored = ranking.scoreCandidate(row, [row], profile.role, ctx);
  assert.equal(scored.total, 33);
  assert.equal(scored.breakdown.sources.evidence, 'unsourced');
});

test('empty assessment preserves legacy profile scores without ctx.profile', () => {
  const rows = [candidate('fixture/evidenced', null), candidate('fixture/high-quality', null)];
  rows[0].quality = 10;
  rows[0].evidence = [{ status: 'passed', level: 'OUTCOME' }];
  rows[1].quality = 90;
  const ctx = { ...context(), assessment: {} };
  delete ctx.profile;
  const result = routing.rankForProfile(structuredClone(rows), profile, {}, ctx);
  assert.equal(result.chosen, routing.candidateKey(rows[1]));
  assert.deepEqual(
    result.ranking.map((row) => row.score),
    [78, 70]
  );
  const explicitProfile = routing.rankForProfile(
    structuredClone(rows),
    profile,
    {},
    {
      ...ctx,
      profile,
    }
  );
  assert.deepEqual(result, explicitProfile);
});

test('no-policy own reservation retains each entry point legacy behavior without ctx.taskId', () => {
  const rows = [candidate('fixture/quality-a', null), candidate('fixture/quality-b', null)];
  rows[0].quality = 80;
  rows[1].quality = 70;
  const ctx = {
    ...context(),
    assessment: { weights: { quality: 1, latency: 0, cost: 0 } },
    reservations: [{ offeringId: routing.candidateKey(rows[0]), workItemId: profile.taskId }],
  };
  assert.equal(ctx.taskId, undefined);
  const dry = routing.rankForProfile(structuredClone(rows), profile, ctx.assessment, ctx);
  assert.equal(dry.chosen, routing.candidateKey(rows[0]));
  assert.deepEqual(
    dry.ranking.map((row) => row.score),
    [65, 55]
  );
});

test('legacy snapshot keeps selecting and marks legacy parts unsourced', () => {
  const rows = [candidate('legacy/unknown', null), candidate('legacy/known', null)];
  rows[1].quality = 80;
  const ctx = { ...context(), assessment: { weights: { quality: 1, applyPenalties: false } } };
  const dry = routing.rankForProfile(structuredClone(rows), profile, ctx.assessment, ctx);
  assert.ok(dry.chosen);
  assert.equal(dry.ranking[1].scoreBreakdown.quality, null);
  assert.equal(dry.ranking[1].qualityLabel, 'QUALITY_UNKNOWN');
  for (const row of dry.ranking) {
    for (const [part, value] of Object.entries(row.scoreBreakdown)) {
      if (typeof value === 'number' || part === 'prior') {
        assert.equal(row.scoreBreakdown.sources[part], 'unsourced', part);
      }
    }
  }
});

test('bare legacy scoring retains its exported helpers and unsourced parts', () => {
  const row = candidate('legacy/bare', null);
  const ctx = context();
  delete ctx.assessment;
  delete ctx.profile;
  const parts = ranking.scoreCandidate(row, [row], profile.role, ctx).breakdown;
  for (const part of Object.keys(ranking.WEIGHTS)) assert.equal(parts.sources[part], 'unsourced');
  for (const name of [
    'evidenceScore',
    'capabilityScore',
    'headroomScore',
    'spreadPenalty',
    'costScore',
  ]) {
    assert.equal(typeof ranking[name], 'function', name);
  }
});

test('no-policy tie breaks and reservation parts retain each entry point legacy behavior', () => {
  const rows = [candidate('z/tied', null), candidate('a/tied', null)];
  rows.forEach((row) => {
    row.quality = 80;
  });
  const ctx = {
    ...context(),
    assessment: { weights: { quality: 1, applyPenalties: false } },
    reservations: [{ offeringId: routing.candidateKey(rows[1]), workItemId: 'other' }],
  };
  const dry = routing.rankForProfile(structuredClone(rows), profile, ctx.assessment, ctx);
  assert.ok(dry.ranking.some((c) => c.scoreBreakdown.busyPenalty > 0));
});
test('no-policy admission preserves UNKNOWN quality under a positive floor', () => {
  const row = { ...candidate('fixture/unknown-quality', null), quality: null };
  const result = routing.rankForProfile([row], { ...profile, qualityFloor: 1 }, {}, context());
  assert.equal(result.chosen, routing.candidateKey(row));
  assert.equal(result.ranking.length, 1);
  assert.equal(result.ranking[0].qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(
    result.rejected.some((entry) => entry.reasonCode === 'QUALITY_FLOOR_NOT_MET'),
    false
  );
});
