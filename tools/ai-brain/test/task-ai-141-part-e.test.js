'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../route-health');
const candidatesApi = require('../candidates');
const cli = require('../cli');
const intake = require('../intake');

function temporaryStore(t) {
  const parent = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'ai141e-'));
  const file = path.join(dir, 'health.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file, store: routes.loadStore(file, { allowMissing: true }) };
}

test('route health normalizes aliases and classifies provider failures', () => {
  assert.equal(routes.normalizeModelId('ag/Claude-Sonnet-4-6'), 'claude-sonnet-4-6');
  assert.equal(routes.normalizeModelId('antigravity/gemini-3.1-pro'), 'gemini-3.1-pro');
  assert.deepEqual(
    [451, 402, 429, 403, 503].map((status) => routes.classifyFailure(status)),
    ['GEO_BLOCKED', 'NO_CREDIT', 'RATE_LIMITED', 'AUTH_NEEDED', 'UNAVAILABLE_NOW']
  );
});

test('missing health stores require an explicit bootstrap option', (t) => {
  const { file } = temporaryStore(t);
  assert.throws(() => routes.loadStore(file), /cannot load model route health store/);
  assert.deepEqual(routes.loadStore(file, { allowMissing: true }), {
    version: 1,
    paths: {},
    events: [],
  });
});

test('50 listed models retain only the 30 successful route probes and named failures', async (t) => {
  const { store } = temporaryStore(t);
  const models = Array.from({ length: 50 }, (_, i) => 'provider/model-' + i);
  const results = await Promise.all(
    models.map(async (model, i) => {
      const response = i < 30 ? { ok: true } : { ok: false, status: [451, 402, 429][(i - 30) % 3] };
      return routes.recordResult(store, model, 'gateway-a', response, 1_800_000_000_000);
    })
  );
  assert.equal(results.filter((row) => row.eligible).length, 30);
  assert.equal(
    Object.keys(store.paths).length,
    50,
    'successful and failed route identities are retained'
  );
  assert.equal(Object.values(store.paths).filter((row) => row.status === 'AVAILABLE').length, 30);
  assert.equal(store.paths['provider/model-30|gateway-a'].status, 'GEO_BLOCKED');
  assert.equal(store.paths['provider/model-31|gateway-a'].status, 'NO_CREDIT');
  assert.equal(store.paths['provider/model-32|gateway-a'].status, 'RATE_LIMITED');
  assert.equal(
    routes.isEligible(store, 'provider/model-30', 'gateway-a', 1_800_000_000_001),
    false
  );
});

test('failed route falls back to the same model and records the chosen path', async (t) => {
  const { store } = temporaryStore(t);
  const now = 1_800_000_000_000;
  routes.recordResult(store, 'ag/gemini-3.1-pro', 'path-1', { ok: false, status: 451 }, now);
  const result = await routes.routeFallback(
    'gemini-3.1-pro',
    'path-1',
    [
      { id: 'path-2', evidence: 10 },
      { id: 'path-3', evidence: 5 },
    ],
    async (_model, route) => (route.id === 'path-2' ? { ok: false, status: 429 } : { ok: true }),
    store,
    { now, failureReason: 'GEO_BLOCKED' }
  );
  assert.equal(result.ok, true);
  assert.equal(result.route.id, 'path-3');
  assert.deepEqual(result.failures, [{ path: 'path-2', reason: 'RATE_LIMITED' }]);
  assert.ok(
    store.events.some((row) => row.type === 'route_fallback' && row.chosenPath === 'path-3')
  );
});

