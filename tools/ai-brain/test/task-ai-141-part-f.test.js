'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const priorsApi = require('../priors');
const routing = require('../routing');
const { candidateKey } = require('../discovery/identity');

function candidate(modelId, overrides) {
  return Object.assign(
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'gateway-f',
      upstream: 'provider',
      accountId: modelId + '-account',
      quotaScope: modelId + '-account',
      modelId,
      contextWindow: 100000,
      latencyMs: 5000,
      cost: 1,
      evidence: [{ status: 'passed', proofLevel: 'HARNESS_PASS', ts: new Date().toISOString() }],
    },
    overrides || {}
  );
}

function profile(overrides) {
  return Object.assign(
    {
      taskId: 'TASK-AI-141-F',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 1000,
      expectedDuration: 10000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 100,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 3,
      currentWorkload: 0,
      riskDomains: [],
    },
    overrides || {}
  );
}

const assessment = { weightProfile: 'BALANCED', weights: { latency: 34, quality: 33, cost: 33 } };

describe('TASK-AI-141 Part F external priors and model choice', () => {
  test('prior promotes a strong untried model over weak model with old evidence', () => {
    const strong = candidate('strong-new', {
      evidence: [],
      latencyMs: 0,
      cost: 1,
      quality: 100,
      headroomStatus: 'open',
    });
    const weak = candidate('weak-old', {
      evidence: [
        {
          status: 'passed',
          proofLevel: 'WORK_ITEM_PASS',
          quality: 20,
          ts: '2026-10-01T00:00:00.000Z',
        },
      ],
      latencyMs: 5000,
      cost: 1,
      quality: 20,
      headroomStatus: 'open',
    });
    const withoutPrior = routing.rankForProfile([strong], profile(), assessment, {
      now: Date.parse('2026-10-10T12:00:00Z'),
      headrooms: { default: 'open' },
      priors: { ranking: [] },
    });
    const result = routing.rankForProfile([weak, strong], profile(), assessment, {
      now: Date.parse('2026-10-10T12:00:00Z'),
      headrooms: { default: 'open' },
      priors: {
        ranking: [
          {
            canonical: 'strong-new',
            codingTier: 'T1',
            reviewTier: 'T1',
            score: 90,
            retrievedAt: '2026-10-09T00:00:00Z',
            sources: [{ url: 'https://bench.example/strong', retrievedAt: '2026-10-09T00:00:00Z' }],
          },
          {
            canonical: 'weak-old',
            codingTier: 'T4',
            reviewTier: 'T4',
            score: 20,
            retrievedAt: '2026-10-09T00:00:00Z',
          },
        ],
      },
    });
    const strongRanked = result.ranking.find((item) => item.modelId === strong.modelId);
    assert.equal(result.ranking[0].modelId, strong.modelId);
    assert.equal(result.chosen, strongRanked.candidateKey);
    assert.ok(strongRanked.score > 0);
    assert.equal(strongRanked.scoreBreakdown.prior.normalizedScore, 0.9);
    assert.equal(strongRanked.scoreBreakdown.prior.weight, 0.33);
    assert.equal(
      priorsApi.benchmarkScore({ contextWindow: 1000000, releaseDate: '2026-01-01' }),
      null
    );
    assert.equal(strongRanked.probation, true);
    assert.equal(strongRanked.scoreBreakdown.cost, 95);
    assert.match(
      routing.formatTopEntry(Object.assign({}, strong, { latencyMs: null }), 1),
      /unknown/
    );
    assert.match(
      routing.formatTopEntry(Object.assign({}, strong, { latencyMs: 0 }), 1),
      /\| 0ms \|/
    );
  });

  test('prior bonus is not counted again after blending into quality', () => {
    const untried = candidate('single-prior', {
      evidence: [],
      latencyMs: 0,
      cost: 0,
      headroomStatus: 'open',
    });
    const result = routing.rankForProfile([untried], profile(), assessment, {
      now: Date.parse('2026-10-10T12:00:00Z'),
      headrooms: { default: 'open' },
      priors: {
        ranking: [
          {
            canonical: 'single-prior',
            codingTier: 'T1',
            reviewTier: 'T1',
            score: 50,
            retrievedAt: '2026-10-09T00:00:00Z',
          },
        ],
      },
    });
    assert.equal(result.ranking[0].scoreBreakdown.quality, 50);
    assert.equal(result.ranking[0].scoreBreakdown.prior.contribution, 0);
    assert.equal(result.ranking[0].score, 63);
  });

  test('measured latency and provider price data populate ranking and report fields', () => {
    const measured = candidate('measured-model', {
      latencyMs: undefined,
      expectedDurationMs: undefined,
      expectedLatencyMs: undefined,
      evidence: [{ status: 'passed', proofLevel: 'API_PASS', latencyMs: 1250 }],
      cost: { inputPerMillion: 10, outputPerMillion: 20 },
      headroomStatus: 'open',
    });
    const result = routing.rankForProfile([measured], profile(), assessment, {
      headrooms: { default: 'open' },
      priors: { ranking: [] },
    });
    const ranked = result.ranking[0];
    assert.equal(ranked.scoreBreakdown.latency, routing.latencyScoreOf(measured));
    assert.equal(ranked.scoreBreakdown.cost, 81);
    const rendered = routing.formatTopEntry(ranked, 1);
    assert.match(rendered, /\| 1250ms \|/);
    assert.match(rendered, /cost 12/);
  });

  test('probation requires an independent strong reviewer for security, money, or tenant work', () => {
    const untried = candidate('new-model', { evidence: [] });
    const task = profile({ riskDomains: ['security'], proofFloor: 'NONE' });
    const refused = routing.rankForProfile([untried], task, assessment, {
      headrooms: { default: 'open' },
      priors: {
        ranking: [
          {
            canonical: 'new-model',
            codingTier: 'T1',
            reviewTier: 'T1',
            score: 90,
            retrievedAt: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(refused.ranking.length, 0);
    assert.equal(refused.rejected[0].reasonCode, 'PROBATION_REQUIRES_INDEPENDENT_STRONG_REVIEWER');
    const reviewer = candidate('independent-reviewer', {
      gateway: 'different-gateway',
      upstream: 'different-provider',
      qualifiedRoles: ['reviewer.primary'],
      reservationStatus: 'reserved',
      strong: true,
    });
    const allowed = routing.rankForProfile([untried], task, assessment, {
      headrooms: { default: 'open' },
      priors: {
        ranking: [
          {
            canonical: 'new-model',
            codingTier: 'T1',
            reviewTier: 'T1',
            score: 90,
            retrievedAt: new Date().toISOString(),
          },
        ],
      },
      independentReviewerCandidates: [reviewer],
    });
    assert.equal(allowed.ranking[0].probation, true);
    assert.equal(allowed.ranking[0].probationRequiresIndependentReview, true);
  });

  test('probation execution refuses an available but unreserved reviewer before writer launch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai141-probation-'));
    const profileFile = path.join(root, 'profile.json');
    fs.writeFileSync(profileFile, JSON.stringify(profile({ proofFloor: 'API_PASS' })), 'utf8');
    const writer = candidate('probation-writer', {
      evidence: [],
      qualifiedRoles: ['author.foundation'],
      latencyMs: 0,
      quality: 100,
      headroomStatus: 'open',
    });
    const reviewer = candidate('reviewer-available-only', {
      gateway: 'different-gateway',
      upstream: 'different-provider',
      qualifiedRoles: ['reviewer.primary'],
      evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }],
    });
    let writerLaunches = 0;
    const errors = [];
    const result = await routing.runProfileDispatch(
      { profile: profileFile, execute: true, launch: true, root },
      {
        rootDir: root,
        candidates: [writer, reviewer],
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: path.join(root, 'decisions'),
        storePath: path.join(root, 'quota.json'),
        home: root,
        now: Date.now(),
        priors: {
          ranking: [
            {
              canonical: 'probation-writer',
              codingTier: 'T1',
              reviewTier: 'T1',
              score: 95,
              retrievedAt: new Date().toISOString(),
            },
          ],
        },
        headrooms: { default: 'open' },
        useStoredQuota: false,
        launcher: async () => {
          writerLaunches += 1;
          return { status: 'completed' };
        },
        log: () => {},
        error: (message) => errors.push(message),
        exit: () => {},
      }
    );
    assert.equal(result.refused, 'PROBATION_REQUIRES_INDEPENDENT_REVIEW');
    assert.equal(writerLaunches, 0);
    assert.ok(errors.includes('PROBATION_REQUIRES_INDEPENDENT_REVIEW'));
  });

  test('JEV can choose only eligible top candidates; low confidence keeps deterministic choice', async () => {
    const first = candidate('provider/first');
    const second = candidate('provider/second');
    const outside = candidate('provider/blocked', { blocked: true });
    let question;
    const ranked = routing.rankForProfile([first, second, outside], profile(), assessment, {
      headrooms: { default: 'open' },
    });
    const result = await routing.adviseRankedModelChoice(ranked, profile(), {
      topN: 2,
      minConfidence: 0.7,
      ask: async (ask) => {
        question = ask;
        return { choice: candidateKey(second), confidence: 0.9 };
      },
    });
    assert.ok(question.options.includes(candidateKey(second)));
    assert.ok(!question.options.includes(candidateKey(outside)));
    assert.match(question.evidence, /"quotaStatus":"unknown"/);
    assert.equal(result.chosen, candidateKey(second));
    const lowConfidence = await routing.adviseRankedModelChoice(
      routing.rankForProfile([first, second], profile(), assessment, {
        headrooms: { default: 'open' },
      }),
      profile(),
      {
        minConfidence: 0.95,
        ask: async (ask) => ({ choice: ask.options[1], confidence: 0.8 }),
      }
    );
    assert.equal(lowConfidence.chosen, lowConfidence.ranking[0].candidateKey);
    assert.equal(lowConfidence.modelChoice.outcome, 'UNDECIDED');
  });

  test('pluggable research merges model benchmark sources and flags stale data', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ai141-priors-')),
      'model-priors.json'
    );
    const refreshed = await priorsApi.refreshPriors({
      now: Date.parse('2026-10-10T00:00:00Z'),
      file,
      search: async (query) => {
        assert.equal(typeof query, 'string');
        return [
          {
            sources: [
              {
                id: 'bench',
                url: 'https://bench.example/results',
                retrievedAt: '2026-10-09T00:00:00Z',
              },
            ],
            models: [
              {
                modelId: 'gateway/Provider.New_Model',
                releaseDate: '2026-09-01',
                contextWindow: 200000,
                benchmarks: {
                  sweBenchVerified: {
                    score: 82,
                    source: {
                      url: 'https://bench.example/swe',
                      retrievedAt: '2026-10-09T00:00:00Z',
                    },
                  },
                  aiderPolyglot: 78,
                },
              },
            ],
          },
        ];
      },
      sourceId: 'fixture-search',
    });
    assert.equal(refreshed.ranking[0].canonical, 'provider-new-model');
    assert.ok(
      refreshed.ranking[0].sources.some((source) => source.url === 'https://bench.example/swe')
    );
    assert.equal(refreshed.ranking[0].stale, false);
    assert.equal(refreshed.searchSource, 'fixture-search');
    assert.equal(priorsApi.loadPriors(file).ranking.length, 1);
    assert.equal(
      priorsApi.isStale('2026-08-01T00:00:00Z', Date.parse('2026-10-10T00:00:00Z')),
      true
    );
  });

  test('refresh writes to its requested temporary file and every stale source flags the row', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ai141-priors-default-')),
      'model-priors.json'
    );
    const doc = await priorsApi.refreshPriors({
      now: Date.parse('2026-10-10T00:00:00Z'),
      file,
      searchSource: 'default-test-provider',
      search: async () => [
        {
          retrievedAt: '2026-10-09T00:00:00Z',
          models: [
            {
              modelId: 'fresh-and-stale',
              benchmarks: {
                swe: {
                  score: 90,
                  source: { url: 'https://fresh.example', retrievedAt: '2026-10-09T00:00:00Z' },
                },
                aider: {
                  score: 80,
                  source: { url: 'https://stale.example', retrievedAt: '2026-08-01T00:00:00Z' },
                },
              },
            },
          ],
        },
      ],
    });
    assert.equal(doc.searchSource, 'default-test-provider');
    assert.equal(priorsApi.loadPriors(file).ranking[0].canonical, 'fresh-and-stale');
    assert.equal(priorsApi.loadPriors(file).ranking[0].stale, true);
  });

  test('stale priors do not boost scores and probation is derived only for valid proof floors', () => {
    const untried = candidate('probation-model', { evidence: [] });
    const priors = {
      ranking: [
        {
          canonical: 'probation-model',
          codingTier: 'T1',
          reviewTier: 'T1',
          score: 95,
          retrievedAt: '2026-10-09T00:00:00Z',
        },
      ],
    };
    const baseline = routing.rankForProfile([untried], profile(), assessment, {
      now: Date.parse('2026-10-10T00:00:00Z'),
      headrooms: { default: 'open' },
      priors: { ranking: [] },
    }).ranking[0];
    const fresh = routing.rankForProfile(
      [untried],
      profile({ proofFloor: 'API_PASS' }),
      assessment,
      {
        now: Date.parse('2026-10-10T00:00:00Z'),
        headrooms: { default: 'open' },
        priors,
        independentStrongReviewerGuaranteed: true,
      }
    ).ranking[0];
    assert.equal(fresh.probation, true);
    assert.equal(fresh.probationRequiresIndependentReview, true);
    const stale = routing.rankForProfile([untried], profile(), assessment, {
      now: Date.parse('2026-10-10T00:00:00Z'),
      headrooms: { default: 'open' },
      priors: { ranking: [{ ...priors.ranking[0], retrievedAt: '2026-08-01T00:00:00Z' }] },
    }).ranking[0];
    assert.equal(stale.score, baseline.score);
    assert.equal(stale.probation, false);
    assert.equal(stale.scoreBreakdown.prior.normalizedScore, null);
  });

  test('fresh strong prior transfers proof-floor admission to independently reviewed probation', () => {
    const untried = candidate('proof-transfer-model', { evidence: [] });
    const result = routing.rankForProfile(
      [untried],
      profile({ proofFloor: 'API_PASS' }),
      assessment,
      {
        now: Date.parse('2026-10-10T00:00:00Z'),
        headrooms: { default: 'open' },
        priors: {
          ranking: [
            {
              canonical: 'proof-transfer-model',
              codingTier: 'T1',
              reviewTier: 'T1',
              score: 91,
              retrievedAt: '2026-10-09T00:00:00Z',
            },
          ],
        },
      }
    );
    assert.equal(result.ranking.length, 1);
    assert.equal(result.ranking[0].probation, true);
    assert.equal(result.ranking[0].probationRequiresIndependentReview, true);
    assert.equal(result.ranking[0].scoreBreakdown.prior.score, 91);
  });

  test('only the role-specific T1 tier admits a never-tried model on probation', () => {
    const untried = candidate('tier-boundary-model', { evidence: [] });
    const priors = {
      ranking: [
        {
          canonical: 'tier-boundary-model',
          codingTier: 'T1',
          reviewTier: 'T2',
          score: 76,
          retrievedAt: '2026-10-09T00:00:00Z',
        },
      ],
    };
    const writer = routing.rankForProfile(
      [untried],
      profile({ role: 'writer', proofFloor: 'API_PASS' }),
      assessment,
      { now: Date.parse('2026-10-10T00:00:00Z'), priors, headrooms: { default: 'open' } }
    );
    const reviewer = routing.rankForProfile(
      [untried],
      profile({ role: 'reviewer', proofFloor: 'API_PASS' }),
      assessment,
      { now: Date.parse('2026-10-10T00:00:00Z'), priors, headrooms: { default: 'open' } }
    );
    assert.equal(writer.ranking[0].probation, true);
    assert.equal(reviewer.ranking.length, 0);
    assert.equal(reviewer.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');
  });

  test('failed internal evidence cannot be waived by a strong prior', () => {
    const failed = candidate('failed-prior-model', {
      evidence: [{ status: 'failed', proofLevel: 'WORK_ITEM_PASS' }],
      quality: undefined,
    });
    const result = routing.rankForProfile(
      [failed],
      profile({ proofFloor: 'API_PASS' }),
      assessment,
      {
        now: Date.parse('2026-10-10T00:00:00Z'),
        priors: {
          ranking: [
            {
              canonical: 'failed-prior-model',
              codingTier: 'T1',
              reviewTier: 'T1',
              score: 99,
              retrievedAt: '2026-10-09T00:00:00Z',
            },
          ],
        },
        headrooms: { default: 'open' },
      }
    );
    assert.equal(result.ranking.length, 0);
    assert.equal(result.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');
  });

  test('a legacy tier bonus alone remains unproven', () => {
    const noMeasurements = candidate('legacy-tier-only', {
      evidence: [],
      quality: undefined,
      latencyMs: undefined,
      cost: undefined,
    });
    const result = routing.rankForProfile([noMeasurements], profile(), assessment, {
      headrooms: { default: 'open' },
      priors: {
        ranking: [
          {
            canonical: 'legacy-tier-only',
            codingTier: 'T1',
            reviewTier: 'T1',
            retrievedAt: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(result.reasonCode, 'MODEL_SELECTION_NOT_PROVEN');
  });

  test('benchmark aliases contribute scores without score or bench in their names', () => {
    assert.equal(
      priorsApi.benchmarkScore({ benchmarks: { aaCodingIndex: 88, liveBench: 82 } }),
      85
    );
    assert.equal(priorsApi.benchmarkScore({ aaCodingIndex: 88 }), 88);
  });

  test('seeded priors include model metadata and per-model source provenance', () => {
    const document = priorsApi.loadPriors();
    assert.ok(document.ranking.length > 0);
    const metadataSource = document.sources.find(
      (source) => source.id === 'benchlm-model-metadata'
    );
    assert.ok(metadataSource);
    for (const model of document.ranking) {
      if (model.releaseDate || model.contextWindow) {
        assert.ok(model.releaseDate, `${model.canonical} has a release date`);
        assert.ok(model.contextWindow > 0, `${model.canonical} has a context window`);
        assert.equal(model.metadataSource.url, `https://benchlm.ai/models/${model.canonical}`);
        assert.equal(model.metadataSource.retrievedAt, metadataSource.retrievedAt);
      }
      assert.ok(
        Array.isArray(model.sources) && model.sources.length > 0,
        `${model.canonical} has sources`
      );
      for (const source of model.sources) {
        assert.match(source.url, /^https:\/\//);
        assert.ok(source.retrievedAt);
      }
    }
  });

  test('priors refresh CLI rejects arbitrary output paths', () => {
    const cli = path.resolve(__dirname, '..', 'cli.js');
    const sourceDir = path.resolve(__dirname, '..', 'priors-sources');
    fs.mkdirSync(sourceDir, { recursive: true });
    const source = path.join(sourceDir, 'test-provider.js');
    fs.writeFileSync(
      source,
      'module.exports = { search: async () => [] };' + String.fromCharCode(10)
    );
    const outside = path.join(os.tmpdir(), 'ai141-priors-outside.json');
    try {
      const result = spawnSync(
        process.execPath,
        [cli, 'priors', 'refresh', '--source', source, '--file', outside],
        { encoding: 'utf8' }
      );
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /PRIORS_OUTPUT_OUTSIDE_ALLOWLIST/);
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test('weak or stale prior on a critical task does not trigger the strong-prior reviewer guard', () => {
    const model = candidate('weak-risk-model', { evidence: [] });
    const result = routing.rankForProfile(
      [model],
      profile({ riskDomains: ['security'] }),
      assessment,
      {
        headrooms: { default: 'open' },
        priors: {
          ranking: [
            {
              canonical: 'weak-risk-model',
              codingTier: 'T4',
              reviewTier: 'T4',
              score: 20,
              retrievedAt: '2026-08-01T00:00:00Z',
            },
          ],
        },
      }
    );
    assert.equal(result.rejected.length, 0);
    assert.equal(result.ranking[0].probation, false);
  });
});
