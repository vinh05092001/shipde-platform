'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const priors = require('../priors');
const routing = require('../routing');
const ranking = require('../ranking');
const cli = require('../cli');
const { buildTaskProfile } = require('../orchestrate');

test('TASK-AI-142 T5: priorFor assigns QUALITY_UNKNOWN to models not in priors table or missing benchmark scores', () => {
  const rankingFixture = [
    {
      canonical: 'scored-model',
      codingTier: 'T1',
      reviewTier: 'T1',
      score: 85,
      benchmarks: { aaCodingIndex: 85, aaAgenticIndex: 85, intelligenceIndex: 85 },
    },
    {
      canonical: 'unscored-model-in-table',
      codingTier: 'T4',
      reviewTier: 'T4',
      score: null,
      benchmarks: {},
    },
  ];
  const customPriors = {
    generatedAt: new Date().toISOString(),
    ranking: rankingFixture,
  };

  // 1. Model completely absent from priors table
  const candAbsent = { modelId: 'provider/completely-absent-model-xyz' };
  const priorAbsent = priors.priorFor(candAbsent, 'writer', customPriors);
  assert.ok(priorAbsent, 'prior must be returned');
  assert.equal(priorAbsent.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(priorAbsent.score, null);
  assert.equal(priorAbsent.priorUnknown, true);

  // 2. Model in table but with null score / no benchmark coverage
  const candUnscored = { modelId: 'provider/unscored-model-in-table' };
  const priorUnscored = priors.priorFor(candUnscored, 'writer', customPriors);
  assert.ok(priorUnscored, 'prior must be returned');
  assert.equal(priorUnscored.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(priorUnscored.score, null);
  assert.equal(priorUnscored.priorUnknown, true);

  // 3. Scored model has real score and no QUALITY_UNKNOWN label
  const candScored = { modelId: 'provider/scored-model' };
  const priorScored = priors.priorFor(candScored, 'writer', customPriors);
  assert.ok(priorScored, 'prior must be returned');
  assert.equal(priorScored.score, 100);
  assert.notEqual(priorScored.qualityLabel, 'QUALITY_UNKNOWN');
});

test('TASK-AI-142 T5: unscored model is assigned QUALITY_UNKNOWN and ordered after scored models, before rejected', () => {
  const customPriors = {
    generatedAt: new Date().toISOString(),
    ranking: [
      {
        canonical: 'scored-model',
        codingTier: 'T2',
        reviewTier: 'T2',
        score: 60,
        benchmarks: { aaCodingIndex: 60 },
      },
    ],
  };

  const candidateScored = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-1',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: 'gw/scored-model',
    contextWindow: 64000,
    cost: 5,
    latency: 500,
    qualifiedRoles: ['author.foundation'],
    evidence: [],
  };
  candidateScored.candidateKey = routing.candidateKey(candidateScored);

  // Unscored model with faster latency and lower cost
  const candidateUnscored = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-2',
    accountId: 'acc-2',
    quotaScope: 'acc-2',
    modelId: 'gw/unscored-model-abc',
    contextWindow: 64000,
    cost: 1,
    latency: 100,
    qualifiedRoles: ['author.foundation'],
    evidence: [],
  };
  candidateUnscored.candidateKey = routing.candidateKey(candidateUnscored);

  // Ineligible / rejected candidate (missing capability / context window too small)
  const candidateRejected = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-3',
    accountId: 'acc-3',
    quotaScope: 'acc-3',
    modelId: 'gw/rejected-model',
    contextWindow: 1000, // below floor 32000
    cost: 1,
    latency: 50,
    qualifiedRoles: ['author.foundation'],
    evidence: [],
  };
  candidateRejected.candidateKey = routing.candidateKey(candidateRejected);

  const profile = {
    taskId: 'TASK-T5-1',
    role: 'writer',
    complexity: 'standard',
    requiredCapabilities: [],
    contextSize: 32000,
    proofFloor: 'NONE',
    qualityFloor: 0,
    costCeiling: 100,
  };

  const assessment = {
    weightProfile: 'BALANCED',
    weights: { quality: 50, latency: 25, cost: 25 },
  };

  const result = routing.rankForProfile(
    [candidateRejected, candidateUnscored, candidateScored],
    profile,
    assessment,
    {
      priors: customPriors,
      headrooms: { default: 'open' },
    }
  );

  // Candidate unscored must have QUALITY_UNKNOWN label and not defaulted to 0 or average 50
  assert.equal(result.ranking.length, 2, '2 eligible candidates ranked');
  const rankedScored = result.ranking.find((c) => c.candidateKey === candidateScored.candidateKey);
  const rankedUnscored = result.ranking.find(
    (c) => c.candidateKey === candidateUnscored.candidateKey
  );
  assert.ok(rankedScored, 'scored candidate is in ranking');
  assert.ok(rankedUnscored, 'unscored candidate is in ranking');

  assert.equal(rankedUnscored.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(rankedUnscored.scoreBreakdown.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(
    rankedUnscored.scoreBreakdown.quality,
    null,
    'quality score must remain null, not defaulted to 0 or 50'
  );

  // Order: scored (#1) -> unscored (#2) -> rejected
  assert.equal(
    result.ranking[0].candidateKey,
    candidateScored.candidateKey,
    'scored model must rank before unscored model'
  );
  assert.equal(
    result.ranking[1].candidateKey,
    candidateUnscored.candidateKey,
    'unscored model ranks after scored model'
  );
  assert.ok(
    result.rejected.some((r) => r.candidateKey === candidateRejected.candidateKey),
    'rejected model is in rejected list'
  );
});

test('TASK-AI-142 T5: dispatch --dry-run prints QUALITY_UNKNOWN for unscored models', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dryrun-t5-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const now = Date.now();
  const candidateUnscored = {
    harness: 'opencode',
    accessPath: 'https://fixture.example/v1',
    gateway: 'gw',
    upstream: 'up',
    accountId: 'acc-unscored',
    quotaScope: 'acc-unscored',
    modelId: 'gw/brand-new-unscored-model',
    capabilities: { contextWindow: 64000 },
    contextWindow: 64000,
    qualifiedRoles: ['author.foundation'],
    cost: 1,
    evidence: [],
  };
  candidateUnscored.candidateKey = routing.candidateKey(candidateUnscored);

  const customPriors = {
    generatedAt: new Date(now).toISOString(),
    ranking: [], // completely empty priors table
  };

  const item = { workItemId: 'TASK-AI-142', role: 'author.foundation', qualityFloor: 0 };
  const logs = [];

  const actual = await cli.dispatchCommand(
    { 'dry-run': true, root },
    {
      candidates: [candidateUnscored],
      items: [item],
      accounts: [],
      registry: { sources: [] },
      now,
      priors: customPriors,
      headrooms: { default: 'open' },
      evidenceDir: path.join(root, 'evidence'),
      decisionDir: path.join(root, 'decisions'),
      log: (msg) => logs.push(msg),
      exit: () => {},
    }
  );

  assert.equal(actual.exitCode, 0);

  // Check that the terminal log output for dry-run printed QUALITY_UNKNOWN
  const rankedLine = logs.find((line) => line.includes(candidateUnscored.candidateKey));
  assert.ok(rankedLine, 'ranked candidate line must be logged: ' + logs.join('\n'));
  assert.match(
    rankedLine,
    /QUALITY_UNKNOWN/,
    'printed line must include QUALITY_UNKNOWN label: ' + rankedLine
  );

  // Check decision log structure
  assert.equal(actual.decision.candidates[0].qualityLabel, 'QUALITY_UNKNOWN');
});

