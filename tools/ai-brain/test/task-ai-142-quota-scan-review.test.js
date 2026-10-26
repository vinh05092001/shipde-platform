'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const quotaScan = require('../quota-scan');
const sourcesApi = require('../sources');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-review-test-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
  return dir;
}

// 1. Regression test for P1: Failed or timed-out scan preserves existing blocking result until valid evidence or expiry
test('P1 review finding 1: transient network failure preserves active blocking QUOTA, AUTH, or REGION until expiry or valid evidence', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');
  const now = 1700000000000;

  const registry = {
    sources: [
      {
        id: 'test-src',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://test.local/v1',
        models: ['test-src/model-1'],
      },
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        endpoint: 'https://router.local/v1',
      },
    ],
  };

  // Initial state has active blocking QUOTA and AUTH results expiring in 1 hour
  const initialQuotaState = {
    updatedAt: new Date(now - 1000).toISOString(),
    scopes: {
      'test-src::test-src': {
        source: 'test-src',
        scope: 'test-src',
        upstream: 'test-src',
        model: 'test-src/model-1',
        code: 'QUOTA',
        status: 402,
        reason: 'QUOTA',
        at: new Date(now - 1000).toISOString(),
        retryAfter: now + 3600000,
      },
      'test-src': {
        source: 'test-src',
        scope: 'test-src',
        upstream: 'test-src',
        model: 'test-src/model-1',
        code: 'QUOTA',
        status: 402,
        reason: 'QUOTA',
        at: new Date(now - 1000).toISOString(),
        retryAfter: now + 3600000,
      },
      '9router::cl': {
        source: '9router',
        scope: 'cl',
        upstream: 'cl',
        model: 'cl/model-1',
        code: 'AUTH',
        status: 401,
        reason: 'AUTH',
        at: new Date(now - 1000).toISOString(),
        retryAfter: now + 3600000,
      },
    },
  };
  fs.writeFileSync(quotaFile, JSON.stringify(initialQuotaState, null, 2), 'utf8');

  // Simulate transient network failure (e.g. connection refused / socket hangup)
  const transientFailingFetch = async (url) => {
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ data: [{ id: 'cl/model-1' }] }),
      };
    }
    throw new Error('connect ECONNREFUSED 127.0.0.1:20128');
  };

  const res = await quotaScan.scanAllQuotas({
    now,
    registry,
    quotaStateFile: quotaFile,
    fetch: transientFailingFetch,
  });

  // Both scopes must PRESERVE their blocking results across the transient failure
  assert.equal(
    res.scopes['test-src::test-src'].code,
    'QUOTA',
    'Active QUOTA result must be preserved on transient failure'
  );
  assert.equal(
    quotaScan.isScopeBlocked(res.scopes['test-src::test-src'], now),
    true,
    'test-src scope must remain blocked'
  );

  assert.equal(
    res.scopes['9router::cl'].code,
    'AUTH',
    'Active AUTH result must be preserved on transient failure'
  );
  assert.equal(
    quotaScan.isScopeBlocked(res.scopes['9router::cl'], now),
    true,
    '9router::cl scope must remain blocked'
  );

  // Valid evidence (200 OK) clears the blocking result
  const okFetch = async (url) => {
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ data: [{ id: 'cl/model-1' }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'pong' } }] }),
    };
  };

  const clearedRes = await quotaScan.scanAllQuotas({
    now: now + 2000,
    registry,
    quotaStateFile: quotaFile,
    fetch: okFetch,
  });
  assert.equal(
    clearedRes.scopes['test-src::test-src'].code,
    'OK',
    'Valid evidence (200 OK) must clear the blocking QUOTA result'
  );

  // Expired blocking result is not preserved when failure occurs after expiry
  const expiredState = {
    updatedAt: new Date(now - 1000).toISOString(),
    scopes: {
      'test-src::test-src': {
        source: 'test-src',
        scope: 'test-src',
        code: 'QUOTA',
        status: 402,
        reason: 'QUOTA',
        at: new Date(now - 7200000).toISOString(),
        retryAfter: now - 1000, // already expired
      },
    },
  };
  fs.writeFileSync(quotaFile, JSON.stringify(expiredState, null, 2), 'utf8');

  const afterExpiryRes = await quotaScan.scanAllQuotas({
    now,
    registry,
    quotaStateFile: quotaFile,
    fetch: transientFailingFetch,
  });
  assert.notEqual(
    afterExpiryRes.scopes['test-src::test-src'].code,
    'QUOTA',
    'Expired blocking result must not be preserved after expiry'
  );
});

