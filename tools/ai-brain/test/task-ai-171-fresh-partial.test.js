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
  lastAttemptAt: m17,
  lastSuccessfulAt: m17,
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
  assert.ok(
    res.excludedRoutes.length === 2 &&
      res.excludedRoutes.every((r) => r.reasonCode === 'SOURCE_CATALOGUE_STALE')
  );
}

test('(5) refresh publication retains prior sources missing from new list (survives in failedSources)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-pub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fFile = path.join(dir, 'freshness.json');
  fs.writeFileSync(
    fFile,
    JSON.stringify({ sources: [S('prior-gw', 'enumerated', 10, h1)], lastSuccessfulAt: h1 })
  );
  fs.writeFileSync(path.join(dir, 'priors.json'), '{"ranking":[]}');
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
  await refreshCatalogue({
    dataDir: dir,
    priorsFile: path.join(dir, 'priors.json'),
    run,
    log: () => {},
    now: NOW,
  });
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
    failedSources: [{ id: 'discovery', reason: 'STAGE_FAILED' }],
  };
  const fresh = sourceFreshness('retained-src', { freshness: fallbackDoc, now: NOW });
  assert.deepEqual([fresh.admitted, fresh.status], [true, 'stale-listing-retained']);
});

test('(7) agy-pool runtime accounts are not catalogue-listed sources and stay admitted', () => {
  const fresh = sourceFreshness(
    { harness: 'agy-pool', modelId: 'm1' },
    { freshness: FIXTURE, now: NOW }
  );
  assert.equal(fresh.admitted && !fresh.stale, true);
});
