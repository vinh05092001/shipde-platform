const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const quotaScan = require('../quota-scan');
const sourcesApi = require('../sources');
const capabilityProbe = require('../capability-probe');
const cli = require('../cli');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-findings-test-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
  return dir;
}

// 1. Regression test for P1: Scope lookup is isolated by source and does not apply 9router::cl to unrelated candidates
test('P1-1: scope lookup is isolated by source without cross-source aliases and respects blocked sourceId', () => {
  const quotaState = {
    scopes: {
      '9router::cl': {
        source: '9router',
        scope: 'cl',
        code: 'QUOTA',
      },
      anthropic: {
        source: 'anthropic',
        scope: 'anthropic',
        code: 'AUTH',
      },
      '9router': {
        source: '9router',
        scope: '9router',
        code: 'AUTH',
      },
      '9router::okscope': {
        source: '9router',
        scope: 'okscope',
        code: 'OK',
      },
    },
  };

  // Case A: Unrelated candidate with cl/ model prefix must NOT inherit 9router::cl block
  const unrelatedCandidate = {
    source: 'anthropic-direct',
    sourceId: 'anthropic-direct',
    modelId: 'cl/claude-3-5-sonnet',
  };
  const unrelatedState = quotaScan.getQuotaScopeState(unrelatedCandidate, quotaState);
  assert.equal(
    unrelatedState,
    null,
    'Unrelated candidate with cl/ prefix must not match 9router::cl'
  );

  // Case B: Candidate whose own sourceId is blocked must not be overridden by a non-blocked upstream scope
  const routerCandidateBlockedSource = {
    gateway: '9router',
    source: '9router',
    sourceId: '9router',
    upstream: 'okscope',
    modelId: 'okscope/model-1',
  };
  const blockedSourceState = quotaScan.getQuotaScopeState(routerCandidateBlockedSource, quotaState);
  assert.ok(blockedSourceState, 'Should resolve candidate scope');
  assert.equal(
    blockedSourceState.code,
    'AUTH',
    'Blocked sourceId must take precedence over non-blocked upstream scope'
  );
});

