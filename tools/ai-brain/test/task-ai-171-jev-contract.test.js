'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jev = require('../jev');
const routing = require('../routing');
const wrapper = require('../jev-wrapper');

const source = {
  kind: 'decision-service',
  endpoint: 'https://fixture.invalid/ask',
  model: 'fixture-model',
  credential: { env: 'FIXTURE_KEY' },
};
const question = {
  kind: 'classify-task',
  key: 'taskClass',
  prompt: 'fixture private prompt',
  evidence: 'fixture private evidence',
  options: ['docs', 'implementation'],
};
const ranking = [
  { candidateKey: 'route-a', isAlive: true, score: 1 },
  { candidateKey: 'blocked-route', blocked: true },
  { candidateKey: 'route-b', isAlive: true, score: 2 },
];
const turns = [];
const recordTurn = (turn) => turns.push(turn);
const choice = (value) => ({ type: 'choice', choice: value, confidence: 0.95 });
function options(reply, inspect) {
  const httpClient = async (_url, body) => {
    inspect?.(body);
    return reply;
  };
  return {
    recordTurn,
    ask: jev.buildJevAsk(source, { env: { FIXTURE_KEY: 'fixture-secret' }, httpClient }),
  };
}
function select(opts, chosen = 'route-a') {
  return routing.adviseModelChoice({ chosen, ranking }, {}, opts);
}

test('TASK-AI-169 clear PR-body-only task skips JEV', async () => {
  const clear = {
    ...question,
    evidence: 'Update PR body only',
    skipReason: 'TASK_ALREADY_CLASSIFIED',
  };
  const ask = async () => assert.fail('clear task must skip');
  const result = await wrapper.run(clear, { ask, recordTurn });
  assert.equal(result.reason, 'TASK_ALREADY_CLASSIFIED');
  assert.equal(result.turn.called, false);
  assert.equal(result.turn.callReason, 'TASK_ALREADY_CLASSIFIED');
});

test('TASK-AI-169 ambiguous task uses the named choice contract', async () => {
  const reply = {
    answers: { unrelated: choice('implementation'), taskClass: choice('docs') },
    usage: { input_tokens: 12, output_tokens: 3, raw: 'fixture-secret' },
  };
  const result = await jev.advise(
    question,
    options(reply, (body) => {
      assert.deepEqual(Object.keys(body.questions), ['taskClass']);
      assert.equal(body.questions.taskClass.type, 'choice');
      assert.deepEqual(Object.keys(body.questions.taskClass.criteria), question.options);
    })
  );
  assert.equal(result.outcome, 'DECIDED', 'deserving classification must decide');
  assert.equal(result.choice, 'docs');
  assert.equal(result.turn.questionKey, 'taskClass');
  assert.deepEqual(result.turn.usage, { input_tokens: 12, output_tokens: 3 });
});

test('selection sends only the filtered shortlist and accepts a valid routeId', async () => {
  const reply = { answers: { eligibleModel: choice('route-b') } };
  const result = await select(
    options(reply, (body) => {
      assert.deepEqual(Object.keys(body.questions.eligibleModel.criteria), ['route-a', 'route-b']);
      assert.equal(body.state.includes('blocked-route'), false);
    })
  );
  assert.equal(result.chosen, 'route-b');
  assert.equal(result.advice.outcome, 'DECIDED', 'valid routeId must decide');
});

for (const [reason, reply] of [
  ['LOW_CONFIDENCE', { choice: 'route-b', confidence: 0.2 }],
  ['UNREACHABLE', new Error('fixture-secret')],
  ['TIMEOUT', new Error('JEV_TIMEOUT')],
  ['MALFORMED_OUTPUT', choice('outside-shortlist')],
]) {
  test(`${reason} never overrides the Controller`, async () => {
    const ask = async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    };
    const result = await select({ ask, recordTurn });
    assert.equal(result.chosen, 'route-a');
    assert.equal(result.advice.outcome, 'UNDECIDED');
    assert.equal(result.advice.turn.reason, reason);
    assert.equal(result.advice.turn.confidence, reply.confidence ?? null);
  });
}

test('wrapper preserves the existing confidence floor', async () => {
  const ask = async () => ({ choice: 'docs', confidence: jev.DEFAULT_MIN_CONFIDENCE / 2 });
  const result = await wrapper.run(question, { ask, recordTurn });
  assert.equal(result.reason, 'LOW_CONFIDENCE');
});

