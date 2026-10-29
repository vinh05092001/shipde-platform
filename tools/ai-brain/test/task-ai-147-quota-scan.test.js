'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  fetchSourceModels,
  selectRepresentativeModel,
  scanAllFullRoutes,
  syncNinerouterModelsToOpenCode,
  scanScope,
  scanAllQuotas,
  schedulePeriodicQuotaScan,
} = require('../quota-scan');
const { recordExecutionResult, loadStore } = require('../route-health');
const routingApi = require('../routing');
const { quotaScanCommand, dispatchCommand } = require('../cli');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-147-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('TASK-AI-147 Req 1: fetchSourceModels gets live models via GET /models with auth header, falls back to static models', async (t) => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === 'https://live-provider.example/v1/models') {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () =>
          JSON.stringify({
            data: [{ id: 'mock-live/model-alpha' }, { id: 'mock-live/model-beta' }],
          }),
      };
    }
    return { ok: false, status: 404, headers: new Map(), text: async () => 'Not found' };
  };

  const liveSource = {
    id: 'live-src',
    servesModels: true,
    endpoint: 'https://live-provider.example/v1',
    credential: { type: 'api-key', env: 'MOCK_SRC_KEY' },
  };

  const env = { MOCK_SRC_KEY: 'secret-token-123' };
  const models = await fetchSourceModels(liveSource, { fetch: fakeFetch, env });

  assert.deepEqual(models, ['mock-live/model-alpha', 'mock-live/model-beta']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://live-provider.example/v1/models');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer secret-token-123');

  // When servesModels is false, return static models without calling network
  const staticSource = {
    id: 'static-src',
    servesModels: false,
    endpoint: 'https://static-provider.example/v1',
    models: ['static/mod-1', 'static/mod-2'],
    modelsUpdatedAt: '2026-10-29',
  };
  const staticModels = await fetchSourceModels(staticSource, { fetch: fakeFetch, env });
  assert.deepEqual(staticModels, ['static/mod-1', 'static/mod-2']);
  assert.equal(calls.length, 1); // no extra fetch call
});

test('TASK-AI-147 Req 2: No UNSCANNABLE - discovered models probed with max_tokens >= 128 and reasoning support', async (t) => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: [{ id: 'live-dyn/reasoning-model-v1' }] }),
      };
    }
    if (url.endsWith('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () =>
          JSON.stringify({
            id: 'cmpl-reason-1',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  reasoning_content: 'Let me think about this step by step. Done.',
                },
                finish_reason: 'stop',
              },
            ],
          }),
      };
    }
    return { ok: false, status: 500, headers: new Map(), text: async () => 'err' };
  };

  const target = {
    source: 'live-dyn',
    scope: 'live-dyn',
    upstream: 'live-dyn',
    model: 'live-dyn/reasoning-model-v1',
    endpoint: 'https://dyn-provider.example/v1',
    apiKeyEnv: 'DYN_KEY',
  };

  const probeRes = await scanScope(target, {
    fetch: fakeFetch,
    env: { DYN_KEY: 'dyn-token' },
    maxTokens: 128,
  });

  assert.equal(probeRes.code, 'OK');
  assert.equal(probeRes.status, 200);

  const completionCall = calls.find((c) => c.url.endsWith('/chat/completions'));
  assert.ok(completionCall);
  assert.ok(completionCall.body.max_tokens >= 128);
});

test('TASK-AI-147 Req 3: 9router representative model per prefix selects highest prior score', () => {
  const models = ['prefixA/weak-model', 'prefixA/strong-model', 'prefixA/average-model'];
  const fakePriors = {
    ranking: [
      { canonical: 'weak-model', codingTier: 'T3', benchmarks: { aaCodingIndex: 45 } },
      { canonical: 'strong-model', codingTier: 'T1', benchmarks: { aaCodingIndex: 98 } },
      { canonical: 'average-model', codingTier: 'T2', benchmarks: { aaCodingIndex: 72 } },
    ],
  };

  const chosen = selectRepresentativeModel(models, {
    priors: fakePriors,
  });

  assert.equal(chosen, 'prefixA/strong-model');
});

