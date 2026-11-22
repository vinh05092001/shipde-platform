'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const combo = require('../combo');
const { candidateKey } = require('../candidates');
const { selectCandidateForProfile } = require('../orchestrate/candidate-select');
const { reviewItem } = require('../orchestrate/review-item');

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

  // Live-shaped default (NO strictIndependentComboReview flag): concrete member writer
  // MUST refuse fail-closed when only same-upstream or same-family members exist.
  for (const nonIndependentMembers of [
    ['gh/gpt-5.2-high', 'gh/claude-4.5-low'],
    ['gh/gpt-5.2-high', 'ag/gpt-5.2-low'],
  ]) {
    const defaultRefused = await selectCandidateForProfile(
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
        comboMembers: nonIndependentMembers,
      },
      logOpts,
      logOpts.now,
      {}
    );
    assert.equal(defaultRefused.chosen, null);
    assert.equal(defaultRefused.reason, 'NO_INDEPENDENT_REVIEWER');
    assert.ok(
      Array.isArray(defaultRefused.result.rejected) && defaultRefused.result.rejected.length > 0,
      'refusal must populate rejected so review-item.js blocks o.reviewerIdentity override'
    );
  }

  // Live-shaped default: absent or unparseable writer identity must refuse fail-closed
  for (const badWriter of [undefined, 'not-a-valid-candidate-key']) {
    const unresolvedRefused = await selectCandidateForProfile(
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
      },
      logOpts,
      logOpts.now,
      {}
    );
    assert.equal(unresolvedRefused.chosen, null);
    assert.equal(unresolvedRefused.reason, 'NO_INDEPENDENT_REVIEWER');
    assert.ok(unresolvedRefused.result.rejected.length > 0);
  }

  // Opaque-combo writer (2026-11-19 "1 combo cho tất cả" contract) preserves combo fallback
  const opaqueFallback = await selectCandidateForProfile(
    {
      id: 'TASK-R3-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: candidateKey(baseCombo),
    },
    [baseCombo],
    ['9router'],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: [],
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(opaqueFallback.chosen, candidateKey(baseCombo));
  assert.equal(opaqueFallback.reason, 'combo-only routing');

  // Strict mode refuses even an opaque-combo writer
  const strictOpaqueRefused = await selectCandidateForProfile(
    {
      id: 'TASK-R3S-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: candidateKey(baseCombo),
    },
    [baseCombo],
    ['9router'],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: [],
      strictIndependentComboReview: true,
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(strictOpaqueRefused.chosen, null);
  assert.equal(strictOpaqueRefused.reason, 'NO_INDEPENDENT_REVIEWER');

  // Regression: opaque-combo fallback must never pick a previously cached comboMember
  // when the configured combo has failed
  const comboJev = require('../combo-jev-select');
  const staleSameFamily = comboJev.buildMemberCandidate(
    { modelId: 'ag/gpt-5.2-low', base: 'gpt-5.2', effort: 'low', score: 85, tier: 'T1' },
    { registry: REGISTRY, env }
  ).candidate;
  const failedComboFallback = await selectCandidateForProfile(
    {
      id: 'TASK-R5-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: candidateKey(baseCombo),
    },
    [baseCombo, writerDecision.decisionRecorded.chosenCandidate, staleSameFamily],
    ['9router'],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: [],
    },
    logOpts,
    logOpts.now,
    { failedKeys: new Set([candidateKey(baseCombo)]) }
  );
  assert.equal(failedComboFallback.chosen, null);
  assert.match(failedComboFallback.reason, /^NO_ELIGIBLE_CANDIDATE/);

  // Causal downstream proof: reviewItem refusal survives an explicit o.reviewerIdentity override
  let launchCount = 0;
  const reviewRes = await reviewItem(
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: ['gh/gpt-5.2-high', 'gh/claude-4.5-low'],
      reviewerIdentity: candidateKey(baseCombo),
      reviewBudget: 1,
      formatCheck: false,
      tests: async () => ({ pass: true, command: 'noop', detail: 'ok' }),
    },
    { id: 'TASK-R6', complexity: 'standard', allowedPaths: ['a.js'] },
    {
      candidateKey: writerDecision.chosen,
      headSha: 'a'.repeat(40),
      branch: 'feat/task-r6',
    },
    { goal: 'test', reviews: [], formatChecks: [], toolGates: [] },
    logOpts,
    async () => {
      launchCount += 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    logOpts.dir,
    logOpts.now,
    [baseCombo, writerDecision.decisionRecorded.chosenCandidate],
    {},
    REGISTRY,
    {}
  );
  assert.equal(launchCount, 0, 'downstream reviewer launcher must never be invoked on refusal');
  assert.notEqual(reviewRes.status, 'PASSED');
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
