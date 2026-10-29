'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priorFor, matchModelPrior, loadPriors, LIVE_PRIORS_FILE } = require('../priors');

function buildFixture() {
  return {
    label: 'EXTERNAL_PRIOR',
    sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
    ranking: [
      {
        canonical: 'claude-opus-5-5',
        codingTier: 'T1',
        reviewTier: 'T1',
        score: 86.6,
        benchmarks: [
          { name: 'benchlm', score: 86.62 },
          { name: 'aggregate', score: 86.62 },
        ],
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      },
      {
        canonical: 'claude-fable-5-1',
        codingTier: 'T1',
        reviewTier: 'T1',
        score: 76.2,
        benchmarks: [
          { name: 'aaCodingIndex', score: 81.6 },
          { name: 'aaAgenticIndex', score: 58.0 },
        ],
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      },
      {
        canonical: 'gpt-5-6-sol',
        codingTier: 'T1',
        reviewTier: 'T1',
        score: 75.1,
        benchmarks: [
          { name: 'benchlm', score: 75.14 },
          { name: 'aaCodingIndex', score: 77.4 },
          { name: 'aaAgenticIndex', score: 51.2 },
          { name: 'aggregate', score: 75.14 },
        ],
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      },
      {
        canonical: 'claude-opus-4-6',
        codingTier: 'T1',
        reviewTier: 'T1',
        score: 62.4,
        benchmarks: [
          { name: 'benchlm', score: 62.4 },
          { name: 'aggregate', score: 62.4 },
        ],
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      },
      {
        canonical: 'qwen3-8-max',
        codingTier: 'T1',
        reviewTier: 'T1',
        score: 69.9,
        benchmarks: [
          { name: 'benchlm', score: 69.89 },
          { name: 'aggregate', score: 69.89 },
        ],
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      },
      {
        canonical: 'baseline-mid',
        codingTier: 'T3',
        reviewTier: 'T3',
        score: 35.0,
        benchmarks: [
          { name: 'aaCodingIndex', score: 32.0 },
          { name: 'aaAgenticIndex', score: 20.0 },
        ],
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      },
      {
        canonical: 'baseline-low',
        codingTier: 'T4',
        reviewTier: 'T4',
        score: 20.0,
        benchmarks: [
          { name: 'aaCodingIndex', score: 20.0 },
          { name: 'aaAgenticIndex', score: 12.0 },
        ],
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      },
    ],
  };
}

test('writer prior order: claude-opus-5-5 > gpt-5-6-sol > claude-opus-4-6 > qwen3.8-27b', () => {
  const priors = buildFixture();
  const opus55 = priorFor({ modelId: 'claude-opus-5-5' }, 'writer', priors);
  const gpt56 = priorFor({ modelId: 'gpt-5-6-sol' }, 'writer', priors);
  const opus46 = priorFor({ modelId: 'claude-opus-4-6' }, 'writer', priors);
  const qwen27b = priorFor({ modelId: 'qwen3.8-27b' }, 'writer', priors);

  assert.ok(typeof opus55.score === 'number', 'opus 5.5 must resolve a numeric score');
  assert.ok(typeof gpt56.score === 'number', 'gpt-5.6-sol must resolve a numeric score');
  assert.ok(typeof opus46.score === 'number', 'opus 4.6 must resolve a numeric score');

  assert.ok(
    opus55.score > gpt56.score,
    `Opus 5.5 (${opus55.score}) must outrank GPT-5.6-sol (${gpt56.score})`
  );
  assert.ok(
    gpt56.score > opus46.score,
    `GPT-5.6-sol (${gpt56.score}) must outrank Opus 4.6 (${opus46.score})`
  );
  assert.equal(qwen27b.score, null, 'qwen3.8-27b must have null score in this fixture');
  assert.equal(qwen27b.priorUnknown, true, 'qwen3.8-27b must stay priorUnknown');
  assert.ok(
    opus46.score > (qwen27b.score ?? 0),
    `Opus 4.6 (${opus46.score}) must outrank unscored Qwen3.8-27B`
  );
});

test('qwen3.8-27b must NOT get qwen3-8-max score; an ID without same-model benchmark stays priorUnknown', () => {
  const priors = buildFixture();
  const matched = matchModelPrior('qwen3.8-27b', priors.ranking);
  assert.equal(matched, null, 'qwen3.8-27b must not match qwen3-8-max');

  const prior = priorFor({ modelId: 'qwen3.8-27b' }, 'writer', priors);
  assert.equal(prior.score, null);
  assert.equal(prior.priorUnknown, true);
  assert.equal(prior.qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(prior.canonical, 'qwen3-8-27b');

  const unknown = priorFor({ modelId: 'unseen-vendor/unknown-model' }, 'writer', priors);
  assert.equal(unknown.score, null);
  assert.equal(unknown.priorUnknown, true);
  assert.equal(unknown.qualityLabel, 'QUALITY_UNKNOWN');
});

test('reasoning-effort variants still map to base model without matching across tiers', () => {
  const priors = buildFixture();
  const thinking = priorFor({ modelId: 'claude-opus-4-6-thinking' }, 'writer', priors);
  const base = priorFor({ modelId: 'claude-opus-4-6' }, 'writer', priors);

  assert.equal(thinking.score, base.score);
  assert.equal(thinking.matchedVia, 'reasoning-variant');
  assert.equal(thinking.matchedBaseId, 'claude-opus-4-6');
});

test('live priors ranking satisfies Opus 5.5 > GPT-5.6-sol', () => {
  const live = loadPriors(LIVE_PRIORS_FILE);
  if (!live || !Array.isArray(live.ranking) || live.ranking.length === 0) return;

  const opus55 = priorFor({ modelId: 'claude-opus-5-5' }, 'writer', live);
  const gpt56 = priorFor({ modelId: 'gpt-5.6-sol' }, 'writer', live);
  const opus46 = priorFor({ modelId: 'claude-opus-4-6-thinking' }, 'writer', live);

  assert.ok(opus55 && typeof opus55.score === 'number');
  assert.ok(gpt56 && typeof gpt56.score === 'number');
  assert.ok(opus46 && typeof opus46.score === 'number');

  assert.ok(
    opus55.score > gpt56.score,
    `Live: Opus 5.5 (${opus55.score}) must outrank GPT-5.6-sol (${gpt56.score})`
  );
  assert.ok(
    gpt56.score > opus46.score,
    `Live: GPT-5.6-sol (${gpt56.score}) must outrank Opus 4.6 (${opus46.score})`
  );
});