test('all route failures retain per-path reasons and a due 402 retry restores immediately', async (t) => {
  const { store, file } = temporaryStore(t);
  const now = 1_800_000_000_000;
  routes.recordResult(store, 'model-x', 'p1', { ok: false, status: 451 }, now);
  const failed = await routes.routeFallback(
    'model-x',
    'p1',
    [{ id: 'p2' }, { id: 'p3' }],
    async (_m, p) => ({
      ok: false,
      status: p.id === 'p2' ? 402 : 503,
    }),
    store,
    { now }
  );
  assert.equal(failed.unavailable, true);
  assert.deepEqual(failed.failures, [
    { path: 'p2', reason: 'NO_CREDIT' },
    { path: 'p3', reason: 'UNAVAILABLE_NOW' },
  ]);
  const retryAt = Date.parse(store.paths['model-x|p2'].nextCheckAt);
  const retryResponse = { ok: true };
  let called = 0;
  const checked = await routes.recheckDue(
    store,
    async (_model, routeId) => {
      called += 1;
      assert.equal(routeId, 'p2');
      return retryResponse;
    },
    { now: retryAt + 1, cap: 1 }
  );
  assert.equal(called, 1);
  assert.equal(checked.restored.length, 1);
  assert.ok(store.events.some((row) => row.type === 'route_restored'));
  assert.ok(retryAt > now);
  routes.saveStore(file, store);
  const loaded = routes.loadStore(file, { allowMissing: true });
  assert.equal(
    Object.keys(loaded.paths).length,
    3,
    'route identities remain persisted after recovery'
  );
});

test('an existing failed route keeps its retry schedule when fallback is entered', async (t) => {
  const { store } = temporaryStore(t);
  const now = 1_800_000_000_000;
  routes.recordResult(
    store,
    'model-reset',
    'p1',
    { ok: false, status: 429, resetAt: new Date(now + 60000).toISOString() },
    now
  );
  const expected = store.paths['model-reset|p1'].nextCheckAt;
  await routes.routeFallback('model-reset', 'p1', [], async () => ({ ok: false }), store, {
    now: now + 1000,
  });
  assert.equal(store.paths['model-reset|p1'].nextCheckAt, expected);
});

test('backoff grows and continues daily; failed models are parked, not removed', (t) => {
  const { store } = temporaryStore(t);
  let now = 1_800_000_000_000;
  const delays = [];
  for (let i = 0; i < 6; i += 1) {
    const row = routes.recordResult(
      store,
      'provider/model-y',
      'gateway',
      { ok: false, status: 500 },
      now
    );
    delays.push(Date.parse(store.paths[row.key].nextCheckAt) - now);
    now += 1;
  }
  assert.deepEqual(delays, [
    30 * 60e3,
    2 * 60 * 60e3,
    6 * 60 * 60e3,
    24 * 60 * 60e3,
    24 * 60 * 60e3,
    24 * 60 * 60e3,
  ]);
  assert.equal(routes.normalizeModelId('model-y'), 'model-y');
  assert.equal(Object.keys(store.paths).length, 1);
});

test('gateway candidates retain successful probes, apply hand additions and honor exclusions', (t) => {
  const registry = {
    sources: [
      { id: 'gateway-a', kind: 'router', endpoint: 'http://gateway' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'gateway-a' },
    ],
    dispatch: { providers: { 'vendor-a': { harness: 'paseo' } } },
  };
  const models = Array.from({ length: 50 }, (_, i) => ({
    gateway: 'gateway-a',
    upstream: 'vendor-a',
    modelId: 'vendor-a/model-' + i,
  }));
  const accounts = [
    {
      id: 'acct',
      provider: 'vendor-a',
      models: [{ model: 'vendor-a/model-0', exclude: true }, 'vendor-a/model-extra'],
    },
  ];
  const store = routes.loadStore(temporaryStore(t).file, { allowMissing: true });
  routes.recordResult(store, 'vendor-a/model-extra', 'gateway-a', { ok: true }, 1_800_000_000_000);
  for (let i = 0; i < 50; i += 1)
    routes.recordResult(
      store,
      models[i].modelId,
      'gateway-a',
      i < 30 ? { ok: true } : { ok: false, status: [451, 402, 429][(i - 30) % 3] },
      1_800_000_000_000
    );
  const result = candidatesApi.gatewayAccountCandidates({
    registry,
    accounts,
    catalogue: models,
    routeHealth: store,
    now: 1_800_000_000_001,
  });
  assert.equal(result.length, 30);
  assert.ok(!result.some((row) => row.modelId === 'vendor-a/model-0'));
  assert.ok(result.some((row) => row.modelId === 'vendor-a/model-extra'));
});