test('TASK-AI-147 Req 4: scanAllFullRoutes enforces upstream concurrency and retries 429 with backoff', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');

  let activeUpstreamProbes = 0;
  let maxObservedConcurrency = 0;
  let attempts429 = 0;

  const fakeFetch = async (url, opts) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () =>
          JSON.stringify({
            data: [
              { id: 'shared/m1' },
              { id: 'shared/m2' },
              { id: 'shared/m3' },
              { id: 'shared/m4' },
              { id: 'shared/m5' },
            ],
          }),
      };
    }
    if (url.endsWith('/chat/completions')) {
      activeUpstreamProbes++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeUpstreamProbes);
      await new Promise((r) => setTimeout(r, 20));
      activeUpstreamProbes--;

      const body = JSON.parse(opts.body);
      if (body.model === 'shared/m1' && attempts429 === 0) {
        attempts429++;
        return {
          ok: false,
          status: 429,
          headers: new Map([['retry-after', '1']]),
          text: async () => JSON.stringify({ error: { message: 'rate limit exceeded' } }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () =>
          JSON.stringify({
            id: 'cmpl-ok',
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          }),
      };
    }
  };

  const registry = {
    dispatch: {
      maxConcurrentUpstreamProbes: 2,
      probeRetry429Count: 2,
      probeRetry429BackoffMs: 10,
      maxConcurrentProbes: 4,
    },
    sources: [
      {
        id: 'test-src',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://test-src.example/v1',
        credential: { env: 'TEST_KEY' },
      },
    ],
  };

  const result = await scanAllFullRoutes({
    registry,
    quotaStateFile: quotaFile,
    fetch: fakeFetch,
    env: { TEST_KEY: 'test-key' },
    concurrency: 4,
    sleep: async (ms) => {},
  });

  assert.equal(result.count, 5);
  assert.equal(result.aliveCount, 5);
  assert.ok(
    maxObservedConcurrency <= 2,
    `Observed concurrency ${maxObservedConcurrency} exceeded cap 2`
  );
  assert.equal(attempts429, 1);
});

test('TASK-AI-147 Req 5: Real clock updatedAt is used and rejects old fixed fixture timestamp', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');

  const injectedNow = 1735689600000;
  const fakeFetch = async (url) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: [{ id: 'src/m1' }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        }),
    };
  };

  const registry = {
    dispatch: {
      maxConcurrentUpstreamProbes: 2,
      probeRetry429Count: 1,
      probeRetry429BackoffMs: 10,
      maxConcurrentProbes: 4,
    },
    sources: [
      {
        id: 'src',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://src.example/v1',
        credential: { env: 'K' },
      },
    ],
  };

  const result = await scanAllFullRoutes({
    registry,
    quotaStateFile: quotaFile,
    fetch: fakeFetch,
    env: { K: 'key' },
    now: injectedNow,
  });

  assert.notEqual(result.at, '2027-01-15T08:00:00Z');
  assert.equal(result.at, new Date(injectedNow).toISOString());

  const saved = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
  assert.equal(saved.updatedAt, new Date(injectedNow).toISOString());
});

test('TASK-AI-147 Req 6: Jev UNDECIDED selects highest alive route; execution results record into route health', async (t) => {
  // Part A: Jev UNDECIDED selects highest alive route
  const mockRankingResult = {
    chosen: 'cand-dead',
    ranking: [
      { candidateKey: 'cand-dead', isAlive: false, blocked: true, score: 99 },
      { candidateKey: 'cand-no-alive-prop', blocked: false, score: 98 }, // missing isAlive must not be treated as alive
      { candidateKey: 'cand-alive-top', isAlive: true, blocked: false, score: 95 },
      { candidateKey: 'cand-alive-second', isAlive: true, blocked: false, score: 80 },
    ],
  };

  const adviceResult = await routingApi.adviseModelChoice(
    mockRankingResult,
    { role: 'writer' },
    {
      ask: async () => ({
        handledBy: 'jev',
        outcome: 'UNDECIDED',
        reason: 'CONFIDENCE_TOO_LOW',
      }),
    }
  );

  assert.equal(adviceResult.chosen, 'cand-alive-top');

  // Part B: recordExecutionResult records success, timeout/stalled, and concurrency into route health
  const dir = fixture(t);
  const healthFile = path.join(dir, 'model-route-health.json');

  // Success
  recordExecutionResult(healthFile, 'm-alpha', 'route-1', {
    status: 200,
    ok: true,
    elapsedMs: 250,
    concurrency: 3,
  });

  const store1 = loadStore(healthFile);
  const rec1 = store1.paths['m-alpha|route-1'];
  assert.ok(rec1);
  assert.equal(rec1.status, 'AVAILABLE');
  assert.equal(rec1.concurrency, 3);
  assert.equal(rec1.elapsedMs, 250);

  // Stalled / timeout
  recordExecutionResult(healthFile, 'm-beta', 'route-1', {
    status: 408,
    timedOut: true,
    concurrency: 4,
  });

  const store2 = loadStore(healthFile);
  const rec2 = store2.paths['m-beta|route-1'];
  assert.ok(rec2);
  assert.notEqual(rec2.status, 'AVAILABLE');
  assert.equal(rec2.concurrency, 4);
});

