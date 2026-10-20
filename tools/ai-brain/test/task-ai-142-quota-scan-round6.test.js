'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const quotaScan = require('../quota-scan');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-round6-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'quota-state.json');
}

const okResponse = () => ({
  ok: true,
  status: 200,
  headers: new Map(),
  text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
});

const registry = {
  sources: [
    { id: 'failing-router', kind: 'router', endpoint: 'https://failing-router.local/v1' },
    {
      id: 'healthy-src',
      kind: 'model-source',
      endpoint: 'https://healthy.local/v1',
      models: ['healthy-model-1'],
      credential: { type: 'api-key', env: 'ROUND6_HEALTHY_KEY' },
    },
  ],
};

test('failed router discovery blocks router candidates and does not advance scan freshness', async (t) => {
  const quotaFile = fixture(t);
  const now = 1700000000000;
  const fetch = async (url) =>
    String(url).includes('failing-router')
      ? { ok: false, status: 503, text: async () => 'down' }
      : okResponse();

  const res = await quotaScan.scanAllQuotas({ registry, quotaStateFile: quotaFile, fetch, now });
  const state = quotaScan.loadQuotaState({ quotaStateFile: quotaFile });

  const routerScope = quotaScan.getQuotaScopeState(
    { gateway: 'failing-router', modelId: 'any/model' },
    res
  );
  assert.equal(routerScope.code, 'DISCOVERY_FAILED');
  assert.equal(quotaScan.isScopeBlocked(routerScope, now), true);

  assert.equal(state.updatedAt, null, 'incomplete full scan must not advance updatedAt');
  assert.equal(state.sourceFreshness['failing-router'], undefined);
  assert.ok(state.sourceFreshness['healthy-src']);
  assert.equal(quotaScan.isQuotaScanDue(state, 60, now + 1000), true);
  assert.equal(quotaScan.isQuotaScanDue(state, 60, now + 1000, 'failing-router'), true);

  // A later successful discovery clears the failure.
  const recovered = async (url) =>
    String(url).endsWith('/models')
      ? {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => '{"data":[{"id":"cl/m1"}]}',
          json: async () => ({ data: [{ id: 'cl/m1' }] }),
        }
      : okResponse();
  await quotaScan.scanAllQuotas({
    registry,
    quotaStateFile: quotaFile,
    fetch: recovered,
    now: now + 2000,
  });
  const after = quotaScan.loadQuotaState({ quotaStateFile: quotaFile });
  assert.notEqual(after.scopes['failing-router']?.code, 'DISCOVERY_FAILED');
  assert.ok(after.updatedAt);
});

test('an explicit env is used exclusively for credentials', async (t) => {
  const quotaFile = fixture(t);
  const prev = process.env.ROUND6_HEALTHY_KEY;
  process.env.ROUND6_HEALTHY_KEY = 'process-secret';
  t.after(() => {
    if (prev === undefined) delete process.env.ROUND6_HEALTHY_KEY;
    else process.env.ROUND6_HEALTHY_KEY = prev;
  });
  const seen = [];
  const fetch = async (url, init) => {
    seen.push(init?.headers?.authorization || null);
    return okResponse();
  };
  await quotaScan.scanAllQuotas({
    registry: { sources: [registry.sources[1]] },
    quotaStateFile: quotaFile,
    fetch,
    env: {},
    now: 1700000000000,
  });
  assert.ok(seen.length > 0);
  assert.ok(
    seen.every((h) => h === null),
    'process credential must not leak into a scoped scan'
  );
});

test('quota-scan --if-due --source gates on that source freshness', async (t) => {
  const quotaFile = fixture(t);
  const cli = require('../cli');
  const now = 1700000000000;
  const quotaState = {
    updatedAt: new Date(now).toISOString(),
    sourceFreshness: { 'other-src': new Date(now).toISOString() },
    scopes: {},
  };
  let fetched = false;
  const fetch = async () => {
    fetched = true;
    return okResponse();
  };
  const res = await cli.quotaScanCommand(
    { out: quotaFile, ifDue: true, source: 'healthy-src' },
    { registry: { sources: [registry.sources[1]] }, quotaState, now, fetch, env: {} }
  );
  assert.notEqual(
    res.gated,
    true,
    'stale source must be scanned although the global scan is fresh'
  );
  assert.equal(fetched, true);
});