test('candidate assembly uses existing probe evidence when a route health record is absent', () => {
  const registry = {
    sources: [
      { id: 'gateway-a', kind: 'router', endpoint: 'http://gateway' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'gateway-a' },
    ],
    dispatch: { providers: { 'vendor-a': { harness: 'paseo' } } },
  };
  const model = { gateway: 'gateway-a', upstream: 'vendor-a', modelId: 'vendor-a/model-live' };
  const assembled = cli.assembleForDispatch(
    { candidates: [model] },
    [{ id: 'acct', provider: 'vendor-a' }],
    registry,
    {
      routeHealth: { version: 1, paths: {}, events: [] },
      probeEvidence: (modelId, gateway) => modelId === model.modelId && gateway === 'gateway-a',
    }
  );
  assert.ok(assembled.some((candidate) => candidate.modelId === model.modelId));
});

test('unprobed catalogue rows remain visible without creating a bound route', () => {
  const registry = {
    sources: [
      { id: 'gateway-a', kind: 'router' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'gateway-a' },
    ],
    dispatch: { providers: { 'vendor-a': { harness: 'paseo' } } },
  };
  const model = { gateway: 'gateway-a', upstream: 'vendor-a', modelId: 'vendor-a/unprobed' };
  const assembled = cli.assembleForDispatch(
    { candidates: [model] },
    [{ id: 'acct', provider: 'vendor-a' }],
    registry,
    { routeHealth: { version: 1, paths: {}, events: [] }, offerings: [], registryAccounts: [] }
  );
  assert.ok(assembled.some((candidate) => candidate.modelId === model.modelId));
  assert.ok(!assembled.some((candidate) => candidate.accountId === 'acct'));
});

test('discovered same-model paths fall through 451 and 429 to success, recording fallback', async (t) => {
  const { store } = temporaryStore(t);
  const registry = {
    sources: [
      { id: 'ag', kind: 'router' },
      { id: 'zd', kind: 'router' },
      { id: 'cl', kind: 'router' },
      { id: 'acct-a', kind: 'model-source', reachedVia: 'ag' },
      { id: 'acct-b', kind: 'model-source', reachedVia: 'zd' },
      { id: 'acct-c', kind: 'model-source', reachedVia: 'cl' },
    ],
    dispatch: {
      providers: {
        'acct-a': { harness: 'paseo' },
        'acct-b': { harness: 'paseo' },
        'acct-c': { harness: 'paseo' },
      },
    },
  };
  const catalogue = ['ag/claude-sonnet-4-6', 'zd/claude-sonnet-4-6', 'cl/claude-sonnet-4-6'].map(
    (modelId) => ({ gateway: modelId.split('/')[0], modelId })
  );
  routes.recordResult(
    store,
    catalogue[0].modelId,
    'ag',
    { ok: false, status: 451 },
    1_800_000_000_000
  );
  const called = [];
  const result = await routes.routeFallbackDiscovered(
    'claude-sonnet-4-6',
    'ag',
    registry,
    [
      { id: 'acct-a', provider: 'acct-a' },
      { id: 'acct-b', provider: 'acct-b' },
      { id: 'acct-c', provider: 'acct-c' },
    ],
    catalogue,
    async (_model, route) => {
      called.push(route.id);
      return route.id === 'zd' ? { ok: false, status: 429 } : { ok: true };
    },
    store,
    { now: 1_800_000_000_000 }
  );
  assert.deepEqual(called, ['zd', 'cl']);
  assert.equal(result.route.id, 'cl');
  assert.ok(
    store.events.some(
      (event) =>
        event.type === 'route_fallback' && event.failedPath === 'ag' && event.chosenPath === 'cl'
    )
  );
});

