'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assembleForDispatch } = require('../cli');
const { candidateKey } = require('../candidates');
const { launchFromDecision } = require('../route-handoff');
const registry = {
  sources: [],
  dispatch: { providers: {} },
};
const row = (over = {}) => ({
  harness: 'paseo',
  accessPath: 'cli',
  gateway: 'fixture-router',
  upstream: 'vendor',
  source: 'fixture-router',
  accountId: 'lane-a',
  quotaScope: 'lane-a',
  modelId: 'vendor/Case/mini:free',
  ...over,
});
const assemble = (candidates, over = {}) =>
  assembleForDispatch({ candidates: [] }, [], registry, {
    candidates,
    evidenceData: {},
    offerings: [],
    registryAccounts: [],
    discoverPool: false,
    routeHealth: { version: 1, paths: {}, events: [] },
    probeEvidence: (modelId, route) =>
      candidates.some(
        (candidate) =>
          candidate.modelId === modelId &&
          candidate.gateway === route.id &&
          candidate.accountId === route.accountId
      ),
    ...over,
  });

test('PR02: implicit health files do not make injected admission depend on unrelated history', (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const health = require('../route-health');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pr02-admission-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const routeHealthFile = path.join(dir, 'health.json');
  const candidate = row();
  const options = { routeHealth: undefined, routeHealthFile, probeEvidence: undefined };
  assert.deepEqual(assemble([candidate], options).map(candidateKey), [candidateKey(candidate)]);
  const store = { version: 1, paths: {}, events: [] };
  health.recordResult(
    store,
    'other/model',
    'other-gateway',
    { ok: false, status: 429 },
    Date.now()
  );
  health.saveStore(routeHealthFile, store);
  assert.deepEqual(assemble([candidate], options).map(candidateKey), [candidateKey(candidate)]);
  assert.equal(assemble([candidate], { ...options, routeHealth: store }).length, 0);
  assert.equal(assemble([candidate], { ...options, requireRouteHealth: true }).length, 0);
  health.recordResult(
    store,
    candidate.modelId,
    { id: candidate.gateway, accountId: candidate.accountId },
    { ok: false, status: 401 },
    Date.now()
  );
  health.saveStore(routeHealthFile, store);
  const refused = assemble([candidate], options);
  assert.equal(refused.length, 0);
  assert.equal(refused.excludedRoutes[0].reasonCode, 'AUTH_NEEDED');
});

test('PR02: dedupe once without dropping accounts, slash IDs, vendors or effort variants', () => {
  const routes = [
    row(),
    row({ accountId: 'lane-b', quotaScope: 'lane-b' }),
    row({ modelId: 'other/Case/mini:free' }),
    row({ modelId: 'vendor/Case/mini:thinking' }),
    row({ harness: 'agy-pool', gateway: 'agy-pool', modelId: 'fixture-low' }),
    row({ harness: 'direct-http', gateway: 'direct' }),
  ];
  const actual = assemble([...routes, ...routes]);
  assert.equal(actual.length, routes.length);
  assert.deepEqual(actual.map(candidateKey), routes.map(candidateKey));
  assert.equal(actual[4].quality, undefined, 'unknown effort quality stays unknown');
});

test('PR02: probe injection cannot bypass a missing credential refusal', () => {
  const c = row({
    credentialEnvMissing: true,
    blocked: true,
    blockReason: 'CREDENTIAL_ENV_MISSING',
  });
  const actual = assemble([c], { probeEvidence: () => true });
  assert.equal(actual.length, 0);
  assert.equal(actual.excludedRoutes[0].reasonCode, 'CREDENTIAL_ENV_MISSING');
});

test('PR02: injected real route uses the same registry alias and account health lookup', () => {
  const health = require('../route-health');
  const store = { paths: {} };
  health.recordResult(
    store,
    'vendor/Case/mini:free',
    { id: 'fixture-router', accountId: 'lane-a' },
    {
      ok: true,
      status: 200,
    },
    Date.now()
  );
  const c = row({ modelId: 'transport/vendor/Case/mini:free' });
  const reg = { ...registry, sources: [{ id: 'fixture-router', aliases: ['transport'] }] };
  const actual = assembleForDispatch(null, [], reg, {
    candidates: [c],
    routeHealth: store,
    evidenceData: {},
  });
  assert.equal(actual.length, 1);
  assert.equal(actual[0].modelId, c.modelId);
});

