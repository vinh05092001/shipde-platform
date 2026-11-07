'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const health = require('../route-health');
const evidence = require('../evidence');
const routeEvidence = require('../route-evidence');
const quota = require('../quota-scan');
const { proofVerdict } = require('../discovery/catalogue-import');
const { candidateKey } = require('../discovery/identity');

beforeEach((t) => {
  const forbidden = () => assert.fail('network calls are forbidden in this offline suite');
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const transport of ['node:http', 'node:https']) {
    t.mock.method(require(transport), 'request', forbidden);
    t.mock.method(require(transport), 'get', forbidden);
  }
});

// Synthetic identities and already-redacted log/cache shapes; no host credentials.
const now = Date.parse('2026-11-07T00:00:00Z');
const at = new Date(now).toISOString();
const registry = {
  sources: [
    { id: '9router', kind: 'router' },
    { id: 'xkiro', kind: 'direct' },
  ],
  dispatch: { routeEvidenceMaxAgeMs: now - Date.parse('2026-11-06T23:59:00Z') },
};
const route = (over = {}) => ({
  harness: 'paseo',
  accessPath: 'cli',
  gateway: '9router',
  upstream: 'fixture-upstream',
  accountId: 'fixture-shared-key',
  quotaScope: 'fixture-budget',
  modelId: 'fixture-upstream/sample',
  ...over,
});
const emptyHealth = () => ({ version: 1, paths: {}, events: [] });
const context = (extra = {}) => ({ now, registry, evidenceData: { combinations: [] }, ...extra });
const scanRow = (over = {}) => ({
  source: '9router',
  scope: '9router::fixture-upstream',
  upstream: 'fixture-upstream',
  model: route().modelId,
  code: 'OK',
  status: 200,
  at,
  ...over,
});
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai171-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

for (const authLayer of [undefined, 'connection']) {
  test(`unclear auth (${authLayer || 'bare 401'}) parks only the failed candidate`, (t) => {
    const dir = scratch(t);
    const failed = route();
    evidence.recordProbe(dir, failed, {
      status: 'failed',
      httpStatus: 401,
      body: '[401]: unauthorized [REDACTED]',
      authLayer,
    });
    const data = evidence.loadEvidence(dir);
    const cd = data.cooldowns[candidateKey(failed)];
    assert.equal(cd.cause, 'auth_scope_unknown');
    assert.equal(cd.scope, 'unknown');
    assert.equal(cd.connectionId, null);
    const opts = { loadQuotaState: false };
    assert.equal(evidence.isCandidateBlocked(data, failed, opts).blocked, true);
    for (const sibling of [
      route({ modelId: 'fixture-upstream/other' }),
      route({ upstream: 'fixture-other', modelId: 'fixture-other/branch' }),
    ]) {
      assert.equal(evidence.isCandidateBlocked(data, sibling, opts).blocked, false);
    }
    assert.deepEqual(data.upstreamStatus || {}, {});
  });
}

test('confirmed gateway-key auth still blocks the shared key', (t) => {
  const dir = scratch(t);
  evidence.recordProbe(dir, route(), {
    status: 'failed',
    httpStatus: 401,
    body: '[REDACTED]',
    authLayer: 'gateway-key',
  });
  const data = evidence.loadEvidence(dir);
  assert.equal(
    evidence.isCandidateBlocked(data, route({ modelId: 'fixture-upstream/other' }), {
      loadQuotaState: false,
    }).blocked,
    true
  );
});

test('xkiro direct cannot borrow a 9Router success or cooldown', () => {
  const routed = route();
  const direct = route({ gateway: 'xkiro', upstream: 'xkiro' });
  const store = emptyHealth();
  health.rememberProbe(
    routed,
    { ok: true, status: 200 },
    {
      ...context(),
      routeHealth: store,
      persistRouteHealth: false,
    }
  );
  assert.equal(routeEvidence.recentRouteSuccess(routed, store, context()), true);
  assert.equal(routeEvidence.recentRouteSuccess(direct, store, context()), false);
  assert.equal(
    health.getPathRecord(store, direct.modelId, health.probeIdentity(direct).route),
    undefined
  );
  store.providers = {
    '9router:fixture-upstream': {
      status: 'PROVIDER_UNAVAILABLE',
      nextCheckAt: new Date(now + registry.dispatch.routeEvidenceMaxAgeMs).toISOString(),
    },
  };
  assert.match(
    health.probeCooldown(routed, { ...context(), routeHealth: store }),
    /PROBE_COOLDOWN/
  );
  assert.equal(health.probeCooldown(direct, { ...context(), routeHealth: store }), null);
  health.rememberProbe(
    direct,
    { ok: true, status: 200 },
    {
      ...context(),
      routeHealth: store,
      persistRouteHealth: false,
    }
  );
  assert.equal(routeEvidence.recentRouteSuccess(direct, store, context()), true);
  assert.match(
    health.probeCooldown(routed, { ...context(), routeHealth: store }),
    /PROBE_COOLDOWN/
  );
});

test('a sample quota OK proves that model, never a sibling or another branch', () => {
  const state = { scopes: { '9router::fixture-upstream': scanRow() } };
  assert.equal(routeEvidence.hasFreshOkOrCompletion(route(), state, context()), true);
  for (const other of [
    route({ modelId: 'fixture-upstream/other' }),
    route({ upstream: 'fixture-other', modelId: 'fixture-other/branch' }),
    route({ gateway: 'xkiro', upstream: 'xkiro' }),
  ]) {
    assert.equal(routeEvidence.hasFreshOkOrCompletion(other, state, context()), false);
  }
});