// 2. Regression test for P1: Persisted error reasons are reliably secret-free and use fixed classifications
test('P1 review finding 2: error reasons from response body or options.env persist fixed classification without leaking upstream text', async () => {
  const customSecret = 'customsecret12345';
  const customEnvKey = 'CUSTOM_TEST_API_KEY';
  const optionsEnv = { [customEnvKey]: customSecret };

  // Upstream returns 500 with secret in raw response body
  const rawBodyWithSecret = JSON.stringify({
    error: `Upstream error with api_key=${customSecret} for account backend`,
  });

  const classified = quotaScan.classifyQuotaResponse(500, rawBodyWithSecret, new Map());
  assert.equal(
    classified.reason.includes(customSecret),
    false,
    'Classified reason must not leak custom secret'
  );
  assert.equal(
    classified.reason,
    'HTTP_500',
    'Non-standard upstream error must persist fixed classification HTTP_500'
  );

  // scanScope with custom secret in error message from options.env
  const target = {
    source: 'test-src',
    scope: 'test-src',
    upstream: 'test-src',
    model: 'test-src/default',
    endpoint: 'https://test.local',
    apiKeyEnv: customEnvKey,
  };

  const failingFetch = async () => {
    throw new Error(`Failed request with api_key=${customSecret}`);
  };

  const scanResult = await quotaScan.scanScope(target, {
    env: optionsEnv,
    fetch: failingFetch,
  });

  assert.equal(
    scanResult.reason.includes(customSecret),
    false,
    'scanScope reason must not leak secret from options.env'
  );
  assert.equal(
    scanResult.reason,
    'FETCH_FAILED',
    'scanScope failure must persist fixed classification FETCH_FAILED'
  );

  // Test sanitizeStatusDescription directly
  assert.equal(
    quotaScan.sanitizeStatusDescription(`secret=${customSecret}`, 'ERROR'),
    'ERROR',
    'sanitizeStatusDescription must return safe fallback for non-allowlisted text'
  );
  assert.equal(
    quotaScan.sanitizeStatusDescription('AUTH'),
    'AUTH',
    'sanitizeStatusDescription must allow safe allowlisted token'
  );
  assert.equal(
    quotaScan.sanitizeStatusDescription('HTTP_503'),
    'HTTP_503',
    'sanitizeStatusDescription must allow HTTP status classification'
  );
});

