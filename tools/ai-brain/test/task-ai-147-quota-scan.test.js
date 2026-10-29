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
} = require('../quota-scan');
const { recordExecutionResult, loadStore } = require('../route-health');
const routingApi = require('../routing');
const { quotaScanCommand } = require('../cli');

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