for (const location of ['source', 'options']) {
  for (const minConfidence of [0, '', false]) {
    test(`wrapper rejects falsy ${location} confidence ${JSON.stringify(minConfidence)}`, async () => {
      const config = location === 'source' ? { source: { minConfidence } } : { minConfidence };
      const ask = async () => ({ choice: 'implementation', confidence: 0.2 });
      const result = await wrapper.run(question, { ...config, ask });
      assert.equal(result.outcome, 'UNDECIDED');
      assert.equal(result.reason, 'LOW_CONFIDENCE');

      const atFloor = await wrapper.run(question, {
        ...config,
        ask: async () => ({ choice: 'implementation', confidence: jev.DEFAULT_MIN_CONFIDENCE }),
      });
      assert.equal(atFloor.outcome, 'DECIDED');
      assert.equal(atFloor.choice, 'implementation');
    });
  }
}

test('missing named answer, score-only selection and invalid confidence fail closed', async () => {
  const scores = Object.fromEntries(
    ['qualityImportance', 'latencyImportance', 'costImportance'].map((name) => [
      name,
      { score: 1, confidence: 0.95 },
    ])
  );
  for (const reply of [
    { answers: { unrelated: choice('docs') } },
    { scores },
    { choice: 'docs', confidence: 1.1 },
  ]) {
    const result = await jev.advise(question, options(reply));
    assert.equal(result.outcome, 'UNDECIDED');
    assert.equal(result.reason, 'MALFORMED_OUTPUT');
  }
});

test('singleton shortlist skips and keeps the Controller choice outside topN', async () => {
  const ask = async () => assert.fail('singleton must skip');
  const result = await select({ topN: 1, ask, recordTurn }, 'route-b');
  assert.equal(result.chosen, 'route-b');
  assert.equal(result.advice.turn.called, false);
  assert.equal(result.advice.turn.reason, 'INSUFFICIENT_OPTIONS');
});

test('configured confidence and assessment turn evidence are retained', async () => {
  const ask = async () => ({ choice: 'docs', confidence: 0.9, usage: { input_tokens: 7 } });
  const result = await wrapper.run(question, { source: { minConfidence: 0.95 }, ask, recordTurn });
  assert.equal(result.reason, 'LOW_CONFIDENCE');
  assert.deepEqual(result.turn.usage, { input_tokens: 7 });
  const fail = async () => {
    throw new Error('fixture-secret');
  };
  const assessment = await routing.assessTask(
    { role: 'writer', riskDomains: [] },
    {
      ask: fail,
      recordTurn,
    }
  );
  assert.equal(assessment.jevTurn.reason, 'UNREACHABLE');
});

test('null confidence configuration cannot bypass the existing floor', async () => {
  const ask = async () => ({ choice: 'docs', confidence: 0.2 });
  const result = await wrapper.run(question, { minConfidence: null, ask, recordTurn });
  assert.equal(result.reason, 'LOW_CONFIDENCE');
  const routeAsk = async () => ({ choice: 'route-b', confidence: 0.2 });
  const selected = await select({ minConfidence: null, ask: routeAsk, recordTurn });
  assert.equal(selected.chosen, 'route-a');
});

test('mock turn metadata excludes private text and reports totals by reason', (t) => {
  const totals = { called: 0, skipped: 0, DECIDED: {}, UNDECIDED: {} };
  for (const turn of turns) {
    assert.ok(Number.isFinite(turn.latencyMs) && turn.latencyMs >= 0);
    assert.equal(typeof turn.questionKind, 'string');
    assert.equal(typeof turn.questionKey, 'string');
    assert.doesNotMatch(JSON.stringify(turn), /fixture-secret|private prompt|private evidence/);
    totals[turn.called ? 'called' : 'skipped']++;
    totals[turn.outcome][turn.reason] = (totals[turn.outcome][turn.reason] || 0) + 1;
  }
  assert.deepEqual(totals, {
    called: 14,
    skipped: 2,
    DECIDED: { VALID_ADVICE: 2 },
    UNDECIDED: {
      TASK_ALREADY_CLASSIFIED: 1,
      LOW_CONFIDENCE: 5,
      UNREACHABLE: 2,
      TIMEOUT: 1,
      MALFORMED_OUTPUT: 4,
      INSUFFICIENT_OPTIONS: 1,
    },
  });
  t.diagnostic('MOCK ONLY: ' + JSON.stringify(totals));
});
