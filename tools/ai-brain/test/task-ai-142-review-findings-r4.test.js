'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const hermesSessionApi = require('../hermes-session');
const quotaScanApi = require('../quota-scan');
const sourcesApi = require('../sources');
const candidatesApi = require('../candidates');
const evidenceApi = require('../evidence');
const harnessApi = require('../harness');
const priorsApi = require('../priors');
const nextRunnerApi = require('../next-runner');

// ---------------------------------------------------------------------------
// 1. P0: buildHermesArgv must NOT add --yolo/--accept-hooks by default
// ---------------------------------------------------------------------------
test('P0: buildHermesArgv does not add --yolo or --accept-hooks for one-shot prompt/query unless explicitly requested', () => {
  const candidate = {
    candidateKey: 'hermes::http://127.0.0.1:20128/v1::9router::ag::acc1::acc1::ag/claude-sonnet-4',
    modelId: 'ag/claude-sonnet-4',
    gateway: '9router',
  };
  const session = { sessionId: 'hermes_test_p0', candidateKey: candidate.candidateKey };

  // 1. Ordinary prompt: must NOT include --yolo or --accept-hooks
  const argvPrompt = hermesSessionApi.buildHermesArgv(candidate, session, {
    prompt: 'explain this code',
  });
  assert.ok(argvPrompt.includes('-q'), 'must include -q flag');
  assert.ok(argvPrompt.includes('explain this code'));
  assert.equal(argvPrompt.includes('--yolo'), false, 'ordinary prompt must NOT include --yolo');
  assert.equal(
    argvPrompt.includes('--accept-hooks'),
    false,
    'ordinary prompt must NOT include --accept-hooks'
  );

  // 2. Ordinary query: must NOT include --yolo or --accept-hooks
  const argvQuery = hermesSessionApi.buildHermesArgv(candidate, session, {
    query: 'run check',
  });
  assert.ok(argvQuery.includes('-q'));
  assert.equal(argvQuery.includes('--yolo'), false, 'ordinary query must NOT include --yolo');
  assert.equal(
    argvQuery.includes('--accept-hooks'),
    false,
    'ordinary query must NOT include --accept-hooks'
  );

  // 3. Explicit opt-in with prompt: adds --yolo and/or --accept-hooks
  const argvYolo = hermesSessionApi.buildHermesArgv(candidate, session, {
    prompt: 'run headless',
    yolo: true,
    acceptHooks: true,
  });
  assert.ok(argvYolo.includes('--yolo'), 'explicit yolo: true must add --yolo');
  assert.ok(
    argvYolo.includes('--accept-hooks'),
    'explicit acceptHooks: true must add --accept-hooks'
  );

  // 4. A goal id selects the goal; it is not consent to skip confirmation or accept hooks
  const argvGoal = hermesSessionApi.buildHermesArgv(candidate, session, {
    goal: 'FEAT-TEST-01',
  });
  assert.equal(argvGoal.includes('--yolo'), false, 'goal alone must not add --yolo');
  assert.equal(
    argvGoal.includes('--accept-hooks'),
    false,
    'goal alone must not add --accept-hooks'
  );

  // 5. Headless opt-in is a separate boolean, not implied by the goal
  const argvGoalHeadless = hermesSessionApi.buildHermesArgv(candidate, session, {
    goal: 'FEAT-TEST-01',
    yolo: true,
    acceptHooks: true,
  });
  assert.ok(argvGoalHeadless.includes('--yolo'), 'yolo: true adds --yolo');
  assert.ok(argvGoalHeadless.includes('--accept-hooks'), 'acceptHooks: true adds --accept-hooks');
});