test('TASK-AI-142 regression: null benchmark prior does not set QUALITY_UNKNOWN when internal quality is finite', () => {
  const sources = require('../sources.json');
  const modelPrefix = sources.dispatch.providers.oc.modelPrefix;
  const modelWithEvidence = `${modelPrefix}test-with-evidence`;
  const modelBenchmarkOnly = `${modelPrefix}test-benchmark-only`;

  const customPriors = {
    generatedAt: new Date().toISOString(),
    ranking: [
      {
        canonical: 'test-with-evidence',
        score: null,
        qualityLabel: 'QUALITY_UNKNOWN',
        benchmarks: {},
      },
      {
        canonical: 'test-benchmark-only',
        score: Math.round(sources.dispatch.maxWriterSelectionRounds * 5),
        benchmarks: { aaCodingIndex: Math.round(sources.dispatch.maxWriterSelectionRounds * 5) },
      },
    ],
  };

  const candidateWithEvidence = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-1',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: modelWithEvidence,
    contextWindow: 64000,
    cost: 5,
    latency: 500,
    qualifiedRoles: ['author.foundation'],
    evidence: [{ status: 'passed', proofLevel: 'HARNESS_PASS', ts: new Date().toISOString() }],
  };
  candidateWithEvidence.candidateKey = routing.candidateKey(candidateWithEvidence);

  const candidateBenchmarkOnly = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-2',
    accountId: 'acc-2',
    quotaScope: 'acc-2',
    modelId: modelBenchmarkOnly,
    contextWindow: 64000,
    cost: 5,
    latency: 500,
    qualifiedRoles: ['author.foundation'],
    evidence: [],
  };
  candidateBenchmarkOnly.candidateKey = routing.candidateKey(candidateBenchmarkOnly);

  const profile = {
    taskId: 'TASK-T5-REG1',
    role: 'author.foundation',
    complexity: 'standard',
    requiredCapabilities: [],
    contextSize: 32000,
    proofFloor: 'NONE',
    qualityFloor: 0,
    costCeiling: 100,
  };

  const assessment = {
    weightProfile: 'BALANCED',
    weights: { quality: 50, latency: 25, cost: 25 },
  };

  const scoreResult = routing.scoreForProfile(candidateWithEvidence, assessment, {
    priors: customPriors,
  });
  assert.equal(scoreResult.breakdown.quality, 80);
  assert.notEqual(scoreResult.breakdown.qualityLabel, 'QUALITY_UNKNOWN');

  const result = routing.rankForProfile(
    [candidateBenchmarkOnly, candidateWithEvidence],
    profile,
    assessment,
    {
      priors: customPriors,
      headrooms: { default: 'open' },
    }
  );

  const rankedCandidate = result.ranking.find(
    (c) => c.candidateKey === candidateWithEvidence.candidateKey
  );
  assert.ok(rankedCandidate);
  assert.notEqual(rankedCandidate.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(
    result.ranking[0].candidateKey,
    candidateWithEvidence.candidateKey,
    'candidate with internal quality score ranks ahead of lower benchmark-only model'
  );
});

