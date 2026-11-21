'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assessComboTask, selectComboMember, modelFamilyOf } = require('../combo-jev-select');

const REGISTRY = {
  sources: [
    {
      id: '9router',
      kind: 'router',
      endpoint: 'http://127.0.0.1:20128/v1',
      credential: { env: 'NINEROUTER_API_KEY' },
    },
  ],
  dispatch: {
    nineRouterWriterCombo: 'vinh',
    nineRouterWriterComboLimits: { contextWindow: 128000, maxOutputTokens: 8192 },
  },
};

const PRIORS = {
  ranking: [
    {
      canonical: 'grok-4.7',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 92 }],
    },
    {
      canonical: 'claude-4.5',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 90 }],
    },
    {
      canonical: 'gpt-5.2',
      codingTier: 'T2',
      reviewTier: 'T2',
      benchmarks: [{ name: 'aaCodingIndex', score: 85 }],
    },
  ],
};

const MEMBERS = ['9router/grok-4.7-high', '9router/claude-4.5-low', '9router/gpt-5.2-medium'];

test('TASK-AI-194 AC1: JEV receives opaque options with score & reasoning and picks combo member', async () => {
  let receivedQuestion = null;
  const res = await selectComboMember({
    item: { id: 'TASK-X', complexity: 'high', risk: 'HIGH', allowedPaths: ['a.js'] },
    role: 'writer',
    members: MEMBERS,
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
    jevAsk: async (q) => {
      receivedQuestion = q;
      return { choice: 'M1', confidence: 0.9, reason: 'strong match for task' };
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.handledBy, 'jev');
  assert.equal(res.assessment.complexity, 'high');
  assert.deepEqual(receivedQuestion.options, ['M0', 'M1', 'M2']);
  assert.doesNotMatch(receivedQuestion.evidence, /grok|claude|gpt|9router/i);
  assert.equal(res.selected.modelId, '9router/claude-4.5-low');
  assert.equal(res.candidate.modelId, '9router/claude-4.5-low');
  assert.equal(res.candidate.comboMember, true);
  assert.equal(res.candidate.upstream, 'claude');
});

test('TASK-AI-194 AC2: reviewer selection excludes writer model family for independent review', async () => {
  const res = await selectComboMember({
    item: { id: 'TASK-X', complexity: 'standard', allowedPaths: ['a.js'] },
    role: 'reviewer',
    writerModelId: '9router/grok-4.7-high',
    members: ['9router/grok-4.7-high', '9router/grok-4.7-low', '9router/claude-4.5-medium'],
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });

  assert.equal(res.ok, true);
  assert.equal(res.independentApplied, true);
  assert.equal(res.eligibleCount, 1);
  assert.equal(res.selected.modelId, '9router/claude-4.5-medium');
  assert.notEqual(modelFamilyOf(res.selected.base), modelFamilyOf('grok-4.7'));
  assert.equal(res.candidate.upstream, 'claude');
});

test('TASK-AI-194 AC3: deterministic complexity fallback when JEV is undecided and combo fallback when empty', async () => {
  // Low complexity prefers lower reasoning effort within score band (claude-4.5-low over grok-4.7-high)
  const lowRes = await selectComboMember({
    item: { id: 'TASK-LOW', complexity: 'low', risk: 'LOW', allowedPaths: ['a.js'] },
    role: 'writer',
    members: MEMBERS,
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
    jevAsk: async () => {
      throw new Error('JEV_TIMEOUT');
    },
  });
  assert.equal(lowRes.ok, true);
  assert.equal(lowRes.handledBy, 'fallback');
  assert.equal(lowRes.selected.modelId, '9router/claude-4.5-low');

  // High complexity prefers top score + high reasoning effort
  const highRes = await selectComboMember({
    item: { id: 'TASK-HIGH', complexity: 'high', risk: 'HIGH', allowedPaths: ['a.js'] },
    role: 'writer',
    members: MEMBERS,
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });
  assert.equal(highRes.ok, true);
  assert.equal(highRes.selected.modelId, '9router/grok-4.7-high');

  // Empty combo falls back cleanly to configured combo candidate `vinh`
  const emptyRes = await selectComboMember({
    item: { id: 'TASK-EMPTY' },
    members: [],
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });
  assert.equal(emptyRes.ok, true);
  assert.equal(emptyRes.handledBy, 'combo-fallback');
  assert.equal(emptyRes.candidate.modelId, 'vinh');

  assert.equal(assessComboTask({ risk: 'LOW', allowedPaths: ['a.js'] }).complexity, 'low');
});
