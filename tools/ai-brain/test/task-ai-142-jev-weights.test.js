'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jev = require('../jev');
const routing = require('../routing');

function profile(overrides = {}) {
  return Object.assign(
    {
      taskId: 'TASK-AI-142-H3',
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
      riskDomains: [],
    },
    overrides
  );
}

function answers(scores, confidence = 0.9) {
  const map = {};
  for (const [name, score] of Object.entries(scores)) {
    map[name] = { type: 'score', score, distribution: { [score]: 1 }, confidence };
  }
  map.weightProfile = { type: 'choice', choice: 'BALANCED', confidence: 0.9 };
  return { answers: map };
}

function clientFor(response, inspect) {
  return async (url, body, headers) => {
    if (inspect) inspect(url, body, headers);
    return response;
  };
}

test('JEV scores convert to direct weights and the Controller uses them for ranking', async () => {
  const secret = 'never-print-this-key';
  let request;
  const source = {
    id: 'jev',
    kind: 'decision-service',
    endpoint: 'https://jev.example/ask',
    model: 'jev-latest',
    credential: { env: 'TYPESAFE_API_KEY' },
    mayWriteCode: false,
  };
  const ask = jev.buildJevAsk(source, {
    env: { TYPESAFE_API_KEY: secret },
    httpClient: clientFor(
      answers({ qualityImportance: 8, latencyImportance: 3, costImportance: 4 }),
      (...args) => {
        request = args;
      }
    ),
  });
  const assessment = await routing.assessTask(profile(), { ask, minConfidence: 0.7 });
  assert.deepEqual(assessment.weights, { quality: 53, latency: 20, cost: 27 });
  assert.equal(assessment.weightSource, 'jev-score');
  assert.equal(request[1].questions.qualityImportance.type, 'score');
  assert.equal(request[1].questions.latencyImportance.type, 'score');
  assert.equal(request[1].questions.costImportance.type, 'score');
  assert.equal(request[1].questions.weightProfile.type, 'choice');
  assert.match(request[1].questions.qualityImportance.criteria[0], /^0:/);
  assert.match(request[1].questions.qualityImportance.criteria[9], /^9:/);
  assert.equal(request[2].authorization, 'Bearer ' + secret);

  const candidates = [
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'g',
      upstream: 'p',
      accountId: 'a',
      modelId: 'quality',
      contextWindow: 10000,
      quality: 100,
      latencyMs: 5000,
      cost: 5,
      evidence: [],
    },
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'g',
      upstream: 'p',
      accountId: 'b',
      modelId: 'fast',
      contextWindow: 10000,
      quality: 20,
      latencyMs: 100,
      cost: 5,
      evidence: [],
    },
  ];
  const ranked = routing.rankForProfile(candidates, profile(), assessment, {
    headrooms: { default: 'open' },
  });
  assert.equal(
    ranked.ranking[0].score,
    routing.scoreForProfile(ranked.ranking[0], assessment, { headrooms: { default: 'open' } }).score
  );
  const visible = JSON.stringify({ assessment, ranking: ranked.ranking });
  assert.equal(visible.includes(secret), false);
  assert.equal(JSON.stringify(request[1]).includes(secret), false);
});

test('reviewer roles always retain QUALITY_FIRST when JEV returns confident scores', async () => {
  for (const role of ['reviewer', 'security-review']) {
    const assessment = await routing.assessTask(profile({ role, riskDomains: [] }), {
      ask: async () => ({
        scores: {
          qualityImportance: { score: 1, confidence: 0.99 },
          latencyImportance: { score: 10, confidence: 0.99 },
          costImportance: { score: 1, confidence: 0.99 },
        },
        choice: 'LATENCY_FIRST',
        confidence: 0.99,
      }),
    });

    assert.equal(assessment.weightProfile, 'QUALITY_FIRST', role);
    assert.equal(assessment.weightSource, 'preset:QUALITY_FIRST', role);
    assert.deepEqual(assessment.weights, { quality: 65, latency: 10, cost: 25 }, role);
    assert.equal(assessment.reason, 'QUALITY_FIRST_ROLE_POLICY', role);
    assert.ok(assessment.reasonCodes.includes('QUALITY_FIRST_ROLE_POLICY'), role);
  }
});