test('TASK-AI-142 regression: scoring does not mutate candidate qualityLabel and ranking derives label afresh', () => {
  const sources = require('../sources.json');
  const modelPrefix = sources.dispatch.providers.oc.modelPrefix;
  const modelId = `${modelPrefix}test-unscored-then-scored`;

  const customPriors = {
    generatedAt: new Date().toISOString(),
    ranking: [],
  };

  const candidate = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-fresh',
    accountId: 'acc-fresh',
    quotaScope: 'acc-fresh',
    modelId,
    contextWindow: 64000,
    cost: 5,
    latency: 500,
    qualifiedRoles: ['author.foundation'],
    evidence: [],
  };
  candidate.candidateKey = routing.candidateKey(candidate);

  const profile = {
    taskId: 'TASK-T5-REG2',
    role: 'author.foundation',
    complexity: 'standard',
    requiredCapabilities: [],
    contextSize: 32000,
    proofFloor: 'NONE',
    qualityFloor: 0,
    costCeiling: 100,
  };

  const assessment = {
    weightProfile: 'BALANCED',
    weights: { quality: 50, latency: 25, cost: 25 },
  };

  // Step 1: Score initially when unscored
  const scoreInitial = routing.scoreForProfile(candidate, assessment, { priors: customPriors });
  assert.equal(scoreInitial.breakdown.qualityLabel, 'QUALITY_UNKNOWN');
  // Candidate input object must not be mutated
  assert.equal(
    candidate.qualityLabel,
    undefined,
    'scoring must not mutate input candidate qualityLabel'
  );

  // Step 2: Simulate candidate having stale qualityLabel or ranked previously
  candidate.qualityLabel = 'QUALITY_UNKNOWN';
  candidate.evidence = [
    { status: 'passed', proofLevel: 'HARNESS_PASS', ts: new Date().toISOString() },
  ];

  // Step 3: Rank candidate again now that evidence exists
  const result = routing.rankForProfile([candidate], profile, assessment, {
    priors: customPriors,
    headrooms: { default: 'open' },
  });

  assert.equal(result.ranking.length, 1);
  const ranked = result.ranking[0];
  assert.equal(ranked.scoreBreakdown.quality, 80);
  assert.notEqual(
    ranked.qualityLabel,
    'QUALITY_UNKNOWN',
    'ranking must derive label afresh from quality evidence instead of trusting stale candidate.qualityLabel'
  );
  assert.notEqual(ranked.scoreBreakdown.qualityLabel, 'QUALITY_UNKNOWN');
});

