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

const writeCache = (dir, name = 'c.json') => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ items: ['old'] }));
  return file;
};

const routerSource = (id, port) => ({
  id,
  kind: 'router',
  servesModels: true,
  endpoint: `http://127.0.0.1:${port}/v1`,
  modelsPath: '/m',
});

const httpResponse = () =>
  http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'up/m1' }] }));
  });

test('B05: fresh cache is returned without fetch or write; a stale cache with a failed fetch keeps its data', async (t) => {
  const dir = tmpDir(t);
  let fetched = false;
  const fresh = await fetchPublicCatalogueCache({
    file: writeCache(dir),
    maxAgeMs: 60000,
    now: fs.statSync(path.join(dir, 'c.json')).mtimeMs + 1000,
    fetch: async () => {
      fetched = true;
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(fresh, { data: { items: ['old'] }, ageMs: 1000, stale: false, error: null });
  const stale = await fetchPublicCatalogueCache({
    file: path.join(dir, 'c.json'),
    maxAgeMs: 5000,
    now: fs.statSync(path.join(dir, 'c.json')).mtimeMs + 20000,
    fetch: async () => {
      throw new Error('TIMEOUT');
    },
  });
  assert.deepEqual(stale, {
    data: { items: ['old'] },
    ageMs: 20000,
    stale: true,
    error: 'TIMEOUT',
  });
});

test('B05: offline cache states read without requests or writes; a successful fetch replaces the cache', async (t) => {
  const dir = tmpDir(t);
  const corruptFile = path.join(dir, 'corrupt.json');
  fs.writeFileSync(corruptFile, '{{{');
  const corrupt = await fetchPublicCatalogueCache({
    file: corruptFile,
    maxAgeMs: 60000,
    offline: true,
  });
  assert.deepEqual(corrupt, {
    data: null,
    ageMs: corrupt.ageMs,
    stale: true,
    error: 'CORRUPT_CACHE',
  });
  const missingFile = path.join(dir, 'missing.json');
  const missing = await fetchPublicCatalogueCache({
    file: missingFile,
    maxAgeMs: 60000,
    offline: true,
  });
  assert.equal(fs.existsSync(missingFile), false);
  assert.deepEqual(missing, {
    data: null,
    ageMs: null,
    stale: true,
    error: 'CACHE_MISSING_OFFLINE',
  });
  const liveFile = path.join(dir, 'live.json');
  const live = await fetchPublicCatalogueCache({
    file: liveFile,
    maxAgeMs: 60000,
    timeoutMs: 2000,
    maxBufferBytes: 4096,
    fetch: async (u, opts) => {
      assert.equal(opts.timeoutMs, 2000);
      return JSON.stringify({ models: ['m1'] });
    },
  });
  assert.deepEqual(live, { data: { models: ['m1'] }, ageMs: 0, stale: false, error: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(liveFile, 'utf8')), { models: ['m1'] });
});

test('B05-repair: an unsuccessful HTTP response, a never-completing body and an oversized body are fetch failures that keep the cache', async (t) => {
  const dir = tmpDir(t);
  const httpFile = writeCache(dir, 'http.json');
  const refused = await fetchPublicCatalogueCache({
    file: httpFile,
    maxAgeMs: 5000,
    now: fs.statSync(httpFile).mtimeMs + 20000,
    fetch: async () => new Response(JSON.stringify({ error: 'upstream down' }), { status: 503 }),
  });
  assert.equal(refused.stale, true);
  assert.equal(refused.error, 'HTTP_503');
  assert.deepEqual(refused.data, { items: ['old'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(httpFile, 'utf8')), { items: ['old'] });

  const hungFile = writeCache(dir, 'never.json');
  const hung = await fetchPublicCatalogueCache({
    file: hungFile,
    maxAgeMs: 5000,
    now: fs.statSync(hungFile).mtimeMs + 20000,
    timeoutMs: 100,
    maxBufferBytes: 16,
    fetch: async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => new Promise(() => {}) }) },
    }),
  });
  assert.equal(hung.stale, true);
  assert.equal(hung.error, 'FETCH_TIMEOUT');
  assert.deepEqual(hung.data, { items: ['old'] });

  const bigFile = writeCache(dir, 'huge.json');
  const chunks = [0, 1, 2, 3].map(() => ({ done: false, value: new Uint8Array(16) }));
  const big = await fetchPublicCatalogueCache({
    file: bigFile,
    maxAgeMs: 5000,
    now: fs.statSync(bigFile).mtimeMs + 20000,
    timeoutMs: 5000,
    maxBufferBytes: 16,
    fetch: async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => chunks.shift() || { done: true, value: undefined },
        }),
      },
      json: async () => ({ huge: 'x'.repeat(256) }),
    }),
  });
  assert.equal(big.stale, true);
  assert.equal(big.error, 'RESPONSE_TOO_LARGE');
  assert.deepEqual(big.data, { items: ['old'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(bigFile, 'utf8')), { items: ['old'] });
});

