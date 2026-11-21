'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN_DIR = path.resolve(__dirname, '..');
const priorsRead = require('../priors-read');

test('TASK-AI-193 AC1: priors-read.js scores and sorts combo members using combo-local IDs', () => {
  const fakePriors = {
    ranking: [
      {
        canonical: 'model-strong',
        codingTier: 'T1',
        reviewTier: 'T1',
        benchmarks: [{ name: 'aaCodingIndex', score: 90 }],
      },
      {
        canonical: 'model-fast',
        codingTier: 'T3',
        reviewTier: 'T3',
        benchmarks: [{ name: 'aaCodingIndex', score: 60 }],
      },
    ],
  };
  const scored = priorsRead.scoreComboMembers(
    ['9router/model-fast-low', '9router/model-strong-high', '9router/unknown-model'],
    'writer',
    { priors: fakePriors }
  );
  assert.equal(scored.length, 3);
  assert.equal(scored[0].modelId, '9router/model-strong-high');
  assert.equal(scored[0].effort, 'high');
  assert.equal(scored[0].priorUnknown, false);
  assert.equal(scored[1].modelId, '9router/model-fast-low');
  assert.equal(scored[1].effort, 'low');
  assert.equal(scored[2].modelId, '9router/unknown-model');
  assert.equal(scored[2].priorUnknown, true);
  assert.equal(priorsRead.normaliseModelId('9router/model-strong'), 'model-strong');
});

test('TASK-AI-193 AC2: hermes-session, next-runner, and orchestrate no longer require priors.js or route-health.js', () => {
  const hermes = fs.readFileSync(path.join(BRAIN_DIR, 'hermes-session.js'), 'utf8');
  assert.doesNotMatch(hermes, /require\(\s*['"]\.\/priors['"]\s*\)/);
  assert.match(hermes, /require\(\s*['"]\.\/priors-read['"]\s*\)/);

  const nextRunner = fs.readFileSync(path.join(BRAIN_DIR, 'next-runner.js'), 'utf8');
  assert.doesNotMatch(nextRunner, /require\(\s*['"]\.\/priors['"]\s*\)/);

  const orchestrate = fs.readFileSync(path.join(BRAIN_DIR, 'orchestrate.js'), 'utf8');
  assert.doesNotMatch(orchestrate, /require\(\s*['"]\.\/route-health['"]\s*\)/);
});
