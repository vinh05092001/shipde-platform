'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPriors, priorFor } = require('../priors');
const { step4ScoreModels } = require('../source-onboarding');

test('priorFor matches <prefix>/gemini-3.8-flash-high to canonical gemini-3-8-flash', () => {
  const priors = loadPriors();
  assert.ok(priors, 'priors document must load');

  const candidateWithPrefix = { modelId: 'custom-prefix/gemini-3.8-flash-high' };
  const prior = priorFor(candidateWithPrefix, 'writer', priors);

  assert.ok(prior, 'prior should be resolved');
  assert.equal(prior.canonical, 'gemini-3-8-flash');
  assert.equal(prior.tier, 'T1');
  assert.equal(typeof prior.score, 'number');
  assert.notEqual(prior.score, null);
  assert.ok(!prior.priorUnknown);
});

test('priorFor matches ag/gemini-3.8-flash to canonical gemini-3-8-flash', () => {
  const priors = loadPriors();
  const candidate = { modelId: 'ag/gemini-3.8-flash' };
  const prior = priorFor(candidate, 'writer', priors);

  assert.ok(prior, 'prior should be resolved');
  assert.equal(prior.canonical, 'gemini-3-8-flash');
  assert.equal(typeof prior.score, 'number');
  assert.notEqual(prior.score, null);
  assert.ok(!prior.priorUnknown);
});

test('step4ScoreModels scores ag/gemini-3.8-flash as SCORED, not QUALITY_UNKNOWN', () => {
  const priors = loadPriors();
  const probedResults = [
    {
      modelId: 'ag/gemini-3.8-flash',
      ok: true,
      status: 200,
      body: { model: 'gemini-3.8-flash' },
    },
    {
      modelId: 'some-prefix/gemini-3.8-flash-high',
      ok: true,
      status: 200,
      body: { model: 'gemini-3.8-flash' },
    },
  ];

  const scored = step4ScoreModels(probedResults, priors);
  assert.equal(scored.length, 2);

  const agFlash = scored.find((s) => s.modelId === 'ag/gemini-3.8-flash');
  assert.ok(agFlash);
  assert.equal(agFlash.status, 'SCORED');
  assert.equal(agFlash.canonical, 'gemini-3-8-flash');
  assert.equal(typeof agFlash.score, 'number');
  assert.equal(agFlash.priorUnknown, false);

  const prefixed = scored.find((s) => s.modelId === 'some-prefix/gemini-3.8-flash-high');
  assert.ok(prefixed);
  assert.equal(prefixed.status, 'SCORED');
  assert.equal(prefixed.canonical, 'gemini-3-8-flash');
  assert.equal(typeof prefixed.score, 'number');
  assert.equal(prefixed.priorUnknown, false);
});

test('a model ending in -max that exists in priors keeps its own prior', () => {
  const priors = loadPriors();
  const candidate = { modelId: 'qwen3-8-max' };
  const prior = priorFor(candidate, 'writer', priors);

  assert.ok(prior, 'prior should be resolved');
  assert.equal(prior.canonical, 'qwen3-8-max');
  assert.equal(prior.tier, 'T2');
  assert.equal(typeof prior.score, 'number');
  assert.ok(!prior.priorUnknown);
  assert.equal(prior.matchedVia, undefined, 'exact match must not strip suffix');

  // Collision prevention: when base model and -max model both exist, -max keeps its own prior
  const customPriors = {
    ranking: [
      {
        canonical: 'model-a-max',
        codingTier: 'T1',
        benchmarks: { aaCodingIndex: 90 },
        sources: [{ retrievedAt: new Date().toISOString() }],
      },
      {
        canonical: 'model-a',
        codingTier: 'T3',
        benchmarks: { aaCodingIndex: 50 },
        sources: [{ retrievedAt: new Date().toISOString() }],
      },
    ],
  };
  const maxPrior = priorFor({ modelId: 'provider/model-a-max' }, 'writer', customPriors);
  assert.ok(maxPrior);
  assert.equal(maxPrior.canonical, 'model-a-max');
  assert.equal(maxPrior.tier, 'T1');
  assert.equal(maxPrior.matchedVia, undefined, 'must keep own prior and never strip to model-a');
});

test('unknown-model-high with no base stays unknown', () => {
  const priors = loadPriors();
  const candidate = { modelId: 'unknown-model-high' };
  const prior = priorFor(candidate, 'writer', priors);

  assert.ok(prior, 'unknown candidate must return neutral prior object');
  assert.equal(prior.canonical, 'unknown-model-high');
  assert.equal(prior.score, null);
  assert.equal(prior.priorUnknown, true);
  assert.equal(prior.qualityLabel, 'QUALITY_UNKNOWN');
});
