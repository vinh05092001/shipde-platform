'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jev = require('../jev');
const comboJev = require('../combo-jev-select');

const MOCK_SOURCE = {
  id: 'jev',
  kind: 'decision-service',
  endpoint: 'https://jev.local/v1/systemone',
  model: 'system-one',
  credential: { env: 'JEV_TEST_KEY' },
  mayWriteCode: false,
};

function mockHttpClient(responseBody) {
  const calls = [];
  const httpClient = (url, body, headers) => {
    calls.push({ url, body, headers });
    return Promise.resolve(responseBody);
  };
  return { calls, httpClient };
}

test('select-combo-member sends exact System One payload with comboMember key and factual per-option criteria', async () => {
  const assessment = comboJev.assessComboTask(
    {
      id: 'TASK-AI-194',
      title: 'SECRET_RAW_WORK_ITEM_TITLE_DO_NOT_LEAK',
      description: 'SECRET_RAW_BODY',
      role: 'writer',
      complexity: 'low',
      risk: 'LOW',
      allowedPaths: ['apps/web/a.ts', 'apps/web/b.ts'],
    },
    'writer'
  );
  const members = [
    {
      modelId: 'gh/claude-4.5-sonnet-high',
      base: 'claude-4.5-sonnet',
      score: 88,
      tier: 'T1',
      effort: 'high',
      priorUnknown: false,
    },
    {
      modelId: 'cx/gpt-5.2-codex-low',
      base: 'gpt-5.2-codex',
      score: 80,
      tier: 'T2',
      effort: 'low',
      priorUnknown: false,
    },
    {
      modelId: 'ag/gemini-3-flash',
      base: 'gemini-3-flash',
      score: null,
      tier: null,
      effort: null,
      priorUnknown: true,
    },
  ];
  const { question } = comboJev.buildJevComboQuestion(assessment, members);
  const { calls, httpClient } = mockHttpClient({
    model: 'system-one',
    answers: {
      comboMember: {
        type: 'choice',
        choice: 'M1',
        confidence: 0.91,
        probabilities: { M0: 0.06, M1: 0.91, M2: 0.03 },
      },
    },
  });
  const ask = jev.buildJevAsk(MOCK_SOURCE, {
    env: { JEV_TEST_KEY: 'sk-test-token' },
    httpClient,
  });

  const outcome = await jev.advise(question, { ask, minConfidence: 0.6 });

  assert.equal(outcome.outcome, jev.Outcome.DECIDED);
  assert.equal(outcome.choice, 'M1');
  assert.equal(calls.length, 1);

  const payload = calls[0].body;
  assert.deepEqual(Object.keys(payload).sort(), ['model', 'questions', 'state']);
  assert.equal(payload.model, 'system-one');
  assert.deepEqual(Object.keys(payload.questions), ['comboMember']);

  const q = payload.questions.comboMember;
  assert.deepEqual(Object.keys(q).sort(), ['criteria', 'instructions', 'type']);
  assert.equal(q.type, 'choice');
  assert.deepEqual(q.criteria, {
    M0: 'Option M0: tier T1, score 88, reasoning effort high, prior known.',
    M1: 'Option M1: tier T2, score 80, reasoning effort low, prior known.',
    M2: 'Option M2: tier unknown, score unknown, reasoning effort default, prior unknown.',
  });

  // Identity & raw Work Item leakage guard across entire serialized payload.
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    'SECRET_RAW_WORK_ITEM_TITLE_DO_NOT_LEAK',
    'SECRET_RAW_BODY',
    'apps/web/a.ts',
    'claude-4.5-sonnet',
    'gpt-5.2-codex',
    'gemini-3-flash',
    'gh/',
    'cx/',
    'ag/',
    'sk-test-token',
  ]) {
    assert.equal(serialized.includes(forbidden), false, 'must not leak ' + forbidden);
  }
});

test('select-combo-member fails closed when raw.answers.comboMember is missing or invalid', async () => {
  const { question } = comboJev.buildJevComboQuestion(
    {
      workItemId: 'TASK-AI-194',
      role: 'writer',
      complexity: 'standard',
      risk: 'MEDIUM',
      fileCount: 3,
    },
    [
      {
        modelId: 'gh/model-a',
        base: 'model-a',
        score: 85,
        tier: 'T1',
        effort: 'high',
        priorUnknown: false,
      },
      {
        modelId: 'cx/model-b',
        base: 'model-b',
        score: 78,
        tier: 'T2',
        effort: 'low',
        priorUnknown: false,
      },
    ]
  );

  for (const badResponse of [
    { model: 'system-one', answers: {} },
    {
      model: 'system-one',
      answers: { weightProfile: { type: 'choice', choice: 'M0', confidence: 0.95 } },
    },
    {
      model: 'system-one',
      answers: { weightProfile: { type: 'choice', choice: 'M0', confidence: 0.95 } },
      choice: 'M0',
      confidence: 0.95,
    },
    {
      model: 'system-one',
      answers: { weightProfile: { type: 'choice', choice: 'M0', confidence: 0.95 } },
      answer: { choice: 'M0', confidence: 0.95 },
    },
    {
      model: 'system-one',
      answers: { comboMember: { type: 'score', score: 9 } },
      choice: 'M0',
      confidence: 0.95,
      decision: { choice: 'M0', confidence: 0.95 },
    },
    {
      model: 'system-one',
      answers: { comboMember: { type: 'choice', choice: 'M99', confidence: 0.95 } },
    },
    { model: 'system-one', answers: { comboMember: { type: 'score', score: 9 } } },
  ]) {
    const { httpClient } = mockHttpClient(badResponse);
    const ask = jev.buildJevAsk(MOCK_SOURCE, {
      env: { JEV_TEST_KEY: 'sk-test-token' },
      httpClient,
    });
    const outcome = await jev.advise(question, { ask, minConfidence: 0.6 });
    assert.equal(outcome.outcome, jev.Outcome.UNDECIDED);
  }
});