test('low confidence scores fall back to a preset with a reason', async () => {
  const assessment = await routing.assessTask(profile(), {
    ask: async () => ({
      scores: {
        qualityImportance: { score: 8, confidence: 0.4 },
        latencyImportance: { score: 3, confidence: 0.4 },
        costImportance: { score: 4, confidence: 0.4 },
      },
      choice: 'BALANCED',
    }),
  });
  assert.equal(assessment.weightSource, 'preset:BALANCED');
  assert.deepEqual(assessment.weights, routing.WEIGHT_PROFILES.BALANCED);
  assert.ok(assessment.reasonCodes.some((code) => code.includes('LOW_CONFIDENCE')));
  assert.deepEqual(assessment.scores, {
    qualityImportance: 8,
    latencyImportance: 3,
    costImportance: 4,
  });
  assert.deepEqual(assessment.dimensionConfidences, {
    qualityImportance: 0.4,
    latencyImportance: 0.4,
    costImportance: 0.4,
  });
});

test('JEV failure falls back to a preset', async () => {
  const secret = 'never-print-this-key';
  const source = {
    id: 'jev',
    kind: 'decision-service',
    endpoint: 'https://jev.example/ask',
    model: 'jev-latest',
    credential: { env: 'TYPESAFE_API_KEY' },
    mayWriteCode: false,
  };
  const ask = jev.buildJevAsk(source, {
    env: { TYPESAFE_API_KEY: secret },
    httpClient: async () => {
      throw new Error('JEV_TIMEOUT');
    },
  });
  const assessment = await routing.assessTask(profile({ latencyPriority: 'high' }), { ask });
  assert.equal(assessment.weightSource, 'preset:LATENCY_FIRST');
  assert.ok(assessment.reasonCodes.some((code) => code.includes('TIMEOUT')));
  assert.equal(JSON.stringify(assessment).includes(secret), false);
});

test('dispatch ranking proceeds when JEV scores, has low confidence, or throws', async () => {
  const route = {
    harness: 'paseo',
    accessPath: 'cli',
    gateway: 'gateway-a',
    upstream: 'provider-a',
    accountId: 'account-a',
    modelId: 'model-a',
    contextWindow: 10000,
    quality: 80,
    latencyMs: 500,
    cost: 2,
    evidence: [],
  };
  const cases = [
    {
      name: 'scores',
      ask: async () => ({
        scores: {
          qualityImportance: { score: 8, confidence: 0.9 },
          latencyImportance: { score: 3, confidence: 0.9 },
          costImportance: { score: 4, confidence: 0.9 },
        },
        choice: 'BALANCED',
      }),
    },
    {
      name: 'low confidence',
      ask: async () => ({
        scores: {
          qualityImportance: { score: 8, confidence: 0.4 },
          latencyImportance: { score: 3, confidence: 0.4 },
          costImportance: { score: 4, confidence: 0.4 },
        },
        choice: 'BALANCED',
      }),
    },
    {
      name: 'throw',
      ask: async () => {
        throw new Error('JEV_UNAVAILABLE');
      },
    },
  ];

  for (const scenario of cases) {
    const assessment = await routing.assessTask(profile(), { ask: scenario.ask });
    const result = routing.rankForProfile([route], profile(), assessment, {
      headrooms: { default: 'open' },
    });
    assert.equal(
      result.ranking.length,
      1,
      `${scenario.name}: candidate should remain dispatchable`
    );
    assert.equal(result.chosen, routing.candidateKey(route));
  }
});