test('B14: a refresh only stamps when it is complete; failed round keeps the stamp, successful round stamps, partial round with one listed and one failed source keeps it too', async (t) => {
  const badSource = {
    id: 'bad',
    kind: 'router',
    servesModels: true,
    endpoint: 'http://127.0.0.1:9/v1',
    modelsPath: '/m',
  };
  const server = httpResponse();
  await new Promise((d) => server.listen(0, '127.0.0.1', d));
  t.after(() => server.close());
  const stampValue = '1000000000';
  const runRefresh = async (sources) => {
    const dir = tmpDir(t);
    const stamp = path.join(dir, 'refreshed.stamp');
    fs.writeFileSync(stamp, stampValue);
    const run = await cmdRun(
      { 'data-dir': dir, 'stamp-file': stamp },
      { ...noLive, registry: { sources } }
    );
    return { run, stamp, dir };
  };
  const failed = await runRefresh([badSource]);
  const done = await runRefresh([routerSource('good', server.address().port)]);
  const partial = await runRefresh([routerSource('good', server.address().port), badSource]);
  assert.notEqual(failed.run.exitCode, 0);
  assert.equal(done.run.exitCode, 0);
  assert.notEqual(fs.readFileSync(done.stamp, 'utf8').trim(), stampValue);
  const doneFresh = JSON.parse(fs.readFileSync(path.join(done.dir, 'freshness.json'), 'utf8'));
  assert.ok(doneFresh.lastSuccessfulAt);
  assert.equal(partial.run.exitCode, 0);
  assert.equal(fs.readFileSync(partial.stamp, 'utf8').trim(), stampValue);
  const partialFresh = JSON.parse(
    fs.readFileSync(path.join(partial.dir, 'freshness.json'), 'utf8')
  );
  assert.equal(partialFresh.listedSources, 1);
  assert.equal(partialFresh.complete, false);
  assert.equal(fs.readFileSync(failed.stamp, 'utf8').trim(), stampValue);
  const failedFresh = JSON.parse(fs.readFileSync(path.join(failed.dir, 'freshness.json'), 'utf8'));
  assert.equal(failedFresh.lastSuccessfulAt, null);
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

test('B17-repair: observedAt decides snapshot freshness with and without an injected clock, and the permitted future-clock skew is a configured input', (t) => {
  const dir = tmpDir(t);
  const pf = path.join(dir, 'pol-old.json');
  fs.writeFileSync(pf, JSON.stringify(fakePolicy('old.json', 60000)));
  fs.writeFileSync(
    path.join(dir, 'old.json'),
    JSON.stringify({
      version: 'AA-1',
      observedAt: '2026-01-01T00:00:00Z',
      rows: [{ name: 'm1', base: 'm1', pct: 80 }],
    })
  );
  // A freshly restored copy has a today mtime; the old observation stays stale,
  // with or without an equivalent injected current time.
  fs.utimesSync(path.join(dir, 'old.json'), new Date(), new Date());
  const oldObs = Date.parse('2026-01-01T00:00:00Z');
  for (const opts of [{}, { now: oldObs + 120000 }]) {
    assert.deepEqual(loadScoringPolicy(pf, opts), {
      scoringPolicy: undefined,
      scoringPolicyStatus: 'SCORING_POLICY_INACTIVE',
      scoringPriorsStatus: 'AA_SNAPSHOT_STALE',
    });
  }
  fs.writeFileSync(
    path.join(dir, 'future.json'),
    JSON.stringify({
      version: 'AA-1',
      observedAt: new Date(Date.now() + 120000).toISOString(),
      rows: [{ name: 'm1', base: 'm1', pct: 80 }],
    })
  );
  for (const [skew, status] of [
    [300000, 'SCORING_POLICY_LOADED'],
    [60000, 'SCORING_POLICY_INACTIVE'],
  ]) {
    const skewPf = path.join(dir, `pol-${skew}.json`);
    fs.writeFileSync(
      skewPf,
      JSON.stringify({ ...fakePolicy('future.json', 60000), maxFutureSkewMs: skew })
    );
    const res = loadScoringPolicy(skewPf);
    assert.equal(res.scoringPolicyStatus, status, `skew ${skew}`);
    assert.equal(res.scoringPolicy === undefined, status === 'SCORING_POLICY_INACTIVE');
  }
});
