'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergePriorDocuments, matchModelPrior, priorFor } = require('../priors');
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