test('select-combo-member prefers valid named answer over conflicting top-level fields and preserves flat shape when no answers map exists', async () => {
  const { question } = comboJev.buildJevComboQuestion(
    {
      workItemId: 'TASK-AI-194',
      role: 'writer',
      complexity: 'standard',
      risk: 'MEDIUM',
      fileCount: 3,
    },
    [
      {
        modelId: 'gh/model-a',
        base: 'model-a',
        score: 85,
        tier: 'T1',
        effort: 'high',
        priorUnknown: false,
      },
      {
        modelId: 'cx/model-b',
        base: 'model-b',
        score: 78,
        tier: 'T2',
        effort: 'low',
        priorUnknown: false,
      },
    ]
  );

  // Valid named answers.comboMember must win over conflicting flat/wrapper fields.
  {
    const { httpClient } = mockHttpClient({
      model: 'system-one',
      choice: 'M0',
      confidence: 0.99,
      answer: { choice: 'M0', confidence: 0.99 },
      answers: {
        comboMember: { type: 'choice', choice: 'M1', confidence: 0.89 },
      },
    });
    const ask = jev.buildJevAsk(MOCK_SOURCE, {
      env: { JEV_TEST_KEY: 'sk-test-token' },
      httpClient,
    });
    const outcome = await jev.advise(question, { ask, minConfidence: 0.6 });
    assert.equal(outcome.outcome, jev.Outcome.DECIDED);
    assert.equal(outcome.choice, 'M1');
  }

  // Flat transport shape without an answers map remains supported.
  {
    const { httpClient } = mockHttpClient({ choice: 'M1', confidence: 0.85 });
    const ask = jev.buildJevAsk(MOCK_SOURCE, {
      env: { JEV_TEST_KEY: 'sk-test-token' },
      httpClient,
    });
    const outcome = await jev.advise(question, { ask, minConfidence: 0.6 });
    assert.equal(outcome.outcome, jev.Outcome.DECIDED);
    assert.equal(outcome.choice, 'M1');
  }
});

test('buildJevAsk preserves explicit question.key, filters criteria to valid options, and keeps default fallback', async () => {
  const { calls, httpClient } = mockHttpClient({
    model: 'system-one',
    answers: {
      customSlot: { type: 'choice', choice: 'A', confidence: 0.88 },
    },
  });
  const ask = jev.buildJevAsk(MOCK_SOURCE, {
    env: { JEV_TEST_KEY: 'sk-test-token' },
    httpClient,
  });

  const outcome = await jev.advise(
    {
      key: 'customSlot',
      kind: 'select-combo-member',
      prompt: 'Pick one option.',
      evidence: '{"task":"demo"}',
      options: ['A', 'B', 'C'],
      criteria: {
        A: '  Custom criterion for A.  ',
        B: '   ',
        C: 123,
        EXTRA_UNKNOWN: 'Must be ignored because it is not in options.',
      },
    },
    { ask, minConfidence: 0.6 }
  );

  assert.equal(outcome.outcome, jev.Outcome.DECIDED);
  assert.equal(outcome.choice, 'A');
  assert.deepEqual(Object.keys(calls[0].body.questions), ['customSlot']);
  assert.deepEqual(calls[0].body.questions.customSlot.criteria, {
    A: 'Custom criterion for A.',
    B: 'Choose B when it best fits the supplied state.',
    C: 'Choose C when it best fits the supplied state.',
  });
});

test('buildJevAsk keeps backward-compatible default criteria and questionKey for legacy callers without criteria', async () => {
  const { calls, httpClient } = mockHttpClient({
    model: 'system-one',
    answers: {
      eligibleModel: { type: 'choice', choice: 'M0', confidence: 0.9 },
    },
  });
  const ask = jev.buildJevAsk(MOCK_SOURCE, {
    env: { JEV_TEST_KEY: 'sk-test-token' },
    httpClient,
  });

  const outcome = await jev.advise(
    {
      kind: 'select-eligible-model',
      prompt: 'Pick eligible model.',
      evidence: '{"eligible":["M0","M1"]}',
      options: ['M0', 'M1'],
    },
    { ask, minConfidence: 0.6 }
  );

  assert.equal(outcome.outcome, jev.Outcome.DECIDED);
  assert.deepEqual(Object.keys(calls[0].body.questions), ['eligibleModel']);
  assert.deepEqual(calls[0].body.questions.eligibleModel.criteria, {
    M0: 'Choose M0 when it best fits the supplied state.',
    M1: 'Choose M1 when it best fits the supplied state.',
  });
});