test('quality-only reasoning scores retain known values and order despite unknown quota', () => {
  const assessment = {
    weights: routing.WEIGHT_PROFILES.QUALITY_FIRST,
    renormalizeKnownScores: true,
  };
  const candidates = [0, 19, 95].map((quality) => ({
    harness: 'hermes',
    accessPath: 'https://example.test/v1',
    gateway: '',
    upstream: 'test',
    accountId: 'account',
    quotaScope: 'account',
    modelId: `reasoner-${quality}`,
    contextWindow: 128000,
    quality,
    evidence: [],
    headroomStatus: 'unknown',
  }));
  const context = {
    priors: { ranking: [] },
    useStoredQuota: false,
    headrooms: { default: 'unknown' },
  };
  const scores = candidates.map((c) => routing.scoreForProfile(c, assessment, context));
  assert.deepEqual(
    scores.map((s) => s.score),
    [0, 4, 80]
  );
  for (const s of scores) {
    assert.equal(s.breakdown.latency, null);
    assert.equal(s.breakdown.cost, null);
    assert.equal(s.breakdown.reliability, null);
  }
  const ranked = routing.rankForProfile(
    candidates,
    profile({ requiredHarness: 'hermes' }),
    assessment,
    context
  );
  assert.deepEqual(
    ranked.ranking.map((c) => c.modelId),
    ['reasoner-95', 'reasoner-19', 'reasoner-0']
  );
});

test('healthy reasoning candidates use existing benchmark priors to choose the strongest', () => {
  const priors = require('../priors').loadPriors(
    require('path').join(__dirname, 'fixtures', 'priors-20261013.json')
  );
  const rows = ['deepseek-v4-1-flash', 'gpt-6-astra', 'claude-opus-5-5'].map((modelId) => ({
    harness: 'hermes',
    accessPath: 'https://example.test/v1',
    gateway: '',
    upstream: 'test',
    accountId: 'account',
    quotaScope: 'account',
    modelId,
    contextWindow: 128000,
    evidence: [],
  }));
  const result = routing.rankForProfile(
    rows,
    profile({ role: 'planner', requiredHarness: 'hermes' }),
    { weights: routing.WEIGHT_PROFILES.QUALITY_FIRST, renormalizeKnownScores: true },
    {
      priors,
      now: Date.parse('2026-10-14T01:08:00Z'),
      useStoredQuota: false,
      headrooms: { default: 'open' },
    }
  );
  assert.equal(result.ranking.length, 3);
  assert.equal(result.ranking[0].modelId, 'gpt-6-astra');
  assert.equal(result.chosen, result.ranking[0].candidateKey);
  assert.ok(result.ranking[0].score > result.ranking[1].score);
  assert.ok(result.ranking[1].score > result.ranking[2].score);
});

for (const minConfidence of [undefined, 0.5]) {
  test(`per-dimension JEV confidence preserves evidence at threshold ${minConfidence ?? 'default'}`, async () => {
    const scores = {
      qualityImportance: { score: 4.11, confidence: 0.56 },
      latencyImportance: { score: 1.98, confidence: 0.23 },
      costImportance: { score: 1.08, confidence: 0.57 },
    };
    const assessment = await routing.assessTask(profile(), {
      minConfidence,
      ask: async () => ({ choice: 'BALANCED', scores }),
    });
    assert.equal(
      assessment.confidence,
      0.23,
      'log the minimum observed confidence even on fallback'
    );
    assert.deepEqual(assessment.dimensionConfidences, {
      qualityImportance: 0.56,
      latencyImportance: 0.23,
      costImportance: 0.57,
    });
    if (minConfidence === undefined) {
      assert.equal(assessment.weightSource, 'preset:BALANCED');
      assert.deepEqual(assessment.weights, routing.WEIGHT_PROFILES.BALANCED);
    } else {
      assert.equal(assessment.weightSource, 'mixed:jev-score+preset:BALANCED');
      assert.deepEqual(assessment.dimensionWeightSources, {
        quality: 'jev-score',
        latency: 'preset:BALANCED',
        cost: 'jev-score',
      });
      const preset = routing.WEIGHT_PROFILES.BALANCED;
      assert.equal(assessment.weights.latency, preset.latency);
      const trustedTotal = scores.qualityImportance.score + scores.costImportance.score;
      const remaining = 100 - preset.latency;
      assert.ok(
        Math.abs(
          assessment.weights.quality - (remaining * scores.qualityImportance.score) / trustedTotal
        ) <= 1
      );
      assert.equal(
        Object.values(assessment.weights).reduce((a, b) => a + b, 0),
        100
      );
    }
  });
}