// 2. Regression test for P1: 9router results do not overwrite source-wide 9router key
test('P1-2: scanAllQuotas does not overwrite shared 9router source entry with per-upstream results', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');

  const registry = {
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        endpoint: 'https://router.local/v1',
      },
    ],
  };

  const fakeFetch = async (url, opts) => {
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () =>
          JSON.stringify({
            data: [{ id: 'alpha/model-a' }, { id: 'beta/model-b' }],
          }),
      };
    }
    // Upstream alpha returns 402 QUOTA, upstream beta returns 200 OK
    if (String(url).includes('chat/completions')) {
      const isAlpha = opts && opts.body && String(opts.body).includes('alpha');
      if (isAlpha) {
        return {
          ok: false,
          status: 402,
          headers: new Map(),
          text: async () => JSON.stringify({ error: { message: 'insufficient_quota' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    }
    return { ok: false, status: 500, headers: new Map(), text: async () => 'err' };
  };

  const res = await quotaScan.scanAllQuotas({
    registry,
    quotaStateFile: quotaFile,
    fetch: fakeFetch,
  });

  // Per-upstream keys must exist
  assert.ok(res.scopes['9router::alpha'], '9router::alpha scope should be saved');
  assert.ok(res.scopes['9router::beta'], '9router::beta scope should be saved');

  // Per-upstream outcomes must reflect their distinct status
  assert.equal(res.scopes['9router::alpha'].code, 'QUOTA', 'alpha upstream must be QUOTA');
  assert.equal(res.scopes['9router::alpha'].status, 402, 'alpha status must be 402');
  assert.equal(res.scopes['9router::beta'].code, 'OK', 'beta upstream must be OK');
  assert.equal(res.scopes['9router::beta'].status, 200, 'beta status must be 200');

  // Verify failure is isolated to alpha and not assigned to beta
  assert.equal(quotaScan.isScopeBlocked(res.scopes['9router::alpha']), true);
  assert.equal(quotaScan.isScopeBlocked(res.scopes['9router::beta']), false);

  // Must NOT assign per-upstream result to source-wide key '9router' or bare prefixes
  assert.equal(
    res.scopes['9router'],
    undefined,
    'Shared 9router key must not be assigned per-upstream result'
  );
  assert.equal(
    res.scopes['alpha'],
    undefined,
    'Bare upstream prefix must not be registered globally'
  );
  assert.equal(
    res.scopes['beta'],
    undefined,
    'Bare upstream prefix must not be registered globally'
  );
});

// 3. Regression test for P1: Quota blocking clears candidate.blocked after expiry
test('P1-3: candidate.blocked and blockScope are cleared after expiry', async () => {
  const now = 1700000000000;
  const expiryTime = now + 5000;

  const quotaState = {
    scopes: {
      '9router::cl': {
        source: '9router',
        scope: 'cl',
        code: 'QUOTA',
        at: now,
        retryAfter: expiryTime,
      },
    },
  };

  const candidate = {
    candidateKey: 'paseo::cl/test-model::acct-1',
    gateway: '9router',
    upstream: 'cl',
    modelId: 'cl/test-model',
  };

  const profile = { task: 'author', role: 'author' };
  const dispatchConfig = sourcesApi.getDispatchConfig(sourcesApi.loadSources());
  const batchSize = dispatchConfig.probeRoundRobinBatch || 1;

  // 1. Initial probe: candidate should be marked blocked
  capabilityProbe.orderCandidatesForProbe([candidate], profile, {
    quotaState,
    now: now + 100,
    probeRoundRobinBatch: batchSize,
  });

  assert.equal(candidate.blocked, true, 'Candidate should be blocked before expiry');
  assert.equal(candidate.blockScope, 'quota-scope');

  // 2. Probing again after expiry (now > expiryTime): candidate mark must be cleared!
  capabilityProbe.orderCandidatesForProbe([candidate], profile, {
    quotaState,
    now: expiryTime + 1000,
    probeRoundRobinBatch: batchSize,
  });

  assert.equal(candidate.blocked, false, 'Candidate blocked mark must be cleared after expiry');
  assert.equal(candidate.blockScope, undefined, 'blockScope must be cleared after expiry');
  assert.equal(candidate.blockReason, undefined, 'blockReason must be cleared after expiry');
});

// 4. Regression test for P1: Sensitive tokens and credentials in responses/errors are sanitized and bounded
test('P1-4: raw response bodies and fetch errors with credentials persist only sanitized, bounded reasons', async () => {
  const secretKey = 'sk-sensitive-secret-token-12345';
  const bearerToken = 'Bearer sensitive-bearer-token-abcde';
  const sensitiveUrl = 'https://api.provider.local/v1/chat?api_key=supersecretkey123';

  // Test classifyQuotaResponse with sensitive raw response text
  const rawBodyWithSecret = JSON.stringify({
    error: {
      message:
        `Failed upstream connection to ${sensitiveUrl} using ${bearerToken} and ${secretKey}. ` +
        'x'.repeat(200),
    },
  });

  const classified = quotaScan.classifyQuotaResponse(500, rawBodyWithSecret, new Map());
  assert.ok(!classified.reason.includes(secretKey), 'Secret key must be sanitized');
  assert.ok(!classified.reason.includes('supersecretkey123'), 'URL secret must be sanitized');
  assert.ok(
    !classified.reason.includes('sensitive-bearer-token'),
    'Bearer token must be sanitized'
  );
  assert.ok(classified.reason.length <= 100, 'Reason must be bounded to at most 100 chars');

  // Test scanScope error handling with sensitive error message
  const target = {
    source: 'test-src',
    scope: 'test-scope',
    upstream: 'test-up',
    model: 'test/model',
    endpoint: 'https://test.local',
  };

  const failingFetch = async () => {
    throw new Error(`Connection failed to ${sensitiveUrl} with ${bearerToken} and ${secretKey}`);
  };

  const scanResult = await quotaScan.scanScope(target, { fetch: failingFetch });
  assert.ok(!scanResult.reason.includes(secretKey), 'Error reason must sanitize secret key');
  assert.ok(
    !scanResult.reason.includes('supersecretkey123'),
    'Error reason must sanitize url token'
  );
  assert.ok(
    !scanResult.reason.includes('sensitive-bearer-token'),
    'Error reason must sanitize bearer token'
  );
  assert.ok(scanResult.reason.length <= 100, 'Error reason must be bounded to at most 100 chars');
});

// 5. Regression test for P1: quotaScanIntervalMin is used to gate scans and schedule periodic scans
test('P1-5: quotaScanIntervalMin gates scans when not due and schedules periodic scans', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');

  const registry = sourcesApi.loadSources();
  const dispatchConfig = sourcesApi.getDispatchConfig(registry);
  const intervalMin = dispatchConfig.quotaScanIntervalMin;
  assert.ok(
    typeof intervalMin === 'number' && intervalMin > 0,
    'quotaScanIntervalMin must be a positive number from config'
  );

  const now = 1700000000000;
  // Last scan was 5 minutes ago (well within intervalMin, which is e.g. 60m)
  const recentState = {
    updatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    scopes: { 'src1::s1': { code: 'OK' } },
  };

  // 1. isQuotaScanDue should return false when within intervalMin
  assert.equal(quotaScan.isQuotaScanDue(recentState, intervalMin, now), false);

  // 2. isQuotaScanDue should return true when intervalMin has elapsed
  const oldState = {
    updatedAt: new Date(now - (intervalMin + 1) * 60 * 1000).toISOString(),
    scopes: {},
  };
  assert.equal(quotaScan.isQuotaScanDue(oldState, intervalMin, now), true);

  // 3. quotaScanCommand with ifDue/gate skips scan if not due
  let fetchCalled = false;
  const fakeFetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, headers: new Map(), text: async () => '{}' };
  };

  const gatedRes = await cli.quotaScanCommand(
    { out: quotaFile, ifDue: true },
    {
      registry,
      quotaState: recentState,
      now,
      fetch: fakeFetch,
    }
  );
  assert.equal(gatedRes.gated, true, 'Scan must be gated when not due');
  assert.equal(fetchCalled, false, 'Fetch must not be called when scan is gated');

  // 4. Scheduling periodic scan returns runner with interval from config
  const scheduleRes = await cli.quotaScanCommand(
    { out: quotaFile, periodic: true },
    {
      registry,
      fetch: fakeFetch,
    }
  );
  assert.equal(scheduleRes.periodic, true);
  assert.equal(scheduleRes.intervalMin, intervalMin);
  assert.equal(fetchCalled, true, 'Initial scan must be executed when scheduling periodic scan');
  assert.equal(
    scheduleRes.runner.timer.hasRef(),
    true,
    'Standalone periodic timer must remain referenced to keep CLI process alive'
  );
  if (scheduleRes.runner && typeof scheduleRes.runner.stop === 'function') {
    scheduleRes.runner.stop();
  }
});
