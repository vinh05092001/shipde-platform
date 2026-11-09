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

function dispatchCandidate(sourceId, fixture, now = NOW) {
  return assembleForDispatch(
    { candidates: [] },
    [],
    { sources: [{ id: sourceId }], dispatch: { providers: {} } },
    {
      candidates: [
        { harness: 'test', gateway: sourceId, source: sourceId, modelId: `vendor/${sourceId}` },
      ],
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
  const res = dispatchCandidate('9router', fix);
  assert.equal(res.length, 1);
  assert.equal(res[0].gateway, '9router');
});

test('(b) source failed this run with last good 3 days ago -> rejected with reason', () => {
  const fix = buildFixture();
  const fresh = sourceFreshness('opencode:agentrouter', { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, false);
  assert.equal(fresh.code, 'SOURCE_CATALOGUE_STALE');
  const res = dispatchCandidate('opencode:agentrouter', fix);
  assert.equal(res.length, 0);
  assert.ok(res.excludedRoutes.some((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE'));
});

test('(c) source failed with last good 1 hour ago -> admitted, marked stale-listing-retained', () => {
  const fix = buildFixture();
  const fresh = sourceFreshness('agy-gateway', { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, true);
  assert.equal(fresh.staleListingRetained, true);
  assert.equal(fresh.status, 'stale-listing-retained');
  const res = dispatchCandidate('agy-gateway', fix);
  assert.equal(res.length, 1);
  assert.equal(res[0].staleListingRetained, true);
});

test('(d) global lastSuccessfulAt alone cannot admit a failed source', () => {
  const fix = buildFixture();
  const fresh = sourceFreshness('opencode:scaleway', { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, false);
  assert.equal(fresh.code, 'SOURCE_CATALOGUE_STALE');
  const res = dispatchCandidate('opencode:scaleway', fix);
  assert.equal(res.length, 0);
  assert.ok(res.excludedRoutes.some((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE'));
});
