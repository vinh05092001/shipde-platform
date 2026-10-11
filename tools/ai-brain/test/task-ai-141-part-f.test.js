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
      latencyMs: 2000,
      cost: 1,
      headroomStatus: 'open',
    });
    const weak = candidate('weak-old', {
      evidence: [
        {
          status: 'passed',
          proofLevel: 'API_PASS',
          quality: 50,
          ts: '2026-09-01T00:00:00.000Z',
        },
      ],
      latencyMs: 2000,
      cost: 1,
      quality: 50,
      headroomStatus: 'open',
    });
    const withoutPrior = routing.rankForProfile([weak, strong], profile(), assessment, {
      now: Date.parse('2026-10-10T12:00:00Z'),
      headrooms: { default: 'open' },
      priors: { ranking: [] },
    });
    assert.equal(withoutPrior.ranking[0].modelId, weak.modelId);
    assert.equal(withoutPrior.chosen, candidateKey(weak));

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
      independentReviewerCandidates: [
        candidate('strong-reviewer', {
          gateway: 'different-gateway',
          upstream: 'different-provider',
          qualifiedRoles: ['reviewer.primary'],
          strong: true,
          reservationStatus: 'reserved',
        }),
      ],
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

  test('strong prior permits probation with partial evidence but WORK_ITEM_PASS supersedes probation', () => {
    const prior = {
      ranking: [
        {
          canonical: 'partially-proven',
          codingTier: 'T1',
          reviewTier: 'T1',
          score: 95,
          retrievedAt: new Date().toISOString(),
        },
      ],
    };
    const partial = candidate('partially-proven', {
      evidence: [{ status: 'passed', proofLevel: 'API_PASS' }],
    });
    const admitted = routing.rankForProfile(
      [partial],
      profile({ proofFloor: 'WORK_ITEM_PASS' }),
      assessment,
      {
        headrooms: { default: 'open' },
        priors: prior,
        independentReviewerCandidates: [
          candidate('partial-reviewer', {
            gateway: 'different-gateway',
            upstream: 'different-provider',
            qualifiedRoles: ['reviewer.primary'],
            strong: true,
            reservationStatus: 'reserved',
          }),
        ],
      }
    );
    assert.equal(admitted.ranking.length, 1);
    assert.equal(admitted.ranking[0].probation, true);
    const complete = candidate('partially-proven', {
      evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }],
    });
    const established = routing.rankForProfile(
      [complete],
      profile({ proofFloor: 'WORK_ITEM_PASS' }),
      assessment,
      {
        headrooms: { default: 'open' },
        priors: prior,
      }
    );
    assert.equal(established.ranking.length, 1);
    assert.equal(established.ranking[0].probation, false);
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
      independentReviewerCandidates: [
        candidate('strong-reviewer', {
          gateway: 'different-gateway',
          upstream: 'different-provider',
          qualifiedRoles: ['reviewer.primary'],
          strong: true,
          reservationStatus: 'reserved',
        }),
      ],
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

  test('probation never admits blocked, parked, or non-proof-floor-ineligible candidates', () => {
    const priors = {
      ranking: [
        {
          canonical: 'probation-guard',
          codingTier: 'T1',
          reviewTier: 'T1',
          score: 95,
          retrievedAt: new Date().toISOString(),
        },
      ],
    };
    const reviewer = candidate('independent-guard-reviewer', {
      gateway: 'another-gateway',
      upstream: 'another-provider',
      qualifiedRoles: ['reviewer.primary'],
      strong: true,
    });
    for (const overrides of [{ blocked: true }, { parked: true }, { status: 'UNAVAILABLE_NOW' }]) {
      const blocked = candidate('probation-guard', { evidence: [], ...overrides });
      const result = routing.rankForProfile(
        [blocked],
        profile({ proofFloor: 'API_PASS' }),
        assessment,
        { priors, headrooms: { default: 'open' }, independentReviewerCandidates: [reviewer] }
      );
      assert.equal(result.ranking.length, 0);
      assert.match(result.rejected[0].reasonCode, /BLOCKED|PROOF_FLOOR/);
    }

    const belowQuality = candidate('probation-guard', { evidence: [], quality: 0 });
    const qualityResult = routing.rankForProfile(
      [belowQuality],
      profile({ proofFloor: 'API_PASS', qualityFloor: 50 }),
      assessment,
      { priors, headrooms: { default: 'open' }, independentReviewerCandidates: [reviewer] }
    );
    assert.equal(qualityResult.ranking.length, 0);
    assert.equal(qualityResult.rejected[0].reasonCode, 'QUALITY_FLOOR_NOT_MET');

    const noReviewer = routing.rankForProfile(
      [candidate('probation-guard', { evidence: [] })],
      profile({ proofFloor: 'API_PASS' }),
      assessment,
      { priors, headrooms: { default: 'open' } }
    );
    assert.equal(noReviewer.ranking.length, 0);
    assert.equal(noReviewer.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');
  });

  test('probation admission refuses when no independent reviewer candidate is supplied', () => {
    const untried = candidate('probation-no-reviewer', { evidence: [] });
    const result = routing.rankForProfile(
      [untried],
      profile({ proofFloor: 'API_PASS' }),
      assessment,
      {
        headrooms: { default: 'open' },
        priors: {
          ranking: [
            {
              canonical: 'probation-no-reviewer',
              codingTier: 'T1',
              reviewTier: 'T1',
              score: 95,
              retrievedAt: new Date().toISOString(),
            },
          ],
        },
      }
    );
    assert.equal(result.ranking.length, 0);
    assert.equal(result.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');
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
        independentReviewerCandidates: [
          candidate('fresh-reviewer', {
            gateway: 'different-gateway',
            upstream: 'different-provider',
            qualifiedRoles: ['reviewer.primary'],
            strong: true,
            reservationStatus: 'reserved',
          }),
        ],
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
        independentReviewerCandidates: [
          candidate('transfer-reviewer', {
            gateway: 'different-gateway',
            upstream: 'different-provider',
            qualifiedRoles: ['reviewer.primary'],
            strong: true,
            reservationStatus: 'reserved',
          }),
        ],
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
      {
        now: Date.parse('2026-10-10T00:00:00Z'),
        priors,
        headrooms: { default: 'open' },
        independentReviewerCandidates: [
          candidate('tier-reviewer', {
            gateway: 'different-gateway',
            upstream: 'different-provider',
            qualifiedRoles: ['reviewer.primary'],
            strong: true,
            reservationStatus: 'reserved',
          }),
        ],
      }
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
    const document = priorsApi.loadPriors(
      path.resolve(__dirname, '..', 'data', 'model-priors.json')
    );
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
    const marker = path.join(sourceDir, 'executed-marker');
    fs.writeFileSync(
      source,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`,
      'utf8'
    );
    const outside = path.join(os.tmpdir(), 'ai141-priors-outside.json');
    try {
      const result = spawnSync(
        process.execPath,
        [cli, 'priors', 'refresh', '--source', source, '--file', outside],
        { encoding: 'utf8' }
      );
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /PRIORS_SEARCH_SOURCE_INVALID_JSON/);
      assert.equal(fs.existsSync(marker), false);
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test('P1 priors refresh reads JSON descriptor and rejects executable JS code without executing', () => {
    const cli = path.resolve(__dirname, '..', 'cli.js');
    const sourceDir = path.resolve(__dirname, '..', 'priors-sources');
    fs.mkdirSync(sourceDir, { recursive: true });
    const jsSource = path.join(sourceDir, 'exploit.js');
    const marker = path.join(sourceDir, 'should-not-exist');
    fs.writeFileSync(
      jsSource,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'pwned');\nmodule.exports = { endpoint: 'https://priors.example.com' };`,
      'utf8'
    );
    try {
      const result = spawnSync(process.execPath, [cli, 'priors', 'refresh', '--source', jsSource], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /PRIORS_SEARCH_SOURCE_INVALID_JSON/);
      assert.equal(fs.existsSync(marker), false);
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test('priors refresh sends only allowlisted headers and resolves auth by environment variable name', async () => {
    const cli = path.resolve(__dirname, '..', 'cli.js');
    const sourceDir = path.resolve(__dirname, '..', 'priors-sources');
    const source = path.join(sourceDir, 'header-filter-test.json');
    const preload = path.join(sourceDir, 'header-filter-preload.js');
    const output = path.join(sourceDir, 'header-filter-output.json');
    const priorToken = process.env.PRIORS_TEST_TOKEN;
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      source,
      JSON.stringify({
        endpoint: 'https://priors.example.com',
        authEnv: 'PRIORS_TEST_TOKEN',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'priors-test',
          Authorization: 'Bearer literal-secret-must-not-be-used',
          'X-Forwarded-Authorization': 'Bearer also-forbidden',
        },
      }),
      'utf8'
    );
    fs.writeFileSync(
      preload,
      `global.fetch = async (_url, options) => { require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify(options.headers)); return { ok: true, json: async () => [] }; };`,
      'utf8'
    );
    process.env.PRIORS_TEST_TOKEN = 'test-token-from-environment';
    try {
      const env = Object.assign({}, process.env, {
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(preload)}`.trim(),
      });
      const result = spawnSync(process.execPath, [cli, 'priors', 'refresh', '--source', source], {
        cwd: path.resolve(__dirname, '../../..'),
        env,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'priors-test',
        authorization: 'Bearer test-token-from-environment',
      });
    } finally {
      if (priorToken === undefined) delete process.env.PRIORS_TEST_TOKEN;
      else process.env.PRIORS_TEST_TOKEN = priorToken;
      fs.rmSync(source, { force: true });
      fs.rmSync(preload, { force: true });
      fs.rmSync(output, { force: true });
      fs.rmSync(path.join(sourceDir, 'header-filter-output-priors.json'), { force: true });
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

  test('P1 priors staleness fails closed for tier-only and undated or future priors', () => {
    const NOW = Date.parse('2026-10-10T12:00:00Z');
    // Tier-only prior (no score) with missing retrieval date
    const undatedTierOnly = priorsApi.priorFor(
      { modelId: 'undated-tier-model' },
      'writer',
      {
        ranking: [
          {
            canonical: 'undated-tier-model',
            codingTier: 'T1',
            reviewTier: 'T1',
          },
        ],
      },
      NOW
    );
    assert.ok(!undatedTierOnly || undatedTierOnly.stale !== false);
    assert.ok(!undatedTierOnly || undatedTierOnly.bonus === 0);

    // Prior with future retrieval date
    const futurePrior = priorsApi.priorFor(
      { modelId: 'future-model' },
      'writer',
      {
        ranking: [
          {
            canonical: 'future-model',
            codingTier: 'T1',
            reviewTier: 'T1',
            score: 90,
            retrievedAt: '2026-10-15T00:00:00Z',
          },
        ],
      },
      NOW
    );
    assert.equal(futurePrior.stale, true);
    assert.equal(futurePrior.bonus, 0);

    // Prior with missing source retrieval dates
    const missingDatePrior = priorsApi.priorFor(
      { modelId: 'missing-date-model' },
      'writer',
      {
        ranking: [
          {
            canonical: 'missing-date-model',
            codingTier: 'T1',
            reviewTier: 'T1',
            score: 85,
            sources: [{ url: 'https://bench.example/foo' }],
          },
        ],
      },
      NOW
    );
    assert.equal(missingDatePrior.stale, true);
    assert.equal(missingDatePrior.bonus, 0);

    // Undated T1 prior fails closed and cannot bypass proof floor on probation
    const undatedCand = candidate('undated-tier-model', { evidence: [] });
    const rankResult = routing.rankForProfile(
      [undatedCand],
      profile({ proofFloor: 'WORK_ITEM_PASS' }),
      assessment,
      {
        now: NOW,
        headrooms: { default: 'open' },
        priors: {
          ranking: [
            {
              canonical: 'undated-tier-model',
              codingTier: 'T1',
              reviewTier: 'T1',
            },
          ],
        },
      }
    );
    assert.equal(rankResult.ranking.length, 0);
    assert.equal(rankResult.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');
  });

  test('undated tier-only priors cannot admit probation', () => {
    const result = routing.rankForProfile(
      [candidate('undated-tier-model', { evidence: [] })],
      profile({ proofFloor: 'WORK_ITEM_PASS' }),
      assessment,
      {
        now: Date.parse('2026-10-10T12:00:00Z'),
        headrooms: { default: 'open' },
        priors: {
          ranking: [{ canonical: 'undated-tier-model', codingTier: 'T1', reviewTier: 'T1' }],
        },
      }
    );
    assert.equal(result.ranking.length, 0);
    assert.equal(result.rejected[0].reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');
  });

  test('P1 independent reviewer isolation rejects unknown domain at admission and pin time', () => {
    const writer = candidate('writer-cand', {
      gateway: 'gw-writer',
      upstream: 'up-writer',
    });
    const reviewerUnknownDomain = candidate('reviewer-unknown', {
      gateway: null,
      upstream: null,
      qualifiedRoles: ['reviewer.primary'],
      reservationStatus: 'reserved',
      strong: true,
    });
    const reviewerIndependent = candidate('reviewer-independent', {
      gateway: 'gw-reviewer',
      upstream: 'up-reviewer',
      qualifiedRoles: ['reviewer.primary'],
      reservationStatus: 'reserved',
      strong: true,
    });

    // Unknown domain cannot be an independent reviewer candidate
    assert.equal(routing.isIndependentReviewerCandidate(writer, reviewerUnknownDomain), false);
    assert.equal(routing.isIndependentReviewerCandidate(writer, reviewerIndependent), true);

    // When reviewer with unknown domain appears before independent reviewer,
    // findIndependentReviewerCandidate skips the unknown domain and chooses the independent one
    const chosenReviewer = routing.findIndependentReviewerCandidate(writer, [
      reviewerUnknownDomain,
      reviewerIndependent,
    ]);
    assert.equal(chosenReviewer.modelId, reviewerIndependent.modelId);
  });

  test('P1 execution with reserved independent reviewer launches writer and records review guarantee', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai141-review-exec-'));
    const profileFile = path.join(root, 'profile.json');
    fs.writeFileSync(profileFile, JSON.stringify(profile({ proofFloor: 'NONE' })), 'utf8');
    const writer = candidate('exec-writer', {
      evidence: [],
      qualifiedRoles: ['author.foundation'],
      latencyMs: 1000,
      cost: 1,
      headroomStatus: 'open',
    });
    const reviewer = candidate('exec-reviewer', {
      gateway: 'gw-isolated-rev',
      upstream: 'up-isolated-rev',
      qualifiedRoles: ['reviewer.primary'],
      reservationStatus: 'reserved',
      strong: true,
      proofLevel: 'WORK_ITEM_PASS',
    });
    let launchedRequest = null;
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
              canonical: 'exec-writer',
              codingTier: 'T1',
              reviewTier: 'T1',
              score: 95,
              retrievedAt: new Date().toISOString(),
            },
          ],
        },
        headrooms: { default: 'open' },
        useStoredQuota: false,
        launcher: async (req) => {
          launchedRequest = req;
          return { status: 'completed' };
        },
        log: () => {},
        error: (message) => errors.push(message),
        exit: () => {},
      }
    );

    assert.equal(result.exitCode, 0);
    assert.ok(launchedRequest);
    assert.equal(launchedRequest.candidateKey, candidateKey(writer));
    assert.ok(launchedRequest.independentReviewer);
    assert.equal(launchedRequest.independentReviewer.candidateKey, candidateKey(reviewer));
    assert.equal(
      launchedRequest.independentReviewer.failureDomain,
      routing.canonicalFailureDomain(reviewer)
    );
  });

  test('P1 JEV model choice on operator path consults JEV and falls back when ask is omitted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai141-jev-choice-'));
    const profileFile = path.join(root, 'profile.json');
    fs.writeFileSync(profileFile, JSON.stringify(profile()), 'utf8');

    const first = candidate('candidate-first', { latencyMs: 1000, quality: 90 });
    const second = candidate('candidate-second', { latencyMs: 2000, quality: 85 });

    let modelChoiceCalled = false;
    // Operator path: deps has ask (weighting and model choice) but no modelChoiceAsk
    const operatorResult = await routing.runProfileDispatch(
      { profile: profileFile, root },
      {
        rootDir: root,
        candidates: [first, second],
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: path.join(root, 'decisions'),
        home: root,
        now: Date.now(),
        headrooms: { default: 'open' },
        useStoredQuota: false,
        ask: async (question) => {
          if (question.kind === 'select-eligible-model') {
            modelChoiceCalled = true;
            return { choice: candidateKey(second), confidence: 0.95 };
          }
          return { choice: 'BALANCED', confidence: 0.9 };
        },
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );

    assert.equal(modelChoiceCalled, true);
    assert.equal(operatorResult.chosen, candidateKey(second));
    assert.equal(operatorResult.modelChoice.outcome, 'DECIDED');
    assert.equal(operatorResult.modelChoice.choice, candidateKey(second));
    assert.equal(operatorResult.modelChoice.confidence, 0.95);

    // Production defaults without injected deps: runs cleanly and records UNDECIDED
    const defaultResult = await routing.runProfileDispatch(
      { profile: profileFile, root },
      {
        rootDir: root,
        candidates: [first, second],
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: path.join(root, 'decisions'),
        home: root,
        now: Date.now(),
        headrooms: { default: 'open' },
        useStoredQuota: false,
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );

    assert.equal(defaultResult.exitCode, 0);
    assert.equal(defaultResult.chosen, candidateKey(first));
    assert.equal(defaultResult.modelChoice.outcome, 'UNDECIDED');
    assert.equal(defaultResult.modelChoice.reason, 'NOT_CONFIGURED');
  });

  test('P1 JEV model choice fails closed on ineligible choice, exception, and low confidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai141-jev-fallback-'));
    const profileFile = path.join(root, 'profile.json');
    fs.writeFileSync(profileFile, JSON.stringify(profile()), 'utf8');

    const first = candidate('candidate-a', { latencyMs: 1000, quality: 90 });
    const second = candidate('candidate-b', { latencyMs: 2000, quality: 85 });

    // Ineligible choice: JEV returns an unknown key
    const ineligibleResult = await routing.runProfileDispatch(
      { profile: profileFile, root },
      {
        rootDir: root,
        candidates: [first, second],
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: path.join(root, 'decisions'),
        home: root,
        now: Date.now(),
        headrooms: { default: 'open' },
        useStoredQuota: false,
        modelChoiceAsk: async () => ({ choice: 'unknown::candidate::key', confidence: 0.95 }),
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );
    assert.equal(ineligibleResult.chosen, candidateKey(first));
    assert.equal(ineligibleResult.modelChoice.outcome, 'UNDECIDED');

    // JEV throws error: falls closed to deterministic choice
    const errorResult = await routing.runProfileDispatch(
      { profile: profileFile, root },
      {
        rootDir: root,
        candidates: [first, second],
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: path.join(root, 'decisions'),
        home: root,
        now: Date.now(),
        headrooms: { default: 'open' },
        useStoredQuota: false,
        modelChoiceAsk: async () => {
          throw new Error('JEV_NETWORK_DOWN');
        },
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );
    assert.equal(errorResult.chosen, candidateKey(first));
    assert.equal(errorResult.modelChoice.outcome, 'UNDECIDED');
    assert.match(errorResult.modelChoice.reason, /JEV_PROVIDER_FAILED/);

    // Low confidence: falls closed to deterministic choice
    const lowConfResult = await routing.runProfileDispatch(
      { profile: profileFile, root },
      {
        rootDir: root,
        candidates: [first, second],
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: path.join(root, 'decisions'),
        home: root,
        now: Date.now(),
        headrooms: { default: 'open' },
        useStoredQuota: false,
        modelChoiceAsk: async () => ({ choice: candidateKey(second), confidence: 0.2 }),
        modelChoiceMinConfidence: 0.7,
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );
    assert.equal(lowConfResult.chosen, candidateKey(first));
    assert.equal(lowConfResult.modelChoice.outcome, 'UNDECIDED');
  });
});