test('a blanket source OK without a sampled model proves no model alive', () => {
  const state = { scopes: { '9router': scanRow({ scope: '9router', model: null }) } };
  assert.equal(routeEvidence.hasFreshOkOrCompletion(route(), state, context()), false);
});

for (const [label, observedAt] of [
  ['stale', now - registry.dispatch.routeEvidenceMaxAgeMs - 1],
  ['future', now + registry.dispatch.routeEvidenceMaxAgeMs],
]) {
  test(`${label} sampled quota OK is not fresh route evidence`, () => {
    const state = {
      scopes: {
        '9router::fixture-upstream': scanRow({ at: new Date(observedAt).toISOString() }),
      },
    };
    assert.equal(routeEvidence.hasFreshOkOrCompletion(route(), state, context()), false);
  });
}

test('catalogue advertisement carries no ping or harness proof', () => {
  for (const [capability, reason] of [
    ['CATALOG_ONLY', 'NOT_A_PROOF'],
    ['API_PASS', 'PROOF_WITHHELD_NOT_PROBED'],
  ]) {
    const verdict = proofVerdict({
      capability,
      status: 'CURRENT_AVAILABLE',
      evidence: 'live catalogue only - not probed',
    });
    assert.equal(verdict.level, null);
    assert.equal(verdict.reason, reason);
  }
});

test('ping evidence stays API_PASS and does not prove harness execution', (t) => {
  const dir = scratch(t);
  evidence.recordProbe(dir, route(), {
    status: 'passed',
    level: evidence.Level.API,
    httpStatus: 200,
    at,
  });
  const items = evidence.getEvidence(evidence.loadEvidence(dir), route());
  assert.equal(evidence.proofLevelOf(items), evidence.ProofLevel.API_PASS);
  assert.equal(evidence.isHarnessProven(items), false);
  assert.equal(
    routeEvidence.recentRouteSuccess(
      route(),
      emptyHealth(),
      context({ evidenceData: evidence.loadEvidence(dir) })
    ),
    true
  );
});

test('harness proof is bound to the exact route and never becomes work-item proof', (t) => {
  const dir = scratch(t);
  evidence.recordProbe(dir, route(), {
    status: 'passed',
    level: evidence.Level.HARNESS,
    at,
  });
  const data = evidence.loadEvidence(dir);
  const items = evidence.getEvidence(data, route());
  assert.equal(evidence.proofLevelOf(items), evidence.ProofLevel.HARNESS_PASS);
  assert.equal(evidence.isHarnessProven(items), true);
  for (const other of [
    route({ harness: 'fixture-other-harness' }),
    route({ gateway: 'xkiro' }),
    route({ quotaScope: 'fixture-other-budget' }),
    route({ modelId: 'fixture-upstream/other' }),
  ]) {
    assert.deepEqual(evidence.getEvidence(data, other), []);
  }
});

test('quotaScope replay changes only a copied fake store and never writes the live stores', (t) => {
  const dir = scratch(t);
  const files = ['quota-state.json', 'model-route-health.json'].map((name) =>
    path.resolve(__dirname, '..', 'data', name)
  );
  const snapshot = (file) =>
    fs.existsSync(file)
      ? {
          hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
          mtime: fs.statSync(file).mtimeMs,
        }
      : null;
  const before = files.map(snapshot);
  t.after(() => assert.deepEqual(files.map(snapshot), before));
  // Guard before mutation: even an accidental default-path write fails without touching live data.
  for (const method of ['writeFileSync', 'mkdirSync', 'renameSync']) {
    const original = fs[method];
    t.mock.method(fs, method, (...args) => {
      for (const target of method === 'renameSync' ? args.slice(0, 2) : args.slice(0, 1)) {
        const relative = path.relative(dir, path.resolve(target));
        assert.ok(
          relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
          'all writes must stay in the scratch copy'
        );
      }
      return original(...args);
    });
  }
  const originalFile = path.join(dir, 'fake-original.json');
  const copiedFile = path.join(dir, 'copied-quota.json');
  quota.saveQuotaState(
    {
      scopes: {
        'fixture-budget': scanRow({
          source: 'fixture-budget',
          scope: 'fixture-budget',
          upstream: 'fixture-budget',
          model: null,
          code: 'QUOTA',
          status: 429,
          retryAfter: new Date(now + registry.dispatch.routeEvidenceMaxAgeMs).toISOString(),
        }),
      },
    },
    { quotaStateFile: originalFile }
  );
  const originalSnapshot = snapshot(originalFile);
  fs.copyFileSync(originalFile, copiedFile);
  const copy = quota.loadQuotaState({ quotaStateFile: copiedFile });
  const selected = quota.getQuotaScopeState(route(), copy, context());
  assert.equal(selected.scope, route().quotaScope);
  assert.equal(quota.isScopeBlocked(selected, now), true);
  const linked = route({ gateway: 'xkiro', accountId: 'fixture-other-key' });
  assert.equal(quota.getQuotaScopeState(linked, copy, context()), selected);
  assert.equal(
    quota.getQuotaScopeState(route({ quotaScope: 'fixture-other-budget' }), copy, context()),
    null
  );
  copy.scopes['fixture-budget'].code = 'OK';
  copy.scopes['fixture-budget'].status = 200;
  quota.saveQuotaState(copy, { quotaStateFile: copiedFile });
  const reloaded = quota.loadQuotaState({ quotaStateFile: copiedFile });
  assert.equal(
    quota.isScopeBlocked(quota.getQuotaScopeState(linked, reloaded, context()), now),
    false
  );
  assert.deepEqual(snapshot(originalFile), originalSnapshot);
  assert.deepEqual(files.map(snapshot), before);
});
