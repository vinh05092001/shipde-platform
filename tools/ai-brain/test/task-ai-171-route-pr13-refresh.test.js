'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { fetchPublicCatalogueCache } = require('../public-catalogue-cache');
const { cmdRun } = require('../discovery');
const { dispatchProfileCommand, dispatchCommand } = require('../cli');
const { loadScoringPolicy } = require('../scoring-policy');

const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr13-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const fakePolicy = (priorsFile, maxAgeMs = 60000) => ({
  version: 'test-v1',
  source: 'AA',
  rationale: 'testing',
  maxAgeMs,
  priorsFile,
  dimensions: { quality: { weight: 1, min: 0, max: 100, unit: 'percentile', direction: 'higher' } },
});

const noLive = {
  env: {},
  config: {},
  lanes: [],
  runCommand: async () => ({ exitCode: 0 }),
  resolveCommand: () => null,
};

test('B05: fresh cache returns cached data, ageMs, stale=false, without fetch or write', async (t) => {
  const file = path.join(tmpDir(t), 'c.json');
  fs.writeFileSync(file, JSON.stringify({ items: ['a'] }));
  let fetched = false;
  const res = await fetchPublicCatalogueCache({
    file,
    maxAgeMs: 60000,
    now: fs.statSync(file).mtimeMs + 1000,
    fetch: async () => {
      fetched = true;
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(res, { data: { items: ['a'] }, ageMs: 1000, stale: false, error: null });
});

test('B05: stale cache with failed fetch returns cached data with stale=true and error', async (t) => {
  const file = path.join(tmpDir(t), 'c.json');
  fs.writeFileSync(file, JSON.stringify({ items: ['old'] }));
  const res = await fetchPublicCatalogueCache({
    file,
    maxAgeMs: 5000,
    now: fs.statSync(file).mtimeMs + 20000,
    fetch: async () => {
      throw new Error('TIMEOUT');
    },
  });
  assert.deepEqual(res, { data: { items: ['old'] }, ageMs: 20000, stale: true, error: 'TIMEOUT' });
});

test('B05: corrupt or missing cache in offline mode makes no request and no write', async (t) => {
  const dir = tmpDir(t);
  const corruptFile = path.join(dir, 'c.json');
  fs.writeFileSync(corruptFile, '{{{');
  const missingFile = path.join(dir, 'm.json');
  const cRes = await fetchPublicCatalogueCache({
    file: corruptFile,
    maxAgeMs: 60000,
    offline: true,
  });
  assert.deepEqual(cRes, { data: null, ageMs: cRes.ageMs, stale: true, error: 'CORRUPT_CACHE' });
  const mRes = await fetchPublicCatalogueCache({
    file: missingFile,
    maxAgeMs: 60000,
    offline: true,
  });
  assert.equal(fs.existsSync(missingFile), false);
  assert.deepEqual(mRes, { data: null, ageMs: null, stale: true, error: 'CACHE_MISSING_OFFLINE' });
});

test('B05: successful fetch writes cache and returns fresh data with ageMs=0', async (t) => {
  const file = path.join(tmpDir(t), 'live.json');
  const res = await fetchPublicCatalogueCache({
    file,
    maxAgeMs: 60000,
    timeoutMs: 2000,
    maxBufferBytes: 4096,
    fetch: async (u, opts) => {
      assert.equal(opts.timeoutMs, 2000);
      return JSON.stringify({ models: ['m1'] });
    },
  });
  assert.deepEqual(res, { data: { models: ['m1'] }, ageMs: 0, stale: false, error: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { models: ['m1'] });
});

test('B14: failed refresh leaves stamp unchanged and does not advance lastSuccessfulAt', async (t) => {
  const dir = tmpDir(t);
  const stamp = path.join(dir, 'refreshed.stamp');
  fs.writeFileSync(stamp, '1000000000');
  const registry = {
    sources: [
      {
        id: 'bad',
        kind: 'router',
        servesModels: true,
        endpoint: 'http://127.0.0.1:9/v1',
        modelsPath: '/m',
      },
    ],
  };
  const run = await cmdRun(
    { 'data-dir': dir, 'stamp-file': stamp },
    { ...noLive, runCommand: async () => ({ exitCode: 1 }), registry }
  );
  assert.notEqual(run.exitCode, 0);
  assert.equal(fs.readFileSync(stamp, 'utf8').trim(), '1000000000');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8')).lastSuccessfulAt,
    null
  );
});

test('B14: successful refresh writes refreshed.stamp and records lastSuccessfulAt', async (t) => {
  const dir = tmpDir(t);
  const stamp = path.join(dir, 'refreshed.stamp');
  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'up/m1' }] }));
  });
  await new Promise((d) => server.listen(0, '127.0.0.1', d));
  t.after(() => server.close());
  const registry = {
    sources: [
      {
        id: 'good',
        kind: 'router',
        servesModels: true,
        endpoint: `http://127.0.0.1:${server.address().port}/v1`,
        modelsPath: '/m',
      },
    ],
  };
  const run = await cmdRun({ 'data-dir': dir, 'stamp-file': stamp }, { ...noLive, registry });
  assert.equal(run.exitCode, 0);
  assert.ok(Number(fs.readFileSync(stamp, 'utf8').trim()) > 0);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8')).lastSuccessfulAt);
});

