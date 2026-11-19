'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jev = require('../jev');
const routing = require('../routing');
const { dispatchCommand } = require('../cli');
const selection = require('../writer-selection');
const { buildTaskProfile } = require('../orchestrate');
const { candidateKey } = require('../candidates');

const source = {
  id: 'jev',
  kind: 'decision-service',
  endpoint: 'https://fixture.invalid/ask',
  model: 'fixture-model',
  credential: { env: 'FIXTURE_JEV_KEY' },
};
const env = { FIXTURE_JEV_KEY: 'fixture-only' };
const profile = {
  taskId: 'TASK-AI-171',
  role: 'writer',
  complexity: 'standard',
  requiredCapabilities: [],
  proofFloor: 'NONE',
  qualityFloor: 0,
  costCeiling: 10,
  riskDomains: [],
  forbiddenFailureDomains: [],
};
const candidate = (id, extra = {}) => ({
  harness: 'paseo',
  gateway: 'fixture',
  accessPath: 'fixture',
  upstream: 'fixture',
  accountId: id,
  quotaScope: id,
  modelId: id,
  quality: 80,
  cost: 1,
  latencyMs: 100,
  evidence: [{ status: 'passed' }],
  ...extra,
});
const answer = (key, choice, confidence = 0.95) => ({
  answers: { [key]: { type: 'choice', choice, confidence } },
  usage: { input_tokens: 8, output_tokens: 2, raw: 'private fixture text' },
});
const turns = [];
const recordTurn = (turn) => turns.push(turn);

for (const clear of [true, false]) {
}

test('ticket skip metadata reaches the profile; cached assessment records one turn', async () => {
  const p = buildTaskProfile({ id: profile.taskId, skipReason: 'TASK_ALREADY_CLASSIFIED' });
  assert.equal(p.skipReason, 'TASK_ALREADY_CLASSIFIED');
  const options = { recordTurn };
  const before = turns.length;
  const ask = async () => assert.fail('classified ticket must not ask');
  await selection.assessOnce(p, source, ask, options, routing);
  await selection.assessOnce(p, source, ask, options, routing);
  assert.equal(turns.length - before, 1);
});

test('selection request contains only admitted route IDs and minimal evidence', async () => {
  const a = candidate('route-a', { privateNotes: 'private fixture text' });
  const b = candidate('route-b');
  const blocked = candidate('blocked-route', { blocked: true });
  const costly = candidate('budget-route', { cost: profile.costCeiling + 1 });
  const auth = candidate('auth-route', { credentialEnvMissing: true });
  const ranked = routing.rankForProfile(
    [a, b, blocked, costly, auth],
    profile,
    { weights: routing.WEIGHT_PROFILES.BALANCED },
    { headrooms: {}, useStoredQuota: false }
  );
  assert.equal(ranked.ranking.length, 2);
  for (const id of ['blocked-route', 'budget-route', 'auth-route', candidateKey(b)]) {
    const ask = jev.buildJevAsk(source, {
      env,
      httpClient: async (_url, body) => {
        assert.deepEqual(
          Object.keys(body.questions.eligibleModel.criteria).sort(),
          [candidateKey(a), candidateKey(b)].sort()
        );
        assert.doesNotMatch(
          body.state,
          /private fixture text|blocked-route|budget-route|auth-route|modelId|accountId/
        );
        const state = JSON.parse(body.state);
        assert.deepEqual(
          state.candidates.map((c) => c.routeId).sort(),
          [candidateKey(a), candidateKey(b)].sort()
        );
        return answer('eligibleModel', id);
      },
    });
    const result = await routing.adviseModelChoice(ranked, profile, { ask, recordTurn });
    assert.equal(result.chosen, id === candidateKey(b) ? id : ranked.chosen);
    assert.equal(result.advice.outcome, id === candidateKey(b) ? 'DECIDED' : 'UNDECIDED');
  }
});

const question = {
  kind: 'classify-task',
  key: 'taskClass',
  prompt: 'private fixture text',
  evidence: 'fixture evidence',
  options: ['docs', 'implementation'],
};
for (const [reason, patch, reply] of [
  ['VALID_ADVICE', {}, answer('taskClass', 'docs')],
  ['MALFORMED_OUTPUT', {}, answer('taskClass', 'outside')],
  ['INSUFFICIENT_OPTIONS', { options: [] }, null],
  ['INSUFFICIENT_EVIDENCE', { evidence: '' }, null],
  ['LOW_CONFIDENCE', {}, answer('taskClass', 'docs', jev.DEFAULT_MIN_CONFIDENCE / 2)],
  ['TIMEOUT', {}, new Error('JEV_TIMEOUT')],
  ['INVALID_RESPONSE', {}, new SyntaxError('private fixture text')],
]) {
  test(`request boundary: ${reason}`, async () => {
    let calls = 0;
    const ask = jev.buildJevAsk(source, {
      env,
      httpClient: async (_url, body) => {
        calls++;
        assert.deepEqual(Object.keys(body.questions), ['taskClass']);
        if (reply instanceof Error) throw reply;
        return reply;
      },
    });
    const result = await jev.advise({ ...question, ...patch }, { ask, recordTurn });
    assert.equal(result.turn.reason, reason);
    assert.equal(calls, reply === null ? 0 : 1);
    assert.equal(result.outcome, reason === 'VALID_ADVICE' ? 'DECIDED' : 'UNDECIDED');
  });
}
