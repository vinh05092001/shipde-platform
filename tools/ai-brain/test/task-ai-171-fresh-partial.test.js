'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceFreshness } = require('../catalogue-refresh');
const { assembleForDispatch } = require('../cli');

const NOW = Date.parse('2026-11-09T16:00:00.000Z');

function buildFixture(now = NOW) {
  const iso = (ms) => new Date(now - ms).toISOString();
  return {
    sources: [
      {
        id: '9router',
        status: 'enumerated',
        advertised: 1205,
        catalogs: [{ upstream: 'combo', count: 1 }],
        lastSuccessfulAt: iso(17 * 60 * 1000),
      },
      {
        id: 'opencode:agentrouter',
        status: 'unavailable',
        advertised: 0,
        lastSuccessfulAt: iso(3 * 86400 * 1000),
      },
      {
        id: 'agy-gateway',
        status: 'unavailable',
        advertised: 0,
        lastSuccessfulAt: iso(3600 * 1000),
      },
      { id: 'opencode:scaleway', status: 'unavailable', advertised: 0, lastSuccessfulAt: null },
      { id: 'legacy-src', status: 'enumerated', advertised: 10 },
      {
        id: 'empty-enum',
        status: 'enumerated',
        advertised: 0,
        catalogs: [],
        lastSuccessfulAt: null,
      },
      {
        id: 'empty-nomodels',
        status: 'no-models',
        advertised: 0,
        catalogs: [],
        lastSuccessfulAt: null,
      },
      {
        id: 'empty-retained',
        status: 'enumerated',
        advertised: 0,
        catalogs: [],
        lastSuccessfulAt: iso(3600 * 1000),
      },
    ],
    listedSources: 45,
    lastAttemptAt: iso(17 * 60 * 1000),
    lastSuccessfulAt: iso(17 * 60 * 1000),
    complete: false,
    failedSources: [
      { id: 'opencode:agentrouter', reason: 'HTTP_401' },
      { id: 'agy-gateway', reason: 'catalogue unavailable at this moment' },
      { id: 'opencode:scaleway', reason: 'HTTP_403' },
    ],
  };
}

function dispatchCandidates(sourceIds, fixture, now = NOW) {
  const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
  return assembleForDispatch(
    { candidates: [] },
    [],
    { sources: ids.map((id) => ({ id })), dispatch: { providers: {} } },
    {
      candidates: ids.map((id) => ({
        harness: 'test',
        gateway: id,
        source: id,
        modelId: `vendor/${id}`,
      })),
      freshness: fixture,
      now,
      allowUnprobedCandidates: true,
    }
  );
}