test('fallback discovery includes direct sources and declared account paths', () => {
  const registry = {
    sources: [
      { id: 'gateway-a', kind: 'router' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'gateway-a' },
      {
        id: 'direct-vendor',
        kind: 'model-source',
        servesModels: true,
        harness: 'direct-http',
        accessPath: 'direct',
      },
      {
        id: 'agy-pool',
        kind: 'agent-cli',
        servesModels: true,
        harness: 'agy-pool',
        accessPath: 'cli',
      },
      {
        id: 'opencode',
        kind: 'agent-cli',
        servesModels: false,
        harness: 'opencode',
        accessPath: 'cli',
      },
    ],
    dispatch: {
      providers: {
        'vendor-a': { harness: 'paseo' },
        'direct-vendor': { harness: 'direct-http' },
        'agy-pool': { harness: 'agy-pool' },
      },
    },
  };
  const paths = routes.discoverModelPaths(
    'claude-sonnet-4-6',
    registry,
    [
      { id: 'router-account', provider: 'vendor-a' },
      { id: 'direct-account', provider: 'direct-vendor', models: ['claude-sonnet-4-6'] },
      { id: 'pool-account', provider: 'agy-pool', models: ['claude-sonnet-4-6'] },
    ],
    [{ gateway: 'gateway-a', modelId: 'ag/claude-sonnet-4-6', evidence: 4 }]
  );
  assert.deepEqual(paths.map((route) => route.id).sort(), [
    'agy-pool',
    'direct-vendor',
    'gateway-a',
  ]);
  assert.equal(paths.find((route) => route.id === 'direct-vendor').harness, 'direct-http');
  assert.equal(paths.find((route) => route.id === 'agy-pool').accessPath, 'cli');
});

test('intake assembly probes a bounded catalogue with a timeout and excludes failed routes', async (t) => {
  const { file, store } = temporaryStore(t);
  const registry = {
    sources: [
      { id: 'gateway-a', kind: 'router' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'gateway-a' },
    ],
    dispatch: { providers: { 'vendor-a': { harness: 'paseo' } } },
  };
  const catalogue = Array.from({ length: 50 }, (_, i) => ({
    gateway: 'gateway-a',
    upstream: 'vendor-a',
    modelId: 'vendor-a/model-' + i,
  }));
  const counts = [];
  const result = await cli.assembleForDispatch(
    { candidates: catalogue },
    [{ id: 'acct', provider: 'vendor-a' }],
    registry,
    {
      routeHealth: store,
      routeHealthFile: file,
      refreshRoutes: true,
      probeCap: 50,
      probeTimeoutMs: 500,
      now: 1_800_000_000_000,
      probeRoute: async (_model, _route, opts) => {
        assert.equal(opts.timeoutMs, 500);
        const i = counts.length;
        counts.push(i);
        return i < 30 ? { ok: true } : { ok: false, status: [451, 402, 429][(i - 30) % 3] };
      },
    }
  );
  assert.equal(counts.length, 50);
  assert.equal(result.length, 30, 'parked probe failures are excluded from explicit candidates');
  assert.equal(Object.keys(routes.loadStore(file).paths).length, 50);
});

