'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('TASK-AI-142 T3: sweep-import classifies HTTP errors into exact status codes', () => {
  const sweepImport = require('../sweep-import');

  // 401 → AUTH
  assert.equal(
    sweepImport.classifySweepRow({ status: 'HTTP_401', err: 'Unauthorized: invalid token' }).code,
    'AUTH'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_503',
      err: '[cline/openai/gpt-6-astra] [401]: {"error":"Unauthorized"}',
    }).code,
    'AUTH'
  );

  // 402 → QUOTA
  assert.equal(
    sweepImport.classifySweepRow({ status: 'HTTP_402', err: 'Payment required' }).code,
    'QUOTA'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_403',
      err: 'Your account balance is insufficient. Please recharge your account to continue using the API',
    }).code,
    'QUOTA'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_503',
      err: '[opencode-zen/muse-spark-1.3] [402]: {"error":{"type":"server_error","message":"Upstream request failed"}}',
    }).code,
    'QUOTA'
  );

  // 403 tier → TIER
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_403',
      err: 'openai/gpt-6-astra is currently available on the Ultra and Power plans, or with pay-as-you',
    }).code,
    'TIER'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_403',
      err: 'Access restricted. Deposit required to unlock premium models.',
    }).code,
    'TIER'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_403',
      err: 'Forbidden: model disabled for current subscription',
    }).code,
    'TIER'
  );

  // 429 → RATE
  assert.equal(
    sweepImport.classifySweepRow({ status: 'HTTP_429', err: 'Rate limit exceeded' }).code,
    'RATE'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_503',
      err: '[cline/openai/gpt-4] [429]: Rate limit reached',
    }).code,
    'RATE'
  );

  // 451 → REGION
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_451',
      err: 'Unavailable For Legal Reasons: Geo blocked',
    }).code,
    'REGION'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_403',
      err: 'Service not available in your region/country',
    }).code,
    'REGION'
  );

  // 503 không có kênh → NO_CHANNEL
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_503',
      err: '[tokenrouter/deepseek/deepseek-v4-flash] [503]: {"error":{"code":"model_not_found","message":"no channel available"}}',
    }).code,
    'NO_CHANNEL'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_503',
      err: 'No healthy upstream channel found for model',
    }).code,
    'NO_CHANNEL'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_503',
      err: 'A server error occurred. Please try again.',
    }).code,
    'HTTP_503'
  );

  // TOOLS_OK → passed
  const passed = sweepImport.classifySweepRow({ status: 'TOOLS_OK', ms: 350 });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.code, 'OK');
});