test('(a) source listed this run -> admitted', () => {
  const fix = buildFixture();
  const fresh = sourceFreshness('9router', { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, true);
  assert.equal(fresh.stale, false);
  const res = dispatchCandidates('9router', fix);
  assert.equal(res.length, 1);
  assert.equal(res[0].gateway, '9router');
});

test('(b) source failed this run with last good 3 days ago -> rejected with reason', () => {
  const fix = buildFixture();
  const fresh = sourceFreshness('opencode:agentrouter', { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, false);
  assert.equal(fresh.code, 'SOURCE_CATALOGUE_STALE');
  const res = dispatchCandidates('opencode:agentrouter', fix);
  assert.equal(res.length, 0);
  assert.ok(res.excludedRoutes.some((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE'));
});

test('(c) source failed with last good 1 hour ago -> admitted, marked stale-listing-retained', () => {
  const fix = buildFixture();
  const fresh = sourceFreshness('agy-gateway', { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, true);
  assert.equal(fresh.staleListingRetained, true);
  assert.equal(fresh.status, 'stale-listing-retained');
  const res = dispatchCandidates('agy-gateway', fix);
  assert.equal(res.length, 1);
  assert.equal(res[0].staleListingRetained, true);
});

test('(d) global lastSuccessfulAt alone cannot admit a failed source', () => {
  const fix = buildFixture();
  const fresh = sourceFreshness('opencode:scaleway', { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, false);
  assert.equal(fresh.code, 'SOURCE_CATALOGUE_STALE');
  const res = dispatchCandidates('opencode:scaleway', fix);
  assert.equal(res.length, 0);
  assert.ok(res.excludedRoutes.some((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE'));
});

test('(1) legacy freshness file with only global lastSuccessfulAt -> explicit stale for all sources', () => {
  const legacyDoc = {
    lastAttemptAt: new Date(NOW).toISOString(),
    lastSuccessfulAt: new Date(NOW).toISOString(),
    complete: true,
    sources: [
      { id: 's1', status: 'enumerated', advertised: 5 },
      { id: 's2', status: 'unavailable', advertised: 0 },
    ],
  };
  for (const id of ['s1', 's2']) {
    const fresh = sourceFreshness(id, { freshness: legacyDoc, now: NOW });
    assert.equal(fresh.admitted, false);
    assert.equal(fresh.code, 'SOURCE_CATALOGUE_STALE');
  }
  const res = dispatchCandidates(['s1', 's2'], legacyDoc);
  assert.equal(res.length, 0);
  assert.equal(res.excludedRoutes.length, 2);
  assert.ok(res.excludedRoutes.every((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE'));
});

test('(2) mixed fixture: listed this run + failed 1h + failed 3d + legacy without timestamp', () => {
  const fix = buildFixture();
  const ids = ['9router', 'agy-gateway', 'opencode:agentrouter', 'legacy-src'];
  const fFresh = sourceFreshness(ids[0], { freshness: fix, now: NOW });
  const fRetained = sourceFreshness(ids[1], { freshness: fix, now: NOW });
  const fStale3d = sourceFreshness(ids[2], { freshness: fix, now: NOW });
  const fLegacy = sourceFreshness(ids[3], { freshness: fix, now: NOW });

  assert.equal(fFresh.admitted, true);
  assert.equal(fFresh.staleListingRetained, false);
  assert.equal(fRetained.admitted, true);
  assert.equal(fRetained.staleListingRetained, true);
  assert.equal(fStale3d.admitted, false);
  assert.equal(fStale3d.code, 'SOURCE_CATALOGUE_STALE');
  assert.equal(fLegacy.admitted, false);
  assert.equal(fLegacy.code, 'SOURCE_CATALOGUE_STALE');

  const res = dispatchCandidates(ids, fix);
  assert.equal(res.length, 2);
  assert.deepEqual(
    res.map((c) => c.gateway),
    ['9router', 'agy-gateway']
  );
  assert.equal(res.find((c) => c.gateway === 'agy-gateway').staleListingRetained, true);
  assert.equal(res.excludedRoutes.length, 2);
  assert.ok(res.excludedRoutes.every((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE'));
});

test('(3) empty-success: completed enumeration with 0 models follows contract', () => {
  const fix = buildFixture();
  // Status enumerated with 0 models advertised and empty catalogs: not admitted without prior good
  const fEnum = sourceFreshness('empty-enum', { freshness: fix, now: NOW });
  assert.equal(fEnum.admitted, false);
  assert.equal(fEnum.code, 'SOURCE_CATALOGUE_STALE');

  // Status no-models per discovery contract: not admitted without prior good
  const fNoMod = sourceFreshness('empty-nomodels', { freshness: fix, now: NOW });
  assert.equal(fNoMod.admitted, false);
  assert.equal(fNoMod.code, 'SOURCE_CATALOGUE_STALE');

  // Empty listing with retained prior good within 48h: admitted with stale-listing-retained
  const fRet = sourceFreshness('empty-retained', { freshness: fix, now: NOW });
  assert.equal(fRet.admitted, true);
  assert.equal(fRet.staleListingRetained, true);

  const res = dispatchCandidates(['empty-enum', 'empty-nomodels', 'empty-retained'], fix);
  assert.equal(res.length, 1);
  assert.equal(res[0].gateway, 'empty-retained');
  assert.equal(res[0].staleListingRetained, true);
});
