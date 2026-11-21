'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const combo = require('../combo');
const { candidateKey } = require('../candidates');
const { selectCandidateForProfile } = require('../orchestrate/candidate-select');

const REGISTRY = {
  dispatch: { nineRouterWriterCombo: 'vinh', comboSource: '9router' },
  sources: [
    {
      id: '9router',
      kind: 'router',
      servesModels: true,
      harness: 'paseo',
      endpoint: 'http://127.0.0.1:20128/v1',
      credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
    },
  ],
};

const PRIORS = {
  ranking: [
    {
      canonical: 'gpt-5.2',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 92 }],
    },
    {
      canonical: 'claude-4.5',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 86 }],
    },
    {
      canonical: 'grok-4.7',
      codingTier: 'T2',
      reviewTier: 'T2',
      benchmarks: [{ name: 'aaCodingIndex', score: 80 }],
    },
  ],
};

function makeLogOpts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-195-'));
  return { dir, now: Date.UTC(2026, 10, 21, 14, 0, 0), runId: 'test-195' };
}

test('TASK-AI-195 AC1: writer selection invokes JEV over combo members and appends member to pool', async () => {
  const env = { NINEROUTER_API_KEY: 'test-key' };
  const baseCombo = combo.comboCandidate({ registry: REGISTRY, env }).candidate;
  const pool = [baseCombo];
  const logOpts = makeLogOpts();

  const decision = await selectCandidateForProfile(
    { id: 'TASK-W1', complexity: 'high', risk: 'HIGH', allowedPaths: ['a.js'] },
    pool,
    [],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'ag/claude-4.5-medium'],
      jevAsk: async (question) => {
        assert.ok(Array.isArray(question.options));
        assert.ok(question.options.includes('M0'));
        assert.ok(question.options.includes('M1'));
        return {
          choice: 'M0',
          confidence: 0.9,
          reason: 'highest score and high effort for high-risk task',
        };
      },
    },
    logOpts,
    logOpts.now,
    {}
  );

  assert.ok(decision.chosen);
  assert.match(decision.reason, /^combo-jev:jev \(gh\/gpt-5\.2-high\)$/);
  assert.equal(decision.decisionRecorded.chosenCandidate.modelId, 'gh/gpt-5.2-high');
  assert.equal(decision.decisionRecorded.chosenCandidate.upstream, 'gh');
  assert.equal(
    pool.some((c) => candidateKey(c) === decision.chosen),
    true,
    'chosen member must be appended to candidate pool for downstream lookup'
  );
});

