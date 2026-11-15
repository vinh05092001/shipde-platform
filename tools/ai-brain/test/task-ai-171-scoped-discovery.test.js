'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cmdRun } = require('../discovery');
const { enumerate } = require('../discovery/adapters');
const { spawnSync } = require('child_process');

const router = {
  id: '9router',
  kind: 'router',
  endpoint: 'http://127.0.0.1:20128/v1',
  verify: { path: '/models', timeoutMs: 60000 },
};
const response = {
  ok: true,
  status: 200,
  parsed: { data: [{ id: 'cmc/model', owned_by: 'cmc' }] },
};

test('one registry source refresh never invokes other routers, live providers or AGY lanes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scoped-discovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  let commands = 0,
    jobs = 0,
    liveFetches = 0;
  const result = await cmdRun(
    { source: '9router', 'data-dir': dir },
    {
      registry: {
        sources: [router, { ...router, id: 'other', endpoint: 'https://other.example/v1' }],
      },
      config: { provider: { other: { options: { baseURL: 'https://live.example/v1' } } } },
      lanes: ['agy01'],
      runCommand: async () => {
        commands++;
        return { exitCode: 0, stdout: '' };
      },
      submitModels: async () => {
        jobs++;
        return { exitCode: 0, stdout: '' };
      },
      fetch: async () => {
        liveFetches++;
        return { ok: true, json: async () => ({ data: [] }) };
      },
      httpGet: async (url, opts) => {
        calls.push({ url, timeoutMs: opts.timeoutMs });
        return response;
      },
    }
  );
  assert.equal(commands, 0, 'no local AGY invocation');
  assert.equal(jobs, 0, 'no pool job');
  assert.equal(liveFetches, 0, 'no live provider fetch');
  assert.deepEqual(calls, [{ url: router.endpoint + '/models', timeoutMs: 60000 }]);
  assert.deepEqual(
    result.sources.map((s) => s.id),
    ['9router']
  );
  const freshness = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  assert.ok(freshness.sources[0].lastSuccessfulAt);
  assert.equal(result.exitCode, 0);
});

test('unknown source refuses before creating output or invoking any producer', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-unknown-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'not-created');
  let calls = 0;
  await assert.rejects(
    cmdRun(
      { source: 'typo', 'data-dir': out },
      {
        registry: { sources: [router] },
        config: { provider: {} },
        lanes: [],
        runCommand: async () => {
          calls++;
          return { exitCode: 0, stdout: '' };
        },
        httpGet: async () => {
          calls++;
          return response;
        },
      }
    ),
    /UNKNOWN_DISCOVERY_SOURCE/
  );
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(out), false);
});

test('router timeout is configured, defaults unchanged, invalid explicit timeout never calls HTTP', async () => {
  for (const [verify, expected] of [
    [{ timeoutMs: 60000 }, 60000],
    [{}, 10000],
  ]) {
    let observed;
    const result = await enumerate(
      { ...router, verify },
      {
        httpGet: async (_url, opts) => {
          observed = opts.timeoutMs;
          return response;
        },
      }
    );
    assert.equal(result.status, 'enumerated');
    assert.equal(observed, expected);
  }
  for (const timeoutMs of [null, 0, -1, '60000', NaN, Infinity, 2147483648]) {
    let called = false;
    const result = await enumerate(
      { ...router, verify: { timeoutMs } },
      {
        httpGet: async () => {
          called = true;
          return response;
        },
      }
    );
    assert.equal(called, false);
    assert.equal(result.status, 'error');
    assert.match(result.reason, /INVALID_MODELS_TIMEOUT/);
  }
});

test('the public cli forwards the source filter and never calls live producers', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scoped-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = await require('../cli').discoveryCommand(
    {
      _: ['discovery', 'run'],
      source: '9router',
      'discovery-dir': dir,
    },
    {
      registry: { sources: [router] },
      config: { provider: {} },
      lanes: ['agy01'],
      log: () => {},
      error: () => {},
      httpGet: async () => response,
      runCommand: async () => {
        assert.fail('unrelated local command');
      },
      submitModels: async () => {
        assert.fail('unrelated pool job');
      },
    }
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    result.sources.map((s) => s.id),
    ['9router']
  );
});

