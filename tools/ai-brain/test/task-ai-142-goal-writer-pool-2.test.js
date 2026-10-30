'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { preferKnownGood } = require('../probe-order');
const { generateCandidates, candidateKey } = require('../candidates');
const { resolveProbeTimeout, getDispatchConfig } = require('../sources');
const agyPoolRuntime = require('../agy-pool-runtime');
const { buildWorkerLaunchScript } = require('../isolation-launcher');
const writerSchema = require('../writer-schema');

test('TASK-AI-142 item 1: probe-order samples every harness and preserves unmeasured ranking order', () => {
  const candidates = [
    {
      harness: 'opencode-direct',
      accessPath: 'https://example.com/v1',
      gateway: 'aihubmix',
      upstream: 'aihubmix',
      accountId: 'acc1',
      quotaScope: 'acc1',
      modelId: 'aihubmix/model-a',
    },
    {
      harness: 'codex',
      accessPath: 'cli',
      gateway: '',
      upstream: 'codex',
      accountId: 'acc2',
      quotaScope: 'acc2',
      modelId: 'gpt-6.1-sol',
    },
    {
      harness: 'paseo',
      accessPath: 'https://example.com',
      gateway: '9router',
      upstream: 'anthropic',
      accountId: 'acc3',
      quotaScope: 'acc3',
      modelId: 'claude-3-5-sonnet',
    },
  ];

  const result = {
    chosen: null,
    ranking: [],
    rejected: candidates.map((c) => ({
      candidateKey: candidateKey(c),
      reasonCode: 'CAPABILITY_UNVERIFIED:jsonSchema',
    })),
  };

  preferKnownGood(result, candidates, { routeHealth: { probes: {} } });

  assert.ok(Array.isArray(result.isolatedLaneRejected));
  const isolatedHarnesses = result.isolatedLaneRejected.map((r) => r.candidateKey.split('::')[0]);
  assert.ok(
    isolatedHarnesses.includes('opencode-direct'),
    'isolatedLaneRejected must include opencode-direct'
  );
  assert.ok(isolatedHarnesses.includes('codex'), 'isolatedLaneRejected must include codex');
  assert.ok(isolatedHarnesses.includes('paseo'), 'every harness uses the same representative rule');

  // With no observed duration or success, preserve existing ranking order.
  const rankingResult = {
    chosen: result.rejected[0].candidateKey,
    ranking: result.rejected.slice(),
    top3: [],
  };
  preferKnownGood(rankingResult, candidates, { routeHealth: { probes: {} } });
  const firstHarness = rankingResult.ranking[0].candidateKey.split('::')[0];
  assert.equal(firstHarness, candidates[0].harness, 'unmeasured routes retain rank order');
});

test('TASK-AI-142 item 1: opencode-direct inherits model capabilities and context window from sources', () => {
  const sourcesApi = require('../sources');
  const registry = sourcesApi.loadSources();

  const candidates = generateCandidates({
    registry,
    catalogue: [
      {
        modelId: 'gpt-4o',
        contextWindow: 128000,
        capabilities: { tools: true, jsonSchema: true },
      },
    ],
    accounts: [
      {
        id: 'acc-aihubmix',
        source: 'aihubmix',
        enabled: true,
        status: 'available',
      },
    ],
    sourceModels: { aihubmix: ['gpt-4o'] },
    env: { AIHUBMIX_API_KEY: 'mock-key' },
  });

  const directCand = candidates.find(
    (c) =>
      c.harness === 'opencode-direct' &&
      (c.modelId === 'aihubmix/gpt-4o' || c.modelId.endsWith('/gpt-4o'))
  );
  assert.ok(directCand, 'opencode-direct candidate must be generated');
  assert.equal(directCand.contextWindow, 128000);
  assert.equal(directCand.capabilities.tools, true);
  assert.equal(directCand.capabilities.jsonSchema, true);
});

