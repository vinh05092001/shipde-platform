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
  splitModelEffort,
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

test('P1.1 regression: effort lookup aggregates normalized scores and keeps tier consistent', () => {
  const docs = [
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        { modelId: 'model-a', benchmarks: { swe: 10 } },
        { modelId: 'model-a-high', benchmarks: { swe: 100 } },
        { modelId: 'model-b', benchmarks: { swe: 50 } },
        { modelId: 'model-b-high', benchmarks: { swe: 200 } },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs);
  // Population scores: swe: 10 (25%), 50 (50%), 100 (75%), 200 (100%)
  // model-a base score is 25 (T4)
  // model-a-high normalized score is 75 (T2)
  const matchHigh = matchModelPrior('model-a-high', merged.ranking);
  assert.ok(matchHigh);
  assert.equal(matchHigh.effort, 'high');
  // Must NOT be the raw score 100
  assert.equal(matchHigh.entry.score, 75, 'effort score must be normalized aggregate');
  assert.equal(matchHigh.entry.normalizedScore, 75);
  // Must NOT inherit the base entry's T4 tier
  assert.equal(matchHigh.entry.codingTier, 'T1');
  assert.equal(matchHigh.entry.reviewTier, 'T1');
});

test('P1.2 regression: deduplication preserves independent sources for the same benchmark metric', () => {
  const docs = [
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [{ modelId: 'model-x', benchmarks: { sweBench: 70 } }],
    },
    {
      sources: [
        { id: 'artificial-analysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
      ],
      models: [{ modelId: 'model-x', benchmarks: { sweBench: 80 } }],
    },
  ];

  const merged = mergePriorDocuments(docs);
  const row = merged.ranking.find((r) => r.canonical === 'model-x');
  assert.ok(row);
  // Both sources must be preserved on model-x benchmarks (deduped by source+name, not name alone)
  assert.equal(row.benchmarks.length, 2, 'independent sources for same metric must not overwrite');
  const benchlm = row.benchmarks.find((b) => b.source && b.source.id === 'benchlm');
  const aa = row.benchmarks.find((b) => b.source && b.source.id === 'artificial-analysis');
  assert.ok(benchlm && aa);
  assert.equal(benchlm.score, 70);
  assert.equal(aa.score, 80);
});

test('P1.3 regression: prefix stripping respects routerPrefixes and excluded vocabulary stays unmatched', () => {
  const docs = [
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        { modelId: 'qwen-3-8', benchmarks: { swe: 80 } },
        { modelId: 'grok-4-7', benchmarks: { swe: 85 } },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs);

  // 1. Unknown router prefix must NOT be stripped (fail closed)
  const unknownMatch = matchModelPrior('unknownrouter/grok-4.7', merged.ranking);
  assert.equal(unknownMatch, null, 'unknown router prefix must stay unmatched');

  // 2. Vocabulary not in configured effortVariants (e.g. 'max') must NOT be stripped as effort
  const maxMatch = matchModelPrior('qwen-3-8-max', merged.ranking);
  assert.equal(maxMatch, null, 'excluded vocabulary max must not match base qwen-3-8');
});

test('P1.4 regression: configured aliases with digitBoundaryHyphen converge to one canonical row', () => {
  const docs = [
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        { modelId: 'Qwen 3.8 Max', benchmarks: { swe: 80 } },
        { modelId: 'qwen3.8-max-high', benchmarks: { swe: 90 } },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs);
  // Both Qwen 3.8 Max and qwen3.8-max-high must merge into one canonical row
  const qwenRows = merged.ranking.filter((r) => r.canonical.includes('qwen'));
  assert.equal(qwenRows.length, 1, 'aliases must converge into exactly one canonical row');
  assert.equal(qwenRows[0].canonical, 'qwen-3-8-max');
  assert.ok(qwenRows[0].efforts && qwenRows[0].efforts.high, 'effort high must be under efforts');
});

