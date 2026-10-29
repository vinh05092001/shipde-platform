'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  mergePriorDocuments,
  matchModelPrior,
  priorFor,
  refreshPriors,
  getNormalizationMethod,
  normalizeScore,
  dedupeBenchmarks,
} = require('../priors');
const config = require('../priors-sources/public.json');

test('Defect 1: mergePriorDocuments merges effort rows into single canonical model entry with per-effort benchmarks', () => {
  const docs = [
    {
      sources: [
        { id: 'artificial-analysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
      ],
      models: [
        {
          modelId: 'GPT-6 Astra',
          benchmarks: { intelligenceIndex: 70.0 },
        },
        {
          modelId: 'GPT-6 Astra (High)',
          benchmarks: { intelligenceIndex: 54.8 },
        },
        {
          modelId: 'Gemini 3.8 Flash (High)',
          benchmarks: { intelligenceIndex: 30.5 },
        },
      ],
    },
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        {
          modelId: 'gpt-6-astra',
          benchmarks: { aaCodingIndex: 73.4, benchlm: 73.4 },
        },
        {
          modelId: 'gemini-3-8-flash',
          benchmarks: { aaCodingIndex: 64.8, benchlm: 64.8 },
        },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs);

  // Exactly one ranking row per canonical model
  const astraRows = merged.ranking.filter((r) => r.canonical === 'gpt-6-astra');
  assert.equal(astraRows.length, 1, 'gpt-6-astra must have exactly one ranking entry');

  const flashRows = merged.ranking.filter((r) => r.canonical === 'gemini-3-8-flash');
  assert.equal(flashRows.length, 1, 'gemini-3-8-flash must have exactly one ranking entry');

  // No separate -high canonical rows
  assert.equal(
    merged.ranking.some((r) => r.canonical.endsWith('-high')),
    false,
    'no separate effort rows in ranking'
  );

  // Canonical entry stores per-effort benchmarks
  const astra = astraRows[0];
  assert.ok(astra.efforts, 'canonical entry must have efforts map');
  assert.ok(astra.efforts.high, 'high effort must be recorded under efforts');
  const highIntel = astra.efforts.high.benchmarks.find((b) => b.name === 'intelligenceIndex');
  assert.ok(highIntel, 'high effort must contain intelligenceIndex');
  assert.equal(highIntel.score, 54.8);
});

test('Defect 1: effort query falls back to base model benchmark when missing on effort and marks fallback in evidence', () => {
  const docs = [
    {
      sources: [
        { id: 'artificial-analysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
      ],
      models: [
        {
          modelId: 'Gemini 3.8 Flash (High)',
          benchmarks: { intelligenceIndex: 30.5 },
        },
      ],
    },
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        {
          modelId: 'gemini-3-8-flash',
          benchmarks: { aaCodingIndex: 64.8 },
        },
      ],
    },
  ];

  const priors = mergePriorDocuments(docs);
  const now = Date.now();

  // Querying with effort suffix (writer role needs aaCodingIndex)
  const prior = priorFor({ modelId: 'agy/gemini-3.8-flash-high' }, 'writer', priors, now);

  assert.ok(prior, 'prior must resolve');
  assert.equal(prior.canonical, 'gemini-3-8-flash');
  assert.ok(prior.score > 0, 'prior score must be positive with coding fallback');
  assert.equal(
    prior.fallback,
    true,
    'missing benchmark on effort must be flagged as fallback in evidence'
  );
});