test('TASK-AI-142 T3: importSweep writes capability combinations matching probe-order expectation', () => {
  const sweepImport = require('../sweep-import');
  const routeEvidence = require('../route-evidence');
  const probeOrder = require('../probe-order');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-import-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const sweepData = {
    at: '2026-10-19T04:17:00.000Z',
    rows: [
      {
        source: 'aihubmix',
        model: 'qwen3.8-max',
        status: 'HTTP_403',
        err: 'Your account balance is insufficient. Please recharge your account',
        ms: 400,
      },
      {
        source: 'cerebras',
        model: 'llama-3.3-70b',
        status: 'HTTP_401',
        err: 'Invalid api key',
        ms: 120,
      },
      {
        source: '9router',
        model: 'ocz/muse-spark-1.3',
        status: 'HTTP_503',
        err: '[opencode-zen/muse-spark-1.3] [402]: Upstream request failed',
        ms: 500,
      },
      {
        source: '9router',
        model: 'ag/good-model',
        status: 'TOOLS_OK',
        ms: 250,
      },
    ],
  };

  const result = sweepImport.importSweep(sweepData, {
    evidenceDir,
    registry: {
      sources: [
        {
          id: 'aihubmix',
          kind: 'model-source',
          endpoint: 'https://aihubmix.com/v1',
          harness: 'opencode-direct',
          accounts: ['acc-aihubmix'],
          credential: { env: 'AIHUBMIX_KEY' },
        },
        {
          id: 'cerebras',
          kind: 'model-source',
          endpoint: 'https://api.cerebras.ai/v1',
          harness: 'opencode-direct',
          accounts: ['acc-cerebras'],
          credential: { env: 'CEREBRAS_KEY' },
        },
        {
          id: '9router',
          kind: 'router',
          endpoint: 'http://127.0.0.1:20128/v1',
          harness: 'paseo',
          modelPrefix: 'ninerouter/',
        },
        // Upstreams reached through 9router: the registry names the account each alias uses.
        { id: 'ag-up', kind: 'model-source', reachedVia: '9router', routerAlias: 'ag' },
        { id: 'ocz-up', kind: 'model-source', reachedVia: '9router', routerAlias: 'ocz' },
      ],
    },
  });

  assert.equal(result.imported, 4);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 3);
  assert.equal(result.breakdown.QUOTA, 2);
  assert.equal(result.breakdown.AUTH, 1);

  // Combinations match structure expected by route-evidence and probe-order
  const combinations = result.evidenceData.combinations;
  assert.ok(Array.isArray(combinations));

  const passedCombo = combinations.find(
    (c) => c.model === 'ag/good-model' || c.modelId === 'ag/good-model'
  );
  assert.ok(passedCombo, 'ag/good-model must be recorded in combinations');
  assert.equal(passedCombo.evidence[0].status, 'passed');
  assert.equal(passedCombo.evidence[0].proofLevel, 'API_PASS');

  // Verify recentRouteSuccess sees the passing route
  const candPassed = {
    ...passedCombo,
    candidateKey: passedCombo.candidateKey,
    modelId: passedCombo.modelId,
  };
  assert.equal(
    routeEvidence.recentRouteSuccess(
      candPassed,
      { paths: {} },
      { evidenceData: result.evidenceData, now: Date.parse(sweepData.at) }
    ),
    true,
    'TOOLS_OK evidence must register as recent route success'
  );

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 T3: dispatch --dry-run excludes exhausted or blocked sources with exact reason codes', async () => {
  const sweepImport = require('../sweep-import');
  const cli = require('../cli');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-dryrun-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const sweepFile = path.join(tmpDir, 'sweep.json');
  const sweepData = {
    at: '2026-10-19T04:17:00.000Z',
    rows: [
      {
        source: 'aihubmix',
        model: 'qwen3.8-max',
        status: 'HTTP_403',
        err: 'Your account balance is insufficient. Please recharge your account',
      },
      {
        source: 'cerebras',
        model: 'llama-3.3-70b',
        status: 'HTTP_401',
        err: 'Unauthorized API key',
      },
      {
        source: 'thegrid',
        model: 'grid-pro',
        status: 'HTTP_403',
        err: 'Access restricted. Deposit required to unlock premium models.',
      },
      {
        source: 'fastapi',
        model: 'fast-429',
        status: 'HTTP_429',
        err: 'Rate limit exceeded',
      },
      {
        source: 'geoapi',
        model: 'geo-451',
        status: 'HTTP_451',
        err: 'Unavailable in region',
      },
      {
        source: '9router',
        model: 'ocz/no-channel-model',
        status: 'HTTP_503',
        err: 'no channel available for this model',
      },
    ],
  };
  fs.writeFileSync(sweepFile, JSON.stringify(sweepData, null, 2), 'utf8');

  // Import sweep into isolated evidenceDir

  // Set up mock candidates and registry for dispatch --dry-run
  const candidates = [
    {
      candidateKey:
        'opencode-direct::https://aihubmix.com/v1::aihubmix::aihubmix::source-aihubmix::source-aihubmix::aihubmix/qwen3.8-max',
      harness: 'opencode-direct',
      accessPath: 'https://aihubmix.com/v1',
      gateway: 'aihubmix',
      upstream: 'aihubmix',
      accountId: 'source-aihubmix',
      quotaScope: 'source-aihubmix',
      modelId: 'aihubmix/qwen3.8-max',
      source: 'aihubmix',
    },
    {
      candidateKey:
        'direct-http::https://api.cerebras.ai/v1::cerebras::cerebras::source-cerebras::source-cerebras::llama-3.3-70b',
      harness: 'direct-http',
      accessPath: 'https://api.cerebras.ai/v1',
      gateway: 'cerebras',
      upstream: 'cerebras',
      accountId: 'source-cerebras',
      quotaScope: 'source-cerebras',
      modelId: 'llama-3.3-70b',
      source: 'cerebras',
    },
    {
      candidateKey:
        'direct-http::https://thegrid.ai/v1::thegrid::thegrid::source-thegrid::source-thegrid::grid-pro',
      harness: 'direct-http',
      accessPath: 'https://thegrid.ai/v1',
      gateway: 'thegrid',
      upstream: 'thegrid',
      accountId: 'source-thegrid',
      quotaScope: 'source-thegrid',
      modelId: 'grid-pro',
      source: 'thegrid',
    },
    {
      candidateKey:
        'direct-http::https://fastapi.com/v1::fastapi::fastapi::source-fastapi::source-fastapi::fast-429',
      harness: 'direct-http',
      accessPath: 'https://fastapi.com/v1',
      gateway: 'fastapi',
      upstream: 'fastapi',
      accountId: 'source-fastapi',
      quotaScope: 'source-fastapi',
      modelId: 'fast-429',
      source: 'fastapi',
    },
    {
      candidateKey:
        'direct-http::https://geoapi.com/v1::geoapi::geoapi::source-geoapi::source-geoapi::geo-451',
      harness: 'direct-http',
      accessPath: 'https://geoapi.com/v1',
      gateway: 'geoapi',
      upstream: 'geoapi',
      accountId: 'source-geoapi',
      quotaScope: 'source-geoapi',
      modelId: 'geo-451',
      source: 'geoapi',
    },
    {
      candidateKey:
        'paseo::http://127.0.0.1:20128/v1::9router::ocz::xkiro::ocz::ocz/no-channel-model',
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'ocz',
      accountId: 'xkiro',
      quotaScope: 'ocz',
      modelId: 'ocz/no-channel-model',
      source: '9router',
    },
  ];
  sweepImport.runSweepImport(sweepFile, { evidenceDir, candidates });

  const item = {
    workItemId: 'TASK-AI-142',
    role: 'writer',
    requiredCapabilities: [],
  };

  const dispatchResult = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates,
      items: [item],
      evidenceDir,
      now: Date.parse(sweepData.at) + 1000,
      log: () => {},
      exit: () => {},
    }
  );

  const rejected = dispatchResult.decision.rejected || [];
  const findRej = (keyFragment) =>
    rejected.find((r) => (r.offeringId || r.candidateKey || '').includes(keyFragment));

  const rejAihub = findRej('aihubmix');
  assert.ok(rejAihub, 'aihubmix must be rejected');
  assert.equal(rejAihub.reason, 'QUOTA');

  const rejCerebras = findRej('cerebras');
  assert.ok(rejCerebras, 'cerebras must be rejected');
  assert.equal(rejCerebras.reason, 'AUTH');

  const rejThegrid = findRej('thegrid');
  assert.ok(rejThegrid, 'thegrid must be rejected');
  assert.equal(rejThegrid.reason, 'TIER');

  const rejFast = findRej('fastapi');
  assert.ok(rejFast, 'fastapi must be rejected');
  assert.equal(rejFast.reason, 'RATE');

  const rejGeo = findRej('geoapi');
  assert.ok(rejGeo, 'geoapi must be rejected');
  assert.equal(rejGeo.reason, 'REGION');

  const rej9router = findRej('no-channel-model');
  assert.ok(rej9router, 'no-channel model must be rejected');
  assert.equal(rej9router.reason, 'NO_CHANNEL');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 T3: cli.js sweep-import executes and requires file argument', () => {
  const cli = require('../cli');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-cli-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const sweepFile = path.join(tmpDir, 'sweep.json');
  fs.writeFileSync(
    sweepFile,
    JSON.stringify({
      at: '2026-10-19T04:17:00.000Z',
      rows: [
        { source: 'aihubmix', model: 'qwen3.8-max', status: 'HTTP_402', err: 'Quota exceeded' },
      ],
    }),
    'utf8'
  );

  // Missing file flag
  let loggedError = '';
  const origError = console.error;
  console.error = (msg) => {
    loggedError = msg;
  };
  try {
    cli.main(['sweep-import']);
    assert.equal(loggedError, 'SWEEP_IMPORT_FILE_REQUIRED');
    assert.equal(process.exitCode, 2);
  } finally {
    console.error = origError;
    process.exitCode = 0;
  }

  // Valid run
  const res = cli.main(['sweep-import', sweepFile, '--evidence-dir', evidenceDir]);
  assert.equal(res.imported, 1);
  assert.equal(res.failed, 1);
  assert.equal(res.breakdown.QUOTA, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142: account-scoped failures remain scoped to affected route and do not create model-wide cooldown', () => {
  const sweepImport = require('../sweep-import');
  const cli = require('../cli');
  const sourcesApi = require('../sources');
  const { candidateKey } = require('../discovery/identity');

  const registry = sourcesApi.loadSources();
  const sourceWithModels =
    registry.sources.find((s) => Array.isArray(s.models) && s.models.length > 0) ||
    registry.sources.find((s) => s.model);
  const testModel = sourceWithModels.models ? sourceWithModels.models[0] : sourceWithModels.model;
  const testSourceA = registry.sources.find((s) => s.kind === 'model-source' && !s.reachedVia);
  const testSourceB = registry.sources.find(
    (s) => s.kind === 'model-source' && !s.reachedVia && s.id !== testSourceA.id
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-scope-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const nowAt = '2026-10-19T05:00:00.000Z';
  const sweepFile = path.join(tmpDir, 'sweep-auth.json');
  fs.writeFileSync(
    sweepFile,
    JSON.stringify({
      at: nowAt,
      rows: [
        {
          source: testSourceA.id,
          model: testModel,
          account: `source-${testSourceA.id}`,
          status: 'HTTP_401',
          err: 'Unauthorized API key',
        },
      ],
    }),
    'utf8'
  );

  // 3. Verify through dispatch
  const candA = {
    harness: testSourceA.harness || 'direct-http',
    accessPath: testSourceA.endpoint || testSourceA.accessPath || 'direct',
    gateway: testSourceA.id,
    upstream: testSourceA.id,
    accountId: `source-${testSourceA.id}`,
    quotaScope: `source-${testSourceA.id}`,
    modelId: testModel,
    source: testSourceA.id,
  };
  candA.candidateKey = candidateKey(candA);

  const candABackup = {
    harness: testSourceA.harness || 'direct-http',
    accessPath: testSourceA.endpoint || testSourceA.accessPath || 'direct',
    gateway: testSourceA.id,
    upstream: testSourceA.id,
    accountId: `backup-${testSourceA.id}`,
    quotaScope: `source-${testSourceA.id}`,
    modelId: testModel,
    source: testSourceA.id,
  };
  candABackup.candidateKey = candidateKey(candABackup);

  const candB = {
    harness: testSourceB.harness || 'direct-http',
    accessPath: testSourceB.endpoint || testSourceB.accessPath || 'direct',
    gateway: testSourceB.id,
    upstream: testSourceB.id,
    accountId: `source-${testSourceB.id}`,
    quotaScope: `source-${testSourceB.id}`,
    modelId: testModel,
    source: testSourceB.id,
  };
  candB.candidateKey = candidateKey(candB);

  const res = sweepImport.runSweepImport(sweepFile, {
    evidenceDir,
    registry,
    candidates: [candA, candABackup, candB],
  });
  assert.equal(res.failed, 1);

  // 1. Must NOT create global model-wide cooldown
  assert.equal(
    res.evidenceData.cooldowns[`model::::${testModel}`],
    undefined,
    'account-scoped failure must not create global model:::: cooldown'
  );

  // 2. Must NOT create model cooldown on unrelated source B
  assert.equal(
    res.evidenceData.cooldowns[`model::${testSourceB.id}::${testModel}`],
    undefined,
    'account-scoped failure must not create model cooldown on unrelated source'
  );

  const item = {
    workItemId: 'TASK-AI-142',
    role: 'writer',
    requiredCapabilities: [],
  };

  const dispatchResult = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [candA, candABackup, candB],
      items: [item],
      evidenceDir,
      now: Date.parse(nowAt) + 1000,
      log: () => {},
      exit: () => {},
    }
  );

  const rejected = dispatchResult.decision.rejected || [];
  const findRej = (candKey) => rejected.find((r) => (r.offeringId || r.candidateKey) === candKey);

  assert.ok(findRej(candA.candidateKey), 'Affected route candA must be rejected');
  assert.equal(findRej(candA.candidateKey).reason, 'AUTH');
  assert.equal(
    findRej(candABackup.candidateKey),
    undefined,
    'Different account candABackup must not be rejected'
  );
  assert.equal(
    findRej(candB.candidateKey),
    undefined,
    'Unrelated source candB must not be rejected'
  );

  // 4. Single NO_TOOL_CALL probe remains route-scoped and does NOT block unrelated providers
  const sweepRouteScope = path.join(tmpDir, 'sweep-routescope.json');
  fs.writeFileSync(
    sweepRouteScope,
    JSON.stringify({
      at: '2026-10-19T05:05:00.000Z',
      rows: [
        {
          source: testSourceA.id,
          model: testModel,
          status: 'NO_TOOL_CALL',
          err: 'Model does not support tool calling',
        },
      ],
    }),
    'utf8'
  );
  const routeRes = sweepImport.runSweepImport(sweepRouteScope, {
    evidenceDir,
    registry,
    candidates: [candA, candB],
  });
  assert.equal(
    routeRes.evidenceData.cooldowns[`model::::${testModel}`],
    undefined,
    'Single route NO_TOOL_CALL must not create global model:::: cooldown'
  );

  const dispatchRoute = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [candA, candB],
      items: [item],
      evidenceDir,
      now: Date.parse('2026-10-19T05:05:00.000Z') + 1000,
      log: () => {},
      exit: () => {},
    }
  );
  const rejRoute = dispatchRoute.decision.rejected || [];
  assert.equal(
    rejRoute.find((r) => (r.offeringId || r.candidateKey) === candB.candidateKey),
    undefined,
    'Unrelated provider candB must not be excluded by single route NO_TOOL_CALL'
  );

  // 5. In contrast, when sweep explicitly establishes a genuinely global condition (scope: model), global cooldown applies
  const sweepModelWide = path.join(tmpDir, 'sweep-modelwide.json');
  fs.writeFileSync(
    sweepModelWide,
    JSON.stringify({
      at: '2026-10-19T05:10:00.000Z',
      rows: [
        {
          source: testSourceA.id,
          model: testModel,
          status: 'NO_TOOL_CALL',
          scope: 'model',
          err: 'Model does not support tool calling globally',
        },
      ],
    }),
    'utf8'
  );
  const mwRes = sweepImport.runSweepImport(sweepModelWide, {
    evidenceDir,
    registry,
    candidates: [candA, candB],
  });
  assert.ok(
    mwRes.evidenceData.cooldowns[`model::::${testModel}`],
    'Model-wide failure must create global model:::: cooldown'
  );

  const dispatchMw = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [candA, candB],
      items: [item],
      evidenceDir,
      now: Date.parse('2026-10-19T05:10:00.000Z') + 1000,
      log: () => {},
      exit: () => {},
    }
  );
  const rejMw = dispatchMw.decision.rejected || [];
  assert.ok(
    rejMw.some((r) => (r.offeringId || r.candidateKey) === candB.candidateKey),
    'Model-wide condition must exclude model on all providers'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142: importing passing probe reconciles and clears earlier failure cooldown through dispatch', () => {
  const sweepImport = require('../sweep-import');
  const cli = require('../cli');
  const sourcesApi = require('../sources');
  const { candidateKey } = require('../discovery/identity');

  const registry = sourcesApi.loadSources();
  const sourceWithModels =
    registry.sources.find((s) => Array.isArray(s.models) && s.models.length > 0) ||
    registry.sources.find((s) => s.model);
  const testModel = sourceWithModels.models ? sourceWithModels.models[0] : sourceWithModels.model;
  const testSource = registry.sources.find((s) => s.kind === 'model-source' && !s.reachedVia);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-reconcile-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const cand = {
    harness: testSource.harness || 'direct-http',
    accessPath: testSource.endpoint || testSource.accessPath || 'direct',
    gateway: testSource.id,
    upstream: testSource.id,
    accountId: `source-${testSource.id}`,
    quotaScope: `source-${testSource.id}`,
    modelId: testModel,
    source: testSource.id,
  };
  cand.candidateKey = candidateKey(cand);

  const item = {
    workItemId: 'TASK-AI-142',
    role: 'writer',
    requiredCapabilities: [],
  };

  // Step 1: Probe failure at T1 records cooldown and excludes candidate in dispatch
  const t1 = '2026-10-19T01:00:00.000Z';
  const failSweep = path.join(tmpDir, 'sweep-fail.json');
  fs.writeFileSync(
    failSweep,
    JSON.stringify({
      at: t1,
      rows: [
        {
          source: testSource.id,
          model: testModel,
          status: 'HTTP_402',
          err: 'Payment required: account balance insufficient',
        },
      ],
    }),
    'utf8'
  );

  sweepImport.runSweepImport(failSweep, { evidenceDir, registry, candidates: [cand] });

  const dispatch1 = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [cand],
      items: [item],
      evidenceDir,
      now: Date.parse(t1) + 1000,
      log: () => {},
      exit: () => {},
    }
  );
  const rej1 = dispatch1.decision.rejected || [];
  assert.ok(
    rej1.some((r) => (r.offeringId || r.candidateKey) === cand.candidateKey),
    'Candidate must be excluded after probe failure'
  );

  // Step 2: Later probe success at T2 clears cooldown and re-enables candidate through dispatch
  const t2 = '2026-10-19T02:00:00.000Z';
  const passSweep = path.join(tmpDir, 'sweep-pass.json');
  fs.writeFileSync(
    passSweep,
    JSON.stringify({
      at: t2,
      rows: [
        {
          source: testSource.id,
          model: testModel,
          status: 'TOOLS_OK',
          ms: 280,
        },
      ],
    }),
    'utf8'
  );

  const passRes = sweepImport.runSweepImport(passSweep, {
    evidenceDir,
    registry,
    candidates: [cand],
  });
  assert.equal(
    passRes.evidenceData.cooldowns[cand.candidateKey],
    undefined,
    'Passing probe must remove candidate cooldown'
  );

  const dispatch2 = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [cand],
      items: [item],
      evidenceDir,
      now: Date.parse(t2) + 1000,
      log: () => {},
      exit: () => {},
    }
  );
  const rej2 = dispatch2.decision.rejected || [];
  assert.equal(
    rej2.some((r) => (r.offeringId || r.candidateKey) === cand.candidateKey),
    false,
    'Candidate must NOT remain excluded after passing probe'
  );

  // Step 3: An earlier passing probe at T0 does NOT supersede a later failure at T3
  const t3 = '2026-10-19T03:00:00.000Z';
  const laterFailSweep = path.join(tmpDir, 'sweep-later-fail.json');
  fs.writeFileSync(
    laterFailSweep,
    JSON.stringify({
      at: t3,
      rows: [
        {
          source: testSource.id,
          model: testModel,
          status: 'HTTP_402',
          err: 'Payment required: account balance insufficient',
        },
      ],
    }),
    'utf8'
  );
  const t0 = '2026-10-19T00:30:00.000Z';
  const oldPassSweep = path.join(tmpDir, 'sweep-old-pass.json');
  fs.writeFileSync(
    oldPassSweep,
    JSON.stringify({
      at: t0,
      rows: [
        {
          source: testSource.id,
          model: testModel,
          status: 'TOOLS_OK',
          ms: 250,
        },
      ],
    }),
    'utf8'
  );
  // Re-fail at t3 to verify old pass does not clear later failure
  sweepImport.runSweepImport(laterFailSweep, { evidenceDir, registry, candidates: [cand] });
  const oldRes = sweepImport.runSweepImport(oldPassSweep, {
    evidenceDir,
    registry,
    candidates: [cand],
  });
  assert.ok(
    oldRes.evidenceData.cooldowns[cand.candidateKey],
    'Old passing probe before failure instant must NOT supersede later failure'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