test('B14: dispatch read path reports stale status without performing refresh or spawning', async (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ role: 'writer' }));
  const logged = [];
  const res = await dispatchProfileCommand(
    { root: dir, profile: 'profile.json', 'discovery-dir': dir, 'dry-run': true },
    { rootDir: dir, discoveryDataDir: dir, error: (m) => logged.push(m), exit: () => {} }
  );
  assert.ok(res);
  assert.ok(logged.some((e) => e.includes('STALE_CATALOGUE')));
});

test('B17: scoring policy consumer reports missing, corrupt and stale snapshot truthfully', (t) => {
  const dir = tmpDir(t);
  const oldDate = new Date('2026-01-01T00:00:00Z').toISOString();
  fs.writeFileSync(path.join(dir, 'aa-corrupt.json'), 'NOT-JSON{{{');
  fs.writeFileSync(
    path.join(dir, 'aa-stale.json'),
    JSON.stringify({
      version: 'AA-1',
      observedAt: oldDate,
      rows: [{ name: 'm1', base: 'm1', pct: 80 }],
    })
  );

  for (const [snap, expected, opts] of [
    ['aa-missing.json', 'AA_SNAPSHOT_MISSING', {}],
    ['aa-corrupt.json', 'AA_SNAPSHOT_CORRUPT', {}],
    ['aa-stale.json', 'AA_SNAPSHOT_STALE', { now: Date.parse(oldDate) + 120000 }],
  ]) {
    const pf = path.join(dir, `pol-${snap}`);
    fs.writeFileSync(pf, JSON.stringify(fakePolicy(snap, 60000)));
    assert.deepEqual(loadScoringPolicy(pf, opts), {
      scoringPolicy: undefined,
      scoringPolicyStatus: 'SCORING_POLICY_INACTIVE',
      scoringPriorsStatus: expected,
    });
  }
});

test('B17: dispatch with corrupt or stale snapshot makes no network call', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'aa-corrupt.json'), 'BAD-JSON');
  const pf = path.join(dir, 'scoring-policy.json');
  fs.writeFileSync(pf, JSON.stringify(fakePolicy('aa-corrupt.json')));
  let networkAttempted = false;
  const logs = [];
  const res = dispatchCommand(
    {
      item: 'TASK-AI-171',
      role: 'writer',
      'dry-run': true,
      json: true,
      'scoring-policy': pf,
      'discovery-dir': dir,
    },
    {
      candidates: [
        {
          harness: 'paseo',
          accessPath: 'f',
          gateway: 'f',
          upstream: 'm',
          accountId: 'a',
          quotaScope: 's',
          modelId: 'f/m',
          modelVersion: 'v',
          qualifiedRoles: ['*'],
          quality: 1,
        },
      ],
      fetch: () => {
        networkAttempted = true;
        throw new Error('NO_NETWORK');
      },
      now: Date.now(),
      log: (line) => logs.push(line),
      error: () => {},
      exit: () => {},
    }
  );
  assert.equal(networkAttempted, false);
  assert.ok(res);
  const decision = JSON.parse(logs.find((l) => l.trim().startsWith('{')));
  assert.equal(decision.scoringPolicyStatus, 'SCORING_POLICY_INACTIVE');
  assert.equal(decision.scoringPriorsStatus, 'AA_SNAPSHOT_CORRUPT');
});
