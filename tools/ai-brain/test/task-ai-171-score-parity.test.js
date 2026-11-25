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
  test(`no-policy execute preserves legacy scoring and ordering: ${name}`, (t) => {
    const rows = [candidate('fixture/evidenced', null), candidate('fixture/high-quality', null)];
    rows[0].quality = 10;
    rows[0].evidence = [{ status: 'passed', level: 'OUTCOME' }];
    rows[1].quality = 90;
    const ctx = { ...context(), assessment: snapshot };
    if (!withProfile) delete ctx.profile;
    const baselineContext = { ...ctx, profile: undefined, assessment: undefined };
    const legacy = ranking.rankAndRecord(structuredClone(rows), baselineContext);
    const result = ranking.rankAndRecord(structuredClone(rows), ctx);
    assert.equal(result.chosen, routing.candidateKey(rows[0]));
    assert.deepEqual(
      result.candidates.map((row) => row.score),
      [51, 33]
    );
    assert.deepEqual(result, legacy);
    for (const row of result.candidates) {
      for (const part of Object.keys(ranking.WEIGHTS)) {
        assert.equal(row.scoreBreakdown.sources[part], 'unsourced', part);
      }
    }

    // Equal upstream/score must retain input order, not profile key ordering.
    const tied = [candidate('z/first', null), candidate('a/second', null)];
    tied.forEach((row) => {
      row.quality = 80;
    });
    assert.deepEqual(
      ranking.rankAndRecord(structuredClone(tied), ctx),
      ranking.rankAndRecord(structuredClone(tied), baselineContext)
    );

    const scorer = t.mock.method(routing, 'scoreForProfile', () => {
      assert.fail('no-policy execute must not enter the shared profile scorer');
    });
    const comparator = t.mock.method(routing, 'compareProfileScores', () => {
      assert.fail('no-policy execute must not enter profile ordering');
    });
    assert.deepEqual(ranking.scoreCandidate(rows[0], rows, profile.role, ctx), {
      total: legacy.candidates[0].score,
      breakdown: legacy.candidates[0].scoreBreakdown,
    });
    assert.deepEqual(ranking.rankAndRecord(structuredClone(rows), ctx), legacy);
    assert.equal(scorer.mock.callCount(), 0);
    assert.equal(comparator.mock.callCount(), 0);
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

test('no-policy execute ordering cannot enter the shared comparator', (t) => {
  const rows = [candidate('z/first', null), candidate('a/second', null)];
  rows.forEach((row) => {
    row.quality = 80;
  });
  t.mock.method(routing, 'compareProfileScores', () => assert.fail('unexpected shared comparator'));
  // Isolate ordering from the separate scoring defect.
  t.mock.method(routing, 'scoreForProfile', () => ({ score: 33, breakdown: { quality: 80 } }));
  for (const ctx of [
    { ...context(), assessment: {} },
    { ...context(), profile: undefined, assessment: { weights: { quality: 1 } } },
  ]) {
    const result = ranking.rankAndRecord(structuredClone(rows), ctx);
    assert.deepEqual(
      result.candidates.map((row) => row.modelId),
      rows.map((row) => row.modelId)
    );
  }
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

test('empty assessment preserves legacy execute scores, selection and unsourced parts', () => {
  const rows = [candidate('fixture/evidenced', null), candidate('fixture/high-quality', null)];
  rows[0].quality = 10;
  rows[0].evidence = [{ status: 'passed', level: 'OUTCOME' }];
  rows[1].quality = 90;
  const ctx = context();
  delete ctx.profile;
  delete ctx.assessment;
  const legacy = ranking.rankAndRecord(structuredClone(rows), ctx);
  assert.equal(legacy.chosen, routing.candidateKey(rows[0]));
  const empty = ranking.rankAndRecord(structuredClone(rows), { ...ctx, assessment: {} });
  assert.equal(empty.chosen, legacy.chosen);
  assert.deepEqual(empty.candidates, legacy.candidates);
  for (const row of empty.candidates) {
    for (const part of Object.keys(ranking.WEIGHTS)) {
      assert.equal(row.scoreBreakdown.sources[part], 'unsourced', part);
    }
  }
});

test('empty assessment preserves legacy execute tie ordering', () => {
  const rows = [candidate('z/first', null), candidate('a/second', null)];
  rows.forEach((row) => {
    row.quality = 80;
  });
  const ctx = context();
  delete ctx.profile;
  delete ctx.assessment;
  const legacy = ranking.rankAndRecord(structuredClone(rows), ctx);
  const empty = ranking.rankAndRecord(structuredClone(rows), { ...ctx, assessment: {} });
  assert.equal(legacy.chosen, routing.candidateKey(rows[0]));
  assert.equal(empty.chosen, legacy.chosen);
  assert.deepEqual(empty.candidates, legacy.candidates);
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
  const execute = ranking.rankAndRecord(structuredClone(rows), ctx);
  assert.deepEqual(
    execute,
    ranking.rankAndRecord(structuredClone(rows), {
      ...ctx,
      profile: undefined,
      assessment: undefined,
    })
  );
  assert.equal(execute.chosen, routing.candidateKey(rows[1]));
});

test('legacy snapshot keeps selecting and marks legacy parts unsourced', () => {
  const rows = [candidate('legacy/unknown', null), candidate('legacy/known', null)];
  rows[1].quality = 80;
  const ctx = { ...context(), assessment: { weights: { quality: 1, applyPenalties: false } } };
  const dry = routing.rankForProfile(structuredClone(rows), profile, ctx.assessment, ctx);
  const execute = ranking.rankAndRecord(structuredClone(rows), ctx);
  assert.ok(dry.chosen);
  assert.equal(execute.chosen, dry.chosen);
  assert.deepEqual(
    execute,
    ranking.rankAndRecord(structuredClone(rows), {
      ...ctx,
      profile: undefined,
      assessment: undefined,
    })
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
  const execute = ranking.rankAndRecord(structuredClone(rows), ctx);
  assert.deepEqual(
    execute,
    ranking.rankAndRecord(structuredClone(rows), {
      ...ctx,
      profile: undefined,
      assessment: undefined,
    })
  );
  assert.equal(execute.chosen, routing.candidateKey(rows[0]));
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
