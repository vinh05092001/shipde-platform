'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assessComboTask, selectComboMember, modelFamilyOf } = require('../combo-jev-select');
const { parseCandidateKey } = require('../discovery/identity');

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
  assert.equal(res.candidate.upstream, '9router');
  assert.equal(res.candidate.modelFamily, 'claude');
});

test('TASK-AI-194 AC2: reviewer selection enforces distinct upstream and model family truthfully', async () => {
  // Distinct upstream (`ag/` vs `gh/`) AND distinct model family -> independentApplied: true
  const res = await selectComboMember({
    item: { id: 'TASK-X', complexity: 'standard', allowedPaths: ['a.js'] },
    role: 'reviewer',
    writerModelId: 'gh/grok-4.7-high',
    members: ['gh/grok-4.7-high', 'gh/claude-4.5-medium', 'ag/claude-4.5-medium'],
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });

  assert.equal(res.ok, true);
  assert.equal(res.independentApplied, true);
  assert.equal(res.eligibleCount, 1);
  assert.equal(res.selected.modelId, 'ag/claude-4.5-medium');
  assert.notEqual(modelFamilyOf(res.selected.base), modelFamilyOf('grok-4.7'));
  assert.equal(res.candidate.upstream, 'ag');
  assert.equal(res.candidate.modelFamily, 'claude');

  // Fail-closed rejection: same upstream (`gh/`), different family -> refused
  const sameUpstream = await selectComboMember({
    item: { id: 'TASK-X', complexity: 'standard', allowedPaths: ['a.js'] },
    role: 'reviewer',
    writerModelId: 'gh/gpt-5.2-high',
    members: ['gh/gpt-5.2-high', 'gh/claude-4.5-low'],
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });
  assert.equal(sameUpstream.ok, false);
  assert.equal(sameUpstream.candidate, null);
  assert.equal(sameUpstream.selected, null);
  assert.equal(sameUpstream.eligibleCount, 0);
  assert.equal(sameUpstream.independentApplied, true);
  assert.equal(sameUpstream.handledBy, 'refused');
  assert.equal(sameUpstream.reason, 'NO_INDEPENDENT_REVIEWER');
  assert.equal(sameUpstream.error, 'NO_INDEPENDENT_REVIEWER');

  // Fail-closed rejection: different upstream (`ag/` vs `gh/`), same model family -> refused
  const sameFamily = await selectComboMember({
    item: { id: 'TASK-X', complexity: 'standard', allowedPaths: ['a.js'] },
    role: 'reviewer',
    writerModelId: 'gh/gpt-5.2-high',
    members: ['gh/gpt-5.2-high', 'ag/gpt-5.2-low'],
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });
  assert.equal(sameFamily.ok, false);
  assert.equal(sameFamily.candidate, null);
  assert.equal(sameFamily.handledBy, 'refused');
  assert.equal(sameFamily.reason, 'NO_INDEPENDENT_REVIEWER');

  // Fail-closed rejection: writer-only combo list -> refused
  const writerOnly = await selectComboMember({
    item: { id: 'TASK-X', complexity: 'standard', allowedPaths: ['a.js'] },
    role: 'reviewer',
    writerModelId: 'gh/gpt-5.2-high',
    members: ['gh/gpt-5.2-high'],
    priors: PRIORS,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });
  assert.equal(writerOnly.ok, false);
  assert.equal(writerOnly.candidate, null);
  assert.equal(writerOnly.handledBy, 'refused');
  assert.equal(writerOnly.reason, 'NO_INDEPENDENT_REVIEWER');
});

test('TASK-AI-194 P2 regressions: IPv6 endpoint candidateKey round-trip and blank-member fallback', async () => {
  // Finding 2: IPv6 endpoint round-trips through parseCandidateKey
  const ipv6Registry = {
    ...REGISTRY,
    sources: [
      {
        ...REGISTRY.sources[0],
        endpoint: 'http://[::1]:20128/v1',
      },
    ],
  };
  const ipv6Res = await selectComboMember({
    item: { id: 'TASK-IPV6', complexity: 'high' },
    members: ['ag/claude-4.5-high'],
    priors: PRIORS,
    registry: ipv6Registry,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });
  assert.equal(ipv6Res.ok, true);
  const parsed = parseCandidateKey(ipv6Res.candidate.candidateKey);
  assert.ok(parsed, 'IPv6 candidateKey must parse cleanly');
  assert.equal(parsed.modelId, 'ag/claude-4.5-high');
  assert.equal(parsed.upstream, 'ag');
  assert.equal(parsed.gateway, '9router');

  // Finding 3: whitespace-only members fall back cleanly to configured combo `vinh`
  const blankRes = await selectComboMember({
    item: { id: 'TASK-BLANK' },
    members: ['', ' '],
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'test-key' },
  });
  assert.equal(blankRes.ok, true);
  assert.equal(blankRes.handledBy, 'combo-fallback');
  assert.equal(blankRes.candidate.modelId, 'vinh');
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
