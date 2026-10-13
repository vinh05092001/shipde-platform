'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { loadPriors, benchmarkScore, priorFor } = require('../priors');
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
    assert.deepEqual(row.benchmarks, [
      {
        name: 'intelligenceIndex',
        score,
        source: { url: sourceUrl, retrievedAt: '2026-10-13T00:00:00.000Z' },
      },
    ]);
    assert.equal(benchmarkScore(row), score);
    const prior = priorFor(
      { modelId: canonical },
      'writer',
      document,
      Date.parse('2026-10-13T12:00:00Z')
    );
    assert.equal(prior.score, Math.round(score));
    assert.ok(prior.sources.every((source) => source.url === sourceUrl));
  }
});

test('planner prior ranks GPT-6.1 Sol and Claude Opus 5.5 above DeepSeek V4.1 Flash', () => {
  const priorScore = (canonical) =>
    priorFor({ modelId: canonical }, 'writer', document, Date.parse('2026-10-13T12:00:00Z')).score;
  assert.ok(priorScore('gpt-6-1-sol') > priorScore('deepseek-v4-1-flash'));
  assert.ok(priorScore('claude-opus-5-5') > priorScore('deepseek-v4-1-flash'));
});
