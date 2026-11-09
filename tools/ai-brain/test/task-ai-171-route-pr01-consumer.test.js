'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchOutput } = require('../dispatch-output');
const { decisionFromDispatch, firstLaunch, launchFromDecision } = require('../route-handoff');
const routing = require('../routing');
const { createWorktreeClaim } = require('./helpers/worktree-claim');

const profile = { taskId: 'TASK-AI-171', role: 'researcher', proofFloor: 'NONE', costCeiling: 10 };
const now = Date.parse('2026-11-08T00:00:00Z');
const assessment = {
  scoringPolicy: {
    version: 'fixture',
    maxAgeMs: 1000,
    dimensions: {
      quality: { weight: 1, min: 0, max: 10, unit: 'points', direction: 'higher' },
    },
  },
};
const registry = {
  sources: [],
  dispatch: {
    providers: { fixture: { harness: 'paseo', provider: 'opencode', modelPrefix: 'fixture/' } },
    launchModes: { opencode: ['full-access'] },
  },
};
const claimHelper = createWorktreeClaim();
const ticket = {
  workItemId: profile.taskId,
  outputTokens: 1,
  minProof: 'HARNESS_PASS',
  request: { cwd: claimHelper.worktree },
};
function envelope() {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    candidateKey: `opaque%3A%3Akey::${i}`,
    modelId: `Org/Case/Model:${i}`,
    source: 'fixture',
    gateway: 'fixture',
    upstream: 'upstream',
    harness: 'paseo',
    accountId: `account::${i}`,
    connectionId: `connection::${i}`,
    quotaScope: `quota::${i}`,
    accessPath: 'fixture-access',
    score: i / 10,
    qualityLabel: 'QUALITY_MEASURED',
    scoreBreakdown: {
      quality: i / 10,
      measurements: { quality: { source: 'fixture://AA', value: i } },
    },
  }));
  return dispatchOutput(profile, assessment, rows, {
    chosen: rows.at(-1).candidateKey,
    ranking: rows,
    rejected: [{ ...rows[0], candidateKey: 'rejected', reasonCode: 'POLICY_REFUSAL' }],
  });
}
const consume = (value, options) => decisionFromDispatch(JSON.stringify(value), options);