// 3. Regression test for P1: Request timeout bounds the scan: /models has abort deadline and timer bounds entire body read
test('P1 review finding 3: timeout bounds entire request and body read for both /models and /chat/completions', async () => {
  const dispatchConfig = sourcesApi.getDispatchConfig(sourcesApi.loadSources());
  const baseTimeout = dispatchConfig.probeTimeoutMs;
  assert.ok(typeof baseTimeout === 'number' && baseTimeout > 0, 'probeTimeoutMs must be positive');

  // Part A: /models in discover9RouterScopes must pass an abort signal and bound stalled server
  let modelsSignalCaptured = null;
  const stalledModelsFetch = async (url, opts) => {
    if (String(url).endsWith('/models')) {
      modelsSignalCaptured = opts?.signal;
      // Stalled response: wait for signal abort or hang
      return new Promise((resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }
    return { ok: false, status: 500 };
  };

  const source = {
    id: '9router',
    kind: 'router',
    endpoint: 'https://router.local/v1',
  };

  const startTime = Date.now();
  const shortTimeout = 50;
  const targets = await quotaScan.discover9RouterScopes(source, {
    fetch: stalledModelsFetch,
    timeoutMs: shortTimeout,
    // Isolated: the fallback uses this injected catalogue, never local discovery data.
    catalogue: [{ modelId: 'stub/model-1', sourceIds: ['9router'] }],
  });
  const elapsed = Date.now() - startTime;

  assert.ok(modelsSignalCaptured, '/models fetch must receive an AbortSignal');
  assert.ok(
    elapsed < 500,
    `discover9RouterScopes must be bounded by timeout (elapsed: ${elapsed}ms)`
  );
  assert.deepEqual(
    targets.map((t) => t.scope),
    ['stub'],
    'Must fall back to the injected live catalogue'
  );

  // Part B: scanScope must bound entire request AND body read even if server stalls during res.text()
  let textReadSignalCaptured = null;
  const stalledBodyFetch = async (url, opts) => {
    textReadSignalCaptured = opts?.signal;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => {
        return new Promise((resolve, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      },
    };
  };

  const scanTarget = {
    source: 'test-src',
    scope: 'test-src',
    upstream: 'test-src',
    model: 'test-src/default',
    endpoint: 'https://test.local/v1',
  };

  const scanStart = Date.now();
  const scanResult = await quotaScan.scanScope(scanTarget, {
    fetch: stalledBodyFetch,
    timeoutMs: shortTimeout,
  });
  const scanElapsed = Date.now() - scanStart;

  assert.ok(
    scanElapsed < 500,
    `scanScope must bound stalled body read within timeout (elapsed: ${scanElapsed}ms)`
  );
  assert.equal(
    scanResult.code,
    'TIMEOUT',
    'scanScope with stalled body read must yield TIMEOUT status'
  );
  assert.equal(scanResult.status, 408, 'scanScope with stalled body read must yield 408 status');
});

// Regression test for P1: Router discovery uses live catalogue models or reports failure without inventing fabricated probes
test('P1 review finding 4: router discovery uses live catalogue models on /models failure and reports discovery failure without fabricating default models', async () => {
  const routerSource = {
    id: '9router',
    kind: 'router',
    servesModels: true,
    endpoint: 'http://127.0.0.1:20128/v1',
  };

  const failingFetch = async (url) => {
    if (String(url).endsWith('/models')) {
      return { ok: false, status: 500, text: async () => 'Internal Server Error' };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    };
  };

  // Case A: /models fails (500) but live catalogue has models -> uses live catalogue models to probe live upstream scopes
  const catalogue = [
    { modelId: 'provider-x/model-alpha', sourceIds: ['9router'] },
    { modelId: 'provider-y/model-beta', sourceIds: ['9router'] },
  ];

  const targets = await quotaScan.discover9RouterScopes(routerSource, {
    fetch: failingFetch,
    catalogue,
  });

  // Should discover provider-x and provider-y from catalogue, NOT fabricated cl, kr, ocz, ag defaults
  assert.equal(targets.length, 2);
  const prefixes = targets.map((t) => t.scope).sort();
  assert.deepEqual(prefixes, ['provider-x', 'provider-y']);
  assert.equal(
    targets.some((t) => t.model.endsWith('/default')),
    false,
    'Must not invent fabricated */default models'
  );

  // Case B: /models fails and catalogue has no models -> reports discovery failure, never fabricates probes
  await assert.rejects(
    async () => {
      await quotaScan.discover9RouterScopes(routerSource, {
        fetch: failingFetch,
        catalogue: [],
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(/discovery failed/i.test(err.message) || err.code === 'DISCOVERY_FAILED');
      return true;
    },
    'Should reject with discovery failure when /models fails and no catalogue models exist'
  );
});

// Regression test for P1: Malformed or unreadable quota-state file surfaces error and retains safe blocking decision
test('P1 review finding 5: malformed or unreadable quota-state file surfaces error and retains safe blocking decision', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'corrupt-quota-state.json');

  // Write malformed JSON
  fs.writeFileSync(quotaFile, '{ "updatedAt": "2026-10-20", scopes: { invalid json', 'utf8');

  // 1. loadQuotaState surfaces the state error
  const state = quotaScan.loadQuotaState({ quotaStateFile: quotaFile });
  assert.ok(state.error, 'loadQuotaState must surface the state error on malformed file');

  // 2. Candidate quota scope state retains safe blocking decision (fails closed)
  const candidate = {
    candidateKey: 'paseo::cl/claude-3-5-sonnet::acct-1',
    gateway: '9router',
    upstream: 'cl',
    modelId: 'cl/claude-3-5-sonnet',
  };

  const scopeState = quotaScan.getQuotaScopeState(candidate, state);
  assert.ok(scopeState, 'Should return scope state indicating error/blocked');
  assert.equal(
    quotaScan.isScopeBlocked(scopeState),
    true,
    'Corrupt state must retain a safe blocking decision'
  );

  // 3. Probes / capability-probe must retain block for previously blocked candidate
  const candidates = [
    {
      ...candidate,
      blocked: true,
      blockReason: 'QUOTA_SCOPE_QUOTA: cl',
      blockScope: 'quota-scope',
    },
  ];
  const { probeCapabilities } = require('../capability-probe');
  await probeCapabilities(
    candidates,
    { requiredCapabilities: [] },
    {
      quotaStateFile: quotaFile,
      registry: { sources: [] },
    }
  );
  assert.equal(
    candidates[0].blocked,
    true,
    'Previously blocked candidate must remain blocked on corrupt quota state'
  );
});

// 6. Regression test for P1: Scope lookup for candidates identified through sourceIds or accessPath
test('P1 review finding 6: scope lookup resolves candidates identified through sourceIds or accessPath', () => {
  const now = Date.now();
  const quotaState = {
    updatedAt: new Date(now).toISOString(),
    scopes: {
      '9router::cl': {
        source: '9router',
        scope: 'cl',
        upstream: 'cl',
        code: 'QUOTA',
        status: 402,
        reason: 'QUOTA',
        at: new Date(now).toISOString(),
        retryAfter: now + 3600000,
      },
      'blocked-src': {
        source: 'blocked-src',
        scope: 'blocked-src',
        code: 'AUTH',
        status: 401,
        reason: 'AUTH',
        at: new Date(now).toISOString(),
        retryAfter: now + 3600000,
      },
      'healthy-src': {
        source: 'healthy-src',
        scope: 'healthy-src',
        code: 'OK',
        status: 200,
        reason: 'OK',
        at: new Date(now).toISOString(),
      },
    },
  };

  // Shape A: accessPath identifies 9router with upstream 'cl'
  const candAccessPathUpstream = {
    accessPath: '9router',
    upstream: 'cl',
    modelId: 'cl/model-1',
  };
  const stateA = quotaScan.getQuotaScopeState(candAccessPathUpstream, quotaState);
  assert.ok(stateA, 'Candidate with accessPath 9router must resolve scope');
  assert.equal(stateA.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(stateA, now), true);

  // Shape B: sourceIds identifies 9router with upstream 'cl'
  const candSourceIdsUpstream = {
    sourceIds: ['9router'],
    upstream: 'cl',
    modelId: 'cl/model-1',
  };
  const stateB = quotaScan.getQuotaScopeState(candSourceIdsUpstream, quotaState);
  assert.ok(stateB, 'Candidate with sourceIds 9router must resolve scope');
  assert.equal(stateB.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(stateB, now), true);

  // Shape C: accessPath identifies 9router without upstream field, using modelId prefix
  const candAccessPathPrefix = {
    accessPath: '9router',
    modelId: 'cl/model-2',
  };
  const stateC = quotaScan.getQuotaScopeState(candAccessPathPrefix, quotaState);
  assert.ok(stateC, 'Candidate with accessPath 9router and prefixed modelId must resolve scope');
  assert.equal(stateC.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(stateC, now), true);

  // Shape D: sourceIds identifies 9router without upstream field, using modelId prefix
  const candSourceIdsPrefix = {
    sourceIds: ['9router'],
    modelId: 'cl/model-3',
  };
  const stateD = quotaScan.getQuotaScopeState(candSourceIdsPrefix, quotaState);
  assert.ok(stateD, 'Candidate with sourceIds 9router and prefixed modelId must resolve scope');
  assert.equal(stateD.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(stateD, now), true);

  // Shape E: accessPath identifies direct blocked source
  const candAccessPathDirect = {
    accessPath: 'blocked-src',
    modelId: 'some-model',
  };
  const stateE = quotaScan.getQuotaScopeState(candAccessPathDirect, quotaState);
  assert.ok(stateE, 'Candidate with accessPath blocked-src must resolve scope');
  assert.equal(stateE.code, 'AUTH');
  assert.equal(quotaScan.isScopeBlocked(stateE, now), true);

  // Shape F: sourceIds identifies direct blocked source
  const candSourceIdsDirect = {
    sourceIds: ['blocked-src'],
    modelId: 'some-model',
  };
  const stateF = quotaScan.getQuotaScopeState(candSourceIdsDirect, quotaState);
  assert.ok(stateF, 'Candidate with sourceIds blocked-src must resolve scope');
  assert.equal(stateF.code, 'AUTH');
  assert.equal(quotaScan.isScopeBlocked(stateF, now), true);

  // Shape G: sourceIds are alternatives; one blocked alternative must not reject the healthy one
  const candMultiSourceIds = {
    sourceIds: ['healthy-src', 'blocked-src'],
    modelId: 'some-model',
  };
  const stateG = quotaScan.getQuotaScopeState(candMultiSourceIds, quotaState);
  assert.equal(quotaScan.isScopeBlocked(stateG, now), false);
  assert.equal(stateG.code, 'OK');

  // Shape G2: the selected gateway decides even when an alternative source is blocked
  const candSelectedHealthy = {
    gateway: 'healthy-src',
    sourceIds: ['healthy-src', 'blocked-src'],
    modelId: 'some-model',
  };
  const stateG2 = quotaScan.getQuotaScopeState(candSelectedHealthy, quotaState);
  assert.equal(quotaScan.isScopeBlocked(stateG2, now), false);
  const candSelectedBlocked = { ...candSelectedHealthy, gateway: 'blocked-src' };
  const stateG3 = quotaScan.getQuotaScopeState(candSelectedBlocked, quotaState);
  assert.equal(stateG3.code, 'AUTH');
  assert.equal(quotaScan.isScopeBlocked(stateG3, now), true);

  // Shape G4: blocked only when every alternative is blocked
  const quotaStateAllBlocked = {
    ...quotaState,
    scopes: {
      ...quotaState.scopes,
      'healthy-src': {
        ...quotaState.scopes['blocked-src'],
        source: 'healthy-src',
        scope: 'healthy-src',
      },
    },
  };
  const stateG4 = quotaScan.getQuotaScopeState(candMultiSourceIds, quotaStateAllBlocked);
  assert.equal(quotaScan.isScopeBlocked(stateG4, now), true);

  // Negative test: unrelated candidate must not match 9router::cl
  const candUnrelated = {
    accessPath: 'other-source',
    sourceIds: ['other-source'],
    modelId: 'cl/model-1',
  };
  const stateUnrelated = quotaScan.getQuotaScopeState(candUnrelated, quotaState);
  assert.equal(stateUnrelated, null, 'Unrelated candidate must not match 9router::cl');
});

// 7. Regression test for P1: partial scan with --source does not advance global updatedAt
test('P1 review finding 7: scan restricted by --source tracks source freshness and preserves global updatedAt for periodic check', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');
  const now = 1700000000000;
  const oldScanTime = now - 70 * 60 * 1000; // 70 minutes ago
  const intervalMin = 60;

  const registry = {
    sources: [
      {
        id: 'src-1',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://src1.local/v1',
        models: ['src-1/model-1'],
      },
      {
        id: 'src-2',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://src2.local/v1',
        models: ['src-2/model-1'],
      },
    ],
  };

  const initialQuotaState = {
    updatedAt: new Date(oldScanTime).toISOString(),
    sourceFreshness: {},
    scopes: {},
  };
  fs.writeFileSync(quotaFile, JSON.stringify(initialQuotaState, null, 2), 'utf8');

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
  });

  // Verify full scan is due before partial scan
  const stateBefore = quotaScan.loadQuotaState({ quotaStateFile: quotaFile });
  assert.equal(
    quotaScan.isQuotaScanDue(stateBefore, intervalMin, now),
    true,
    'Full scan must be due initially'
  );

  // Run partial scan restricted to src-1
  const partialRes = await quotaScan.scanAllQuotas({
    quotaStateFile: quotaFile,
    registry,
    source: 'src-1',
    now,
    fetch: mockFetch,
  });

  assert.equal(partialRes.count, 1, 'Only src-1 should be scanned');

  // Load state after partial scan
  const stateAfterPartial = quotaScan.loadQuotaState({ quotaStateFile: quotaFile });

  // 1. Global updatedAt must NOT be advanced by partial scan
  assert.equal(
    stateAfterPartial.updatedAt,
    new Date(oldScanTime).toISOString(),
    'Partial scan must not advance global updatedAt'
  );

  // 2. Per-source freshness must be recorded for src-1
  assert.ok(stateAfterPartial.sourceFreshness, 'sourceFreshness object must be present');
  assert.equal(
    stateAfterPartial.sourceFreshness['src-1'],
    new Date(now).toISOString(),
    'Freshness for src-1 must be recorded'
  );

  // 3. Periodic due check for full scan must NOT be postponed (remains true)
  assert.equal(
    quotaScan.isQuotaScanDue(stateAfterPartial, intervalMin, now),
    true,
    'Periodic check must not postpone full scan while other sources remain unscanned'
  );

  // 4. Per-source due check for src-1 must be false (not due)
  assert.equal(
    quotaScan.isQuotaScanDue(stateAfterPartial, intervalMin, now, 'src-1'),
    false,
    'src-1 scan is fresh and not due'
  );

  // 5. Per-source due check for src-2 must be true (unscanned / stale)
  assert.equal(
    quotaScan.isQuotaScanDue(stateAfterPartial, intervalMin, now, 'src-2'),
    true,
    'src-2 was not scanned and remains due'
  );

  // Run full scan without source restriction
  await quotaScan.scanAllQuotas({
    quotaStateFile: quotaFile,
    registry,
    now: now + 1000,
    fetch: mockFetch,
  });

  const stateAfterFull = quotaScan.loadQuotaState({ quotaStateFile: quotaFile });
  assert.equal(
    stateAfterFull.updatedAt,
    new Date(now + 1000).toISOString(),
    'Full scan must advance global updatedAt'
  );
  assert.equal(
    quotaScan.isQuotaScanDue(stateAfterFull, intervalMin, now + 1000),
    false,
    'Full scan satisfies periodic due check'
  );
});

