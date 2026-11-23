'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourcesApi = require('../sources');
const health = require('../route-health');
const probeOrder = require('../probe-order');
const { candidateKey } = require('../candidates');

function makeCandidate(extra = {}) {
  const base = {
    harness: 'opencode-direct',
    accessPath: 'https://test.example/v1',
    gateway: 'test-source',
    upstream: 'test-vendor',
    modelId: 'test-vendor/model-a',
    accountId: 'acct-1',
    quotaScope: 'acct-1',
    capabilities: {},
    ...extra,
  };
  return { ...base, candidateKey: candidateKey(base) };
}

test('PR C (Item 1 & 6): sources.json dispatch configuration provides probe and schema budgets', () => {
  // The tracked configuration is an operator choice; these tests fix the agy-pool
  // writer flags explicitly instead of reading whatever the repo currently sets.
  const loaded = sourcesApi.loadSources();
  const defaultRegistry = {
    ...loaded,
    sources: loaded.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: false, allowWriter: false } : s
    ),
  };
  const config = sourcesApi.getDispatchConfig(defaultRegistry);
  assert.equal(config.probeBudgetMs, 180000);
  assert.equal(config.maxConcurrentProbes, 8);
  assert.equal(config.probeTimeoutMs, 8000);
  assert.equal(config.safetyMarginMs, 2000);
  assert.equal(config.schemaProbeBudgetMs, 180000);

  // Custom configuration overrides defaults
  const customRegistry = {
    ...defaultRegistry,
    dispatch: {
      probeBudgetMs: 45000,
      maxConcurrentProbes: 4,
      probeTimeoutMs: 3000,
      probeSafetyMarginMs: 1500,
      schemaProbeBudgetMs: 50000,
    },
  };
  const customConfig = sourcesApi.getDispatchConfig(customRegistry);
  assert.equal(customConfig.probeBudgetMs, 45000);
  assert.equal(customConfig.maxConcurrentProbes, 4);
  assert.equal(customConfig.probeTimeoutMs, 3000);
  assert.equal(customConfig.safetyMarginMs, 1500);
  assert.equal(customConfig.schemaProbeBudgetMs, 50000);
});

test('PR C (Item 1): per-probe timeout uses elapsedMs + safetyMarginMs when elapsedMs is measured, probeTimeoutMs otherwise', () => {
  const config = {
    probeTimeoutMs: 8000,
    safetyMarginMs: 2000,
  };

  // Route without measured latency: defaults to probeTimeoutMs
  const cNoLatency = makeCandidate();
  const timeoutNoLatency = sourcesApi.resolveProbeTimeout(cNoLatency, null, config, 60000);
  assert.equal(timeoutNoLatency, 8000);

  // Route with measured elapsedMs on record
  const recordWithElapsed = { elapsedMs: 1400 };
  const timeoutWithRecord = sourcesApi.resolveProbeTimeout(
    cNoLatency,
    recordWithElapsed,
    config,
    60000
  );
  assert.equal(timeoutWithRecord, 3400); // 1400 + 2000

  // Route with elapsedMs on candidate itself
  const cWithElapsed = makeCandidate({ elapsedMs: 2100 });
  const timeoutWithCand = sourcesApi.resolveProbeTimeout(cWithElapsed, null, config, 60000);
  assert.equal(timeoutWithCand, 4100); // 2100 + 2000

  // Bounded by remaining time
  const timeoutCapped = sourcesApi.resolveProbeTimeout(cWithElapsed, null, config, 1500);
  assert.equal(timeoutCapped, 1500);
});

test('PR C (Item 2): orderProbeRoutes places route with recent success ahead of higher-ranked route without evidence', () => {
  const now = Date.now();
  const candHighNoEvidence = makeCandidate({
    modelId: 'vendor/high-score-unprobed',
    score: 100,
  });
  const candLowRecentSuccess = makeCandidate({
    modelId: 'vendor/lower-score-proven',
    score: 60,
  });

  const store = { version: 1, paths: {}, events: [] };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-config-'));
  const isolatedHealthFile = path.join(tmpDir, 'model-route-health.json');
  const options = {
    routeHealth: store,
    routeHealthFile: isolatedHealthFile,
    persistRouteHealth: false,
    now,
  };

  try {
    // Record recent successful probe for candLowRecentSuccess
    health.rememberProbe(candLowRecentSuccess, { ok: true, status: 200 }, options);

    // High score candidate comes first in ranking
    const ranked = [candHighNoEvidence, candLowRecentSuccess];

    // orderProbeRoutes must place the proven route ahead of unevidenced route
    const ordered = health.orderProbeRoutes(ranked, options);
    assert.equal(ordered[0].candidateKey, candLowRecentSuccess.candidateKey);
    assert.equal(ordered[1].candidateKey, candHighNoEvidence.candidateKey);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PR C (Item 3): preferKnownGood does not prioritize agy-pool ahead of known-good when writer is disabled', () => {
  const store = { version: 1, paths: {}, events: [] };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-config-'));
  const isolatedHealthFile = path.join(tmpDir, 'model-route-health.json');
  const now = Date.now();
  // The tracked configuration is an operator choice; these tests fix the agy-pool
  // writer flags explicitly instead of reading whatever the repo currently sets.
  const loaded = sourcesApi.loadSources();
  const defaultRegistry = {
    ...loaded,
    sources: loaded.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: false, allowWriter: false } : s
    ),
  };
  const agyCand = makeCandidate({ harness: 'agy-pool', accessPath: 'pool' });
  const liveCand = makeCandidate({ modelId: 'live/model', accessPath: 'live' });

  try {
    health.rememberProbe(
      liveCand,
      { ok: true, status: 200 },
      { routeHealth: store, routeHealthFile: isolatedHealthFile, persistRouteHealth: false, now }
    );

    const resultDisabled = {
      chosen: agyCand.candidateKey,
      ranking: [agyCand, liveCand],
    };
    probeOrder.preferKnownGood(resultDisabled, [agyCand, liveCand], {
      registry: defaultRegistry,
      routeHealth: store,
      routeHealthFile: isolatedHealthFile,
      now,
    });
    // When agy-pool is disabled, liveCand (known good) should win over agy-pool
    assert.equal(resultDisabled.chosen, liveCand.candidateKey);

    // When agy-pool writer is enabled in registry
    const enabledRegistry = {
      ...defaultRegistry,
      sources: defaultRegistry.sources.map((s) =>
        s.id === 'agy-pool' ? { ...s, writerEnabled: true } : s
      ),
    };
    const resultEnabled = {
      chosen: liveCand.candidateKey,
      ranking: [liveCand, agyCand],
    };
    probeOrder.preferKnownGood(resultEnabled, [liveCand, agyCand], {
      registry: enabledRegistry,
      routeHealth: store,
      routeHealthFile: isolatedHealthFile,
      now,
    });
    assert.equal(
      resultEnabled.chosen,
      liveCand.candidateKey,
      'authorization is not measured probe evidence'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PR C (Item 3): orchestrate launcher refuses agy-pool when writer is disabled by configuration', () => {
  // The tracked configuration is an operator choice; these tests fix the agy-pool
  // writer flags explicitly instead of reading whatever the repo currently sets.
  const loaded = sourcesApi.loadSources();
  const defaultRegistry = {
    ...loaded,
    sources: loaded.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: false, allowWriter: false } : s
    ),
  };
  const orchestrate = require('../orchestrate');
  const launcher = orchestrate.resolveLauncher(
    {
      registry: defaultRegistry,
      externalWorkers: 'agy-pool',
    },
    () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
  );
  const result = launcher({
    harness: 'agy-pool',
    provider: 'agy-pool',
    model: 'gemini-model',
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.refusal, /WRITER_LAUNCH_NOT_AUTHORIZED.*disabled by configuration/);
});