// ---------------------------------------------------------------------------
// 2. P1: quota-scan source/account blocks must win over a model-level OK row
// ---------------------------------------------------------------------------
test('P1: quota-scan source-level block wins over a model-level OK entry', () => {
  const now = 1700000000000;
  const registry = {
    version: 2,
    sources: [
      {
        id: '9router',
        aliases: ['ninerouter'],
        kind: 'router',
      },
    ],
  };

  // Source 9router has a QUOTA block, but the specific model has OK/COMPLETION
  const quotaState = {
    scopes: {
      '9router': {
        source: '9router',
        code: 'QUOTA',
        status: 429,
        at: new Date(now).toISOString(),
        retryAfter: now + 60000,
      },
      '9router::ag/claude-sonnet-4': {
        source: '9router',
        scope: 'ag/claude-sonnet-4',
        code: 'OK',
        evidence: 'COMPLETION',
        at: new Date(now).toISOString(),
      },
    },
  };

  const candidate = {
    gateway: '9router',
    modelId: 'ag/claude-sonnet-4',
  };

  const scopeState = quotaScanApi.getQuotaScopeState(candidate, quotaState, { now, registry });
  assert.ok(scopeState, 'must resolve scope state');
  assert.equal(scopeState.code, 'QUOTA', 'source-level block must win over model OK row');
  assert.equal(quotaScanApi.isScopeBlocked(scopeState, now), true, 'scope must be blocked');
});

test('P1: quota-scan model-level block stays model-scoped and does not block unblocked models on healthy source', () => {
  const now = 1700000000000;
  const registry = {
    version: 2,
    sources: [{ id: '9router', kind: 'router' }],
  };

  const quotaState = {
    scopes: {
      '9router': {
        source: '9router',
        code: 'OK',
        at: new Date(now).toISOString(),
      },
      '9router::ag/claude-blocked': {
        source: '9router',
        scope: 'ag/claude-blocked',
        code: 'QUOTA',
        status: 429,
        at: new Date(now).toISOString(),
        retryAfter: now + 60000,
      },
      '9router::ag/claude-healthy': {
        source: '9router',
        scope: 'ag/claude-healthy',
        code: 'OK',
        at: new Date(now).toISOString(),
      },
    },
  };

  const blockedCand = { gateway: '9router', modelId: 'ag/claude-blocked' };
  const healthyCand = { gateway: '9router', modelId: 'ag/claude-healthy' };

  const blockedState = quotaScanApi.getQuotaScopeState(blockedCand, quotaState, { now, registry });
  assert.equal(blockedState.code, 'QUOTA');
  assert.equal(quotaScanApi.isScopeBlocked(blockedState, now), true);

  const healthyState = quotaScanApi.getQuotaScopeState(healthyCand, quotaState, { now, registry });
  assert.equal(healthyState.code, 'OK');
  assert.equal(quotaScanApi.isScopeBlocked(healthyState, now), false);
});