// 8. Regression test for P2: Configurable fallback block TTL from dispatch config or live expiry data
test('P2 review finding 8: default block TTL is read from dispatch configuration or live expiry data, making fallback configurable', async () => {
  const now = 1700000000000;
  const dispatchConfig = sourcesApi.getDispatchConfig();
  assert.ok(
    Number(dispatchConfig.quotaBlockTtlMin) > 0,
    'sources.json dispatch config must define quotaBlockTtlMin'
  );
  assert.ok(
    Number(dispatchConfig.quotaBlockTtlMs) > 0,
    'sources.json dispatch config must define quotaBlockTtlMs'
  );

  // Scope entry with no retry-after recorded 90 minutes ago
  const atTime = now - 90 * 60 * 1000;
  const scopeEntry = {
    source: 'test-src',
    scope: 'test-scope',
    code: 'QUOTA',
    status: 429,
    reason: 'QUOTA',
    at: new Date(atTime).toISOString(),
    retryAfter: null,
  };

  // Case 1: When configured fallback TTL is 120 minutes (via options or dispatch config),
  // 90 minutes elapsed is less than 120 minutes: must remain blocked
  const isBlocked120 = quotaScan.isScopeBlocked(scopeEntry, now, { quotaBlockTtlMin: 120 });
  assert.equal(
    isBlocked120,
    true,
    'Scope must remain blocked at 90 minutes under 120-minute fallback TTL'
  );

  // At 130 minutes (elapsed > 120 minutes): must expire and become unblocked
  const isBlocked130 = quotaScan.isScopeBlocked(scopeEntry, atTime + 130 * 60 * 1000, {
    quotaBlockTtlMin: 120,
  });
  assert.equal(isBlocked130, false, 'Scope must expire after 120-minute fallback TTL elapses');

  // Case 2: Configurable fallback via options ttlMs or dispatchConfig object
  const isBlocked30 = quotaScan.isScopeBlocked(scopeEntry, now, {
    dispatchConfig: { quotaBlockTtlMin: 30 },
  });
  assert.equal(
    isBlocked30,
    false,
    'Scope must be unblocked at 90 minutes under 30-minute fallback TTL'
  );

  // Case 3: Live expiry data on scopeEntry (e.g. ttlMs) takes precedence over default
  const scopeEntryWithTtl = {
    ...scopeEntry,
    ttlMs: 45 * 60 * 1000, // 45 minutes live TTL
  };
  assert.equal(
    quotaScan.isScopeBlocked(scopeEntryWithTtl, now, { quotaBlockTtlMin: 120 }),
    false,
    'Live ttlMs on scopeEntry must take precedence over default dispatch fallback'
  );

  // Case 4: scanScope populates configured ttlMs on response without Retry-After
  const mockFetchNoRetryAfter = async () => ({
    ok: false,
    status: 429,
    headers: new Map(),
    text: async () => JSON.stringify({ error: { message: 'rate limit' } }),
  });

  const scanResult = await quotaScan.scanScope(
    {
      source: 'test-src',
      scope: 'test-src',
      upstream: 'test-src',
      model: 'test/m',
      endpoint: 'https://test.local/v1',
    },
    {
      now,
      fetch: mockFetchNoRetryAfter,
      quotaBlockTtlMin: 120,
    }
  );

  assert.equal(scanResult.code, 'RATE');
  assert.equal(scanResult.retryAfter, null);
  assert.equal(scanResult.ttlMs, 120 * 60 * 1000, 'scanScope must populate configured ttlMs');
});