test('partial refresh preserves unrelated listing and timestamps; failure does not renew success', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scoped-prior-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const other = { ...router, id: 'other', endpoint: 'https://other.example/v1' };
  const registry = { sources: [router, other] };
  const flags = { 'data-dir': dir };
  await cmdRun({ ...flags, source: 'other' }, { registry, httpGet: async () => response });
  const before = fs.readFileSync(path.join(dir, 'catalogue.jsonl'), 'utf8');
  const oldSuccess = '2026-01-01T00:00:00.000Z';
  const previous = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  previous.sources[0].lastSuccessfulAt = oldSuccess;
  previous.sources.push({ id: '9router', lastSuccessfulAt: oldSuccess });
  fs.writeFileSync(path.join(dir, 'freshness.json'), JSON.stringify(previous));
  const result = await cmdRun(
    { ...flags, source: '9router' },
    {
      registry,
      httpGet: async () => ({ ok: false, status: 0, error: 'timeout' }),
    }
  );
  const freshness = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  assert.equal(result.exitCode, 1);
  assert.equal(freshness.sources.find((s) => s.id === 'other').lastSuccessfulAt, oldSuccess);
  assert.equal(freshness.sources.find((s) => s.id === '9router').lastSuccessfulAt, oldSuccess);
  assert.equal(fs.readFileSync(path.join(dir, 'catalogue.jsonl'), 'utf8'), before);
});

test('scoped success cannot claim full refresh or replace the global success timestamp/stamp', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scoped-global-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const oldSuccess = '2026-01-01T00:00:00.000Z';
  fs.writeFileSync(
    path.join(dir, 'freshness.json'),
    JSON.stringify({
      sources: [],
      lastSuccessfulAt: oldSuccess,
    })
  );
  const stamp = path.join(dir, 'full-refresh.stamp');
  fs.writeFileSync(stamp, 'previous full refresh');
  await cmdRun(
    { source: '9router', 'data-dir': dir, 'stamp-file': stamp },
    {
      registry: { sources: [router] },
      httpGet: async () => response,
    }
  );
  const freshness = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  assert.equal(freshness.complete, false);
  assert.equal(freshness.lastSuccessfulAt, oldSuccess);
  assert.deepEqual(freshness.scope, { source: '9router' });
  assert.notEqual(freshness.sources[0].lastSuccessfulAt, oldSuccess);
  assert.equal(fs.readFileSync(stamp, 'utf8'), 'previous full refresh');
});

test('equals syntax refuses at the public consumer instead of silently scanning all sources', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scoped-equals-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  await assert.rejects(
    Promise.resolve().then(() =>
      require('../cli').discoveryCommand(
        {
          _: ['discovery', 'run'],
          'source=9router': true,
          'discovery-dir': path.join(dir, 'out'),
        },
        {
          registry: { sources: [router] },
          config: { provider: {} },
          lanes: [],
          log: () => {},
          error: () => {},
          httpGet: async () => {
            calls++;
            return response;
          },
          runCommand: async () => {
            calls++;
            return { exitCode: 0, stdout: '' };
          },
        }
      )
    ),
    /DISCOVERY_SOURCE_SYNTAX/
  );
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(path.join(dir, 'out')), false);
});

test('unsupported source kinds and missing --source value cannot fall back to full discovery', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scoped-refusal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'not-created');
  await assert.rejects(
    cmdRun(
      { source: 'agy-local', 'data-dir': out },
      {
        registry: { sources: [{ id: 'agy-local', kind: 'agent-cli' }] },
      }
    ),
    /UNSUPPORTED_DISCOVERY_SOURCE_KIND/
  );
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'discovery.js'), 'run', '--source', '--data-dir', out],
    { encoding: 'utf8' }
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /DISCOVERY_SOURCE_REQUIRED/);
  assert.equal(fs.existsSync(out), false);
});