test('TASK-AI-142 item 2: readLastRunElapsedMs reads duration of last successful run', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-pool-test-'));
  const accountDir = path.join(tmpDir, 'agy01');
  fs.mkdirSync(accountDir, { recursive: true });

  const runsFile = path.join(accountDir, 'runs.jsonl');
  const runs = [
    {
      startedAt: '2026-10-18T07:30:00.000Z',
      finishedAt: '2026-10-18T07:30:15.500Z',
      state: 'ok',
    },
    {
      startedAt: '2026-10-18T07:33:00.000Z',
      finishedAt: '2026-10-18T07:33:21.200Z',
      state: 'ok',
    },
  ];
  fs.writeFileSync(runsFile, runs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const elapsed = agyPoolRuntime.readLastRunElapsedMs('agy01', { fakeRunsDir: tmpDir });
  assert.equal(elapsed, 21200);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 item 2: resolveProbeTimeout for agy-pool uses measured latency + safety margin', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-probe-test-'));
  const accountDir = path.join(tmpDir, 'agy01');
  fs.mkdirSync(accountDir, { recursive: true });

  const runsFile = path.join(accountDir, 'runs.jsonl');
  const run = {
    startedAt: '2026-10-18T07:33:00.000Z',
    finishedAt: '2026-10-18T07:33:17.580Z',
    state: 'ok',
  };
  fs.writeFileSync(runsFile, JSON.stringify(run) + '\n', 'utf8');

  process.env.AGY_POOL_RUNS_DIR = tmpDir;
  try {
    const candidate = { harness: 'agy-pool', accountId: 'agy01' };
    const dispatchConfig = {
      probeTimeoutMs: 8000,
      probeSafetyMarginMs: 2000,
      schemaProbeBudgetMs: 180000,
    };

    const timeout = resolveProbeTimeout(candidate, null, dispatchConfig, 180000);
    // 17580 + 2000 = 19580 ms
    assert.equal(timeout, 19580);
    assert.ok(timeout > 8000, 'agy-pool timeout must exceed 8000ms default HTTP timeout');
  } finally {
    delete process.env.AGY_POOL_RUNS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TASK-AI-142 item 2: resolveProbeTimeout for agy-pool without prior run uses schemaProbeBudgetMs', () => {
  const candidate = { harness: 'agy-pool', accountId: 'agy99' };
  const dispatchConfig = {
    probeTimeoutMs: 8000,
    probeSafetyMarginMs: 2000,
    schemaProbeBudgetMs: 180000,
  };

  const timeout = resolveProbeTimeout(candidate, null, dispatchConfig, 60000);
  assert.equal(
    timeout,
    60000,
    'Without prior run, timeout should be bounded by remainingMs / schemaProbeBudgetMs, not 8000'
  );
});

test('TASK-AI-142 item 3: buildWorkerLaunchScript preserves exePrefixArgs in codex login check', () => {
  const script = buildWorkerLaunchScript({
    workerRoot: 'C:\\ShipDeWorker\\test',
    adapterId: 'codex',
    isolationVerdict: { verdict: 'CLOSED' },
    exeFile: 'C:\\Program Files\\nodejs\\node.exe',
    exePrefixArgs: [
      'C:\\Users\\gumac\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
    ],
    payloadArgsPath: 'C:\\ShipDeWorker\\test\\payload.json',
    launchResultPath: 'C:\\ShipDeWorker\\test\\launch.json',
    workerTimeoutMs: 60000,
    completionNonce: 'test-nonce-1234',
    completionMarkerPath: 'C:\\ShipDeWorker\\test\\completion.json',
    runAsCurrentUser: true,
  });

  assert.ok(
    script.includes(
      '& "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\gumac\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js" login status'
    ),
    'Launch script must include exePrefixArgs when running login status probe'
  );
});

test('TASK-AI-142 item 4: observedToolUse recognizes Antigravity CLI completion envelope', () => {
  const agyOutput = JSON.stringify({
    conversation_id: '9611e7e3-5bc0-428e-ba7c-7874fa6aa4b6',
    status: 'SUCCESS',
    response: '{"candidateKey":"agy-pool...","status":"completed","artifacts":[]}',
    duration_seconds: 17.58,
    num_turns: 1,
    usage: { input_tokens: 14837, output_tokens: 83, total_tokens: 14920 },
  });

  const observed = writerSchema.observedToolUse(null, agyOutput);
  assert.equal(observed, true, 'Antigravity SUCCESS envelope with usage must be observed');
});
