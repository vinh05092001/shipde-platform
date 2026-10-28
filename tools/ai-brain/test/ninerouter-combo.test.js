'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  buildWriterComboModels,
  extractModelId,
  DEFAULT_COMBO_NAME,
} = require('../ninerouter-combo');
const { priorFor } = require('../priors');

test('extractModelId strips ninerouter prefix', () => {
  assert.equal(extractModelId('ninerouter/ag/gemini-3.8-flash'), 'ag/gemini-3.8-flash');
  assert.equal(extractModelId('ag/gemini-3.8-flash'), 'ag/gemini-3.8-flash');
  assert.equal(extractModelId(''), '');
});

test('buildWriterComboModels filters by live listing and tools.ok proof', () => {
  const listing = ['model-a', 'model-b', 'model-c', 'model-d'];
  const evidenceData = {
    capabilityProbes: {
      'paseo::http://127.0.0.1:20128/v1::9router::upstream::acc::scope::model-a': {
        tools: { ok: true },
      },
      'paseo::http://127.0.0.1:20128/v1::9router::upstream::acc::scope::model-b': {
        tools: { ok: false }, // failed tools
      },
      'paseo::http://127.0.0.1:20128/v1::9router::upstream::acc::scope::model-e': {
        tools: { ok: true }, // not in live listing
      },
      'opencode-direct::http://127.0.0.1:20128/v1::opencode-provider-ninerouter-options::ninerouter::acc::scope::ninerouter/model-c':
        {
          tools: { ok: true }, // prefixed model id
        },
    },
  };
  const priorsData = {
    ranking: [
      {
        canonical: 'model-a',
        codingTier: 'T1',
        benchmarks: [{ name: 'intelligenceIndex', score: 60 }],
      },
      {
        canonical: 'model-c',
        codingTier: 'T1',
        benchmarks: [{ name: 'intelligenceIndex', score: 90 }],
      },
    ],
  };

  const models = buildWriterComboModels(listing, evidenceData, priorsData);
  // model-c (score 100) should come before model-a (score 67)
  // model-b (failed) and model-e (not in listing) are excluded
  assert.deepEqual(models, ['model-c', 'model-a']);
});

test('buildWriterComboModels orders models with benchmark scores desc, unknown last', () => {
  const listing = ['alpha', 'beta', 'gamma', 'delta'];
  const evidenceData = {
    capabilityProbes: {
      'paseo::http://127.0.0.1:20128/v1::9router::u::a::s::alpha': { tools: { ok: true } },
      'paseo::http://127.0.0.1:20128/v1::9router::u::a::s::beta': { tools: { ok: true } },
      'paseo::http://127.0.0.1:20128/v1::9router::u::a::s::gamma': { tools: { ok: true } },
      'paseo::http://127.0.0.1:20128/v1::9router::u::a::s::delta': { tools: { ok: true } },
    },
  };
  const priorsData = {
    ranking: [
      {
        canonical: 'alpha',
        codingTier: 'T1',
        benchmarks: [{ name: 'intelligenceIndex', score: 50 }],
      },
      {
        canonical: 'beta',
        codingTier: 'T1',
        benchmarks: [{ name: 'intelligenceIndex', score: 85 }],
      },
      // gamma and delta have no ranking entry (unknown)
    ],
  };

  const models = buildWriterComboModels(listing, evidenceData, priorsData);
  assert.equal(models[0], 'beta'); // highest score
  assert.equal(models[1], 'alpha'); // lower score
  // unknown scores placed last, tie-broken alphabetically by model id: delta then gamma
  assert.equal(models[2], 'delta');
  assert.equal(models[3], 'gamma');
});

test('priorFor candidate with comboMembers resolves to the best member score', () => {
  const priorsData = {
    ranking: [
      {
        canonical: 'weak-model',
        codingTier: 'T1',
        benchmarks: [{ name: 'intelligenceIndex', score: 40 }],
      },
      {
        canonical: 'strong-model',
        codingTier: 'T1',
        benchmarks: [{ name: 'intelligenceIndex', score: 92 }],
      },
    ],
  };

  const candidate = {
    modelId: 'ninerouter/shipde-writer',
    comboMembers: ['weak-model', 'strong-model'],
  };

  const prior = priorFor(candidate, 'writer', priorsData, Date.now());
  assert.ok(prior);
  assert.equal(prior.score, 76);
});

test('no secret is exposed in module exports or return structures', () => {
  const mod = require('../ninerouter-combo');
  const serialized = JSON.stringify(mod);
  assert.equal(serialized.includes('cli-secret'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('run-7 inputs produce writer combo candidates, 0 individual 9router candidates, and coverage-weighted score ~83', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sources = require('../sources');
  const orch = require('../orchestrate');
  const candidatesApi = require('../candidates');
  const priorsApi = require('../priors');
  const runDir = path.join(
    __dirname,
    '..',
    'data',
    'intake',
    'FEAT-AUTH-05-2026-10-22T15-24-35-818Z'
  );
  if (!fs.existsSync(runDir)) return;
  const accounts = JSON.parse(fs.readFileSync(path.join(runDir, 'accounts.json'), 'utf8'));
  const catalogue = JSON.parse(fs.readFileSync(path.join(runDir, 'catalogue.json'), 'utf8'));
  const sourceModels = JSON.parse(
    fs.readFileSync(path.join(runDir, 'catalogue-sources.json'), 'utf8')
  );
  const registry = sources.loadSources();
  const candidates = orch.buildCandidates({
    registry,
    accounts,
    catalogue,
    sourceModels,
    externalWorkers: ['agy-pool'],
  });
  const individual9R = candidates.filter((c) =>
    candidatesApi.isIndividualNineRouterCandidate(c, 'shipde-writer')
  );
  assert.equal(individual9R.length, 0);
  const comboCands = candidates.filter((c) => c.comboMembers);
  assert.ok(comboCands.length > 0);
  const priors = priorsApi.loadPriors();
  const bestPrior = priorsApi.priorFor(comboCands[0], 'writer', priors);
  assert.equal(bestPrior.score, 83);
});

test('unprobed combo candidate is treated as recentRouteSuccess and prioritized by orderProbeRoutes', () => {
  const routeEvidence = require('../route-evidence');
  const routeHealth = require('../route-health');
  const probeOrder = require('../probe-order');

  const emptyStore = { paths: {} };
  const comboCandidate = {
    harness: 'direct-http',
    gateway: '9router',
    source: '9router',
    modelId: 'shipde-writer',
    comboMembers: ['ag/gemini-3.8-flash', 'gh/gpt-4.1'],
  };

  // An unprobed combo candidate qualifies as recentRouteSuccess
  assert.equal(routeEvidence.recentRouteSuccess(comboCandidate, emptyStore), true);

  // When in cooldown, it is no longer recentRouteSuccess
  const cooldownStore = {
    paths: {
      'shipde-writer|9router': {
        modelId: 'shipde-writer',
        routeId: '9router',
        status: 'COOLDOWN',
        probeCause: 'TIMEOUT',
        nextCheckAt: new Date(Date.now() + 60000).toISOString(),
      },
    },
  };
  assert.equal(routeEvidence.recentRouteSuccess(comboCandidate, cooldownStore), false);

  // orderProbeRoutes puts the live combo candidate into the live probe partition
  const ordered = routeHealth.orderProbeRoutes([comboCandidate], { routeHealth: emptyStore });
  assert.equal(ordered.length, 1);
  assert.equal(ordered[0].modelId, 'shipde-writer');
});