// ---------------------------------------------------------------------------
// 3. P1: hermes-session probe ordering probes Controller-ranked route first
// ---------------------------------------------------------------------------
test('P1: hermes-session probes Controller-ranked route first and never drops it due to account caps', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-order-test-'));
  try {
    const candidateRankedWinner = {
      candidateKey:
        'hermes::http://127.0.0.1:20128/v1::9router::ag::acc1::acc1::ag/claude-3-7-sonnet',
      modelId: 'ag/claude-3-7-sonnet',
      gateway: '9router',
      sourceId: '9router',
      accountId: 'acc1',
      endpoint: 'http://127.0.0.1:20128/v1',
    };
    const candidateWithEvidence = {
      candidateKey:
        'hermes::http://127.0.0.1:20128/v1::9router::ag::acc1::acc1::ag/claude-3-5-haiku',
      modelId: 'ag/claude-3-5-haiku',
      gateway: '9router',
      sourceId: '9router',
      accountId: 'acc1',
      endpoint: 'http://127.0.0.1:20128/v1',
      evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const probedOrder = [];
    const registry = {
      version: 2,
      sources: [
        {
          id: '9router',
          kind: 'router',
          endpoint: 'http://127.0.0.1:20128/v1',
          credential: { env: 'NINEROUTER_API_KEY' },
        },
      ],
      dispatch: {
        probeBudgetMs: 5000,
        probeTimeoutMs: 1000,
        hermesOrchestrator: {
          qualityFloor: 60,
          costCeiling: 100000,
          weightProfile: 'QUALITY_FIRST',
          complexity: 'standard',
          maxProbes: 8,
          maxRoutesPerAccount: 1, // Only 1 route per account allowed
        },
      },
    };

    // Controller ranked winner is claude-3-7-sonnet
    const fakeSelection = {
      chosen: candidateRankedWinner.candidateKey,
      candidate: candidateRankedWinner,
      ranking: [candidateRankedWinner, candidateWithEvidence],
      modelRanking: [],
      rejected: [],
    };

    const res = await hermesSessionApi.launchHermesSession(
      {
        rootDir: root,
        dryRun: true,
        probe: true,
        skipDecisionLog: true,
        registry,
      },
      {
        rootDir: root,
        registry,
        selectReasoningCandidate: () => fakeSelection,
        probe: async (candidate) => {
          probedOrder.push(candidate.candidateKey);
          return { ok: true, status: 200, body: 'ok' };
        },
      }
    );

    assert.equal(res.status, 'dry_run');
    assert.ok(probedOrder.length > 0);
    // Controller ranked winner MUST be probed first and NOT dropped by maxRoutesPerAccount: 1
    assert.equal(probedOrder[0], candidateRankedWinner.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. P1: fail-closed on missing/invalid blockedNoRoute limits
// ---------------------------------------------------------------------------
test('P1: sources.js getDispatchConfig throws DISPATCH_CONFIG_INVALID for missing/invalid blockedNoRoute limits', () => {
  const validRegistry = {
    version: 2,
    sources: [],
    dispatch: {
      blockedNoRouteTimeoutMs: 3600000,
      blockedNoRoutePollIntervalMs: 30000,
    },
  };

  // Missing / 0 / non-numeric timeout
  assert.throws(
    () => sourcesApi.getDispatchConfig(validRegistry, { blockedNoRouteTimeoutMs: 0 }),
    /DISPATCH_CONFIG_INVALID: blockedNoRouteTimeoutMs must be a positive integer/
  );
  assert.throws(
    () => sourcesApi.getDispatchConfig(validRegistry, { blockedNoRouteTimeoutMs: 'invalid' }),
    /DISPATCH_CONFIG_INVALID: blockedNoRouteTimeoutMs must be a positive integer/
  );

  // Missing / 0 / non-numeric poll interval
  assert.throws(
    () => sourcesApi.getDispatchConfig(validRegistry, { blockedNoRoutePollIntervalMs: -1 }),
    /DISPATCH_CONFIG_INVALID: blockedNoRoutePollIntervalMs must be a positive integer/
  );
  assert.throws(
    () => sourcesApi.getDispatchConfig(validRegistry, { blockedNoRoutePollIntervalMs: 0 }),
    /DISPATCH_CONFIG_INVALID: blockedNoRoutePollIntervalMs must be a positive integer/
  );
});

test('P1: next-runner.js nextLoop throws DISPATCH_CONFIG_INVALID for invalid blockedNoRoute limits', async () => {
  await assert.rejects(async () => {
    await nextRunnerApi.nextLoop(
      { blockedNoRouteTimeoutMs: 'not-a-number' },
      { dispatchConfig: {} }
    );
  }, /DISPATCH_CONFIG_INVALID: blockedNoRouteTimeoutMs must be a positive integer/);

  await assert.rejects(async () => {
    await nextRunnerApi.nextLoop(
      { blockedNoRouteTimeoutMs: 1000, blockedNoRoutePollIntervalMs: 0 },
      { dispatchConfig: {} }
    );
  }, /DISPATCH_CONFIG_INVALID: blockedNoRoutePollIntervalMs must be a positive integer/);
});

// ---------------------------------------------------------------------------
// 6. P1: annotateCandidates must not load host quota state when quotaState is passed
// ---------------------------------------------------------------------------
test('P1: annotateCandidates loads host quota state unless quotaState is passed or load is disabled', () => {
  let loadQuotaStateCalled = 0;
  const origLoadQuotaState = quotaScanApi.loadQuotaState;
  quotaScanApi.loadQuotaState = () => {
    loadQuotaStateCalled += 1;
    return { scopes: {} };
  };

  const candidates = [
    {
      candidateKey: 'direct-http::http://127.0.0.1::direct::openai::acc1::q1::gpt-4o',
      gateway: 'direct',
      upstream: 'openai',
      accountId: 'acc1',
      modelId: 'gpt-4o',
    },
  ];

  try {
    candidatesApi.annotateCandidates(candidates, {}, { quotaState: null });
    assert.equal(
      loadQuotaStateCalled,
      0,
      'an explicit quotaState, including null, must not load the host file'
    );

    candidatesApi.annotateCandidates(candidates, {}, { loadQuotaState: false });
    assert.equal(loadQuotaStateCalled, 0, 'loadQuotaState: false must not load the host file');

    candidatesApi.annotateCandidates(candidates, {}, {});
    assert.equal(
      loadQuotaStateCalled,
      1,
      'omitting quotaState must keep the production default load'
    );

    candidatesApi.annotateCandidates(candidates, {});
    assert.equal(
      loadQuotaStateCalled,
      2,
      'omitting opts entirely must keep the production default load'
    );
  } finally {
    quotaScanApi.loadQuotaState = origLoadQuotaState;
  }
});

test('P1: isCandidateBlocked loads host quota state when the key is absent and honors an explicit null', () => {
  const now = 1700000000000;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-default-load-'));
  try {
    const quotaFile = path.join(tmpDir, 'quota-state.json');
    fs.writeFileSync(
      quotaFile,
      JSON.stringify({
        scopes: {
          '9router': {
            source: '9router',
            code: 'QUOTA',
            status: 429,
            at: new Date(now).toISOString(),
            retryAfter: now + 60000,
          },
        },
      }),
      'utf8'
    );
    const candidate = { gateway: '9router', modelId: 'ag/claude-sonnet-4' };

    const loaded = evidenceApi.isCandidateBlocked({}, candidate, {
      now,
      quotaStateFile: quotaFile,
    });
    assert.equal(loaded.blocked, true, 'absent quotaState must load and apply the host file');

    const injected = evidenceApi.isCandidateBlocked({}, candidate, {
      now,
      quotaState: null,
      quotaStateFile: quotaFile,
    });
    assert.equal(injected.blocked, false, 'explicit null quotaState must not read the host file');

    const disabled = evidenceApi.isCandidateBlocked({}, candidate, {
      now,
      loadQuotaState: false,
      quotaStateFile: quotaFile,
    });
    assert.equal(disabled.blocked, false, 'loadQuotaState: false must suppress host file load');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P1: getOpenRuns still scans the intake directory when only in-memory register rows are set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-runs-records-'));
  try {
    const intakeDir = path.join(root, 'tools', 'ai-brain', 'data', 'intake');
    const runDir = path.join(intakeDir, 'FEAT-LIVE-01-2026-01-01T00-00-00');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'specs.json'),
      JSON.stringify([{ id: 'FEAT-LIVE-01' }]),
      'utf8'
    );

    // Call without intakeDir in opts or deps: old buggy code returned [] when records was set
    const runs = nextRunnerApi.getOpenRuns(
      { rootDir: root, records: [{ workItemId: 'FEAT-OTHER', stage: 'SELECTED' }] },
      { now: Date.now(), isPidAlive: () => true }
    );
    assert.ok(
      runs.some((run) => run.workItemId === 'FEAT-LIVE-01'),
      'in-memory register rows must not hide a live intake run when intakeDir is omitted'
    );

    const injected = nextRunnerApi.getOpenRuns(
      { rootDir: root, records: [], openRuns: [{ workItemId: 'FEAT-INJECTED' }] },
      { now: Date.now() }
    );
    assert.deepEqual(
      injected.map((run) => run.workItemId),
      ['FEAT-INJECTED'],
      'an injected openRuns list remains the override'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. P1: getSourceAliases does not leak via process-global cache
// ---------------------------------------------------------------------------
test('P1: getSourceAliases does not cache in a process-global registry cache', () => {
  // Call with no registry: returns only self aliases, does not load or cache machine sources
  const aliases1 = sourcesApi.getSourceAliases('custom-isolated-source');
  assert.deepEqual(aliases1, ['custom-isolated-source']);

  // Call with explicit registry: aliases come only from that registry
  const registryA = {
    sources: [{ id: 'src-a', aliases: ['alias-a1', 'alias-a2'] }],
  };
  const aliasesA = sourcesApi.getSourceAliases('src-a', registryA);
  assert.ok(aliasesA.includes('alias-a1'));
  assert.ok(aliasesA.includes('alias-a2'));

  // Subsequent call without registry does NOT see aliases from registryA
  const aliases2 = sourcesApi.getSourceAliases('src-a');
  assert.deepEqual(aliases2, ['src-a'], 'unbound call must not inherit previous registry aliases');
});

// ---------------------------------------------------------------------------
// 8. P1: executableFor does not prepend hardcoded C:\ShipDeWorker\npm
// ---------------------------------------------------------------------------
test('P1: executableFor does not prepend hardcoded C:\\ShipDeWorker\\npm without configuration', () => {
  const searchedDirs = [];
  const fakeFileExists = (p) => {
    if (p === 'C:\\ShipDeWorker\\npm') return true; // Pretend the dir exists on disk
    searchedDirs.push(p);
    return false;
  };

  harnessApi.executableFor('hermes', {
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\system32;C:\\Tools' },
    fileExists: fakeFileExists,
    readFile: () => '',
  });

  const searchedWorker = searchedDirs.some((d) => d.startsWith('C:\\ShipDeWorker\\npm'));
  assert.equal(
    searchedWorker,
    false,
    'executableFor must not prepend hardcoded C:\\ShipDeWorker\\npm without env/config'
  );

  // When explicitly configured via env.SHIPDE_WORKER_NPM or opts.workerNpmPath, it is included
  const configuredDirs = [];
  harnessApi.executableFor('hermes', {
    platform: 'win32',
    env: { PATH: 'C:\\Tools', SHIPDE_WORKER_NPM: 'C:\\ShipDeWorker\\npm' },
    fileExists: (p) => {
      configuredDirs.push(p);
      return false;
    },
    readFile: () => '',
  });
  const foundConfigured = configuredDirs.some((d) => d.startsWith('C:\\ShipDeWorker\\npm'));
  assert.equal(foundConfigured, true, 'configured SHIPDE_WORKER_NPM must be searched');
});

// ---------------------------------------------------------------------------
// 9. P1: launchHermesSession does not retarget ambient OPENAI_BASE_URL
// ---------------------------------------------------------------------------
test('P1: launchHermesSession does not set OPENAI_BASE_URL on child env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-no-env-leak-'));
  try {
    const candidate = {
      candidateKey:
        'hermes::http://127.0.0.1:20128/v1::9router::ag::acc1::acc1::ag/claude-sonnet-4',
      modelId: 'ag/claude-sonnet-4',
      gateway: '9router',
      sourceId: '9router',
      endpoint: 'http://127.0.0.1:20128/v1',
    };

    let capturedChildEnv = null;
    const registry = {
      version: 2,
      sources: [
        {
          id: '9router',
          kind: 'router',
          endpoint: 'http://127.0.0.1:20128/v1',
          credential: { env: 'NINEROUTER_API_KEY' },
        },
      ],
      dispatch: {
        probeBudgetMs: 5000,
        probeTimeoutMs: 1000,
        hermesOrchestrator: {
          qualityFloor: 60,
          costCeiling: 100000,
          weightProfile: 'QUALITY_FIRST',
          complexity: 'standard',
          maxProbes: 8,
          maxRoutesPerAccount: 3,
        },
      },
    };

    await hermesSessionApi.launchHermesSession(
      {
        rootDir: root,
        dryRun: false,
        skipDecisionLog: true,
        registry,
      },
      {
        rootDir: root,
        registry,
        selectReasoningCandidate: () => ({
          chosen: candidate.candidateKey,
          candidate,
          ranking: [candidate],
          modelRanking: [],
          rejected: [],
        }),
        probe: async () => ({ ok: true, status: 200 }),
        resolveHermesCommand: () => ({ command: 'node', args: ['-e', 'process.exit(0)'] }),
        spawn: async (command, args, options) => {
          capturedChildEnv = options.env;
          return { status: 0, exitCode: 0, stdout: '', stderr: '' };
        },
      }
    );

    assert.ok(capturedChildEnv, 'must resolve and execute');
    assert.equal(
      capturedChildEnv.OPENAI_BASE_URL,
      undefined,
      'OPENAI_BASE_URL must not be set on child env'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 10. P1: checkpointData status does not mark unrelated work item as BLOCKED_NO_ROUTE
// ---------------------------------------------------------------------------
test('P1: executeIntakeForItem does not mark item as BLOCKED_NO_ROUTE from unrelated checkpoint status', async () => {
  const item = {
    work_item_id: 'FEAT-WORK-02',
    title: 'Work item 2',
    status: 'IN_PROGRESS',
  };

  const checkpointData = {
    status: 'BLOCKED_NO_ROUTE',
    workItemId: 'FEAT-WORK-01',
    outcomes: [
      {
        workItemId: 'FEAT-WORK-02',
        status: 'FAILED',
        reason: 'Syntax error in code',
        reasonCode: 'SYNTAX_ERROR',
      },
    ],
  };

  const decDir = fs.mkdtempSync(path.join(os.tmpdir(), 'item-checkpoint-dec-'));
  try {
    const res = await nextRunnerApi.executeIntakeForItem(
      item,
      {},
      {
        runIntake: async () => ({
          status: 'failed',
          exitCode: 1,
          checkpoint: checkpointData,
        }),
      },
      { dir: decDir }
    );

    assert.equal(
      res.isBlockedNoRoute,
      false,
      'item must not be marked as isBlockedNoRoute from unrelated checkpoint'
    );
    assert.notEqual(res.outcome, 'blocked_no_route');
    assert.equal(res.outcome, 'failed');
    assert.equal(res.reason, 'Syntax error in code');

    // Also verify when checkpoint status is BLOCKED_NO_ROUTE for a different workItemId and outcomes has no record for this item
    const unrelatedCheckpoint = {
      status: 'BLOCKED_NO_ROUTE',
      workItemId: 'FEAT-WORK-01',
      outcomes: [
        {
          workItemId: 'FEAT-WORK-01',
          status: 'BLOCKED_NO_ROUTE',
          reasonCode: 'BLOCKED_NO_ROUTE',
        },
      ],
    };
    const resUnrelated = await nextRunnerApi.executeIntakeForItem(
      item,
      {},
      {
        runIntake: async () => ({
          status: 'failed',
          exitCode: 1,
          checkpoint: unrelatedCheckpoint,
        }),
      },
      { dir: decDir }
    );
    assert.equal(
      resUnrelated.isBlockedNoRoute,
      false,
      'unrelated checkpoint workItemId must not mark different item as isBlockedNoRoute'
    );
  } finally {
    fs.rmSync(decDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 11. P1: loadEffortVariants only uses configured suffixes, never display names
// ---------------------------------------------------------------------------
test('P1: priors loadEffortVariants does not harvest arbitrary parentheticals from display names', () => {
  // A ranking containing arbitrary parentheticals in row.name
  const fakeRanking = [
    {
      canonical: 'custom-model-preview',
      name: 'Custom Model (preview/experimental)',
      matchedBaseId: 'custom-model',
    },
  ];

  const matched = priorsApi.matchModelPrior('other-model-preview', fakeRanking);
  // 'preview' is not in sources.json effortVariants, so it must NOT match 'other-model'
  assert.equal(
    matched,
    null,
    'model-preview must not strip unconfigured -preview suffix harvested from display names'
  );
});
