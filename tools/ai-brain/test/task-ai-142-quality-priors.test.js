'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const routing = require('../routing');
const priors = require('../priors');
const cli = require('../cli');

const FIXTURE_NOW = Date.parse('2026-10-17T12:00:00.000Z');

function testAssessment() {
  return {
    jevOutcome: 'DECIDED',
    confidence: 'high',
    reasonCodes: ['TEST_OK'],
    weights: { quality: 50, latency: 25, cost: 25 },
  };
}

function testProfile() {
  return {
    taskId: 'TASK-AI-142',
    role: 'writer',
    complexity: 'standard',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    qualityFloor: 0,
    costCeiling: 100,
  };
}

test('VIỆC 1: Candidate with thinking suffix matches base model in priors table and extracts real quality, url, retrievedAt', () => {
  const rankingFixture = [
    {
      canonical: 'claude-opus-4-6',
      codingTier: 'T1',
      reviewTier: 'T1',
      score: 82,
      sources: [
        {
          id: 'aa-coding-index',
          url: 'https://benchlm.ai/benchmarks/aacodingindex',
          retrievedAt: '2026-10-13T00:00:00.000Z',
        },
      ],
      benchmarks: [
        {
          name: 'aaCodingIndex',
          score: 82,
          source: {
            url: 'https://benchlm.ai/benchmarks/aacodingindex',
            retrievedAt: '2026-10-13T00:00:00.000Z',
          },
        },
        {
          name: 'aaAgenticIndex',
          score: 82,
          source: {
            url: 'https://benchlm.ai/benchmarks/aaagenticindex',
            retrievedAt: '2026-10-13T00:00:00.000Z',
          },
        },
        {
          name: 'intelligenceIndex',
          score: 82,
          source: {
            url: 'https://artificialanalysis.ai/leaderboards/models',
            retrievedAt: '2026-10-13T00:00:00.000Z',
          },
        },
      ],
    },
    {
      canonical: 'top-reference-model',
      codingTier: 'T1',
      reviewTier: 'T1',
      score: 100,
      benchmarks: [
        { name: 'aaCodingIndex', score: 100 },
        { name: 'aaAgenticIndex', score: 100 },
        { name: 'intelligenceIndex', score: 100 },
      ],
    },
  ];

  const customPriors = {
    label: 'EXTERNAL_PRIOR',
    generatedAt: '2026-10-13T00:00:00.000Z',
    sources: [
      {
        id: 'aa-coding-index',
        url: 'https://benchlm.ai/benchmarks/aacodingindex',
        retrievedAt: '2026-10-13T00:00:00.000Z',
      },
    ],
    ranking: rankingFixture,
  };

  const candidateThinking = {
    harness: 'hermes',
    accessPath: 'openrouter',
    gateway: 'openrouter',
    upstream: 'anthropic',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: 'claude-opus-4-6-thinking',
    evidence: [],
  };

  const ranked = routing.rankForProfile([candidateThinking], testProfile(), testAssessment(), {
    priors: customPriors,
    now: FIXTURE_NOW,
    headrooms: { 'acc-1': 'open' },
  });

  assert.equal(ranked.ranking.length, 1);
  const c = ranked.ranking[0];
  assert.ok(c.scoreBreakdown, 'scoreBreakdown must exist');
  assert.equal(typeof c.scoreBreakdown.quality, 'number', 'quality must be a number from priors');
  assert.equal(c.scoreBreakdown.quality, 82, 'quality must match prior score');
  assert.equal(c.scoreBreakdown.url, 'https://benchlm.ai/benchmarks/aacodingindex');
  assert.equal(c.scoreBreakdown.retrievedAt, '2026-10-13T00:00:00.000Z');
  assert.equal(c.scoreBreakdown.qualitySource, 'aa-coding-index');
  assert.notEqual(c.score, 'chưa rõ');
});

