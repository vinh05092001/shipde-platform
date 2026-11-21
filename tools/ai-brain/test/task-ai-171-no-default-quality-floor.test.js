'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTaskProfile } = require('../orchestrate');
const routing = require('../routing');
for (const role of ['author.foundation', 'reviewer', 'security-review', 'researcher']) {
  test(role + ' does not inject a numeric quality floor', () => {
    const profile = buildTaskProfile({ id: 'TASK-AI-171', role }, { enforceProofFloors: false });
    assert.equal(profile.qualityFloor, null);
    assert.equal(routing.validateTaskProfile(profile).valid, true);
  });
}
test('explicit quality requirement remains enforced', () => {
  const profile = buildTaskProfile(
    { id: 'TASK-AI-171', qualityFloor: 82 },
    { enforceProofFloors: false }
  );
  assert.equal(profile.qualityFloor, 82);
  assert.equal(routing.validateTaskProfile(profile).valid, true);
});
test('missing optional floor is accepted while malformed explicit floor is refused', () => {
  const p = buildTaskProfile({ id: 'TASK-AI-171' }, { enforceProofFloors: false });
  delete p.qualityFloor;
  assert.equal(routing.validateTaskProfile(p).valid, true);
  assert.equal(routing.validateTaskProfile({ ...p, qualityFloor: 'bad-owner-input' }).valid, false);
});

const { parseTicket } = require('../ticket-parser');
const { candidateKey } = require('../candidates');
const now = Date.parse('2026-11-01T12:00:00.000Z');
const candidate = {
  harness: 'opencode-direct',
  accessPath: 'cli',
  gateway: 'test-gw',
  upstream: 'test-up',
  accountId: 'test-acc',
  quotaScope: 'test-acc',
  modelId: 'test-gw/measured-model',
  quality: 55,
  contextWindow: 128000,
  cost: 5,
  latency: 500,
  qualifiedRoles: ['author.foundation'],
  evidence: [],
};
const context = () => ({
  now,
  loadQuotaState: false,
  useStoredQuota: false,
  priors: {
    generatedAt: new Date(now).toISOString(),
    ranking: [
      { canonical: 'reference', score: 100, benchmarks: [{ name: 'aaCodingIndex', score: 100 }] },
      {
        canonical: 'measured-model',
        score: 55,
        benchmarks: [{ name: 'aaCodingIndex', score: 55 }],
      },
    ],
  },
});
const assessment = {
  jevOutcome: 'DECIDED',
  confidence: 'high',
  reasonCodes: ['FIXTURE'],
  weights: { quality: 50, latency: 25, cost: 25 },
};
test('real profile producer admits known-quality candidate without injecting old floor; explicit owner floor still rejects', () => {
  const item = parseTicket(
    '# TASK-AI-171: fixture\nGOAL: fixture\nVERIFY: fixture\nALLOWED FILES: x.js'
  );
  const p = buildTaskProfile(item, { enforceProofFloors: false });
  const selected = routing.rankForProfile([candidate], p, assessment, context());
  assert.equal(selected.chosen, candidateKey(candidate));
  assert.match(selected.reason, /no task quality floor specified/);
  assert.doesNotMatch(selected.reason, /quality floor (null|undefined|70|40)/);
  const explicit = buildTaskProfile(parseTicket(item.rawText + '\nQUALITY FLOOR: 82'), {
    enforceProofFloors: false,
  });
  assert.equal(explicit.qualityFloor, 82);
  const refused = routing.rankForProfile([candidate], explicit, assessment, context());
  assert.equal(refused.chosen, null);
  assert.ok(refused.rejected.some((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'));
});
test('removing an implicit floor does not clear a quota block', () => {
  const p = buildTaskProfile({ id: 'TASK-AI-171' }, { enforceProofFloors: false });
  const refused = routing.rankForProfile(
    [{ ...candidate, blocked: true, blockReason: 'QUOTA_GROUP_UNKNOWN', blockScope: 'account' }],
    p,
    assessment,
    context()
  );
  assert.equal(refused.chosen, null);
  assert.ok(refused.rejected.some((r) => /QUOTA_GROUP_UNKNOWN/.test(r.reason)));
});
test('invalid explicit ticket floor is diagnosed instead of replaced by a default', () => {
  const p = buildTaskProfile(parseTicket('# TASK-AI-171: fixture\nQUALITY FLOOR: invalid'), {
    enforceProofFloors: false,
  });
  assert.equal(p.qualityFloor, 'invalid');
  assert.ok(
    routing.validateTaskProfile(p).errors.some((e) => e.code === 'MALFORMED_QUALITY_FLOOR')
  );
});

test('invalid explicit floor types cannot coerce into zero or an unspecified constraint', () => {
  for (const qualityFloor of [false, true, [], {}, '', ' ', -1, 101, Infinity]) {
    const p = buildTaskProfile({ id: 'TASK-AI-171', qualityFloor }, { enforceProofFloors: false });
    assert.equal(routing.validateTaskProfile(p).valid, false);
  }
});

test('default work-item planner does not invent its own quality floor', async () => {
  const { defaultPlanningDeps } = require('../work-item-planner');
  let profile;
  const deps = defaultPlanningDeps(process.cwd(), {
    loadPool: () => ({ annotated: [], evidenceData: {}, accounts: [] }),
    rankForProfile: (rows, p) => {
      profile = p;
      return { chosen: null, ranking: [] };
    },
  });
  await deps.rankPlanner({ workItemId: 'TASK-AI-171', role: 'planner.default' });
  assert.equal(profile.qualityFloor, null);
});