test('TASK-AI-142 regression: rankAndRecord clears QUALITY_UNKNOWN when candidate gains finite quality and orders correctly', () => {
  const sources = require('../sources.json');
  const candidatesApi = require('../candidates');
  const modelPrefix = sources.dispatch.providers.oc.modelPrefix;
  const modelA = `${modelPrefix}cand-unscored-then-scored`;
  const modelB = `${modelPrefix}cand-already-scored`;

  const candA = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-a',
    accountId: 'acc-a',
    quotaScope: 'acc-a',
    modelId: modelA,
    status: 'passed',
    qualifiedRoles: ['author.foundation'],
    evidence: [{ status: 'passed', level: 3 }],
    quality: undefined,
  };

  const candB = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: 'up-b',
    accountId: 'acc-b',
    quotaScope: 'acc-b',
    modelId: modelB,
    status: 'passed',
    qualifiedRoles: ['author.foundation'],
    evidence: [{ status: 'passed', level: 1 }],
    quality: Math.round(sources.dispatch.maxWriterSelectionRounds * 5),
  };

  // Step 1: Initial ranking pass when candA has undefined quality
  const decision1 = ranking.rankAndRecord([candA, candB], {
    workItemId: 'TASK-P1-REGRESSION',
    role: 'author.foundation',
    dryRun: true,
  });

  assert.equal(candA.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(candA.scoreBreakdown.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(
    decision1.candidates[0].offeringId,
    candidatesApi.candidateKey(candB),
    'scored candidate B must rank before unscored candidate A'
  );

  // Step 2: candA gains a finite quality score
  candA.quality = Math.round(sources.dispatch.maxWriterSelectionRounds * 7);

  // Step 3: Subsequent ranking pass
  const decision2 = ranking.rankAndRecord([candA, candB], {
    workItemId: 'TASK-P1-REGRESSION',
    role: 'author.foundation',
    dryRun: true,
  });

  // Candidate A must no longer have QUALITY_UNKNOWN
  assert.notEqual(
    candA.qualityLabel,
    'QUALITY_UNKNOWN',
    'rankAndRecord must clear QUALITY_UNKNOWN when candidate gains a finite quality score'
  );
  assert.notEqual(
    candA.scoreBreakdown.qualityLabel,
    'QUALITY_UNKNOWN',
    'scoreBreakdown must not retain QUALITY_UNKNOWN when candidate gains a finite quality score'
  );

  // Candidate A has higher score (level 3 evidence) and finite quality, so it must rank before candidate B
  assert.equal(
    decision2.candidates[0].offeringId,
    candidatesApi.candidateKey(candA),
    'now-scored candidate A must rank before candidate B on subsequent ranking'
  );
  assert.equal(decision2.chosen, candidatesApi.candidateKey(candA));
});