test('Defect 3: model with only effort row merges into canonical base and matches router prefix (gcli/grok-4.7)', () => {
  const docs = [
    {
      sources: [
        { id: 'artificial-analysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
      ],
      models: [
        {
          modelId: 'Grok 4.7 (High)',
          benchmarks: { intelligenceIndex: 45.0 },
        },
      ],
    },
  ];

  const priors = mergePriorDocuments(docs);

  // Canonical row is grok-4-7, not grok-4-7-high
  const grok = priors.ranking.find((r) => r.canonical === 'grok-4-7');
  assert.ok(grok, 'canonical entry must be grok-4-7');
  assert.equal(
    priors.ranking.some((r) => r.canonical === 'grok-4-7-high'),
    false
  );

  // Router ID gcli/grok-4.7 matches grok-4-7
  const match = matchModelPrior('gcli/grok-4.7', priors.ranking);
  assert.ok(match, 'gcli/grok-4.7 must match canonical entry');
  assert.equal(match.entry.canonical, 'grok-4-7');
});

test('Defect 3: router ID qwen/qwen3.8-max:free matches canonical qwen-3-8-max from config rules', () => {
  const docs = [
    {
      sources: [
        { id: 'artificial-analysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
      ],
      models: [
        {
          modelId: 'Qwen 3.8 Max',
          benchmarks: { intelligenceIndex: 58.0 },
        },
      ],
    },
  ];

  const priors = mergePriorDocuments(docs);
  const match = matchModelPrior('qwen/qwen3.8-max:free', priors.ranking);

  assert.ok(match, 'qwen/qwen3.8-max:free must match canonical qwen-3-8-max');
  assert.equal(match.entry.canonical, 'qwen-3-8-max');
});

test('Unknown model ID stays unmatched (fail closed)', () => {
  const priors = {
    ranking: [{ canonical: 'gpt-6-astra', benchmarks: [{ name: 'intelligenceIndex', score: 70 }] }],
  };

  const match = matchModelPrior('unknown/fabricated-model:free', priors.ranking);
  assert.equal(match, null);

  const prior = priorFor({ modelId: 'unknown/fabricated-model:free' }, 'writer', priors);
  assert.equal(prior.score, null);
  assert.equal(prior.priorUnknown, true);
});

test('Defect 2: normalize each benchmark source independently (percentile within source) before aggregating', () => {
  const docs = [
    {
      sources: [
        { id: 'artificial-analysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
      ],
      models: [
        { modelId: 'm1', benchmarks: { intelligenceIndex: 10 } },
        { modelId: 'm2', benchmarks: { intelligenceIndex: 20 } },
        { modelId: 'm3', benchmarks: { intelligenceIndex: 30 } },
        { modelId: 'm4', benchmarks: { intelligenceIndex: 40 } },
      ],
    },
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        { modelId: 'm1', benchmarks: { benchlm: 400 } },
        { modelId: 'm2', benchmarks: { benchlm: 300 } },
        { modelId: 'm3', benchmarks: { benchlm: 200 } },
        { modelId: 'm4', benchmarks: { benchlm: 100 } },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs);

  // Normalization method recorded in output
  assert.equal(merged.normalizationMethod, 'percentile');
  assert.deepEqual(merged.normalization, { method: 'percentile' });

  // Each source is normalized independently before aggregating:
  // For intelligenceIndex: m1=25, m2=50, m3=75, m4=100
  // For benchlm: m1=100, m2=75, m3=50, m4=25
  // Aggregating normalized scores gives (25+100)/2 = 62.5 for all four models!
  const m1 = merged.ranking.find((r) => r.canonical === 'm1');
  assert.ok(m1);
  assert.equal(m1.score, 62.5);
  assert.equal(m1.normalizedScore, 62.5);
  // Raw scores preserved on benchmarks and rawScore
  assert.equal(m1.rawScore, 205); // (10 + 400) / 2
  const m1Intel = m1.benchmarks.find((b) => b.name === 'intelligenceIndex');
  assert.equal(m1Intel.score, 10);
  assert.equal(m1Intel.normalizedScore, 25);
  const m1Bench = m1.benchmarks.find((b) => b.name === 'benchlm');
  assert.equal(m1Bench.score, 400);
  assert.equal(m1Bench.normalizedScore, 100);

  // Derive codingTier/reviewTier from the normalized aggregate
  for (const r of merged.ranking) {
    assert.ok(r.codingTier, `model ${r.canonical} must have codingTier`);
    assert.ok(r.reviewTier, `model ${r.canonical} must have reviewTier`);
  }
});

test('Defect 2: custom normalization method (e.g. min-max) from config', () => {
  const customConfig = {
    ...config,
    normalizationMethod: 'min-max',
    normalization: { method: 'min-max' },
  };

  const docs = [
    {
      sources: [{ id: 'bench-a', url: 'https://example.com/a' }],
      models: [
        { modelId: 'model-lo', benchmarks: { scoreA: 10 } },
        { modelId: 'model-hi', benchmarks: { scoreA: 50 } },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs, undefined, { config: customConfig });
  assert.equal(merged.normalizationMethod, 'min-max');
  assert.deepEqual(merged.normalization, { method: 'min-max' });

  const lo = merged.ranking.find((r) => r.canonical === 'model-lo');
  const hi = merged.ranking.find((r) => r.canonical === 'model-hi');

  // min-max: (10 - 10) / 40 * 100 = 0; (50 - 10) / 40 * 100 = 100
  assert.equal(lo.score, 0);
  assert.equal(hi.score, 100);
});

test('New defect: priors refresh replaces and deduplicates benchmarks per source (e.g. benchlm=85.3 and benchlm=84.4 on gpt-6-1-sol)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priors-dedupe-'));
  const file = path.join(dir, 'priors.json');
  const now = Date.parse('2026-10-29T00:00:00Z');

  try {
    // Initial document written with gpt-6-1-sol having benchlm=85.3 (older date) and aaCodingIndex=78.5
    await refreshPriors({
      file,
      now: Date.parse('2026-10-15T00:00:00Z'),
      search: async () => [
        {
          sources: [
            {
              id: 'benchlm',
              url: 'https://benchlm.ai/data/models.json',
              retrievedAt: '2026-10-15T00:00:00Z',
            },
          ],
          models: [
            {
              modelId: 'gpt-6-1-sol',
              benchmarks: {
                benchlm: 85.3,
                aaCodingIndex: 78.5,
              },
              sources: [
                {
                  id: 'benchlm',
                  url: 'https://benchlm.ai/data/models.json',
                  retrievedAt: '2026-10-15T00:00:00Z',
                },
              ],
            },
          ],
        },
      ],
      liveModels: ['gpt-6-1-sol'],
    });

    // Fresh refresh where benchlm updated to 84.4 (newer date), without aaCodingIndex in fresh search
    const refreshed = await refreshPriors({
      file,
      now,
      preserveHistory: true,
      search: async () => [
        {
          sources: [
            {
              id: 'benchlm',
              url: 'https://benchlm.ai/data/models.json',
              retrievedAt: '2026-10-29T00:00:00Z',
            },
          ],
          models: [
            {
              modelId: 'gpt-6-1-sol',
              benchmarks: {
                benchlm: 84.4,
              },
              sources: [
                {
                  id: 'benchlm',
                  url: 'https://benchlm.ai/data/models.json',
                  retrievedAt: '2026-10-29T00:00:00Z',
                },
              ],
            },
          ],
        },
      ],
      liveModels: ['gpt-6-1-sol'],
    });

    const row = refreshed.ranking.find((r) => r.canonical === 'gpt-6-1-sol');
    assert.ok(row, 'gpt-6-1-sol must exist in refreshed ranking');

    // Exactly one benchlm benchmark (latest value 84.4 replaced 85.3, no duplicate second copy)
    const benchlmList = row.benchmarks.filter((b) => b.name === 'benchlm');
    assert.equal(
      benchlmList.length,
      1,
      'must have exactly one benchlm benchmark, not old+new duplicates'
    );
    assert.equal(benchlmList[0].score, 84.4, 'must keep only the latest value for benchlm');
    assert.equal(benchlmList[0].source.retrievedAt, '2026-10-29T00:00:00Z');

    // Historical benchmark for unrefreshed source is preserved
    const codingList = row.benchmarks.filter((b) => b.name === 'aaCodingIndex');
    assert.equal(codingList.length, 1, 'historical benchmark aaCodingIndex must be preserved');
    assert.equal(codingList[0].score, 78.5);

    // Total benchmarks exactly 2
    assert.equal(row.benchmarks.length, 2);

    // Normalization method recorded in refresh output
    assert.equal(refreshed.normalizationMethod, 'percentile');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('New defect: priors refresh preserves newer historical benchmark if incoming search is older', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priors-ts-'));
  const file = path.join(dir, 'priors.json');

  try {
    // Initial document with newer date: 2026-10-20
    await refreshPriors({
      file,
      now: Date.parse('2026-10-20T00:00:00Z'),
      search: async () => [
        {
          sources: [
            {
              id: 'benchlm',
              url: 'https://benchlm.ai/data/models.json',
              retrievedAt: '2026-10-20T00:00:00Z',
            },
          ],
          models: [
            {
              modelId: 'm1',
              benchmarks: { benchlm: 90.0 },
              sources: [
                {
                  id: 'benchlm',
                  url: 'https://benchlm.ai/data/models.json',
                  retrievedAt: '2026-10-20T00:00:00Z',
                },
              ],
            },
          ],
        },
      ],
      liveModels: ['m1'],
    });

    // Refresh with older date: 2026-10-10
    const refreshed = await refreshPriors({
      file,
      now: Date.parse('2026-10-20T00:00:00Z'),
      preserveHistory: true,
      search: async () => [
        {
          sources: [
            {
              id: 'benchlm',
              url: 'https://benchlm.ai/data/models.json',
              retrievedAt: '2026-10-10T00:00:00Z',
            },
          ],
          models: [
            {
              modelId: 'm1',
              benchmarks: { benchlm: 80.0 },
              sources: [
                {
                  id: 'benchlm',
                  url: 'https://benchlm.ai/data/models.json',
                  retrievedAt: '2026-10-10T00:00:00Z',
                },
              ],
            },
          ],
        },
      ],
      liveModels: ['m1'],
    });

    const row = refreshed.ranking.find((r) => r.canonical === 'm1');
    const benchlmList = row.benchmarks.filter((b) => b.name === 'benchlm');
    assert.equal(benchlmList.length, 1);
    assert.equal(benchlmList[0].score, 90.0, 'latest timestamp value must be kept');
    assert.equal(benchlmList[0].source.retrievedAt, '2026-10-20T00:00:00Z');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