// 9. Regression test for P1: Standalone quota-scan --periodic schedules initial scan and keeps timer referenced
test('P1 review finding 9: standalone quota-scan --periodic schedules initial scan and keeps timer referenced to prevent early exit', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    };
  };

  const registry = {
    sources: [
      {
        id: 'test-src',
        kind: 'model-source',
        endpoint: 'https://test.local/v1',
        models: ['test-model'],
      },
    ],
  };

  const cli = require('../cli');
  const res = await cli.quotaScanCommand(
    { periodic: true, out: quotaFile },
    {
      registry,
      fetch: mockFetch,
    }
  );

  // 1. Initial scan must have run immediately
  assert.ok(fetchCount > 0, 'Initial scan must be executed when scheduling periodic scan');
  assert.ok(fs.existsSync(quotaFile), 'Quota file must be created by initial scan');

  // 2. Timer must be referenced so standalone process does not exit
  assert.ok(res.runner, 'Runner must be returned');
  assert.equal(res.runner.timer.hasRef(), true, 'Standalone periodic timer must remain referenced');

  // 3. Explicit unref: true allows unreferencing
  const runnerUnref = quotaScan.schedulePeriodicQuotaScan({
    registry,
    quotaStateFile: quotaFile,
    fetch: mockFetch,
    unref: true,
  });
  assert.equal(
    runnerUnref.timer.hasRef(),
    false,
    'Timer must be unreferenced when unref: true is explicitly requested'
  );

  res.runner.stop();
  runnerUnref.stop();
});

