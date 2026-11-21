'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN_DIR = path.resolve(__dirname, '..');
const priorsRead = require('../priors-read');

test('TASK-AI-193 AC1: priors-read.js scores combo members with zero global catalogue calls and preserves descriptor rules', (t) => {
  const priorsPublic = require('../priors-public');
  const origLiveModelIds = priorsPublic.liveModelIds;
  let globalCalls = 0;
  priorsPublic.liveModelIds = () => {
    globalCalls += 1;
    return [];
  };
  t.after(() => {
    priorsPublic.liveModelIds = origLiveModelIds;
  });

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
      {
        canonical: 'qwen-3.8-max',
        codingTier: 'T2',
        reviewTier: 'T2',
        benchmarks: [{ name: 'aaCodingIndex', score: 75 }],
      },
    ],
  };

  // Unregistered combo prefix (`customgw/`), combined effort+deployment suffix (`-high-fast`), and `:free` + digit alias
  const members = [
    'customgw/model-fast-low',
    'customgw/model-strong-high-fast',
    'customgw/qwen3.8-max:free',
    'customgw/unknown-model',
  ];
  const scored = priorsRead.scoreComboMembers(members, 'writer', { priors: fakePriors });

  assert.equal(globalCalls, 0, 'scoreComboMembers must never call priors-public.liveModelIds()');
  assert.equal(scored.length, 4);
  assert.equal(scored[0].modelId, 'customgw/model-strong-high-fast');
  assert.equal(scored[0].base, 'model-strong');
  assert.equal(scored[0].effort, 'high');
  assert.equal(scored[0].priorUnknown, false);
  assert.equal(scored[1].modelId, 'customgw/qwen3.8-max:free');
  assert.equal(scored[1].priorUnknown, false);
  assert.equal(scored[2].modelId, 'customgw/model-fast-low');
  assert.equal(scored[2].effort, 'low');
  assert.equal(scored[3].modelId, 'customgw/unknown-model');
  assert.equal(scored[3].priorUnknown, true);
  assert.equal(priorsRead.normaliseModelId('9router/model-strong'), 'model-strong');

  // Inherited priors.config.liveModels (empty or unrelated) must not override combo-local liveIds
  for (const inheritedLiveModels of [[], ['othergw/unrelated-1']]) {
    const res = priorsRead.scoreComboMembers(members, 'writer', {
      priors: { ...fakePriors, config: { liveModels: inheritedLiveModels } },
    });
    assert.equal(globalCalls, 0);
    assert.equal(res[0].modelId, 'customgw/model-strong-high-fast');
    assert.equal(res[0].base, 'model-strong');
    assert.equal(res[0].effort, 'high');
    assert.equal(res[0].score, scored[0].score);
    assert.deepEqual(
      res.map((r) => r.modelId),
      scored.map((r) => r.modelId)
    );
  }
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
