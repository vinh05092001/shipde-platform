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
const assessment = {
  scoringPolicy: {
    version: 'fixture-v1',
    source: 'fixture://policy',
    rationale: 'Synthetic quality-only comparison in a single benchmark scale',
    maxAgeMs: 1000,
    dimensions: {
      quality: { weight: 1, min: 0, max: 10, unit: 'fixture-points', direction: 'higher' },
    },
  },
};
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
function both(rows) {
  return [
    routing.rankForProfile(structuredClone(rows), profile, assessment, context()),
    ranking.rankAndRecord(structuredClone(rows), context()),
  ];
}

test('legacy snapshot keeps selecting and marks legacy parts unsourced', () => {
  const rows = [candidate('legacy/unknown', null), candidate('legacy/known', null)];
  rows[1].quality = 80;
  const ctx = { ...context(), assessment: { weights: { quality: 1, applyPenalties: false } } };
  const dry = routing.rankForProfile(structuredClone(rows), profile, ctx.assessment, ctx);
  const execute = ranking.rankAndRecord(structuredClone(rows), ctx);
  assert.ok(dry.chosen);
  assert.equal(execute.chosen, dry.chosen);
  assert.deepEqual(
    execute.candidates.map((c) => [c.offeringId, c.score, c.scoreBreakdown]),
    dry.ranking.map((c) => [c.candidateKey, c.score, c.scoreBreakdown])
  );
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

test('bare legacy dispatch retains its exported helpers and selectable score', () => {
  const row = candidate('legacy/bare', null);
  const ctx = context();
  delete ctx.assessment;
  delete ctx.profile;
  const result = ranking.rankAndRecord([row], ctx);
  assert.ok(result.chosen);
  const parts = result.candidates[0].scoreBreakdown;
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

test('legacy tie breaks and reservation parts match for the same snapshot', () => {
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
  const execute = ranking.rankAndRecord(structuredClone(rows), ctx);
  assert.deepEqual(
    execute.candidates.map((c) => [c.offeringId, c.score, c.scoreBreakdown]),
    dry.ranking.map((c) => [c.candidateKey, c.score, c.scoreBreakdown])
  );
  assert.equal(execute.chosen, dry.chosen);
  assert.ok(dry.ranking.some((c) => c.scoreBreakdown.busyPenalty > 0));
});
test('same snapshot gives the same order and parts through both entry points', (t) => {
  const rows = [candidate('vendor/Case/model/v2', 3), candidate('other/model', 8)];
  const [dry, execute] = both(rows);
  assert.deepEqual(
    execute.candidates.map((c) => [c.offeringId, c.score, c.scoreBreakdown]),
    dry.ranking.map((c) => [c.candidateKey, c.score, c.scoreBreakdown])
  );
  assert.equal(dry.ranking[0].modelId, rows[1].modelId);
  assert.equal(execute.candidates[1].modelId, rows[0].modelId);
  assert.equal(execute.chosen, dry.chosen);
  const record = t.mock.method(require('../decisions'), 'recordDecision', () => {});
  const live = ranking.rankAndRecord(rows, { ...context(), dryRun: false });
  assert.deepEqual(live, execute);
  assert.equal(record.mock.callCount(), 1);
  for (const row of rows) {
    const direct = routing.scoreForProfile(row, assessment, context());
    assert.deepEqual(ranking.scoreCandidate(row, rows, profile.role, context()), {
      total: direct.score,
      breakdown: direct.breakdown,
    });
  }
});
test('unknown quality stays unknown and is not ranked as zero', () => {
  const unknown = candidate('unknown/model', null);
  const [dry, execute] = both([unknown, candidate('measured/zero', 0)]);
  assert.equal(dry.ranking[0].modelId, 'measured/zero');
  assert.equal(dry.ranking[1].scoreBreakdown.quality, null);
  assert.equal(dry.ranking[1].score, null);
  assert.equal(execute.candidates[1].score, null);
  assert.equal(both([unknown])[0].chosen, null);
  assert.equal(both([unknown])[1].chosen, null);
  assert.equal(both([unknown])[1].reasonCode, 'SCORING_INPUTS_UNVERIFIED');
  const floor = routing.rankForProfile(
    [{ ...unknown, quality: null }],
    { ...profile, qualityFloor: 1 },
    assessment,
    context()
  );
  assert.equal(floor.ranking.length, 1, 'null quality must not become zero at admission');
});
test('valid measured input changes the decision with an attributable explanation', () => {
  const rows = [candidate('first/model', 3), candidate('second/model', 8)];
  assert.equal(both(rows)[0].ranking[0].modelId, rows[1].modelId);
  rows[0].measurements.quality.value = 9;
  for (const result of both(rows)) {
    const winner = (result.ranking || result.candidates)[0];
    assert.equal(winner.modelId, rows[0].modelId);
    assert.equal(winner.scoreBreakdown.quality, 0.9);
    assert.equal(winner.scoreBreakdown.measurements.quality.source, 'fixture://benchmark');
    assert.match(result.reason, /fixture-v1/);
  }
});
test('no model-name bonus, inferred alias sharing or unverified scale', () => {
  const row = candidate('vendor/Case/model/v2', 4);
  const renamed = candidate('vendor/flagship/model/latest', 4);
  const ctx = context();
  ctx.priors.ranking = [
    {
      canonical: 'v2',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: { aaCodingIndex: 95 },
      retrievedAt: new Date(now).toISOString(),
    },
  ];
  assert.deepEqual(
    routing.scoreForProfile(row, assessment, ctx).score,
    routing.scoreForProfile(renamed, assessment, ctx).score
  );
  for (const patch of [
    { modelId: 'model/v2' },
    { modelVersion: 'other' },
    { unit: 'percentile' },
    { samples: 0 },
    { observedAt: new Date(now - 1001).toISOString() },
  ]) {
    const invalid = structuredClone(row);
    Object.assign(invalid.measurements.quality, patch);
    assert.equal(routing.scoreForProfile(invalid, assessment, context()).score, null);
  }
  const legacy = routing.scoreForProfile(row, {}, context());
  assert.ok(Number.isFinite(legacy.score));
  assert.equal(legacy.breakdown.sources.quality, 'unsourced');
});
test('policy normalizes different measured units before weighting and omits unknown parts', () => {
  const row = candidate('fixture/mixed-scale', 4);
  const mixed = structuredClone(assessment);
  mixed.scoringPolicy.dimensions.latency = {
    weight: 1,
    min: 0,
    max: 2000,
    unit: 'milliseconds',
    direction: 'lower',
  };
  row.measurements.latency = { ...row.measurements.quality, value: 1000, unit: 'milliseconds' };
  const scored = routing.scoreForProfile(row, mixed, context());
  assert.equal(scored.breakdown.quality, 0.4);
  assert.equal(scored.breakdown.latency, 0.5);
  assert.equal(scored.score, 0.45);
  row.measurements.latency.value = null;
  assert.equal(routing.scoreForProfile(row, mixed, context()).score, 0.4);
});