// 10. Regression test for P1: Source without configured representative model is reported as unscannable rather than fabricating a model ID
test('P1 review finding 10: source without representative model is skipped from probing and reported unscannable rather than fabricating default model', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');
  const now = 1700000000000;

  const probedModels = [];
  const mockFetch = async (url, opts) => {
    let body = {};
    try {
      body = JSON.parse(opts?.body || '{}');
    } catch {}
    if (body.model) probedModels.push(body.model);
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    };
  };

  const registry = {
    sources: [
      {
        id: 'unconfigured-src',
        kind: 'model-source',
        endpoint: 'https://unconf.local/v1',
        // No models array, no verify.model
      },
      {
        id: 'configured-src',
        kind: 'model-source',
        endpoint: 'https://conf.local/v1',
        models: ['conf-provider/model-1'],
      },
    ],
  };

  const scanRes = await quotaScan.scanAllQuotas({
    registry,
    quotaStateFile: quotaFile,
    fetch: mockFetch,
    now,
  });

  // Must NOT probe unconfigured-src with fabricated model ID like unconfigured-src/default
  assert.equal(
    probedModels.some((m) => m.includes('default') || m.includes('unconfigured-src')),
    false,
    'Must not probe endpoint using fabricated default model'
  );
  assert.equal(
    probedModels.includes('conf-provider/model-1'),
    true,
    'Configured source model must be probed'
  );

  // Must report unconfigured-src as unscannable in scopes
  const unscannableScope = scanRes.scopes['unconfigured-src'];
  assert.ok(unscannableScope, 'Unconfigured source must be recorded in scopes');
  assert.equal(unscannableScope.code, 'UNSCANNABLE');
  assert.equal(unscannableScope.model, null);
  assert.equal(
    quotaScan.isScopeBlocked(unscannableScope, now),
    false,
    'Unscannable scope must not be blocked'
  );
});

