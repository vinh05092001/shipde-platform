'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../routing');
const priors = require('../priors');

const FIXTURE_NOW = Date.parse('2026-11-01T12:00:00.000Z');

/**
 * Build a priors fixture with a model at a specific quality score.
 * The prior score is normalized to 0-100 by priorFor, where 100 = top
 * and the score is relative.  We include a top-reference at 100 so the
 * fixture model's score is used directly.
 */
function buildPriors(entries) {
  return {
    generatedAt: new Date(FIXTURE_NOW).toISOString(),
    ranking: [
      {
        canonical: 'top-reference-model',
        codingTier: 'T1',
        reviewTier: 'T1',
        score: 100,
        benchmarks: [
          { name: 'aaCodingIndex', score: 100 },
          { name: 'aaAgenticIndex', score: 100 },
        ],
      },
      ...entries,
    ],
  };
}

function testAssessment(overrides) {
  return {
    jevOutcome: 'DECIDED',
    confidence: 'high',
    reasonCodes: ['TEST_OK'],
    weights: { quality: 50, latency: 25, cost: 25 },
    ...overrides,
  };
}

function testProfile(overrides) {
  return {
    taskId: 'TASK-AI-171',
    role: 'writer',
    complexity: 'standard',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    qualityFloor: 70,
    costCeiling: 999,
    ...overrides,
  };
}

function makeCandidate(modelCanonical, overrides) {
  return {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'test-gw',
    upstream: 'test-up',
    accountId: 'test-acc',
    quotaScope: 'test-acc',
    modelId: 'test-gw/' + modelCanonical,
    contextWindow: 128000,
    cost: 5,
    latency: 500,
    qualifiedRoles: ['author.foundation'],
    evidence: [],
    ...overrides,
  };
}

// --- Test (a): candidate with prior-derived quality 15, floor 70 -> rejected ---
test('TASK-AI-171 (a): candidate with prior-derived quality 15 is rejected by quality floor 70', () => {
  const lowQualityPriors = buildPriors([
    {
      canonical: 'low-quality-model',
      codingTier: 'T4',
      reviewTier: 'T4',
      score: 15,
      benchmarks: [
        { name: 'aaCodingIndex', score: 15 },
        { name: 'aaAgenticIndex', score: 15 },
      ],
    },
  ]);

  const candidate = makeCandidate('low-quality-model');
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();

  const result = routing.rankForProfile([candidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: lowQualityPriors,
    loadQuotaState: false,
    useStoredQuota: false,
  });

  // The candidate must be rejected, not chosen
  assert.equal(result.chosen, null, 'low-quality candidate must not be chosen');
  assert.ok(result.ranking.length === 0, 'low-quality candidate must not be in ranking');
  assert.ok(result.rejected.length > 0, 'low-quality candidate must be rejected');
  const rejection = result.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET');
  assert.ok(rejection, 'rejection reason must be QUALITY_FLOOR_NOT_MET');
});

// --- Test (b): unknown quality, floor 70 -> not admitted ---
test('TASK-AI-171 (b): candidate with unknown quality is not admitted when floor is 70', () => {
  // Priors that do NOT include the candidate model -> quality unknown
  const priorsWithoutCandidate = buildPriors([]);

  const candidate = makeCandidate('unknown-quality-model-xyz');
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();

  const result = routing.rankForProfile([candidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: priorsWithoutCandidate,
    loadQuotaState: false,
    useStoredQuota: false,
  });

  assert.equal(result.chosen, null, 'unknown-quality candidate must not be chosen');
  assert.ok(result.ranking.length === 0, 'unknown-quality candidate must not be in ranking');
  assert.ok(result.rejected.length > 0, 'unknown-quality candidate must be rejected');
  const rejection = result.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET');
  assert.ok(rejection, 'rejection reason must be QUALITY_FLOOR_NOT_MET');
});

// --- Test (c): quality 85 -> admitted and chosen over (a) ---
test('TASK-AI-171 (c): candidate with quality 85 is admitted and chosen over low-quality candidate', () => {
  const mixedPriors = buildPriors([
    {
      canonical: 'low-quality-model',
      codingTier: 'T4',
      reviewTier: 'T4',
      score: 15,
      benchmarks: [
        { name: 'aaCodingIndex', score: 15 },
        { name: 'aaAgenticIndex', score: 15 },
      ],
    },
    {
      canonical: 'high-quality-model',
      codingTier: 'T1',
      reviewTier: 'T1',
      score: 85,
      benchmarks: [
        { name: 'aaCodingIndex', score: 85 },
        { name: 'aaAgenticIndex', score: 85 },
      ],
    },
  ]);

  const lowCandidate = makeCandidate('low-quality-model', {
    upstream: 'up-low',
    accountId: 'acc-low',
    quotaScope: 'acc-low',
  });
  const highCandidate = makeCandidate('high-quality-model', {
    upstream: 'up-high',
    accountId: 'acc-high',
    quotaScope: 'acc-high',
  });
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();

  const result = routing.rankForProfile([lowCandidate, highCandidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: mixedPriors,
    loadQuotaState: false,
    useStoredQuota: false,
  });

  // high-quality candidate must be chosen
  assert.ok(result.chosen, 'a candidate must be chosen');
  assert.ok(
    result.chosen.includes('high-quality-model'),
    'chosen candidate must be the high-quality model, got: ' + result.chosen
  );

  // low-quality candidate must be rejected
  const lowRejection = result.rejected.find(
    (r) => r.candidateKey && r.candidateKey.includes('low-quality-model')
  );
  assert.ok(lowRejection, 'low-quality candidate must be rejected');
  assert.equal(lowRejection.reasonCode, 'QUALITY_FLOOR_NOT_MET');
});

// --- Test: resolveEffectiveQuality returns prior-derived quality ---
test('TASK-AI-171: resolveEffectiveQuality returns prior score when candidate has no internal quality', () => {
  const testPriors = buildPriors([
    {
      canonical: 'prior-model',
      codingTier: 'T2',
      reviewTier: 'T2',
      score: 42,
      benchmarks: [{ name: 'aaCodingIndex', score: 42 }],
    },
  ]);

  const candidate = makeCandidate('prior-model');
  const quality = routing.resolveEffectiveQuality(candidate, testAssessment(), {
    now: FIXTURE_NOW,
    role: 'writer',
    priors: testPriors,
  });

  assert.ok(Number.isFinite(quality), 'effective quality must be finite');
  // Prior score 42 relative to top 100 -> normalized score from priorFor
  // The exact value depends on priorFor normalization, but it must be a positive number
  assert.ok(quality > 0, 'effective quality must be positive, got: ' + quality);
});

// --- Test: qualityFloor 0 admits unknown quality ---
test('TASK-AI-171: qualityFloor 0 admits candidates with unknown quality', () => {
  const priorsEmpty = buildPriors([]);
  const candidate = makeCandidate('no-prior-model-abc');
  const profile = testProfile({ qualityFloor: 0 });
  const assessment = testAssessment();

  const result = routing.rankForProfile([candidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: priorsEmpty,
    loadQuotaState: false,
    useStoredQuota: false,
  });

  // With floor 0, unknown quality should still be admitted
  assert.ok(
    result.ranking.length > 0,
    'candidate with unknown quality should be admitted when floor is 0'
  );
});