test('VIỆC 1: Model normalization strips router prefixes (cl/, ninerouter/) and account prefixes (::)', () => {
  const rankingFixture = [
    {
      canonical: 'claude-opus-4-6',
      score: 82,
      sources: [
        {
          url: 'https://benchlm.ai/benchmarks/aacodingindex',
          retrievedAt: '2026-10-13T00:00:00.000Z',
        },
      ],
      benchmarks: [{ name: 'aaCodingIndex', score: 82 }],
    },
    {
      canonical: 'gemini-3-7-flash',
      score: 75,
      sources: [
        {
          url: 'https://benchlm.ai/models/gemini-3-7-flash',
          retrievedAt: '2026-10-13T00:00:00.000Z',
        },
      ],
      benchmarks: [{ name: 'aaCodingIndex', score: 75 }],
    },
  ];

  // 1. Router prefix with thinking suffix: cl/claude-opus-4-6-thinking
  const match1 = priors.matchModelPrior('cl/claude-opus-4-6-thinking', rankingFixture);
  assert.ok(match1, 'cl/claude-opus-4-6-thinking should match');
  assert.equal(match1.entry.canonical, 'claude-opus-4-6');

  // 2. ninerouter prefix: ninerouter/claude-opus-4-6
  const match2 = priors.matchModelPrior('ninerouter/claude-opus-4-6', rankingFixture);
  assert.ok(match2, 'ninerouter/claude-opus-4-6 should match');
  assert.equal(match2.entry.canonical, 'claude-opus-4-6');

  // 3. Account prefix with :: and effort suffix: agy01:gemini::gemini-3.7-flash-high
  const match3 = priors.matchModelPrior('agy01:gemini::gemini-3.7-flash-high', rankingFixture);
  assert.ok(match3, 'agy01:gemini::gemini-3.7-flash-high should match');
  assert.equal(match3.entry.canonical, 'gemini-3-7-flash');
});

test('VIỆC 1: Model not in priors table results in null quality and displays "chưa rõ"', () => {
  const customPriors = { ranking: [] };
  const candidateUnknown = {
    harness: 'hermes',
    accessPath: 'openrouter',
    gateway: 'openrouter',
    upstream: 'custom',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: 'completely-unknown-custom-model-2026',
    evidence: [],
  };

  const ranked = routing.rankForProfile([candidateUnknown], testProfile(), testAssessment(), {
    priors: customPriors,
    now: FIXTURE_NOW,
    headrooms: { 'acc-1': 'open' },
  });

  assert.equal(ranked.ranking[0].scoreBreakdown.quality, null);

  const dryRunLog = cli.buildDryRunLog({
    item: { workItemId: 'TASK-AI-142' },
    now: FIXTURE_NOW,
    annotated: [ranked.ranking[0]],
    candidatesApi: require('../candidates'),
    decision: {
      chosen: ranked.chosen,
      reason: ranked.reason,
      candidates: ranked.ranking.map((c) => ({
        offeringId: c.candidateKey,
        score: c.score,
        scoreBreakdown: c.scoreBreakdown,
        headroom: 'open',
      })),
      rejected: [],
    },
  });

  assert.equal(dryRunLog.candidates[0].score, 'chưa rõ');
  assert.equal(dryRunLog.ranking.ordered[0].score, 'chưa rõ');
});

test('VIỆC 1: Stale priors trigger staleness detection and decision log warning', () => {
  // Stale date: older than 30 days before FIXTURE_NOW
  const staleDate = new Date(FIXTURE_NOW - 45 * 24 * 60 * 60 * 1000).toISOString();
  const rankingFixture = [
    {
      canonical: 'claude-opus-4-6',
      codingTier: 'T1',
      reviewTier: 'T1',
      score: 80,
      sources: [
        {
          url: 'https://benchlm.ai/benchmarks/aacodingindex',
          retrievedAt: staleDate,
        },
      ],
      benchmarks: [{ name: 'aaCodingIndex', score: 80 }],
    },
  ];
  const customPriors = {
    generatedAt: staleDate,
    ranking: rankingFixture,
  };

  assert.equal(priors.arePriorsStale(customPriors, FIXTURE_NOW), true);

  const candidate = {
    harness: 'hermes',
    accessPath: 'openrouter',
    gateway: 'openrouter',
    upstream: 'anthropic',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: 'claude-opus-4-6',
    evidence: [],
  };

  const ranked = routing.rankForProfile([candidate], testProfile(), testAssessment(), {
    priors: customPriors,
    now: FIXTURE_NOW,
    headrooms: { 'acc-1': 'open' },
  });

  const c = ranked.ranking[0];
  assert.equal(c.scoreBreakdown.prior.stale, true, 'prior must be flagged stale');
  assert.equal(c.scoreBreakdown.stalePriorWarning, true, 'stale warning recorded on breakdown');
});