test('P1.5 regression: synthetic fallback copies must not enter source percentiles', () => {
  const docs = [
    {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        // Effort-only model: scores 10 on high effort
        { modelId: 'model-effort-only (high)', benchmarks: { swe: 10 } },
        // Base-only model: scores 20
        { modelId: 'model-base-only', benchmarks: { swe: 20 } },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs);
  const m1 = merged.ranking.find((r) => r.canonical === 'model-effort-only');
  const m2 = merged.ranking.find((r) => r.canonical === 'model-base-only');

  // Actual observations are only two: [10, 20].
  // Score 10 percentile must be (1/2)*100 = 50.0, NOT (2/3)*100 = 66.7 from synthetic fallback duplication
  assert.equal(m1.score, 50);
  assert.equal(m2.score, 100);
});

test('P1.6 regression: refresh drops obsolete effort rows superseded by canonical entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priors-obsolete-'));
  const file = path.join(dir, 'priors.json');

  try {
    // Historical priors has obsolete unmerged grok-4-7-high row
    fs.writeFileSync(
      file,
      JSON.stringify({
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
        ranking: [
          {
            canonical: 'grok-4-7-high',
            score: 80,
            sources: [
              {
                id: 'benchlm',
                url: 'https://benchlm.ai/data/models.json',
                retrievedAt: '2026-10-10T00:00:00Z',
              },
            ],
            benchmarks: [
              {
                name: 'swe',
                score: 80,
                source: {
                  id: 'benchlm',
                  url: 'https://benchlm.ai/data/models.json',
                  retrievedAt: '2026-10-10T00:00:00Z',
                },
              },
            ],
          },
        ],
      })
    );

    // Fresh refresh merges grok-4-7 with efforts
    const refreshed = await refreshPriors({
      file,
      preserveHistory: true,
      search: async () => [
        {
          sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
          models: [
            {
              modelId: 'grok-4.7',
              benchmarks: { swe: 85 },
              source: {
                id: 'benchlm',
                url: 'https://benchlm.ai/data/models.json',
                retrievedAt: '2026-10-29T00:00:00Z',
              },
            },
          ],
        },
      ],
      liveModels: ['grok-4-7'],
    });

    // Obsolete effort row grok-4-7-high must NOT survive in refreshed ranking
    const obsoleteRow = refreshed.ranking.find((r) => r.canonical === 'grok-4-7-high');
    assert.equal(obsoleteRow, undefined, 'obsolete effort row grok-4-7-high must not survive');

    const canonicalRow = refreshed.ranking.find((r) => r.canonical === 'grok-4-7');
    assert.ok(canonicalRow, 'canonical row grok-4-7 must exist');
    assert.equal(refreshed.ranking.length, 1, 'ranking must have exactly one row');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P2.7 regression: base fallbacks reflect latest deduplicated effort values, not superseded ones', () => {
  const docs = [
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
          modelId: 'effort-model (high)',
          benchmarks: { swe: 50 },
          source: {
            id: 'benchlm',
            url: 'https://benchlm.ai/data/models.json',
            retrievedAt: '2026-10-10T00:00:00Z',
          },
        },
      ],
    },
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
          modelId: 'effort-model (high)',
          benchmarks: { swe: 80 },
          source: {
            id: 'benchlm',
            url: 'https://benchlm.ai/data/models.json',
            retrievedAt: '2026-10-20T00:00:00Z',
          },
        },
      ],
    },
  ];

  const merged = mergePriorDocuments(docs);
  const row = merged.ranking.find((r) => r.canonical === 'effort-model');
  assert.ok(row);
  assert.equal(row.benchmarks.length, 1);
  assert.equal(row.benchmarks[0].score, 80, 'base fallback must reflect latest deduplicated value');
  assert.equal(row.benchmarks[0].fallback, true);
});

test('P2.9 regression: combined configured deployment and effort suffixes resolve effort identity', () => {
  const { base: b1, effort: e1 } = splitModelEffort('deepseek-high-fast');
  assert.equal(b1, 'deepseek');
  assert.equal(e1, 'high');

  const { base: b2, effort: e2 } = splitModelEffort('deepseek-fast-high');
  assert.equal(b2, 'deepseek');
  assert.equal(e2, 'high');
});