test('TASK-AI-195 AC2: reviewer selects independent combo member and honors strict refusal vs combo fallback', async () => {
  const env = { NINEROUTER_API_KEY: 'test-key' };
  const baseCombo = combo.comboCandidate({ registry: REGISTRY, env }).candidate;
  const pool = [baseCombo];
  const logOpts = makeLogOpts();

  // First select writer
  const writerDecision = await selectCandidateForProfile(
    { id: 'TASK-R1', complexity: 'standard', allowedPaths: ['a.js'] },
    pool,
    [],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'gh/claude-4.5-low', 'ag/claude-4.5-medium'],
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(writerDecision.decisionRecorded.chosenCandidate.modelId, 'gh/gpt-5.2-high');

  // Reviewer excludes both same-upstream (`gh/claude-4.5-low`) and writer -> picks `ag/claude-4.5-medium`
  const reviewerDecision = await selectCandidateForProfile(
    {
      id: 'TASK-R1-review',
      roleRequirement: { role: 'reviewer' },
      complexity: 'standard',
      writerCandidateKey: writerDecision.chosen,
    },
    pool,
    ['gh'],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'gh/claude-4.5-low', 'ag/claude-4.5-medium'],
    },
    logOpts,
    logOpts.now,
    {}
  );

  assert.ok(reviewerDecision.chosen);
  assert.notEqual(reviewerDecision.chosen, writerDecision.chosen);
  assert.equal(reviewerDecision.decisionRecorded.chosenCandidate.modelId, 'ag/claude-4.5-medium');
  assert.equal(reviewerDecision.decisionRecorded.chosenCandidate.upstream, 'ag');
  assert.equal(reviewerDecision.decisionRecorded.comboJev.independentApplied, true);

  // Strict refusal when no independent member exists
  const strictRefused = await selectCandidateForProfile(
    {
      id: 'TASK-R2-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: writerDecision.chosen,
    },
    [baseCombo],
    ['gh'],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'gh/claude-4.5-low'],
      strictIndependentComboReview: true,
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(strictRefused.chosen, null);
  assert.equal(strictRefused.reason, 'NO_INDEPENDENT_REVIEWER');

  // Non-strict falls back cleanly to configured combo `vinh`
  const nonStrictFallback = await selectCandidateForProfile(
    {
      id: 'TASK-R3-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: writerDecision.chosen,
    },
    [baseCombo],
    ['gh'],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'gh/claude-4.5-low'],
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(nonStrictFallback.chosen, candidateKey(baseCombo));
  assert.equal(nonStrictFallback.reason, 'combo-only routing');

  // Regression 1: strict reviewer with absent or unparseable writer identity must refuse
  for (const badWriter of [undefined, 'not-a-valid-candidate-key']) {
    const strictUnresolved = await selectCandidateForProfile(
      {
        id: 'TASK-R4-review',
        roleRequirement: { role: 'reviewer' },
        ...(badWriter ? { writerCandidateKey: badWriter } : {}),
      },
      [baseCombo],
      [],
      {},
      {
        registry: REGISTRY,
        env,
        priors: PRIORS,
        comboMembers: ['gh/gpt-5.2-high', 'ag/claude-4.5-medium'],
        strictIndependentComboReview: true,
      },
      logOpts,
      logOpts.now,
      {}
    );
    assert.equal(strictUnresolved.chosen, null);
    assert.equal(strictUnresolved.reason, 'NO_INDEPENDENT_REVIEWER');
  }

  // Regression 2: fallback after independence rejects all members must never pick a
  // previously appended same-family comboMember when the configured combo has failed
  const comboJev = require('../combo-jev-select');
  const staleSameFamily = comboJev.buildMemberCandidate(
    { modelId: 'ag/gpt-5.2-low', base: 'gpt-5.2', effort: 'low', score: 85, tier: 'T1' },
    { registry: REGISTRY, env }
  ).candidate;
  const failedComboFallback = await selectCandidateForProfile(
    {
      id: 'TASK-R5-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: writerDecision.chosen,
    },
    [baseCombo, writerDecision.decisionRecorded.chosenCandidate, staleSameFamily],
    ['gh'],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'ag/gpt-5.2-low'],
    },
    logOpts,
    logOpts.now,
    { failedKeys: new Set([candidateKey(baseCombo)]) }
  );
  assert.equal(failedComboFallback.chosen, null);
  assert.match(failedComboFallback.reason, /^NO_ELIGIBLE_CANDIDATE/);
});

test('TASK-AI-195 AC3: failed member is skipped on retry and falls back to remaining member or combo', async () => {
  const env = { NINEROUTER_API_KEY: 'test-key' };
  const baseCombo = combo.comboCandidate({ registry: REGISTRY, env }).candidate;
  const pool = [baseCombo];
  const logOpts = makeLogOpts();

  const attempt1 = await selectCandidateForProfile(
    { id: 'TASK-F1', complexity: 'standard' },
    pool,
    [],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'ag/claude-4.5-medium'],
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(attempt1.decisionRecorded.chosenCandidate.modelId, 'gh/gpt-5.2-high');

  // Attempt 2: first member failed -> picks second member
  const attempt2 = await selectCandidateForProfile(
    { id: 'TASK-F1', complexity: 'standard' },
    pool,
    [],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'ag/claude-4.5-medium'],
    },
    logOpts,
    logOpts.now,
    { failedKeys: new Set([attempt1.chosen]) }
  );
  assert.equal(attempt2.decisionRecorded.chosenCandidate.modelId, 'ag/claude-4.5-medium');

  // Attempt 3: both members failed -> falls back to configured combo `vinh`
  const attempt3 = await selectCandidateForProfile(
    { id: 'TASK-F1', complexity: 'standard' },
    pool,
    [],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'ag/claude-4.5-medium'],
    },
    logOpts,
    logOpts.now,
    { failedKeys: new Set([attempt1.chosen, attempt2.chosen]) }
  );
  assert.equal(attempt3.chosen, candidateKey(baseCombo));
  assert.equal(attempt3.reason, 'combo-only routing');
});