test('TASK-AI-147 Req 7: syncNinerouterModelsToOpenCode backs up opencode.json and updates only provider models', async (t) => {
  const dir = fixture(t);
  const ocPath = path.join(dir, 'opencode.json');

  const initialConfig = {
    provider: {
      anthropic: { models: { 'claude-3': { name: 'claude-3' } } },
      ninerouter: {
        name: '9Router (local)',
        models: { 'old/model': { name: 'old/model' } },
      },
    },
    general: { theme: 'dark' },
  };
  fs.writeFileSync(ocPath, JSON.stringify(initialConfig, null, 2), 'utf8');

  const fakeFetch = async (url) => {
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({
          data: [{ id: '9router/fresh-model-1' }, { id: '9router/fresh-model-2' }],
        }),
    };
  };

  const syncRes = await syncNinerouterModelsToOpenCode({
    opencodePath: ocPath,
    fetch: fakeFetch,
    registry: {
      sources: [
        {
          id: 'test-router',
          kind: 'router',
          aliases: ['ninerouter', '9router'],
          endpoint: 'http://127.0.0.1:20128/v1',
          credential: { env: 'NINEROUTER_API_KEY' },
        },
      ],
    },
    env: { NINEROUTER_API_KEY: 'test-key' },
  });

  assert.equal(syncRes.success, true);
  assert.equal(syncRes.modelCount, 2);
  assert.ok(fs.existsSync(syncRes.backupPath));

  const updatedConfig = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
  assert.equal(updatedConfig.general.theme, 'dark');
  assert.deepEqual(updatedConfig.provider.anthropic, initialConfig.provider.anthropic);
  assert.deepEqual(Object.keys(updatedConfig.provider.ninerouter.models), [
    'fresh-model-1',
    'fresh-model-2',
  ]);
});

test('TASK-AI-147 Req 4 CLI: quotaScanCommand with --full really calls full route scanning', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');

  const fakeFetch = async (url) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: [{ id: 'src/m1' }, { id: 'src/m2' }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        }),
    };
  };

  const registry = {
    dispatch: {
      maxConcurrentUpstreamProbes: 2,
      probeRetry429Count: 1,
      probeRetry429BackoffMs: 10,
      maxConcurrentProbes: 4,
    },
    sources: [
      {
        id: 'src',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://src.example/v1',
        credential: { env: 'K' },
      },
    ],
  };

  const result = await quotaScanCommand(
    { full: true, out: quotaFile },
    {
      registry,
      fetch: fakeFetch,
      env: { K: 'key' },
      now: 1735689600000,
    }
  );

  assert.equal(result.count, 2);
  assert.equal(result.aliveCount, 2);
  assert.ok(Array.isArray(result.rankedAlive));
  assert.equal(result.rankedAlive.length, 2);
});

test('TASK-AI-147 Req 7 CLI: quotaScanCommand with --sync-opencode invokes syncNinerouterModelsToOpenCode', async (t) => {
  const dir = fixture(t);
  const ocPath = path.join(dir, 'opencode.json');
  fs.writeFileSync(ocPath, JSON.stringify({ provider: {} }), 'utf8');

  const fakeFetch = async (url) => {
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ data: [{ id: '9router/model-x' }] }),
    };
  };

  const result = await quotaScanCommand(
    { 'sync-opencode': true, 'opencode-path': ocPath },
    {
      registry: {
        sources: [
          {
            id: 'test-router',
            kind: 'router',
            aliases: ['ninerouter', '9router'],
            endpoint: 'http://127.0.0.1:20128/v1',
            credential: { env: 'NINEROUTER_API_KEY' },
          },
        ],
      },
      fetch: fakeFetch,
      env: { NINEROUTER_API_KEY: 'test-key' },
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.modelCount, 1);
  const updated = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
  assert.ok(updated.provider.ninerouter.models['model-x']);
});

