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

// --- Test (b): unknown quality admitted, ranked after known candidate, reason says unknown ---
test('TASK-AI-171 (b): candidate with unknown quality is admitted, ranked after known candidate, reason says unknown', () => {
  const mixedPriors = buildPriors([
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

  const highCandidate = makeCandidate('high-quality-model', {
    upstream: 'up-high',
    accountId: 'acc-high',
    quotaScope: 'acc-high',
  });
  const unknownCandidate = makeCandidate('unknown-quality-model-xyz', {
    upstream: 'up-unknown',
    accountId: 'acc-unknown',
    quotaScope: 'acc-unknown',
  });
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();

  // 1. When ranked alongside a known candidate: unknown is admitted and ranked after known
  const result = routing.rankForProfile([unknownCandidate, highCandidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: mixedPriors,
    loadQuotaState: false,
    useStoredQuota: false,
  });

  assert.ok(result.chosen, 'a candidate must be chosen');
  assert.ok(
    result.chosen.includes('high-quality-model'),
    'known candidate must be chosen over unknown'
  );
  assert.equal(result.ranking.length, 2, 'both candidates must be admitted in ranking');
  assert.ok(
    result.ranking[0].candidateKey.includes('high-quality-model'),
    'known candidate must rank first'
  );
  assert.ok(
    result.ranking[1].candidateKey.includes('unknown-quality-model-xyz'),
    'unknown-quality candidate must rank after known candidate'
  );
  assert.equal(
    result.ranking[1].qualityLabel,
    'QUALITY_UNKNOWN',
    'unknown candidate must keep QUALITY_UNKNOWN label'
  );
  assert.equal(
    result.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'),
    undefined,
    'unknown-quality candidate must not be rejected by quality floor'
  );

  // 2. When unknown candidate is evaluated alone: admitted and chosen, reason says unknown
  const soloResult = routing.rankForProfile([unknownCandidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: buildPriors([]),
    loadQuotaState: false,
    useStoredQuota: false,
  });

  assert.ok(soloResult.chosen, 'unknown candidate must be admitted and chosen when alone');
  assert.ok(
    soloResult.chosen.includes('unknown-quality-model-xyz'),
    'chosen candidate must be unknown candidate'
  );
  assert.match(
    soloResult.reason,
    /score chưa rõ/,
    'decision reason must say unknown score (score chưa rõ)'
  );
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

// --- Test: resolveFloorQuality uses a valid external prior as floor evidence ---
test('TASK-AI-171: resolveFloorQuality uses a valid external prior as floor evidence when candidate has no internal quality', () => {
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
  assert.equal(candidate.quality, undefined);
  const expected = priors.priorFor(candidate, 'writer', testPriors, FIXTURE_NOW);
  assert.ok(Number.isFinite(expected.score) && expected.score > 0, 'fixture prior must be valid');

  const floor = routing.resolveFloorQuality(candidate, testAssessment(), {
    now: FIXTURE_NOW,
    role: 'writer',
    priors: testPriors,
  });
  assert.equal(floor.known, true, 'valid external prior is floor evidence');
  assert.equal(floor.value, expected.score, 'floor value is the priorFor score');
  assert.equal(floor.units, 'points');

  // Admission reads the same resolver: prior below floor rejects, at/above floor admits.
  const below = routing.rankForProfile(
    [candidate],
    testProfile({ qualityFloor: expected.score + 1 }),
    testAssessment(),
    { now: FIXTURE_NOW, priors: testPriors, loadQuotaState: false, useStoredQuota: false }
  );
  assert.equal(below.ranking.length, 0);
  assert.ok(below.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'));

  const meets = routing.rankForProfile(
    [candidate],
    testProfile({ qualityFloor: expected.score }),
    testAssessment(),
    { now: FIXTURE_NOW, priors: testPriors, loadQuotaState: false, useStoredQuota: false }
  );
  assert.equal(meets.ranking.length, 1, 'prior meeting the floor is admitted');
  assert.equal(
    meets.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'),
    undefined
  );
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

// --- QF-PROOF-VS-QUALITY Tests ---

test('TASK-AI-171 QF (legacy): candidate with prior 15 and passed API evidence is still REJECTED under floor 70', () => {
  const lowPriors = buildPriors([
    {
      canonical: 'low-model',
      codingTier: 'T4',
      reviewTier: 'T4',
      score: 15,
      benchmarks: [{ name: 'aaCodingIndex', score: 15 }],
    },
  ]);
  const candidate = makeCandidate('low-model', {
    evidence: [{ status: 'passed', proofLevel: 'API_PASS' }],
  });
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();

  const result = routing.rankForProfile([candidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: lowPriors,
    loadQuotaState: false,
    useStoredQuota: false,
  });

  assert.equal(result.chosen, null);
  assert.equal(result.ranking.length, 0);
  const rej = result.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET');
  assert.ok(rej, 'candidate must be rejected with QUALITY_FLOOR_NOT_MET');
});

test('TASK-AI-171 QF (legacy): proof-only evidence is not floor evidence (floor UNKNOWN, admitted under floor 70); ranking follows the #414 evidence contract and orders after known candidate', () => {
  const priors = buildPriors([
    {
      canonical: 'known-quality-model',
      codingTier: 'T1',
      reviewTier: 'T1',
      score: 85,
      benchmarks: [
        { name: 'aaCodingIndex', score: 85 },
        { name: 'aaAgenticIndex', score: 85 },
      ],
    },
  ]);
  const knownCandidate = makeCandidate('known-quality-model', {
    upstream: 'up-known',
    accountId: 'acc-known',
    quotaScope: 'acc-known',
    quality: 85,
  });
  const proofOnlyCandidate = makeCandidate('proof-only-model', {
    upstream: 'up-proof',
    accountId: 'acc-proof',
    quotaScope: 'acc-proof',
    evidence: [{ status: 'passed', proofLevel: 'API_PASS' }],
  });
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();

  // Floor resolver: proof of execution is not quality evidence -> UNKNOWN, never 0.
  const floor = routing.resolveFloorQuality(proofOnlyCandidate, assessment, {
    now: FIXTURE_NOW,
    role: profile.role,
    priors,
  });
  assert.equal(floor.known, false, 'proof-only evidence is not floor evidence');
  assert.equal(floor.value, null, 'unknown floor quality is never coerced to 0');

  const result = routing.rankForProfile([proofOnlyCandidate, knownCandidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors,
    loadQuotaState: false,
    useStoredQuota: false,
  });

  assert.equal(result.ranking.length, 2, 'both candidates must be admitted');
  assert.ok(
    result.ranking[0].candidateKey.includes('known-quality-model'),
    'known candidate ranks first'
  );
  assert.ok(
    result.ranking[1].candidateKey.includes('proof-only-model'),
    'proof-only ranks after known'
  );
  // Ranking/labels behave as on main (#414, task-ai-142-quality-unknown): passed
  // evidence yields a finite ranking quality, so the label is not QUALITY_UNKNOWN.
  assert.ok(Number.isFinite(result.ranking[1].scoreBreakdown.quality));
  assert.notEqual(result.ranking[1].qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(
    result.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'),
    undefined
  );

  // Alone: admitted by the floor and chosen
  const solo = routing.rankForProfile([proofOnlyCandidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: buildPriors([]),
    loadQuotaState: false,
    useStoredQuota: false,
  });
  assert.ok(solo.chosen, 'proof-only candidate must be chosen when alone');
  assert.ok(solo.chosen.includes('proof-only-model'));
  assert.equal(
    solo.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'),
    undefined
  );
});

// --- Floor source 2: validated scoreMeasurements breakdown.quality (0-1) x100 ---
test('TASK-AI-171 QF (legacy): candidate with valid quality 85 is eligible under floor 70', () => {
  const candidate = makeCandidate('valid-85-model', {
    quality: 85,
    evidence: [{ status: 'passed', proofLevel: 'API_PASS' }],
  });
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();

  const result = routing.rankForProfile([candidate], profile, assessment, {
    now: FIXTURE_NOW,
    priors: buildPriors([]),
    loadQuotaState: false,
    useStoredQuota: false,
  });

  assert.ok(result.chosen);
  assert.equal(result.ranking.length, 1);
  assert.equal(result.ranking[0].scoreBreakdown.quality, 85);
});

// --- Whitespace-only explicit quality tests (TASK-AI-171) ---

test("TASK-AI-171: whitespace-only quality ' ' with no measurement/prior yields UNKNOWN and is admitted", () => {
  const candidate = makeCandidate('whitespace-unknown-model', { quality: ' ' });
  const profile = testProfile({ qualityFloor: 70 });
  const assessment = testAssessment();
  const ctx = {
    now: FIXTURE_NOW,
    priors: buildPriors([]),
    loadQuotaState: false,
    useStoredQuota: false,
    role: profile.role,
  };

  const floor = routing.resolveFloorQuality(candidate, assessment, ctx);
  assert.equal(floor.known, false, 'whitespace-only quality must yield UNKNOWN floor quality');
  assert.equal(floor.value, null, 'unknown floor quality must be null');
  assert.equal(floor.source, 'unknown', 'unknown floor quality source must be unknown');

  const result = routing.rankForProfile([candidate], profile, assessment, ctx);
  assert.equal(result.ranking.length, 1, 'candidate with unknown quality must be admitted');
  assert.equal(
    result.rejected.find((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'),
    undefined,
    'candidate with unknown quality must not be rejected by quality floor'
  );
  assert.ok(result.chosen, 'candidate must be chosen');
  assert.ok(result.chosen.includes('whitespace-unknown-model'));
});
