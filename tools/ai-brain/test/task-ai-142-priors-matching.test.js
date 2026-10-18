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