test('TASK-AI-147 Review R2-1: fetchSourceModels fail-closed on malformed response shapes', async () => {
  const liveSource = {
    id: 'live-src',
    servesModels: true,
    endpoint: 'https://live.example/v1',
    credential: { env: 'KEY' },
  };
  const env = { KEY: 'secret' };

  // Case A: HTTP 200 with {} (empty object, not array)
  await assert.rejects(async () => {
    await fetchSourceModels(liveSource, {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({}),
      }),
      env,
    });
  }, /MALFORMED_MODELS_RESPONSE/);

  // Case B: HTTP 200 with { data: [{}] } (missing id/name)
  await assert.rejects(async () => {
    await fetchSourceModels(liveSource, {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: [{}] }),
      }),
      env,
    });
  }, /MALFORMED_MODELS_RESPONSE/);

  // Case C: HTTP 200 with { data: [{ id: '' }] } (empty string id)
  await assert.rejects(async () => {
    await fetchSourceModels(liveSource, {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: [{ id: '' }] }),
      }),
      env,
    });
  }, /MALFORMED_MODELS_RESPONSE/);

  // Case D: HTTP 200 with { data: "not-an-array" }
  await assert.rejects(async () => {
    await fetchSourceModels(liveSource, {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: 'not-an-array' }),
      }),
      env,
    });
  }, /MALFORMED_MODELS_RESPONSE/);
});

test('TASK-AI-147 Review R2-2: schedulePeriodicQuotaScan prevents overlapping scans via lock and shares limiter', async (t) => {
  let scanRunCount = 0;
  let slowScanResolver;
  const slowScanPromise = new Promise((resolve) => {
    slowScanResolver = resolve;
  });

  const customScan = async () => {
    scanRunCount++;
    await slowScanPromise;
    return { ok: true };
  };

  let registeredIntervalFn = null;
  const fakeSetInterval = (fn, ms) => {
    registeredIntervalFn = fn;
    return 12345;
  };

  schedulePeriodicQuotaScan({
    initialScan: false,
    intervalMs: 100,
    scanFn: customScan,
    setInterval: fakeSetInterval,
    clearInterval: () => {},
  });

  assert.ok(registeredIntervalFn, 'interval callback should be registered');

  // Trigger first tick - starts scanning
  const tick1 = registeredIntervalFn();
  assert.equal(scanRunCount, 1, 'first scan should start');

  // Trigger second tick while first is still in flight - should skip due to lock
  const tick2 = registeredIntervalFn();
  assert.equal(scanRunCount, 1, 'second scan should be skipped while first is in-flight');

  // Complete first scan
  slowScanResolver();
  await tick1;
  await tick2;

  // Now a subsequent tick should run
  let fastResolved = false;
  const fastScan = async () => {
    scanRunCount++;
    fastResolved = true;
  };
  registeredIntervalFn = null;
  schedulePeriodicQuotaScan({
    initialScan: false,
    intervalMs: 100,
    scanFn: fastScan,
    setInterval: fakeSetInterval,
    clearInterval: () => {},
  });
  await registeredIntervalFn();
  assert.equal(scanRunCount, 2, 'scan runs again after lock is cleared');
  assert.equal(fastResolved, true);
});

