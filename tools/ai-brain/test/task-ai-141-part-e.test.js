'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../route-health');

function temporaryStore(t) {
  const parent = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'ai141e-'));
  const file = path.join(dir, 'health.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file, store: routes.loadStore(file) };
}

test('route health normalizes aliases and classifies provider failures', () => {
  assert.equal(routes.normalizeModelId('ag/Claude-Sonnet-4-6'), 'claude-sonnet-4-6');
  assert.equal(routes.normalizeModelId('antigravity/gemini-3.1-pro'), 'gemini-3.1-pro');
  assert.deepEqual(
    [451, 402, 429, 403, 503].map((status) => routes.classifyFailure(status)),
    ['GEO_BLOCKED', 'NO_CREDIT', 'RATE_LIMITED', 'AUTH_NEEDED', 'UNAVAILABLE_NOW']
  );
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
  store.paths['model-x|p2'].nextCheckAt = new Date(now).toISOString();
  let called = 0;
  const checked = await routes.recheckDue(
    store,
    async () => {
      called += 1;
      return { ok: true };
    },
    { now: now + 1, cap: 1 }
  );
  assert.equal(called, 1);
  assert.equal(checked.restored.length, 1);
  assert.ok(store.events.some((row) => row.type === 'route_restored'));
  assert.ok(retryAt > now);
  routes.saveStore(file, store);
  const loaded = routes.loadStore(file);
  assert.equal(
    Object.keys(loaded.paths).length,
    3,
    'route identities remain persisted after recovery'
  );
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
