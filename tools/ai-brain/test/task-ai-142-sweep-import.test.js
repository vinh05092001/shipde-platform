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