test('TASK-AI-147 Review R2-2: scanAllFullRoutes shares upstream concurrency limiter across multiple runs', async (t) => {
  const dir = fixture(t);
  const quotaFile1 = path.join(dir, 'quota-1.json');
  const quotaFile2 = path.join(dir, 'quota-2.json');

  let activeUpstream = 0;
  let maxConcurrent = 0;

  const fakeFetch = async (url) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }),
      };
    }
    activeUpstream++;
    maxConcurrent = Math.max(maxConcurrent, activeUpstream);
    await new Promise((r) => setTimeout(r, 25));
    activeUpstream--;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    };
  };

  const registry = {
    dispatch: {
      maxConcurrentUpstreamProbes: 1,
      probeRetry429Count: 0,
      probeRetry429BackoffMs: 10,
      maxConcurrentProbes: 4,
    },
    sources: [
      {
        id: 'shared-up',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://shared.example/v1',
        credential: { env: 'K' },
      },
    ],
  };

  const sharedLimiter = {
    active: new Map(),
    waiters: new Map(),
  };

  await Promise.all([
    scanAllFullRoutes({
      registry,
      quotaStateFile: quotaFile1,
      fetch: fakeFetch,
      env: { K: 'val' },
      upstreamLimiter: sharedLimiter,
      concurrency: 2,
    }),
    scanAllFullRoutes({
      registry,
      quotaStateFile: quotaFile2,
      fetch: fakeFetch,
      env: { K: 'val' },
      upstreamLimiter: sharedLimiter,
      concurrency: 2,
    }),
  ]);

  assert.equal(
    maxConcurrent,
    1,
    `Max concurrency ${maxConcurrent} should not exceed cap 1 across runs`
  );
});

test('TASK-AI-147 Review R2-3: scanAllFullRoutes overwrites previously OK scope when probe fails, and marks router discovery failure', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');

  const initialQuota = {
    version: '1.0',
    updatedAt: '2026-10-29T10:00:00Z',
    scopes: {
      'src-failing': { status: 200, code: 'OK', checkedAt: '2026-10-29T10:00:00Z' },
      'src-failing::src-failing': { status: 200, code: 'OK', checkedAt: '2026-10-29T10:00:00Z' },
    },
    sources: {
      'src-failing': { checkedAt: '2026-10-29T10:00:00Z' },
    },
  };
  fs.writeFileSync(quotaFile, JSON.stringify(initialQuota, null, 2), 'utf8');

  const fakeFetch = async (url) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ data: [{ id: 'src-failing/m1' }] }),
      };
    }
    return {
      ok: false,
      status: 500,
      headers: new Map(),
      text: async () => JSON.stringify({ error: 'Internal Server Error' }),
    };
  };

  const registry = {
    dispatch: {
      maxConcurrentUpstreamProbes: 2,
      probeRetry429Count: 0,
      probeRetry429BackoffMs: 10,
      maxConcurrentProbes: 4,
    },
    sources: [
      {
        id: 'src-failing',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://fail.example/v1',
        credential: { env: 'K' },
      },
    ],
  };

  const scanNow = 1735689700000;
  await scanAllFullRoutes({
    registry,
    quotaStateFile: quotaFile,
    fetch: fakeFetch,
    env: { K: 'val' },
    now: scanNow,
  });

  const updatedState = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
  assert.equal(
    updatedState.scopes['src-failing'].status,
    500,
    'Scope status should be overwritten with failure status 500'
  );
  assert.notEqual(
    updatedState.scopes['src-failing'].code,
    'OK',
    'Scope code should be overwritten with failure code'
  );
  assert.equal(
    updatedState.scopes['src-failing::src-failing'].status,
    500,
    'Scope source::source should be overwritten with failure status 500'
  );

  // Router discovery failure case
  const routerRegistry = {
    dispatch: {
      maxConcurrentUpstreamProbes: 2,
      probeRetry429Count: 0,
      probeRetry429BackoffMs: 10,
      maxConcurrentProbes: 4,
    },
    sources: [
      {
        id: 'broken-router',
        kind: 'router',
        endpoint: 'https://router.example/v1',
        credential: { env: 'K' },
      },
    ],
  };

  const fakeFetchRouterFail = async (url) => {
    return {
      ok: false,
      status: 503,
      headers: new Map(),
      text: async () => 'Service Unavailable',
    };
  };

  const routerScanRes = await scanAllFullRoutes({
    registry: routerRegistry,
    quotaStateFile: quotaFile,
    fetch: fakeFetchRouterFail,
    env: { K: 'val' },
    now: scanNow + 1000,
  });

  const finalState = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
  assert.equal(
    finalState.scopes['broken-router'].code,
    'DISCOVERY_FAILED',
    'Router scope should be marked DISCOVERY_FAILED'
  );
  assert.equal(
    finalState.scopes['broken-router::broken-router'].code,
    'DISCOVERY_FAILED',
    'Router broken-router::broken-router scope should be DISCOVERY_FAILED'
  );
  assert.ok(
    routerScanRes.failedSources.includes('broken-router'),
    'failedSources should include broken-router'
  );
  assert.equal(
    finalState.sourceFreshness?.['broken-router'],
    undefined,
    'sourceFreshness should not advance for failed router'
  );
});

