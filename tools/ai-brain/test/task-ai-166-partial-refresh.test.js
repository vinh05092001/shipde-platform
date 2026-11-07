'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { cmdRun } = require('../discovery');
const { catalogueFreshness, refreshCatalogue } = require('../catalogue-refresh');

const router = (id, endpoint) => ({
  id,
  kind: 'router',
  servesModels: true,
  harness: 'paseo',
  endpoint,
  credential: { type: 'none' },
  modelsPath: '/models',
});
const closedPort = 'http://127.0.0.1:9/v1';

async function listing(t) {
  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'up/model-a' }] }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/v1`;
}
function dataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const noLive = {
  env: {},
  config: {},
  lanes: [],
  runCommand: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
  resolveCommand: () => null,
};

test('one source listing makes the catalogue fresh and keeps the failed one named', async (t) => {
  const dir = dataDir(t);
  const up = await listing(t);
  const registry = { sources: [router('ok', up), router('bad', closedPort)] };
  const run = await cmdRun({ 'data-dir': dir }, { ...noLive, registry });
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  assert.equal(run.exitCode, 0);
  assert.ok(doc.lastSuccessfulAt);
  assert.equal(doc.complete, false);
  assert.ok(doc.failedSources.some((s) => s.id === 'bad'));
  assert.equal(catalogueFreshness({ dataDir: dir }).stale, false);
});

test('no source listing advances nothing and the gate stays shut', async (t) => {
  const dir = dataDir(t);
  const registry = { sources: [router('bad', closedPort)] };
  const run = await cmdRun({ 'data-dir': dir }, { ...noLive, registry });
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  assert.equal(doc.lastSuccessfulAt, null);
  assert.notEqual(run.exitCode, 0);
  assert.equal(catalogueFreshness({ dataDir: dir }).code, 'STALE_CATALOGUE');
});

test('the 48h limit still applies to a partial success', (t) => {
  const dir = dataDir(t);
  const old = new Date(Date.now() - 49 * 3600e3).toISOString();
  fs.writeFileSync(
    path.join(dir, 'freshness.json'),
    JSON.stringify({ lastSuccessfulAt: old, listedSources: 1, complete: false })
  );
  assert.equal(catalogueFreshness({ dataDir: dir }).code, 'STALE_CATALOGUE');
});

test('an empty listing is not a success, even beside a failed source', async (t) => {
  const dir = dataDir(t);
  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const empty = `http://127.0.0.1:${server.address().port}/v1`;
  const registry = { sources: [router('empty', empty), router('bad', closedPort)] };
  const run = await cmdRun({ 'data-dir': dir }, { ...noLive, registry });
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  assert.equal(doc.lastSuccessfulAt, null);
  assert.notEqual(run.exitCode, 0);
  assert.equal(catalogueFreshness({ dataDir: dir }).code, 'STALE_CATALOGUE');
});

test('a corrupt priors file cannot stand in for a failed score fetch', async (t) => {
  const dir = dataDir(t);
  const freshnessFile = path.join(dir, 'freshness.json');
  const priorsFile = path.join(dir, 'priors.json');
  fs.writeFileSync(priorsFile, 'not-json');
  const run = async (args, context) => {
    if (args[0] === 'priors') return { exitCode: 1, stderr: 'fetch failed' };
    if (args[0] === 'discovery') {
      const at = new Date().toISOString();
      fs.writeFileSync(
        context.discoveryFile,
        JSON.stringify({
          lastAttemptAt: at,
          lastSuccessfulAt: at,
          complete: true,
          listedSources: 1,
        })
      );
    }
    return { exitCode: 0, stderr: '' };
  };
  const report = await refreshCatalogue({
    dataDir: dir,
    freshnessFile,
    priorsFile,
    reportFile: path.join(dir, 'report.json'),
    run,
    verifyEvidence: false,
  });
  assert.equal(report.ok, false);
});