test('missing interval configuration is an error, not a literal fallback', () => {
  assert.throws(
    () =>
      quotaScan.schedulePeriodicQuotaScan({
        registry: { sources: [], dispatch: {} },
        intervalMin: 0,
        initialScan: false,
        unref: true,
      }),
    /DISPATCH_CONFIG_INVALID|quotaScanIntervalMin/
  );
});

test('a gateway candidate whose sourceId names the upstream checks <gateway>::<upstream>', () => {
  const now = 1700000000000;
  const quotaState = {
    scopes: {
      '9router::cl': {
        source: '9router',
        scope: 'cl',
        code: 'QUOTA',
        at: new Date(now).toISOString(),
        retryAfter: now + 3600000,
      },
    },
  };
  const state = quotaScan.getQuotaScopeState(
    { sourceId: 'cl', gateway: '9router', modelId: 'model-without-prefix' },
    quotaState,
    { now }
  );
  assert.equal(state.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(state, now), true);
});

test('a 200 response without completion evidence does not clear an active block', async (t) => {
  const quotaFile = fixture(t);
  const now = 1700000000000;
  const src = registry.sources[1];
  const blocked = {
    source: src.id,
    scope: src.id,
    code: 'QUOTA',
    status: 402,
    reason: 'QUOTA',
    at: new Date(now).toISOString(),
    retryAfter: now + 3600000,
  };
  fs.writeFileSync(
    quotaFile,
    JSON.stringify({
      updatedAt: null,
      sourceFreshness: {},
      scopes: { [src.id]: blocked, [`${src.id}::${src.id}`]: blocked },
    })
  );
  for (const body of ['', '{"id":"x"}', '{"error":{"message":"upstream failed"}}']) {
    const fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => body,
    });
    const res = await quotaScan.scanAllQuotas({
      registry: { sources: [src] },
      quotaStateFile: quotaFile,
      fetch,
      env: {},
      now: now + 1000,
    });
    assert.equal(
      res.scopes[src.id].code,
      'QUOTA',
      `body ${JSON.stringify(body)} must not clear block`
    );
  }
});

test('authoritative HTTP statuses win over conflicting body keywords', () => {
  const h = new Map();
  assert.equal(quotaScan.classifyQuotaResponse(401, 'insufficient_quota', h).code, 'AUTH');
  assert.equal(quotaScan.classifyQuotaResponse(451, 'insufficient_quota', h).code, 'REGION');
  assert.equal(
    quotaScan.classifyQuotaResponse(403, 'requires tier upgrade; out of credits', h).code,
    'TIER'
  );
  assert.equal(quotaScan.classifyQuotaResponse(403, 'insufficient_quota', h).code, 'AUTH');
});

test('quota scan max_tokens comes from dispatch configuration', async () => {
  let sent = null;
  await quotaScan.scanScope(
    { source: 's', scope: 's', upstream: 's', model: 'm', endpoint: 'https://s.local/v1' },
    {
      registry: { sources: [], dispatch: {} },
      quotaScanMaxTokens: 7,
      env: {},
      fetch: async (url, init) => {
        sent = JSON.parse(init.body);
        return okResponse();
      },
    }
  );
  assert.equal(sent.max_tokens, 7);
});

test('a source without a probe target is not marked fresh', async (t) => {
  const quotaFile = fixture(t);
  const now = 1700000000000;
  await quotaScan.scanAllQuotas({
    registry: {
      sources: [{ id: 'nomodel', kind: 'model-source', endpoint: 'https://n.local/v1' }],
    },
    quotaStateFile: quotaFile,
    fetch: async () => okResponse(),
    env: {},
    now,
  });
  const state = quotaScan.loadQuotaState({ quotaStateFile: quotaFile });
  assert.equal(state.scopes.nomodel.code, 'UNSCANNABLE');
  assert.equal(state.sourceFreshness.nomodel, undefined);
  assert.equal(state.updatedAt, null);
});

test('candidate blocking fails closed when quota state cannot be evaluated', () => {
  const evidence = require('../evidence');
  const res = evidence.isCandidateBlocked(
    { upstreamStatus: {}, candidates: {} },
    { sourceId: 's', modelId: 'm', accountId: 'a' },
    {
      quotaState: {
        get scopes() {
          throw new Error('corrupt state');
        },
      },
    }
  );
  assert.equal(res.blocked, true);
  assert.match(res.reason, /QUOTA_SCOPE_STATE_ERROR/);
});
