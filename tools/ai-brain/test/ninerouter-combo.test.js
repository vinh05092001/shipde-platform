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
  assert.equal(prior.score, 15);
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
  const runDir = path.join(__dirname, 'fixtures', 'ninerouter-run-7');
  assert.ok(fs.existsSync(runDir), 'run-7 fixture directory must exist in repo');
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
    forWriter: true,
    evidenceDir: runDir,
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

test('generateCandidates preserves individual 9router candidates when nineRouterWriterCombo is absent or null', () => {
  const sources = require('../sources');
  const candidatesApi = require('../candidates');
  const registry = sources.loadSources();
  const regWithoutCombo = JSON.parse(JSON.stringify(registry));
  delete regWithoutCombo.dispatch.nineRouterWriterCombo;

  const mockAccounts = [
    {
      id: '9router',
      source: '9router',
      capabilities: { tools: true },
    },
  ];

  const candsWithout = candidatesApi.generateCandidates({
    registry: regWithoutCombo,
    accounts: mockAccounts,
    catalogue: ['ninerouter/gh/gpt-4o'],
    sourceModels: { '9router': ['ninerouter/gh/gpt-4o'] },
    forWriter: true,
  });

  const individualPreserved = candsWithout.filter((c) =>
    candidatesApi.isIndividualNineRouterCandidate(c, null)
  );
  assert.ok(
    individualPreserved.length > 0,
    'Individual 9router candidates must be preserved when combo is absent'
  );

  // When nineRouterWriterCombo is present, individual candidates are filtered
  const regWithCombo = JSON.parse(JSON.stringify(registry));
  regWithCombo.dispatch.nineRouterWriterCombo = 'shipde-writer';

  const candsWith = candidatesApi.generateCandidates({
    registry: regWithCombo,
    accounts: mockAccounts,
    catalogue: ['ninerouter/gh/gpt-4o'],
    sourceModels: { '9router': ['ninerouter/gh/gpt-4o'] },
    forWriter: true,
  });

  const individualFiltered = candsWith.filter((c) =>
    candidatesApi.isIndividualNineRouterCandidate(c, 'shipde-writer')
  );
  assert.equal(
    individualFiltered.length,
    0,
    'Individual 9router candidates must be filtered when combo is active'
  );
});

test('combo candidate limits are sourced from live source modelMeta or registry config without hardcoded values', () => {
  const candidatesApi = require('../candidates');
  const reg = {
    dispatch: {
      nineRouterWriterCombo: 'shipde-writer',
      nineRouterWriterComboLimits: {
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
    },
    sources: [
      {
        id: '9router',
        kind: 'router',
        endpoint: 'http://127.0.0.1:20128/v1',
        modelMeta: {
          'shipde-writer': { contextWindow: 200000, maxOutputTokens: 16384 },
        },
      },
    ],
  };

  const cands = candidatesApi.generateCandidates({
    registry: reg,
    accounts: [{ id: '9router', source: '9router' }],
    catalogue: ['ninerouter/model-x'],
    forWriter: true,
  });

  const combo = cands.find((c) => c.comboMembers);
  assert.ok(combo, 'Combo candidate must be generated');
  assert.equal(combo.contextWindow, 200000, 'Live source modelMeta should take precedence');
  assert.equal(combo.maxOutputTokens, 16384);

  // When live modelMeta is absent, registry config limits are used
  delete reg.sources[0].modelMeta['shipde-writer'];
  const candsConfig = candidatesApi.generateCandidates({
    registry: reg,
    accounts: [{ id: '9router', source: '9router' }],
    catalogue: ['ninerouter/model-x'],
    forWriter: true,
  });
  const comboConfig = candsConfig.find((c) => c.comboMembers);
  assert.ok(comboConfig);
  assert.equal(comboConfig.contextWindow, 128000, 'Registry config limits should be used');
  assert.equal(comboConfig.maxOutputTokens, 8192);
});