for (const difficulty of ['simple', 'hard', 'unrated']) {
  test(`${difficulty} preserves the chosen writer, all seven ranks and policy scores`, () => {
    const input = envelope();
    const decision = consume(input, { difficulty, probeRows: [input.ranking[0]] });
    assert.equal(decision.controllerStatus, 'READY');
    assert.equal(decision.selected, input.chosen);
    assert.deepEqual(
      decision.candidates.map((c) => c.offeringId),
      input.ranking.map((c) => c.candidateKey)
    );
    assert.deepEqual(
      decision.candidates.map((c) => c.scoreBreakdown),
      input.ranking.map((c) => c.scoreBreakdown)
    );
    assert.deepEqual(
      decision.candidates.map((c) => c.score),
      input.ranking.map((c) => c.score)
    );
    assert.equal(decision.scoreScale, input.scoreScale);
    assert.deepEqual(decision.rejected, input.rejected);
    const context = {
      evidenceData: {
        combinations: decision.candidates.map((c) => ({
          ...c,
          evidence: [{ status: 'passed', proofLevel: ticket.minProof }],
        })),
      },
      ...claimHelper.context,
    };
    assert.equal(firstLaunch(decision, ticket, context, registry).launch.offeringId, input.chosen);
  });
}
test('explicit escaped identity survives the JSON consumer and existing launcher', () => {
  const input = envelope();
  const decision = consume(input);
  const selected = decision.candidates.at(-1);
  for (const field of [
    'modelId',
    'accountId',
    'connectionId',
    'quotaScope',
    'accessPath',
    'harness',
  ]) {
    assert.equal(selected[field], input.selected[field]);
    assert.ok(selected[field]);
  }
  const launch = launchFromDecision(decision, ticket.request, registry);
  assert.equal(launch.model, 'fixture/' + input.selected.modelId);
  assert.throws(
    () => launchFromDecision(decision, { offeringId: decision.candidates[0].offeringId }, registry),
    /CONTROLLER_CHOICE_REQUIRED/
  );
  decision.selected = decision.candidates[0].offeringId;
  assert.throws(() => launchFromDecision(decision, {}, registry), /CONTROLLER_CHOICE_REQUIRED/);
  assert.equal(firstLaunch(decision, ticket, {}, registry).action, 'BLOCKED');
});
test('chosen-null with ranked and injected probe routes cannot launch', () => {
  const input = {
    ...envelope(),
    chosen: null,
    selected: null,
    reasonCode: 'SCORING_INPUTS_UNVERIFIED',
  };
  const decision = consume(input, { probeRows: envelope().ranking });
  assert.equal(decision.selected, null);
  assert.equal(decision.reasonCode, input.reasonCode);
  assert.equal(firstLaunch(decision, ticket, {}, registry).action, 'BLOCKED');
  assert.throws(
    () => launchFromDecision(decision, { offeringId: decision.candidates[0].offeringId }, registry),
    /CONTROLLER_CHOICE_REQUIRED/
  );
});
test('a newly refused chosen writer blocks instead of substituting another ranked writer', () => {
  const decision = consume(envelope());
  const out = firstLaunch(
    decision,
    ticket,
    { ledger: { failures: [{ offeringId: decision.selected, class: 'LAUNCH_FAILED' }] } },
    registry
  );
  assert.equal(out.action, 'BLOCKED');
  assert.equal(out.reason, 'CONTROLLER_CHOICE_UNAVAILABLE');
});
for (const stale of [false, true]) {
  test(`${stale ? 'stale snapshot' : 'unknown quality'} retains Controller refusal and provenance`, () => {
    const rows = [
      {
        ...envelope().ranking[0],
        cost: 1,
        contextWindow: 100,
        qualifiedRoles: ['researcher'],
        measurements: {
          quality: {
            value: stale ? 8 : null,
            source: 'fixture://AA',
            unit: 'points',
            samples: 1,
            observedAt: new Date(now - (stale ? 1001 : 0)).toISOString(),
            modelId: envelope().ranking[0].modelId,
          },
        },
      },
    ];
    const ranked = routing.rankForProfile(rows, profile, assessment, {
      now,
      useStoredQuota: false,
      loadQuotaState: false,
      quotaState: {},
      reservations: [],
    });
    const input = dispatchOutput(profile, assessment, rows, ranked);
    const decision = consume(input);
    assert.equal(decision.selected, null);
    assert.equal(decision.candidates[0].score, null);
    assert.equal(decision.candidates[0].qualityLabel, 'QUALITY_UNKNOWN');
    assert.deepEqual(decision.candidates[0].scoreBreakdown, input.ranking[0].scoreBreakdown);
    assert.equal(firstLaunch(decision, ticket, {}, registry).action, 'BLOCKED');
  });
}
test('known quality, ties, freshness and snapshot statuses retain producer evidence', () => {
  const input = envelope();
  input.ranking[0].score = null;
  input.ranking[0].qualityLabel = 'QUALITY_UNKNOWN';
  input.ranking[1].score = input.ranking[2].score;
  input.scoringPolicyStatus = 'ACTIVE';
  input.scoringPriorsStatus = 'STALE';
  const decision = consume(input);
  assert.deepEqual(
    decision.candidates.map((c) => c.qualityLabel),
    input.ranking.map((c) => c.qualityLabel)
  );
  assert.equal(decision.scoringPriorsStatus, 'STALE');
  assert.equal(decision.scoringPolicyStatus, 'ACTIVE');
  assert.deepEqual(decision.assessment, input.assessment);
  assert.deepEqual(decision.filters, input.filters);
});
test('parse failure, execution error, empty inventory and refusal stay distinct', () => {
  const empty = { ...envelope(), chosen: null, selected: null, ranking: [], rejected: [] };
  const outcomes = [
    decisionFromDispatch('{'),
    consume(envelope(), { exitCode: 1 }),
    consume(empty),
    consume(
      { ...empty, rejected: envelope().rejected, reasonCode: 'POLICY_REFUSAL' },
      { exitCode: 1 }
    ),
  ];
  assert.deepEqual(
    outcomes.map((d) => d.controllerStatus),
    ['ERROR', 'ERROR', 'EMPTY', 'REFUSED']
  );
  assert.deepEqual(
    outcomes.map((d) => d.reasonCode),
    [
      'CONTROLLER_JSON_INVALID',
      'CONTROLLER_EXECUTION_ERROR',
      'CONTROLLER_EMPTY_CANDIDATES',
      'POLICY_REFUSAL',
    ]
  );
  for (const decision of outcomes)
    assert.equal(firstLaunch(decision, ticket, {}, registry).action, 'BLOCKED');
});
test('invalid shape, duplicate keys and inconsistent selected identity fail closed', () => {
  const input = envelope();
  for (const invalid of [
    null,
    [],
    {},
    { ...input, chosen: 'missing' },
    { ...input, ranking: [input.ranking[0], input.ranking[0]] },
    { ...input, selected: { ...input.selected, accountId: 'different' } },
  ]) {
    const decision = consume(invalid);
    assert.equal(decision.controllerStatus, 'ERROR');
    assert.equal(decision.reasonCode, 'CONTROLLER_DECISION_INVALID');
    assert.equal(firstLaunch(decision, ticket, {}, registry).action, 'BLOCKED');
  }
});