test('TASK-AI-142 Finding 8: sources.js does not contain test-only isFixture branches', () => {
  const sourcesCode = fs.readFileSync(path.join(__dirname, '..', 'sources.js'), 'utf8');
  assert.equal(
    sourcesCode.includes('isFixture'),
    false,
    'production code must not contain isFixture check'
  );
  assert.equal(
    sourcesCode.includes('isExplicitFixture'),
    false,
    'production code must not contain isExplicitFixture'
  );

  // Verify hermesOrchestrator is derived strictly from options/dispatch/defaults
  const orchConfig = {
    qualityFloor: 70,
    costCeiling: 1000,
    weightProfile: 'BALANCED',
    complexity: 'standard',
    maxProbes: 3,
    maxRoutesPerAccount: 2,
  };
  const regWithOrch = { dispatch: { hermesOrchestrator: orchConfig } };
  const cfg = sourcesApi.getDispatchConfig(regWithOrch);
  assert.deepEqual(cfg.hermesOrchestrator, orchConfig);
});

test('TASK-AI-142 Finding 14: hermesOrchestrator falls back to defaults when unconfigured, fails closed when missing everywhere', () => {
  const defaults = require('../sources.json').dispatch;

  // 1. Default-only case: no options override, no registry override -> defaults.hermesOrchestrator is preserved
  const defaultCfg = sourcesApi.getDispatchConfig({ dispatch: {} });
  assert.ok(
    defaultCfg.hermesOrchestrator,
    'default hermesOrchestrator configuration must not be discarded'
  );
  assert.deepEqual(defaultCfg.hermesOrchestrator, {
    qualityFloor: Number(defaults.hermesOrchestrator.qualityFloor),
    costCeiling: Number(defaults.hermesOrchestrator.costCeiling),
    weightProfile: defaults.hermesOrchestrator.weightProfile,
    complexity: defaults.hermesOrchestrator.complexity,
    maxProbes: Number(defaults.hermesOrchestrator.maxProbes),
    maxRoutesPerAccount: Number(defaults.hermesOrchestrator.maxRoutesPerAccount),
  });

  // 2. Options override beats dispatch and defaults
  const optionsOrch = {
    qualityFloor: 85,
    costCeiling: 50000,
    weightProfile: 'LATENCY_FIRST',
    complexity: 'standard',
    maxProbes: 4,
    maxRoutesPerAccount: 1,
  };
  const overriddenCfg = sourcesApi.getDispatchConfig(
    { dispatch: { hermesOrchestrator: { ...optionsOrch, qualityFloor: 50 } } },
    { hermesOrchestrator: optionsOrch }
  );
  assert.deepEqual(overriddenCfg.hermesOrchestrator, optionsOrch);

  // 3. Explicitly null in dispatch leaves hermesOrchestrator undefined and fails closed when required
  const nullReg = { dispatch: { hermesOrchestrator: null } };
  const nullCfg = sourcesApi.getDispatchConfig(nullReg);
  assert.equal(nullCfg.hermesOrchestrator, undefined);
  assert.throws(
    () => sourcesApi.getDispatchConfig(nullReg, { requireHermesOrchestrator: true }),
    /CONFIG_MISSING: dispatch\.hermesOrchestrator is required/
  );

  // 4. Missing everywhere (options, dispatch, and defaults omitted) fails closed when required
  const missingEverywhereReg = { dispatch: {} };
  assert.throws(
    () =>
      sourcesApi.getDispatchConfig(missingEverywhereReg, {
        defaults: {},
        requireHermesOrchestrator: true,
      }),
    /CONFIG_MISSING: dispatch\.hermesOrchestrator is required/
  );
});
