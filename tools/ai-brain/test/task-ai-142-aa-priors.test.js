'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { loadPriors, benchmarkScore, priorFor, weightedBenchmarkScore } = require('../priors');
const document = loadPriors(path.join(__dirname, '..', 'data', 'model-priors.json'));
const sourceUrl = 'https://artificialanalysis.ai/leaderboards/models';
const expected = new Map([
  ['claude-opus-5-5', 57.6],
  ['claude-sonnet-5-5', 56.0],
  ['muse-wonder', 55.8],
  ['claude-fable-5-1', 53.4],
  ['gpt-6-astra', 52.7],
  ['gemini-4-argon', 52.6],
  ['gpt-6-1-sol', 51.8],
  ['claude-opus-5', 50.8],
  ['muse-spark-1-3', 48.1],
  ['grok-4-7', 46.4],
  ['qwen3-8-max', 45.4],
]);

test('AA model priors preserve exact rounded indices and per-number provenance', () => {
  for (const [canonical, score] of expected) {
    const row = document.ranking.find((item) => item.canonical === canonical);
    assert.ok(row, `missing ${canonical}`);
    assert.deepEqual(
      row.benchmarks.find((item) => item.name === 'intelligenceIndex'),
      {
        name: 'intelligenceIndex',
        score,
        source: { url: sourceUrl, retrievedAt: '2026-10-13T00:00:00.000Z' },
      }
    );
    assert.equal(benchmarkScore(row), score);
    const prior = priorFor(
      { modelId: canonical },
      'writer',
      document,
      Date.parse('2026-10-13T12:00:00Z')
    );
    assert.ok(Number.isFinite(prior.score));
    assert.ok(prior.sources.some((source) => source.url === sourceUrl));
  }
});

test('planner prior ranks GPT-6 Astra and Claude Opus 5.5 above DeepSeek V4.1 Flash', () => {
  const priorScore = (canonical) =>
    priorFor({ modelId: canonical }, 'planner', document, Date.parse('2026-10-13T12:00:00Z')).score;
  assert.ok(priorScore('gpt-6-astra') > priorScore('deepseek-v4-1-flash'));
  assert.ok(priorScore('claude-opus-5-5') > priorScore('deepseek-v4-1-flash'));
});

test('no benchmark present in origin/main is removed or changed', () => {
  const raw = execFileSync('git', ['show', 'origin/main:tools/ai-brain/data/model-priors.json'], {
    encoding: 'utf8',
  }).replace(/^\uFEFF+/, '');
  const origin = JSON.parse(raw);
  for (const oldRow of origin.ranking) {
    const row = document.ranking.find((item) => item.canonical === oldRow.canonical);
    assert.ok(row, `removed prior model ${oldRow.canonical}`);
    for (const oldBenchmark of oldRow.benchmarks || []) {
      assert.ok(
        row.benchmarks.some(
          (benchmark) => JSON.stringify(benchmark) === JSON.stringify(oldBenchmark)
        ),
        `changed or removed ${oldRow.canonical} ${oldBenchmark.name}`
      );
    }
  }
});

test('missing role benchmarks add zero rather than renormalizing available weights', () => {
  const result = weightedBenchmarkScore(
    { benchmarks: [{ name: 'intelligenceIndex', score: 50 }] },
    { intelligenceIndex: 0.5, aaAgenticIndex: 0.3, aaCodingIndex: 0.2 },
    { intelligenceIndex: 100, aaAgenticIndex: 100, aaCodingIndex: 100 }
  );
  assert.equal(result.score, 25);
  assert.equal(result.coverage, 0.5);
});

test('writer profile weights coding more heavily than intelligence', () => {
  const codingHeavy = weightedBenchmarkScore(
    { benchmarks: [{ name: 'aaCodingIndex', score: 100 }] },
    { aaCodingIndex: 0.6, aaAgenticIndex: 0.25, intelligenceIndex: 0.15 },
    { aaCodingIndex: 100, aaAgenticIndex: 100, intelligenceIndex: 100 }
  );
  const intelligenceHeavy = weightedBenchmarkScore(
    { benchmarks: [{ name: 'intelligenceIndex', score: 100 }] },
    { aaCodingIndex: 0.6, aaAgenticIndex: 0.25, intelligenceIndex: 0.15 },
    { aaCodingIndex: 100, aaAgenticIndex: 100, intelligenceIndex: 100 }
  );
  assert.equal(codingHeavy.score, 60);
  assert.equal(intelligenceHeavy.score, 15);
});

test('prior reports coverage and marks low coverage as INDIRECT', () => {
  const prior = priorFor(
    { modelId: 'partial-evidence' },
    'writer',
    {
      ranking: [
        {
          canonical: 'partial-evidence',
          codingTier: 'T2',
          reviewTier: 'T2',
          benchmarks: [{ name: 'intelligenceIndex', score: 50 }],
          retrievedAt: '2026-10-13T00:00:00Z',
        },
        {
          canonical: 'benchmark-max',
          benchmarks: [{ name: 'intelligenceIndex', score: 100 }],
        },
      ],
    },
    Date.parse('2026-10-13T12:00:00Z')
  );
  assert.equal(prior.score, 8);
  assert.equal(prior.coverage, 0.15);
  assert.equal(prior.evidence, 'INDIRECT');
});

test('AA Agentic Index rows carry the supplied October 12 scores and source', () => {
  const expectedAgentic = new Map([
    ['muse-spark-1-3', 55.7],
    ['glm-5-3', 53.4],
    ['grok-4-6', 53.4],
    ['gpt-6-astra', 51.5],
    ['kimi-k3', 50.6],
    ['gpt-5-6-sol', 50.5],
    ['qwen3-8-max', 49.6],
  ]);
  for (const [canonical, score] of expectedAgentic) {
    const row = document.ranking.find((item) => item.canonical === canonical);
    const benchmark = row.benchmarks.find((item) => item.name === 'aaAgenticIndex');
    assert.equal(benchmark.score, score);
    assert.equal(benchmark.source.url, 'https://benchlm.ai/benchmarks/aaagenticindex');
  }
});