test('TASK-AI-147 Review R2-4: dispatchCommand and reportOutcomeCommand record execution results to route health', async (t) => {
  const dir = fixture(t);
  const healthFile = path.join(dir, 'model-route-health.json');
  const evidenceDir = path.join(dir, 'evidence');

  const candA = {
    harness: 'paseo',
    accessPath: 'http://127.0.0.1:20128/v1',
    gateway: '9router',
    upstream: 'mock-up',
    accountId: 'mock-scope',
    quotaScope: 'mock-scope',
    modelId: 'm-alpha',
    qualifiedRoles: ['author.foundation'],
    cost: 5,
    quality: 90,
  };
  candA.candidateKey = [
    candA.harness,
    candA.accessPath,
    candA.gateway,
    candA.upstream,
    candA.accountId,
    candA.quotaScope,
    candA.modelId,
  ].join('\u241f');

  // 1. dispatchCommand on SUCCESS
  let exitCode = -1;
  dispatchCommand(
    { execute: true, item: 'TASK-TEST-HEALTH-SUCCESS' },
    {
      candidates: [candA],
      run: () => ({
        exitCode: 0,
        stdout: JSON.stringify({ id: 'sess-01', status: 'running' }),
        elapsedMs: 150,
      }),
      routeHealthFile: healthFile,
      evidenceDir,
      home: dir,
      exit: (code) => {
        exitCode = code;
      },
      log: () => {},
      concurrency: 2,
    }
  );

  assert.equal(exitCode, 0);
  const storeAfterSuccess = loadStore(healthFile);
  const healthRecSuccess = storeAfterSuccess.paths['m-alpha|mock-up'];
  assert.ok(healthRecSuccess, 'route health record should exist after dispatchCommand success');
  assert.equal(healthRecSuccess.status, 'AVAILABLE');
  assert.equal(healthRecSuccess.elapsedMs, 150);
  assert.equal(healthRecSuccess.concurrency, 2);

  // 2. dispatchCommand on FAILURE/TIMEOUT
  let exitCodeFail = -1;
  dispatchCommand(
    { execute: true, item: 'TASK-TEST-HEALTH-FAIL' },
    {
      candidates: [candA],
      run: () => ({ exitCode: 1, stderr: 'Request timed out after 30000ms', elapsedMs: 30000 }),
      routeHealthFile: healthFile,
      evidenceDir,
      home: dir,
      exit: (code) => {
        exitCodeFail = code;
      },
      log: () => {},
      maxAttempts: 1,
      concurrency: 1,
    }
  );

  assert.equal(exitCodeFail, 1);
  const storeAfterFail = loadStore(healthFile);
  const healthRecFail = storeAfterFail.paths['m-alpha|mock-up'];
  assert.ok(healthRecFail);
  assert.notEqual(healthRecFail.status, 'AVAILABLE', 'status should reflect failure');
  assert.equal(healthRecFail.concurrency, 1);

  // 3. routingApi.reportDispatchOutcome
  const candReport = [
    'paseo',
    'http://127.0.0.1:20128/v1',
    '9router',
    'mock-gateway',
    'mock-acc',
    'mock-scope',
    'm-beta',
  ].join('\u241f');

  const outcomeFile = path.join(dir, 'outcome.json');
  fs.writeFileSync(
    outcomeFile,
    JSON.stringify({
      candidateKey: candReport,
      status: 'completed',
      elapsedMs: 220,
      concurrency: 3,
    })
  );

  routingApi.reportDispatchOutcome(
    { 'report-outcome': outcomeFile },
    {
      routeHealthFile: healthFile,
      evidenceDir,
      home: dir,
      exit: () => {},
    }
  );

  const storeAfterReport = loadStore(healthFile);
  const healthRecReport = storeAfterReport.paths['m-beta|mock-gateway'];
  assert.ok(healthRecReport, 'route health record should exist after reportDispatchOutcome');
  assert.equal(healthRecReport.status, 'AVAILABLE');
  assert.equal(healthRecReport.elapsedMs, 220);
  assert.equal(healthRecReport.concurrency, 3);
});
