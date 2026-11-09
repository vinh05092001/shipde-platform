'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sourceFreshness, catalogueFreshness, refreshCatalogue } = require('../catalogue-refresh');
const { assembleForDispatch } = require('../cli');

const NOW = Date.parse('2026-11-09T16:00:00.000Z');
const iso = (ms, now = NOW) => new Date(now - ms).toISOString();
const cand = (id) => ({ harness: 'test', gateway: id, source: id, modelId: `v/${id}` });
const S = (id, status, advertised, lastSuccessfulAt, extra = {}) =>
  Object.assign({ id, status, advertised, lastSuccessfulAt }, extra);

const m17 = iso(1020000),
  d3 = iso(259200000),
  h1 = iso(3600000);
const FIXTURE = {
  sources: [
    S('9router', 'enumerated', 1205, m17, { catalogs: [{ upstream: 'c', count: 1 }] }),
    S('opencode:agentrouter', 'unavailable', 0, d3),
    S('agy-gateway', 'unavailable', 0, h1),
    S('opencode:scaleway', 'unavailable', 0, null),
    S('legacy-src', 'enumerated', 10, null),
    S('empty-enum', 'enumerated', 0, null, { catalogs: [] }),
    S('empty-nomodels', 'no-models', 0, null, { catalogs: [] }),
    S('empty-retained', 'enumerated', 0, h1, { catalogs: [] }),
  ],
  listedSources: 45,
  lastAttemptAt: m17,
  lastSuccessfulAt: m17,
  complete: false,
  failedSources: [
    { id: 'opencode:agentrouter', reason: 'HTTP_401' },
    { id: 'agy-gateway', reason: 'unavailable' },
    { id: 'opencode:scaleway', reason: 'HTTP_403' },
  ],
};

function dispatchCandidates(sourceIds, fixture, now = NOW, catalogueExtra = {}) {
  const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
  return assembleForDispatch(
    { candidates: [], ...catalogueExtra },
    [],
    { sources: ids.map((id) => ({ id })), dispatch: { providers: {} } },
    { candidates: ids.map(cand), freshness: fixture, now, allowUnprobedCandidates: true }
  );
}

function checkSource(id, admitted, code, retained, fix = FIXTURE) {
  const fresh = sourceFreshness(id, { freshness: fix, now: NOW });
  assert.equal(fresh.admitted, admitted);
  if (code) assert.equal(fresh.code, code);
  if (retained !== undefined) assert.equal(fresh.staleListingRetained, retained);
  const res = dispatchCandidates(id, fix);
  assert.equal(res.length, admitted ? 1 : 0);
  if (admitted && retained) assert.equal(res[0].staleListingRetained, true);
  if (!admitted) assert.ok(res.excludedRoutes.some((r) => r.reasonCode === code));
}

function assertMixedResult(res) {
  assert.deepEqual(
    res.map((c) => c.gateway),
    ['9router', 'agy-gateway']
  );
  assert.equal(res.find((c) => c.gateway === 'agy-gateway').staleListingRetained, true);
  assert.equal(res.excludedRoutes.length, 2);
  assert.ok(res.excludedRoutes.every((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE'));
}

test('(a) source listed this run -> admitted', () => checkSource('9router', true, null, false));
test('(b) source failed this run with last good 3 days ago -> rejected with reason', () =>
  checkSource('opencode:agentrouter', false, 'SOURCE_CATALOGUE_STALE'));
test('(c) source failed with last good 1 hour ago -> admitted, marked stale-listing-retained', () =>
  checkSource('agy-gateway', true, null, true));
test('(d) global lastSuccessfulAt alone cannot admit a failed source', () =>
  checkSource('opencode:scaleway', false, 'SOURCE_CATALOGUE_STALE'));

test('(1) legacy freshness file with only global lastSuccessfulAt -> explicit stale for all sources', () => {
  const at = new Date(NOW).toISOString();
  const legacyDoc = {
    lastSuccessfulAt: at,
    sources: [S('s1', 'enumerated', 5, null), S('s2', 'unavailable', 0, null)],
  };
  checkSource('s1', false, 'SOURCE_CATALOGUE_STALE', undefined, legacyDoc);
  checkSource('s2', false, 'SOURCE_CATALOGUE_STALE', undefined, legacyDoc);
});

test('(2) mixed fixture: listed this run + failed 1h + failed 3d + legacy without timestamp', () => {
  checkSource('9router', true, null, false);
  checkSource('agy-gateway', true, null, true);
  checkSource('opencode:agentrouter', false, 'SOURCE_CATALOGUE_STALE');
  checkSource('legacy-src', false, 'SOURCE_CATALOGUE_STALE');
  const ids = ['9router', 'agy-gateway', 'opencode:agentrouter', 'legacy-src'];
  assertMixedResult(dispatchCandidates(ids, FIXTURE));
});

test('(3) empty-success: completed enumeration with 0 models follows contract', () => {
  checkSource('empty-enum', false, 'SOURCE_CATALOGUE_STALE');
  checkSource('empty-nomodels', false, 'SOURCE_CATALOGUE_STALE');
  checkSource('empty-retained', true, null, true);
});

test('(4) ordinary dispatch loads persisted freshness through normal reader without injection', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-disp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'freshness.json'), JSON.stringify(FIXTURE));
  const ids = ['9router', 'agy-gateway', 'opencode:agentrouter', 'legacy-src'];
  const candidates = ids.map(cand);
  const freshness = catalogueFreshness({ dataDir: dir, now: NOW });
  assertMixedResult(
    assembleForDispatch(
      { candidates, freshness, freshnessDoc: freshness.doc },
      [],
      { sources: ids.map((id) => ({ id })), dispatch: { providers: {} } },
      { candidates, now: NOW, allowUnprobedCandidates: true }
    )
  );
});

