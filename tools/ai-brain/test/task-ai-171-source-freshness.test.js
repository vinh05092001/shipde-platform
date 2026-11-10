'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, sourceFreshness, readJson } = require('../catalogue-refresh');
const { cmdRun } = require('../discovery');

function tempDir(t, prefix = 'source-freshness-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('TASK-AI-171: refresh with offline fake stage: A succeeds, B fails and keeps prior (or none)', async (t) => {
  const dir = tempDir(t);
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const freshnessFile = path.join(dataDir, 'freshness.json');
  const priorsFile = path.join(dir, 'priors.json');
  fs.writeFileSync(priorsFile, JSON.stringify({ ranking: [] }));

  const nowEpoch = 1794291000000;
  const startedAt = new Date(nowEpoch).toISOString();
  const oldTs = new Date(nowEpoch - 3600 * 1000).toISOString();

  // Initial state: B has oldTs, timestamp-less D has null, untouched C has oldTs
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      sources: [
        { id: 'src-b', status: 'enumerated', lastSuccessfulAt: oldTs, lastAttemptAt: oldTs },
        { id: 'src-c', status: 'enumerated', lastSuccessfulAt: oldTs, lastAttemptAt: oldTs },
        { id: 'src-d', status: 'unavailable', lastSuccessfulAt: null, lastAttemptAt: oldTs },
      ],
      lastSuccessfulAt: oldTs,
      lastAttemptAt: oldTs,
    })
  );

  // Offline fake stage: discovery writes observation where A succeeds, B and D fail
  const run = async (args, ctx) => {
    if (args[0] === 'discovery') {
      fs.writeFileSync(
        ctx.discoveryFile,
        JSON.stringify({
          lastAttemptAt: startedAt,
          lastSuccessfulAt: startedAt,
          listedSources: 1,
          complete: false,
          failedSources: [
            { id: 'src-b', reason: 'HTTP_500' },
            { id: 'src-d', reason: 'CONNECTION_REFUSED' },
          ],
          sources: [
            {
              id: 'src-a',
              status: 'enumerated',
              durationMs: 10,
              advertised: 10,
              catalogs: [{ upstream: 'c', count: 1 }],
            },
            {
              id: 'src-b',
              status: 'unavailable',
              durationMs: 5,
              incomplete: true,
              reason: 'HTTP_500',
            },
            {
              id: 'src-d',
              status: 'unavailable',
              durationMs: 5,
              incomplete: true,
              reason: 'CONNECTION_REFUSED',
            },
          ],
        })
      );
    }
    return { exitCode: 0 };
  };

  await refreshCatalogue({
    dataDir,
    priorsFile,
    run,
    now: nowEpoch,
    log: () => {},
  });

  const published = readJson(freshnessFile, null);
  assert.ok(published, 'freshness.json must be written');

  const srcA = (published.sources || []).find((s) => s.id === 'src-a');
  const srcB = (published.sources || []).find((s) => s.id === 'src-b');
  const srcC = (published.sources || []).find((s) => s.id === 'src-c');
  const srcD = (published.sources || []).find((s) => s.id === 'src-d');

  assert.ok(srcA, 'src-a must exist in published sources');
  assert.ok(srcB, 'src-b must exist in published sources');
  assert.ok(srcC, 'untouched src-c must be retained in published sources');
  assert.ok(srcD, 'src-d must exist in published sources');

  // (a) A has fresh src.lastSuccessfulAt and keeps lastAttemptAt; B keeps old value; D keeps none
  assert.equal(srcA.lastSuccessfulAt, startedAt);
  assert.equal(srcA.lastAttemptAt, startedAt);
  assert.equal(srcB.lastSuccessfulAt, oldTs);
  assert.equal(srcB.lastAttemptAt, startedAt);
  assert.equal(srcC.lastSuccessfulAt, oldTs);
  assert.equal(srcC.lastAttemptAt, oldTs);
  assert.equal(srcD.lastSuccessfulAt, null);
  assert.equal(srcD.lastAttemptAt, startedAt);

  // (b) D timestamp-less -> still rejected by sourceFreshness
  const freshD = sourceFreshness('src-d', { freshness: published, now: nowEpoch });
  assert.equal(freshD.admitted, false);
  assert.equal(freshD.code, 'SOURCE_CATALOGUE_STALE');

  // (c) A admitted
  const freshA = sourceFreshness('src-a', { freshness: published, now: nowEpoch });
  assert.equal(freshA.admitted, true);
  assert.equal(freshA.stale, false);

  // B with oldTs preserved within 48h -> admitted as stale-listing-retained
  const freshB = sourceFreshness('src-b', { freshness: published, now: nowEpoch });
  assert.equal(freshB.admitted, true);
  assert.equal(freshB.staleListingRetained, true);
});

