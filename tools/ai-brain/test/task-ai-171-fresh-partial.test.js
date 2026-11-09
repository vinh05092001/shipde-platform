'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  catalogueFreshness,
  sourceFreshness,
  refreshCatalogue,
  writeJson,
} = require('../catalogue-refresh');
const { assembleForDispatch } = require('../cli');

const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-partial-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const candidateRow = (id, gateway, source) => ({
  harness: 'test-harness',
  accessPath: 'test-path',
  gateway,
  upstream: gateway,
  source: source || gateway,
  accountId: 'test-account',
  quotaScope: 'test-quota',
  modelId: `test-vendor/${id}`,
});

function makeFreshnessFixture(now) {
  const oneHourAgo = new Date(now - 3600 * 1000).toISOString();
  const threeDaysAgo = new Date(now - 3 * 24 * 3600 * 1000).toISOString();
  const seventeenMinutesAgo = new Date(now - 17 * 60 * 1000).toISOString();

  return {
    sources: [
      {
        id: '9router',
        kind: 'router',
        status: 'enumerated',
        durationMs: 3317,
        incomplete: false,
        reason: null,
        advertised: 1205,
        catalogs: [{ upstream: 'combo', count: 1 }],
      },
      {
        id: 'opencode:agentrouter',
        kind: 'router',
        status: 'unavailable',
        durationMs: 401,
        incomplete: true,
        reason: 'HTTP_401',
        advertised: 0,
        catalogs: [],
        lastSuccessfulAt: threeDaysAgo,
      },
      {
        id: 'agy-gateway',
        kind: 'router',
        status: 'unavailable',
        durationMs: 2,
        incomplete: true,
        reason: 'catalogue unavailable at this moment',
        advertised: 0,
        catalogs: [],
        lastSuccessfulAt: oneHourAgo,
      },
      {
        id: 'opencode:scaleway',
        kind: 'router',
        status: 'unavailable',
        durationMs: 403,
        incomplete: true,
        reason: 'HTTP_403',
        advertised: 0,
        catalogs: [],
        lastSuccessfulAt: null,
      },
    ],
    listedSources: 45,
    lastAttemptAt: seventeenMinutesAgo,
    lastSuccessfulAt: seventeenMinutesAgo,
    complete: false,
    failedSources: [
      { id: 'opencode:agentrouter', reason: 'HTTP_401' },
      { id: 'agy-gateway', reason: 'catalogue unavailable at this moment' },
      { id: 'opencode:scaleway', reason: 'HTTP_403' },
    ],
  };
}

test('TASK-AI-171: per-source freshness from real-freshness shape', (t) => {
  const now = Date.parse('2026-11-09T16:00:00.000Z');
  const fixture = makeFreshnessFixture(now);

  // (a) source listed this run -> admitted
  const resA = sourceFreshness('9router', { freshness: fixture, now });
  assert.equal(resA.admitted, true);
  assert.equal(resA.stale, false);
  assert.equal(resA.code, null);

  // (b) source failed this run with last good 3 days ago -> rejected with reason
  const resB = sourceFreshness('opencode:agentrouter', { freshness: fixture, now });
  assert.equal(resB.admitted, false);
  assert.equal(resB.stale, true);
  assert.equal(resB.code, 'SOURCE_CATALOGUE_STALE');

  // (c) source failed with last good 1 hour ago -> admitted, marked stale-listing-retained
  const resC = sourceFreshness('agy-gateway', { freshness: fixture, now });
  assert.equal(resC.admitted, true);
  assert.equal(resC.stale, false);
  assert.equal(resC.staleListingRetained, true);
  assert.equal(resC.status, 'stale-listing-retained');

  // (d) global lastSuccessfulAt alone cannot admit a failed source
  const resD = sourceFreshness('opencode:scaleway', { freshness: fixture, now });
  assert.equal(resD.admitted, false);
  assert.equal(resD.stale, true);
  assert.equal(resD.code, 'SOURCE_CATALOGUE_STALE');
});