test('(5) refresh publication retains prior sources missing from new list (survives in failedSources)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-pub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fFile = path.join(dir, 'freshness.json');
  fs.writeFileSync(
    fFile,
    JSON.stringify({ sources: [S('prior-gw', 'enumerated', 10, h1)], lastSuccessfulAt: h1 })
  );
  const priorsFile = path.join(dir, 'priors.json');
  fs.writeFileSync(priorsFile, JSON.stringify({ ranking: [] }));
  const at = new Date(NOW).toISOString();
  const discData = {
    lastAttemptAt: at,
    lastSuccessfulAt: at,
    listedSources: 1,
    failedSources: [{ id: 'prior-gw', reason: 'HTTP_500' }],
    sources: [S('9router', 'enumerated', 100, at)],
  };
  const run = async (args, ctx) => {
    if (args[0] === 'discovery') fs.writeFileSync(ctx.discoveryFile, JSON.stringify(discData));
    return { exitCode: 0 };
  };
  await refreshCatalogue({ dataDir: dir, priorsFile, run, log: () => {} });
  const pub = JSON.parse(fs.readFileSync(fFile, 'utf8'));
  const retained = pub.sources.find((s) => s.id === 'prior-gw');
  assert.ok(retained && retained.lastSuccessfulAt === h1, 'prior source must be retained');
  const fresh = sourceFreshness('prior-gw', { freshness: pub, now: NOW });
  assert.equal(fresh.admitted && fresh.staleListingRetained, true);
});

test('(6) fallback document after early discovery failure preserves staleListingRetained=true', () => {
  const fallbackDoc = {
    sources: [S('retained-src', 'enumerated', 10, h1, { staleListingRetained: true })],
    lastAttemptAt: new Date(NOW).toISOString(),
    lastSuccessfulAt: h1,
    complete: false,
    failedSources: [{ id: 'discovery', reason: 'STAGE_FAILED' }],
  };
  const fresh = sourceFreshness('retained-src', { freshness: fallbackDoc, now: NOW });
  assert.equal(fresh.admitted && fresh.staleListingRetained, true);
  assert.equal(fresh.status, 'stale-listing-retained');
});

test('(7) agy-pool runtime accounts are not catalogue-listed sources and stay admitted', () => {
  const fresh = sourceFreshness(
    { harness: 'agy-pool', source: 'agy-pool', accountId: 'a1', modelId: 'm1' },
    { freshness: FIXTURE, now: NOW }
  );
  assert.equal(fresh.admitted && !fresh.stale, true);
});

test('(8) missing/unreadable freshness rejects catalogue sources while admitting pool', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-miss-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidates = [cand('9router'), { harness: 'agy-pool', gateway: 'agy-pool', modelId: 'm1' }];
  const freshness = catalogueFreshness({ dataDir: dir, now: NOW });
  const res = assembleForDispatch(
    { candidates, freshness, freshnessDoc: freshness.doc },
    [],
    { sources: [{ id: '9router' }], dispatch: { providers: {} } },
    { candidates, now: NOW, allowUnprobedCandidates: true }
  );
  assert.equal(res.length, 1);
  assert.equal(res[0].gateway, 'agy-pool');
  assert.equal(res.excludedRoutes[0]?.reasonCode, 'SOURCE_CATALOGUE_STALE');
});

test('(9) successful fresh listing clears staleListingRetained marker on candidate', () => {
  const candidates = [{ ...cand('9router'), staleListingRetained: true }];
  const res = assembleForDispatch(
    { candidates, freshness: FIXTURE, freshnessDoc: FIXTURE },
    [],
    { sources: [{ id: '9router' }], dispatch: { providers: {} } },
    { candidates, freshness: FIXTURE, now: NOW, allowUnprobedCandidates: true }
  );
  assert.equal(res.length, 1);
  assert.equal(res[0].staleListingRetained, undefined);
});