test('TASK-AI-171: discovery stage (cmdRun) stamps successful sources, preserves prior, keeps lastAttemptAt', async (t) => {
  const dir = tempDir(t);
  const freshnessFile = path.join(dir, 'freshness.json');
  const nowEpoch = 1794291000000;
  const oldTs = new Date(nowEpoch - 2 * 3600 * 1000).toISOString();

  // Prior freshness with prior B timestamp, untouched C, and timestamp-less D
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      sources: [
        { id: 'src-b', status: 'enumerated', lastSuccessfulAt: oldTs, lastAttemptAt: oldTs },
        { id: 'src-c', status: 'enumerated', lastSuccessfulAt: oldTs, lastAttemptAt: oldTs },
        { id: 'src-d', status: 'unavailable', lastSuccessfulAt: null, lastAttemptAt: oldTs },
      ],
      lastSuccessfulAt: oldTs,
      lastAttemptAt: oldTs,
    })
  );

  const registry = {
    sources: [
      { id: 'src-a', kind: 'router', endpoint: 'http://test-ok', servesModels: true },
      { id: 'src-b', kind: 'router', endpoint: 'http://test-fail', servesModels: true },
      { id: 'src-d', kind: 'router', endpoint: 'http://test-fail-d', servesModels: true },
    ],
  };

  const deps = {
    registry,
    lanes: [],
    config: {},
    env: {},
    httpGet: async (url) => {
      if (url.includes('test-ok')) {
        return { ok: true, status: 200, parsed: { data: [{ id: 'model-a' }] } };
      }
      return { ok: false, status: 500, error: 'connection failed' };
    },
    runCommand: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    resolveCommand: () => null,
  };

  const res = await cmdRun({ 'data-dir': dir, 'freshness-file': freshnessFile }, deps);
  assert.equal(res.exitCode, 0);

  const doc = readJson(freshnessFile, null);
  assert.ok(doc, 'freshness.json must be written');

  const srcA = (doc.sources || []).find((s) => s.id === 'src-a');
  const srcB = (doc.sources || []).find((s) => s.id === 'src-b');
  const srcC = (doc.sources || []).find((s) => s.id === 'src-c');
  const srcD = (doc.sources || []).find((s) => s.id === 'src-d');

  assert.ok(srcA, 'src-a must be present');
  assert.ok(srcB, 'src-b must be present');
  assert.ok(srcC, 'src-c must be retained');
  assert.ok(srcD, 'src-d must be present');

  // (a) A has fresh src.lastSuccessfulAt and src.lastAttemptAt; B preserves old value; D stays null
  assert.ok(srcA.lastSuccessfulAt, 'src-a must have lastSuccessfulAt');
  assert.ok(srcA.lastAttemptAt, 'src-a must have lastAttemptAt');
  assert.equal(srcB.lastSuccessfulAt, oldTs, 'src-b must preserve prior lastSuccessfulAt');
  assert.ok(srcB.lastAttemptAt, 'src-b must have lastAttemptAt from this attempt');
  assert.equal(srcC.lastSuccessfulAt, oldTs, 'src-c must preserve prior lastSuccessfulAt');
  assert.equal(srcD.lastSuccessfulAt, null, 'src-d must keep null lastSuccessfulAt');

  // (b) D timestamp-less -> rejected
  const freshD = sourceFreshness('src-d', { freshness: doc });
  assert.equal(freshD.admitted, false);
  assert.equal(freshD.code, 'SOURCE_CATALOGUE_STALE');

  // (c) A admitted
  const freshA = sourceFreshness('src-a', { freshness: doc });
  assert.equal(freshA.admitted, true);
  assert.equal(freshA.stale, false);
});

test('TASK-AI-171: never backfill src.lastSuccessfulAt from document timestamp', () => {
  const now = Date.now();
  const freshDocTs = new Date(now).toISOString();
  const doc = {
    lastSuccessfulAt: freshDocTs,
    lastAttemptAt: freshDocTs,
    complete: false,
    sources: [
      {
        id: 'src-none',
        status: 'enumerated',
        advertised: 10,
        catalogs: [{ upstream: 'c', count: 1 }],
      },
    ],
  };

  const fresh = sourceFreshness('src-none', { freshness: doc, now });
  assert.equal(fresh.admitted, false);
  assert.equal(fresh.code, 'SOURCE_CATALOGUE_STALE');
});
