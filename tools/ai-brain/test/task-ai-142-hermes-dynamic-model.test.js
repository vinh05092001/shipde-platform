'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  launchHermesSession,
  selectReasoningCandidate,
  buildHermesArgv,
} = require('../hermes-session');
const routing = require('../routing');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'hermes-dyn-model-'));
}

test('TASK-AI-142: orchestrator profile defaults to modest quality floor 60 and QUALITY_FIRST for planner.default', () => {
  let observedProfile;
  let observedAssessment;
  selectReasoningCandidate(
    { skipDecisionLog: true },
    {
      candidates: [],
      priorsData: { ranking: [] },
      rankForProfile: (rows, profile, assessment) => {
        observedProfile = profile;
        observedAssessment = assessment;
        return { ranking: [], rejected: [], chosen: null };
      },
    }
  );

  assert.equal(observedProfile.role, 'planner.default');
  assert.equal(observedProfile.qualityFloor, 60, 'orchestrator quality floor must be 60');
  assert.equal(observedAssessment.weightProfile, 'QUALITY_FIRST');
  assert.deepEqual(observedAssessment.weights, routing.WEIGHT_PROFILES.QUALITY_FIRST);
});

test('TASK-AI-142: launchHermesSession picks Controller route from fixture quota-state + priors, never config default', async () => {
  const tmpDir = makeTempDir();
  try {
    const goalsDir = path.join(tmpDir, 'data', 'goals');
    const goalDir = path.join(goalsDir, 'G-TEST-ORCH');
    fs.mkdirSync(goalDir, { recursive: true });

    const quotaState = {
      scopes: {
        'blocked-gw::expensive-model': {
          source: 'blocked-gw',
          scope: 'blocked-gw::expensive-model',
          code: 'QUOTA',
          reason: 'quota exceeded',
          status: 429,
          at: new Date().toISOString(),
        },
        'live-gw::fast-model': {
          source: 'live-gw',
          scope: 'live-gw::fast-model',
          code: 'OK',
          reason: 'OK',
          status: 200,
          evidence: 'COMPLETION',
          at: new Date().toISOString(),
        },
      },
    };

    const candidateBlocked = {
      harness: 'hermes',
      accessPath: 'https://blocked.example.com/v1',
      gateway: 'blocked-gw',
      upstream: 'expensive-model',
      source: 'blocked-gw',
      sourceId: 'blocked-gw',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'expensive-model',
      contextWindow: 128000,
      cost: 100,
      quality: 95,
      candidateKey:
        'hermes::https://blocked.example.com/v1::blocked-gw::expensive-model::acc-1::acc-1::expensive-model',
    };

    const candidateLive = {
      harness: 'hermes',
      accessPath: 'https://live.example.com/v1',
      gateway: 'live-gw',
      upstream: 'fast-model',
      source: 'live-gw',
      sourceId: 'live-gw',
      accountId: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'fast-model',
      contextWindow: 128000,
      cost: 2,
      quality: 75,
      candidateKey:
        'hermes::https://live.example.com/v1::live-gw::fast-model::acc-2::acc-2::fast-model',
    };

    const registry = {
      version: 2,
      sources: [
        {
          id: 'blocked-gw',
          kind: 'router',
          endpoint: 'https://blocked.example.com/v1',
          credential: { env: 'BLOCKED_GW_API_KEY' },
        },
        {
          id: 'live-gw',
          kind: 'router',
          endpoint: 'https://live.example.com/v1',
          credential: { env: 'LIVE_GW_API_KEY' },
        },
      ],
      dispatch: {
        hermesOrchestrator: {
          qualityFloor: 60,
          costCeiling: 100000,
          weightProfile: 'LATENCY_FIRST',
          complexity: 'standard',
          maxProbes: 8,
          maxRoutesPerAccount: 3,
        },
        maxHermesProbes: 8,
        probeBudgetMs: 5000,
        probeTimeoutMs: 1000,
      },
    };

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      origLog(...args);
    };

    let result;
    try {
      result = await launchHermesSession(
        {
          goal: 'G-TEST-ORCH',
          rootDir: tmpDir,
          goalsDir,
          dryRun: true,
          quotaState,
          registry,
        },
        {
          candidateList: [candidateBlocked, candidateLive],
          registry,
          quotaState,
          rootDir: tmpDir,
          goalsDir,
          probe: async () => ({ ok: true, status: 200 }),
        }
      );
    } finally {
      console.log = origLog;
    }

    assert.equal(result.status, 'dry_run');
    assert.equal(
      result.candidate.modelId,
      'fast-model',
      'must select the live qualified route, not the blocked one'
    );
    assert.notEqual(
      result.candidate.modelId,
      'expensive-model',
      'must not select blocked candidate'
    );
    assert.ok(result.decisionLine, 'must return decisionLine');
    assert.match(result.decisionLine, /\[HERMES_DISPATCH\] model=fast-model/);

    // Verify printed to stdout at launch
    const dispatchLog = logs.find((l) => l.includes('[HERMES_DISPATCH]'));
    assert.ok(dispatchLog, 'must print [HERMES_DISPATCH] line at launch');
    assert.match(dispatchLog, /model=fast-model/);

    // Verify written to goal's run.log
    const runLogPath = path.join(goalDir, 'run.log');
    assert.ok(fs.existsSync(runLogPath), 'goal run.log must exist');
    const runLogContent = fs.readFileSync(runLogPath, 'utf8');
    assert.match(runLogContent, /\[HERMES_DISPATCH\] model=fast-model/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TASK-AI-142: launchHermesSession fails closed when no route qualifies (no fallback to hard-coded model)', async () => {
  const tmpDir = makeTempDir();
  try {
    const quotaState = {
      scopes: {
        'dead-src::model-a': {
          source: 'dead-src',
          scope: 'dead-src::model-a',
          code: 'AUTH',
          reason: 'account auth failed',
          status: 401,
          at: new Date().toISOString(),
        },
      },
    };

    const candidate = {
      harness: 'hermes',
      accessPath: 'https://dead.example.com/v1',
      gateway: 'dead-src',
      upstream: 'model-a',
      source: 'dead-src',
      sourceId: 'dead-src',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'model-a',
      contextWindow: 128000,
      cost: 10,
      quality: 80,
      candidateKey: 'hermes::https://dead.example.com/v1::dead-src::model-a::acc-1::acc-1::model-a',
    };

    const registry = {
      version: 2,
      sources: [
        {
          id: 'dead-src',
          kind: 'router',
          endpoint: 'https://dead.example.com/v1',
          credential: { env: 'DEAD_SRC_KEY' },
        },
      ],
      dispatch: {
        hermesOrchestrator: {
          qualityFloor: 60,
          costCeiling: 100000,
          weightProfile: 'LATENCY_FIRST',
          complexity: 'standard',
          maxProbes: 8,
          maxRoutesPerAccount: 3,
        },
        maxHermesProbes: 8,
        probeBudgetMs: 2000,
      },
    };

    await assert.rejects(
      async () => {
        await launchHermesSession(
          {
            rootDir: tmpDir,
            dryRun: true,
            quotaState,
            registry,
          },
          {
            candidateList: [candidate],
            registry,
            quotaState,
            rootDir: tmpDir,
            probe: async () => ({ ok: false, status: 401 }),
          }
        );
      },
      (err) => {
        assert.equal(err.code, 'NO_REASONING_CANDIDATE');
        assert.match(err.message, /NO_REASONING_CANDIDATE/);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TASK-AI-142: source alias resolution derives aliases dynamically from fixture sources.json without hardcoding', () => {
  const tmpDir = makeTempDir('sources-alias-');
  try {
    const fixtureSourcesPath = path.join(tmpDir, 'sources.json');
    const fixture = {
      version: 2,
      sources: [
        {
          id: 'custom-vendor',
          label: 'Custom Vendor',
          kind: 'model-source',
          aliases: ['vendor-alias-1', 'vendor-alias-2'],
          routerAlias: 'cv',
        },
      ],
      dispatch: {
        hermesOrchestrator: {
          qualityFloor: 60,
          costCeiling: 100000,
          weightProfile: 'LATENCY_FIRST',
          complexity: 'standard',
          maxProbes: 16,
          maxRoutesPerAccount: 3,
        },
      },
    };
    fs.writeFileSync(fixtureSourcesPath, JSON.stringify(fixture, null, 2), 'utf8');

    const sourcesApi = require('../sources');
    const quotaScanApi = require('../quota-scan');
    const registry = sourcesApi.loadSources({ file: fixtureSourcesPath });

    // Test resolving by alias
    const aliasesFromAlias = sourcesApi.getSourceAliases('vendor-alias-1', registry);
    assert.ok(aliasesFromAlias.includes('vendor-alias-1'));
    assert.ok(aliasesFromAlias.includes('custom-vendor'));
    assert.ok(aliasesFromAlias.includes('vendor-alias-2'));
    assert.ok(aliasesFromAlias.includes('cv'));

    // Test resolving by stripped opencode-provider gateway
    const aliasesFromGw = sourcesApi.getSourceAliases(
      'opencode-provider-vendor-alias-2-options',
      registry
    );
    assert.ok(aliasesFromGw.includes('custom-vendor'));
    assert.ok(aliasesFromGw.includes('vendor-alias-1'));

    // Test quotaScope lookup using the alias-derived registry
    const now = 1700000000000;
    const quotaState = {
      scopes: {
        'vendor-alias-1::test-model': {
          source: 'vendor-alias-1',
          scope: 'test-model',
          code: 'QUOTA',
          status: 429,
          at: new Date(now).toISOString(),
          retryAfter: now + 60000,
        },
      },
    };
    const cand = {
      gateway: 'opencode-provider-custom-vendor-options',
      modelId: 'test-model',
    };
    const scopeState = quotaScanApi.getQuotaScopeState(cand, quotaState, { now, registry });
    assert.ok(scopeState, 'Must resolve scope across aliases');
    assert.equal(scopeState.code, 'QUOTA');
    assert.equal(quotaScanApi.isScopeBlocked(scopeState, now), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TASK-AI-142: missing hermesOrchestrator in fixture sources.json fails closed with clear CONFIG_MISSING error', async () => {
  const tmpDir = makeTempDir('hermes-no-orch-');
  try {
    const fixtureSourcesPath = path.join(tmpDir, 'sources.json');
    const fixture = {
      version: 2,
      sources: [
        {
          id: 'mock-gw',
          kind: 'router',
          endpoint: 'https://mock.example.com/v1',
          credential: { env: 'MOCK_KEY' },
        },
      ],
      dispatch: {
        probeBudgetMs: 5000,
        hermesOrchestrator: null,
      },
    };
    fs.writeFileSync(fixtureSourcesPath, JSON.stringify(fixture, null, 2), 'utf8');

    const sourcesApi = require('../sources');
    const registry = sourcesApi.loadSources({ file: fixtureSourcesPath });

    // 1. getDispatchConfig with requireHermesOrchestrator fails closed
    assert.throws(
      () => sourcesApi.getDispatchConfig(registry, { requireHermesOrchestrator: true }),
      /CONFIG_MISSING: dispatch\.hermesOrchestrator is required/
    );

    // 2. selectReasoningCandidate for planner.default fails closed without literal fallback
    assert.throws(
      () =>
        selectReasoningCandidate(
          { role: 'planner.default' },
          { registry, candidates: [], priorsData: { ranking: [] } }
        ),
      /CONFIG_MISSING: dispatch\.hermesOrchestrator is required/
    );

    // 3. launchHermesSession fails closed
    await assert.rejects(async () => {
      await launchHermesSession(
        { rootDir: tmpDir, dryRun: true, registry },
        { registry, candidateList: [], rootDir: tmpDir }
      );
    }, /CONFIG_MISSING: dispatch\.hermesOrchestrator/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