test('intake persists bounded fake gateway probe results and reports per-account candidate counts', async (t) => {
  const root = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(root, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, 'ai141e-intake-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const id = 'FIXTURE-E-INTAKE';
  const itemDir = path.join(fixture, 'docs', 'product-spec', 'work-items');
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(path.join(itemDir, id + '.md'), intakeFixture(id));
  const registerDir = path.join(fixture, 'docs', 'product-spec', 'docs', '10-ai-collaboration');
  fs.mkdirSync(registerDir, { recursive: true });
  fs.writeFileSync(
    path.join(registerDir, 'FEATURE-DELIVERY-REGISTER.csv'),
    'delivery_order,slice,group,work_item_id,feature_id,feature_name,key_behavior,status,dependencies,work_item_path,branch,pr,codex_verdict,merge_commit\n1,S00,AI,' +
      id +
      ',,fixture,fixture,READY_FOR_AUTHOR,,docs/product-spec/work-items/' +
      id +
      '.md,feat/fixture,,,,\n'
  );
  const registry = {
    sources: [
      { id: 'gateway-a', kind: 'router', endpoint: 'http://gateway' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'gateway-a' },
    ],
    dispatch: { providers: { 'vendor-a': { harness: 'paseo' } } },
  };
  const models = Array.from({ length: 50 }, (_, i) => ({
    gateway: 'gateway-a',
    upstream: 'vendor-a',
    modelId: 'vendor-a/model-' + i,
  }));
  let probeCount = 0;
  const perAccount = [];
  const result = await intake.runIntake(
    { workItem: id },
    {
      root: fixture,
      baseSha: 'a'.repeat(40),
      resolveDependencies: () => [],
      buildCatalogue: () => models,
      listAccounts: () => [{ id: 'acct', provider: 'vendor-a' }],
      registry,
      routeHealthFile: path.join(fixture, 'route-health.json'),
      now: 1_800_000_000_000,
      probeCap: 50,
      probeTimeoutMs: 200,
      persistRouteHealth: true,
      probeRoute: async (_model, _route, options) => {
        assert.equal(options.timeoutMs, 200);
        const n = probeCount++;
        return n < 30 ? { ok: true } : { ok: false, status: [451, 402, 429][(n - 30) % 3] };
      },
    }
  );
  assert.equal(probeCount, 50);
  assert.equal(result.routeRefresh.count, 50);
  assert.equal(
    Object.keys(routes.loadStore(path.join(fixture, 'route-health.json')).paths).length,
    50
  );
  const contributionLog = JSON.parse(
    fs.readFileSync(
      path.join(result.runDir, 'decisions', 'gateway-account-contributions.json'),
      'utf8'
    )
  );
  assert.deepEqual(contributionLog.accounts, [{ accountId: 'acct', count: 30 }]);
  assert.equal(contributionLog.candidateCount, 30);
  const assembled = await cli.assembleForDispatch(
    { candidates: models },
    result.accounts,
    registry,
    {
      routeHealth: routes.loadStore(path.join(fixture, 'route-health.json')),
      refreshRoutes: false,
      trustCatalogueProbe: true,
      onAccountCount: (accountId, count) => perAccount.push({ accountId, count }),
    }
  );
  assert.equal(assembled.length, 60, 'parked probe failures stay excluded from live candidates');
  assert.deepEqual(perAccount, [{ accountId: 'acct', count: 30 }]);
});

test('all failed routes emit an unavailable decision with every path reason', async (t) => {
  const { store } = temporaryStore(t);
  const now = 1_800_000_000_000;
  routes.recordResult(store, 'model-z', 'p1', { ok: false, status: 451 }, now);
  const result = await routes.routeFallback(
    'model-z',
    'p1',
    [{ id: 'p2' }, { id: 'p3' }],
    async (_model, route) => ({ ok: false, status: route.id === 'p2' ? 401 : 404 }),
    store,
    { now }
  );
  assert.equal(result.unavailable, true);
  assert.deepEqual(store.events.at(-1).failures, [
    { path: 'p2', reason: 'AUTH_NEEDED' },
    { path: 'p3', reason: 'UNSUPPORTED' },
  ]);
  assert.ok(
    store.events.some(
      (event) => event.type === 'operator_action_required' && event.routeId === 'p2'
    )
  );
});

test('geo-blocked access class skips all paths marked geo-restricted', async (t) => {
  const { store } = temporaryStore(t);
  routes.recordResult(store, 'model-g', 'p1', { ok: false, status: 451 }, 1_800_000_000_000);
  const probed = [];
  const result = await routes.routeFallback(
    'model-g',
    'p1',
    [{ id: 'p2', geoBlocked: true }, { id: 'p3' }],
    async (_model, route) => {
      probed.push(route.id);
      return { ok: true };
    },
    store,
    {
      now: 1_800_000_000_000,
      failureReason: 'GEO_BLOCKED',
    }
  );
  assert.deepEqual(probed, ['p3']);
  assert.equal(result.route.id, 'p3');
});

test('5xx fallback retries the failed path once with backoff before choosing another path', async (t) => {
  const { store } = temporaryStore(t);
  const attempts = [];
  const sleeps = [];
  const result = await routes.routeFallback(
    'model-retry',
    'p1',
    [{ id: 'p2' }],
    async (_model, route, options) => {
      attempts.push([route.id, options.attempt]);
      return options.attempt === 0 ? { ok: false, status: 503 } : { ok: true };
    },
    store,
    { now: 1_800_000_000_000, sleep: async (ms) => sleeps.push(ms), retryBackoffMs: 25 }
  );
  assert.equal(result.route.id, 'p2');
  assert.deepEqual(attempts, [
    ['p2', 0],
    ['p2', 1],
  ]);
  assert.deepEqual(sleeps, [25]);
});

test('due parked routes are eligible for recheck and selection only after refresh', async (t) => {
  const { store } = temporaryStore(t);
  const now = 1_800_000_000_000;
  routes.recordResult(store, 'model-due', 'gateway', { ok: false, status: 429 }, now);
  store.paths['model-due|gateway'].nextCheckAt = new Date(now).toISOString();
  assert.equal(routes.isEligible(store, 'model-due', 'gateway', now - 1), false);
  assert.equal(routes.isDue(store, 'model-due', 'gateway', now + 1), true);
  assert.equal(routes.isEligible(store, 'model-due', 'gateway', now + 1), false);
  await routes.recheckDue(store, async () => ({ ok: true }), { now: now + 1 });
  assert.equal(routes.isEligible(store, 'model-due', 'gateway', now + 2), true);
});

test('probe --due returns failure when every due route remains parked', async (t) => {
  const { file, store } = temporaryStore(t);
  const now = Date.now();
  routes.recordResult(store, 'model-due-fail', 'gateway', { ok: false, status: 429 }, now - 60000);
  store.paths['model-due-fail|gateway'].nextCheckAt = new Date(now - 1).toISOString();
  routes.saveStore(file, store);
  const result = await routes.runDueCli({
    file,
    cap: 1,
    log: () => {},
    probe: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(result, 1);
});

test('assembly performs due checks and bounded fresh probes before building live candidates', async (t) => {
  const { file, store } = temporaryStore(t);
  const registry = {
    sources: [
      { id: 'gateway-a', kind: 'router' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'gateway-a' },
    ],
    dispatch: { providers: { 'vendor-a': { harness: 'paseo' } } },
  };
  const model = { gateway: 'gateway-a', upstream: 'vendor-a', modelId: 'vendor-a/live-model' };
  const health = routes.recordResult(
    store,
    model.modelId,
    'gateway-a',
    { ok: false, status: 402 },
    1_800_000_000_000
  );
  store.paths[health.key].nextCheckAt = new Date(1_800_000_000_000).toISOString();
  let calls = 0;
  const candidates = await cli.assembleForDispatch(
    { candidates: [model] },
    [{ id: 'acct', provider: 'vendor-a' }],
    registry,
    {
      routeHealth: store,
      routeHealthFile: file,
      refreshRoutes: true,
      now: 1_800_000_000_001,
      probeCap: 1,
      probeRoute: async () => {
        calls += 1;
        return { ok: true };
      },
      offerings: [],
      registryAccounts: [],
    }
  );
  assert.equal(calls, 1);
  assert.equal(routes.loadStore(file).paths[health.key].status, 'AVAILABLE');
  assert.equal(candidates.length, 1, 'explicit candidate replay preserves the supplied row');
});

test('live assembly fallback discovers account paths outside the catalogue', async (t) => {
  const { file, store } = temporaryStore(t);
  const now = 1_800_000_000_000;
  const registry = {
    sources: [
      { id: 'ag', kind: 'router' },
      { id: 'direct-vendor', kind: 'model-source', servesModels: true, endpoint: 'direct' },
      { id: 'acct-a', kind: 'model-source', reachedVia: 'ag' },
    ],
    dispatch: {
      providers: { 'acct-a': { harness: 'paseo' }, 'direct-vendor': { harness: 'direct' } },
    },
  };
  const catalogue = [{ gateway: 'ag', upstream: 'ag', modelId: 'ag/model-fallback', evidence: 2 }];
  routes.recordResult(store, catalogue[0].modelId, 'ag', { ok: false, status: 451 }, now);
  const counts = [];
  const result = await cli.assembleForDispatch(
    { candidates: catalogue },
    [
      { id: 'account-a', provider: 'acct-a' },
      { id: 'account-direct', provider: 'direct-vendor', models: ['model-fallback'] },
    ],
    registry,
    {
      routeHealth: store,
      routeHealthFile: file,
      refreshRoutes: true,
      now: now + 1,
      probeCap: 2,
      probeRoute: async (_model, route) => {
        counts.push(route);
        return { ok: route === 'direct-vendor' };
      },
      offerings: [],
      registryAccounts: [],
      onAccountCount: (accountId, count) => counts.push(`${accountId}:${count}`),
    }
  );
  assert.ok(!result.some((candidate) => candidate.gateway === 'ag'));
  assert.ok(
    store.events.some(
      (event) =>
        event.type === 'route_fallback' &&
        event.failedPath === 'ag' &&
        event.chosenPath === 'direct-vendor'
    )
  );
  assert.ok(
    result.some(
      (candidate) => candidate.modelId === 'model-fallback' && candidate.gateway === 'direct-vendor'
    )
  );
  assert.ok(result.some((candidate) => candidate.gateway === 'direct-vendor'));
});

test('fallback assembly probes every discovered direct and harness path', async (t) => {
  const { file, store } = temporaryStore(t);
  const now = 1_800_000_000_000;
  const registry = {
    sources: [
      { id: 'ag', kind: 'router' },
      { id: 'vendor-a', kind: 'model-source', reachedVia: 'ag' },
      { id: 'direct-vendor', kind: 'model-source', servesModels: true },
    ],
    dispatch: {
      providers: {
        'vendor-a': { harness: 'paseo' },
        'direct-vendor': { harness: 'direct' },
      },
    },
  };
  const catalogue = [{ gateway: 'ag', upstream: 'ag', modelId: 'ag/model-every-path' }];
  routes.recordResult(store, catalogue[0].modelId, 'ag', { ok: false, status: 451 }, now);
  const attempted = [];
  await cli.assembleForDispatch(
    { candidates: catalogue },
    [{ id: 'direct-account', provider: 'direct-vendor' }],
    registry,
    {
      routeHealth: store,
      routeHealthFile: file,
      refreshRoutes: true,
      now: now + 1,
      probeCap: 4,
      probeRoute: async (_model, route) => {
        attempted.push(route);
        return { ok: route === 'direct-vendor' };
      },
      offerings: [],
      registryAccounts: [],
    }
  );
  assert.deepEqual(attempted, ['direct-vendor']);
  assert.ok(
    store.events.some(
      (event) =>
        event.type === 'route_fallback' &&
        event.failedPath === 'ag' &&
        event.chosenPath === 'direct-vendor'
    )
  );
});

function intakeFixture(id) {
  return `# ${id}\n\n## Control\n\n| Field | Value |\n|---|---|\n| Work Item ID | \`${id}\` |\n| Feature ID | \`N/A\` |\n| Status | \`READY_FOR_AUTHOR\` |\n| Dependencies | \`None\` |\n| Assigned author | \`GEMINI\` |\n| Risk | \`LOW\` |\n| Complexity | \`standard\` |\n| Allowed paths | \`tools/ai-brain/cli.js\` |\n| Branch | \`feat/fixture\` |\n\n## Business Outcome\n\nFixture business outcome.\n\n## Acceptance Matrix\n\n| AC/Test ID | Scenario | Expected result | Evidence required |\n|---|---|---|---|\n| FX-01 | Fixture | Fixture passes | Test |\n\n## Verification Commands\n\n- \`node --test\`\n`;
}