test('mixed JEV weighting uses the default confidence threshold and retains risk policy', async () => {
  const ask = async () => ({
    scores: {
      qualityImportance: { score: 4.11, confidence: 0.8 },
      latencyImportance: { score: 1.98, confidence: 0.23 },
      costImportance: { score: 1.08, confidence: 0.9 },
    },
  });
  const result = await routing.assessTask(profile(), { ask });
  assert.equal(result.weightSource, 'mixed:jev-score+preset:BALANCED');
  assert.equal(result.confidence, 0.23);
  assert.equal(result.weights.latency, routing.WEIGHT_PROFILES.BALANCED.latency);
  const risky = await routing.assessTask(profile({ riskDomains: ['money'] }), { ask });
  assert.deepEqual(risky.weights, routing.WEIGHT_PROFILES.QUALITY_FIRST);
  assert.equal(risky.dimensionWeightSources, null);
});

test('configured weighting confidence keeps the exact live quality and cost advice without lowering the choice threshold', async () => {
  const source = { minConfidence: 0.7, weightingMinConfidence: 0.5 };
  const scores = {
    qualityImportance: { score: 4.11, confidence: 0.56 },
    latencyImportance: { score: 1.98, confidence: 0.23 },
    costImportance: { score: 1.08, confidence: 0.57 },
  };
  const result = await routing.assessTask(profile(), {
    source,
    ask: async () => ({ scores, choice: 'BALANCED' }),
  });
  assert.equal(result.weightSource, 'mixed:jev-score+preset:BALANCED');
  assert.deepEqual(result.dimensionWeightSources, {
    quality: 'jev-score',
    latency: 'preset:BALANCED',
    cost: 'jev-score',
  });
  assert.deepEqual(result.weights, { quality: 52, latency: 34, cost: 14 });
  assert.equal(result.confidence, 0.23);
  const closed = await jev.advise(
    {
      kind: 'advisory',
      evidence: 'fixture evidence',
      options: ['BALANCED', 'QUALITY_FIRST'],
    },
    {
      minConfidence: source.minConfidence,
      ask: async () => ({ choice: 'BALANCED', confidence: 0.56 }),
    }
  );
  assert.equal(closed.outcome, jev.Outcome.UNDECIDED);
  assert.equal(closed.reason, 'LOW_CONFIDENCE');
});

test('weighting threshold does not admit low confidence preset-only advice', async () => {
  const result = await routing.assessTask(profile(), {
    source: { minConfidence: 0.7, weightingMinConfidence: 0.5 },
    ask: async () => ({ choice: 'QUALITY_FIRST', confidence: 0.56 }),
  });
  assert.equal(result.weightSource, 'preset:BALANCED');
  assert.equal(result.jevOutcome, jev.Outcome.UNDECIDED);
});

test('zero trusted score mass keeps preset provenance instead of claiming mixed weights', async () => {
  const result = await routing.assessTask(profile(), {
    source: { minConfidence: 0.7, weightingMinConfidence: 0.5 },
    ask: async () => ({
      scores: {
        qualityImportance: { score: 0, confidence: 0.8 },
        latencyImportance: { score: 2, confidence: 0.23 },
        costImportance: { score: 0, confidence: 0.9 },
      },
    }),
  });
  assert.equal(result.weightSource, 'preset:BALANCED');
  assert.deepEqual(result.weights, routing.WEIGHT_PROFILES.BALANCED);
  assert.equal(result.dimensionWeightSources, null);
});