test('TASK-AI-171: admission in assembleForDispatch enforces per-source freshness', (t) => {
  const now = Date.parse('2026-11-09T16:00:00.000Z');
  const fixture = makeFreshnessFixture(now);

  const candA = candidateRow('model-a', '9router');
  const candB = candidateRow('model-b', 'opencode:agentrouter');
  const candC = candidateRow('model-c', 'agy-gateway');
  const candD = candidateRow('model-d', 'opencode:scaleway');

  const registry = {
    sources: [
      { id: '9router' },
      { id: 'opencode:agentrouter' },
      { id: 'agy-gateway' },
      { id: 'opencode:scaleway' },
    ],
    dispatch: { providers: {} },
  };

  const admitted = assembleForDispatch({ candidates: [] }, [], registry, {
    candidates: [candA, candB, candC, candD],
    freshness: fixture,
    now,
    evidenceData: {},
    offerings: [],
    registryAccounts: [],
    discoverPool: false,
    routeHealth: { version: 1, paths: {}, events: [] },
    allowUnprobedCandidates: true,
  });

  // (a) source listed this run -> admitted
  assert.ok(admitted.some((c) => c.gateway === '9router'));

  // (b) source failed this run with last good 3 days ago -> rejected with reason
  assert.equal(
    admitted.some((c) => c.gateway === 'opencode:agentrouter'),
    false
  );
  assert.ok(
    admitted.excludedRoutes.some(
      (r) =>
        r.reasonCode === 'SOURCE_CATALOGUE_STALE' &&
        (r.candidateKey.includes('opencode:agentrouter') ||
          r.offeringId.includes('opencode:agentrouter'))
    )
  );

  // (c) source failed with last good 1 hour ago -> admitted, marked stale-listing-retained
  const admittedC = admitted.find((c) => c.gateway === 'agy-gateway');
  assert.ok(admittedC);
  assert.equal(admittedC.staleListingRetained, true);

  // (d) global lastSuccessfulAt alone cannot admit a failed source
  assert.equal(
    admitted.some((c) => c.gateway === 'opencode:scaleway'),
    false
  );
  assert.ok(
    admitted.excludedRoutes.some(
      (r) =>
        r.reasonCode === 'SOURCE_CATALOGUE_STALE' &&
        (r.candidateKey.includes('opencode:scaleway') || r.offeringId.includes('opencode:scaleway'))
    )
  );
});

test('TASK-AI-171: catalogue-refresh preserves last-good timestamps across runs', async (t) => {
  const dir = tmpDir(t);
  const now = Date.parse('2026-11-09T16:00:00.000Z');
  const oneHourAgo = new Date(now - 3600 * 1000).toISOString();
  const freshnessFile = path.join(dir, 'freshness.json');

  // Seed prior freshness with a last good listing
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      sources: [
        { id: 'src-1', lastSuccessfulAt: oneHourAgo, status: 'enumerated' },
        { id: 'src-2', lastSuccessfulAt: oneHourAgo, status: 'enumerated' },
      ],
      lastSuccessfulAt: oneHourAgo,
    })
  );

  await refreshCatalogue({
    dataDir: dir,
    now,
    verifyEvidence: false,
    run: async (args, context) => {
      if (args[0] === 'discovery') {
        writeJson(context.discoveryFile, {
          sources: [
            {
              id: 'src-1',
              status: 'enumerated',
              advertised: 10,
              catalogs: [{ count: 10 }],
            },
            { id: 'src-2', status: 'unavailable', advertised: 0, catalogs: [] },
          ],
          listedSources: 1,
          lastAttemptAt: new Date(now).toISOString(),
          lastSuccessfulAt: new Date(now).toISOString(),
          complete: false,
          failedSources: [{ id: 'src-2', reason: 'HTTP_500' }],
        });
        return { exitCode: 0 };
      }
      return { exitCode: 0 };
    },
  });

  const updatedDoc = JSON.parse(fs.readFileSync(freshnessFile, 'utf8'));
  const s1 = updatedDoc.sources.find((s) => s.id === 'src-1');
  const s2 = updatedDoc.sources.find((s) => s.id === 'src-2');

  assert.equal(s1.lastSuccessfulAt, new Date(now).toISOString());
  assert.equal(s1.staleListingRetained, false);
  // Source 2 failed this run, but its previous last-good timestamp is retained
  assert.equal(s2.lastSuccessfulAt, oneHourAgo);
  assert.equal(s2.staleListingRetained, true);
});

test('TASK-AI-171: real freshness shape from .oc/real-freshness-2242.json', (t) => {
  const realFile = path.join(__dirname, '../../../.oc/real-freshness-2242.json');
  if (!fs.existsSync(realFile)) return;
  const realDoc = JSON.parse(fs.readFileSync(realFile, 'utf8'));
  const now = Date.parse('2026-11-09T16:00:00.000Z');

  // (a) 9router listed this run -> admitted
  const resA = sourceFreshness('9router', { freshness: realDoc, now });
  assert.equal(resA.admitted, true);
  assert.equal(resA.stale, false);

  // (d) opencode:agentrouter failed this run with no prior good listing in file -> rejected with reason
  const resD = sourceFreshness('opencode:agentrouter', { freshness: realDoc, now });
  assert.equal(resD.admitted, false);
  assert.equal(resD.code, 'SOURCE_CATALOGUE_STALE');

  // When given prior good evidence within 48h -> admitted, marked stale-listing-retained
  const modifiedDoc = JSON.parse(JSON.stringify(realDoc));
  const agy = modifiedDoc.sources.find((s) => s.id === 'agy-gateway');
  agy.lastSuccessfulAt = new Date(now - 3600 * 1000).toISOString();
  const resC = sourceFreshness('agy-gateway', { freshness: modifiedDoc, now });
  assert.equal(resC.admitted, true);
  assert.equal(resC.staleListingRetained, true);
  assert.equal(resC.status, 'stale-listing-retained');

  // When given prior good evidence 3 days ago -> rejected with reason
  agy.lastSuccessfulAt = new Date(now - 3 * 24 * 3600 * 1000).toISOString();
  const resB = sourceFreshness('agy-gateway', { freshness: modifiedDoc, now });
  assert.equal(resB.admitted, false);
  assert.equal(resB.code, 'SOURCE_CATALOGUE_STALE');
});