// 11. Regression test for P1: Router discovery failure does not abort scanning remaining sources; automatic scanning handles per-source failures and makes state visible to routing
test('P1 review finding 11: router discovery failure is handled per-source, remaining sources are scanned, and automatic scanning surfaces state to routing', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');
  const now = 1700000000000;

  const registry = {
    sources: [
      {
        id: 'failing-router',
        kind: 'router',
        endpoint: 'https://failing-router.local/v1',
      },
      {
        id: 'healthy-src',
        kind: 'model-source',
        endpoint: 'https://healthy.local/v1',
        models: ['healthy-model-1'],
      },
    ],
  };

  let healthyScanned = false;
  const mockFetch = async (url) => {
    if (String(url).includes('failing-router')) {
      return {
        ok: false,
        status: 503,
        text: async () => 'Router unavailable',
      };
    }
    if (String(url).includes('healthy')) {
      healthyScanned = true;
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      };
    }
    return { ok: false, status: 500 };
  };

  // 1. scanAllQuotas must NOT abort when router discovery fails; it must scan healthy-src
  const scanRes = await quotaScan.scanAllQuotas({
    registry,
    quotaStateFile: quotaFile,
    fetch: mockFetch,
    now,
  });

  assert.equal(
    healthyScanned,
    true,
    'Healthy source must be scanned despite router discovery failure'
  );
  assert.equal(scanRes.scopes['healthy-src'].code, 'OK');
  assert.ok(scanRes.scopes['failing-router'], 'Failure state for failing router must be recorded');
  assert.equal(scanRes.scopes['failing-router'].code, 'DISCOVERY_FAILED');

  // 2. State is visible to routing
  const candidateHealthy = { source: 'healthy-src', modelId: 'healthy-model-1' };
  const scopeHealthy = quotaScan.getQuotaScopeState(candidateHealthy, scanRes);
  assert.equal(scopeHealthy.code, 'OK');
  assert.equal(quotaScan.isScopeBlocked(scopeHealthy, now), false);

  const candidateFailing = {
    source: 'failing-router',
    gateway: 'failing-router',
    modelId: 'any/model',
  };
  const scopeFailing = quotaScan.getQuotaScopeState(candidateFailing, scanRes);
  assert.ok(scopeFailing, 'Failing router scope state must be visible to routing');
  assert.equal(scopeFailing.code, 'DISCOVERY_FAILED');

  // 3. Automatic scanning via cli.js refreshRouteHealth does not silently discard failure
  const cli = require('../cli');
  const nextDeps = {
    registry,
    quotaStateFile: quotaFile,
    fetch: mockFetch,
    probeCap: 1,
    probeTimeoutMs: 1000,
  };

  // Simulate refreshRouteHealth hook setup in cli.js
  const hookDir = path.join(dir, 'root');
  fs.mkdirSync(hookDir, { recursive: true });
  const healthFile = path.join(hookDir, 'health.json');
  fs.writeFileSync(healthFile, JSON.stringify({ version: 1, paths: {}, events: [] }), 'utf8');

  // Call automatic scan in refreshRouteHealth
  const refreshRouteHealth = cli._createRefreshRouteHealth(
    { loop: true, root: hookDir, 'route-health': healthFile },
    nextDeps
  );
  assert.ok(typeof refreshRouteHealth === 'function', 'refreshRouteHealth hook must be created');

  const refreshResult = await refreshRouteHealth({ now: now + 4000000 });
  assert.ok(refreshResult, 'refreshRouteHealth must return result');
  assert.ok(refreshResult.quotaState, 'quotaState must be visible on refresh result');
  assert.equal(refreshResult.quotaState['healthy-src'].code, 'OK');
  assert.equal(refreshResult.quotaState['failing-router'].code, 'DISCOVERY_FAILED');
});