test('PR02: allowing unprobed injection preserves known account health failures', () => {
  const health = require('../route-health');
  const store = { paths: {} };
  const failed = row();
  const unprobed = row({ accountId: 'lane-b', quotaScope: 'lane-b' });
  const routePath = { id: failed.gateway, accountId: failed.accountId };
  store.paths[health.healthKey(failed.modelId, routePath)] = { status: 'AUTH_NEEDED' };
  assert.equal(health.getPathRecord(store, failed.modelId, routePath).status, 'AUTH_NEEDED');

  const actual = assemble([failed, unprobed], {
    routeHealth: store,
    allowUnprobedCandidates: true,
    probeEvidence: () => false,
  });
  assert.deepEqual(actual.map(candidateKey), [candidateKey(unprobed)]);
  assert.deepEqual(
    actual.excludedRoutes.map(({ candidateKey: key, reasonCode }) => ({ key, reasonCode })),
    [{ key: candidateKey(failed), reasonCode: 'AUTH_NEEDED' }]
  );
});

test('PR02: injected admission requires probe evidence and refuses known failures', () => {
  const health = require('../route-health');
  const failed = row();
  const unknown = row({ accountId: 'lane-b', quotaScope: 'lane-b' });
  const store = { paths: {} };
  store.paths[
    health.healthKey(failed.modelId, { id: failed.gateway, accountId: failed.accountId })
  ] = {
    status: 'AUTH_NEEDED',
  };
  const options = { routeHealth: store, probeEvidence: undefined };
  assert.equal(assemble([unknown], options).length, 0);
  const proven = {
    ...options,
    probeEvidence: (modelId, route) =>
      modelId === unknown.modelId &&
      route.id === unknown.gateway &&
      route.accountId === unknown.accountId,
  };
  const actual = assemble([failed, unknown], proven);
  assert.deepEqual(actual.map(candidateKey), [candidateKey(unknown)]);
  assert.equal(actual.excludedRoutes[0].reasonCode, 'AUTH_NEEDED');
  assert.equal(assemble([unknown], { ...options, requireRouteHealth: true }).length, 0);
  assert.equal(assemble([unknown], { ...options, allowUnprobedCandidates: false }).length, 0);
});

test('PR02: duplicate combo candidate keeps its own selected model and resolved launch evidence', () => {
  const sources = require('../sources').loadSources();
  const c = row({
    gateway: '9router',
    source: '9router',
    modelId: 'fixture-team',
    routeKind: 'combo',
    comboMembers: ['vendor/Case/mini:free'],
  });
  const actual = assemble([c, c]);
  assert.equal(actual.length, 1);
  const key = candidateKey(actual[0]);
  const launched = launchFromDecision(
    { selected: key, candidates: [{ ...actual[0], offeringId: key }] },
    { prompt: 'fixture', mode: 'full-access' },
    sources
  );
  assert.equal(launched.offeringId, key);
  assert.ok(launched.model.endsWith('/fixture-team'));
  assert.deepEqual(actual[0].comboMembers, c.comboMembers);
});

test('PR02: delimiter and percent components cannot collapse separate route identities', () => {
  const { mergeCandidates } = require('../candidates');
  const { parseCandidateKey } = require('../discovery/identity');
  const a = row({ accountId: 'lane::part', quotaScope: 'quota', modelId: 'vendor/A%3A::B' });
  const b = row({ accountId: 'lane', quotaScope: 'part::quota', modelId: a.modelId });
  assert.equal(mergeCandidates([a], [b]).length, 2);
  assert.equal(parseCandidateKey(candidateKey(a)).modelId, a.modelId);
  assert.equal(parseCandidateKey(candidateKey(a)).account, a.accountId);
  const boundary = row({ accessPath: 'http://fixture.invalid/v1', accountId: ':lane:' });
  assert.equal(parseCandidateKey(candidateKey(boundary)).account, boundary.accountId);
  assert.equal(parseCandidateKey(candidateKey(boundary)).accessPath, boundary.accessPath);
});
