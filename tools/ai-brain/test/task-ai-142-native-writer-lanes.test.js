'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { generateCandidates } = require('../candidates');
const { resolveCandidateHeadroom } = require('../ranking');
const { routeProbeCandidate } = require('../orchestrate');
const { resolveRoute } = require('../executor');
const { commitNativeWriterChanges } = require('../isolation-launcher');
const registry = require('../sources.json');
const home = path.join(path.sep, 'fixture-native');
const native = {
  id: 'cli-x',
  kind: 'agent-cli',
  modelsFrom: 'account',
  harness: 'codex',
  accessPath: 'cli',
};
const codexOpts = {
  homeDir: home,
  env: {},
  fs: {
    existsSync: () => true,
    statSync: () => ({ isFile: () => true }),
    readFileSync(file) {
      assert.ok(!file.endsWith('auth.json'), 'must never read auth');
      return 'model = "fixture-model"';
    },
  },
};
test('HTTP inventory cannot impersonate native CLI login or hide its quota scope', () => {
  const out = generateCandidates({
    registry: { sources: [native] },
    accounts: [
      {
        id: 'http-x',
        sourceId: native.id,
        endpoint: 'https://fixture.invalid/v1',
        enabled: true,
        models: ['http-model'],
      },
    ],
    codexOpts,
    discoverPool: false,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].modelId, 'fixture-model');
  assert.equal(out[0].binding, 'cli-login');
  assert.equal(
    resolveCandidateHeadroom(out[0], {
      headrooms: {
        [out[0].quotaScope]: { status: 'exhausted', observedAt: new Date().toISOString() },
      },
      useStoredQuota: false,
    }).status,
    'exhausted'
  );
});
test('native account aliases are declared by registry, never inferred from provider name', () => {
  const source = {
    id: 'local-x',
    kind: 'agent-cli',
    harness: 'agy',
    accessPath: 'cli',
    accountProviders: ['provider-x'],
  };
  const out = generateCandidates({
    registry: { sources: [source] },
    accounts: [{ id: 'account-x', provider: 'provider-x', models: ['model-x'] }],
    discoverPool: false,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].accountId, 'account-x');
  assert.equal(out[0].modelId, 'model-x');
});
test('gateway writer uses live bare wire ids and its own HTTP endpoint', () => {
  const source = registry.sources.find((s) => s.id === 'agy-gateway');
  const out = generateCandidates({
    registry: { ...registry, sources: [source] },
    sourceModels: { [source.id]: ['wire-x'] },
    accounts: [],
    discoverPool: false,
  });
  assert.equal(out.length, 1);
  const route = resolveRoute(
    { provider: source.id, harness: out[0].harness, model: out[0].modelId },
    { isolatedWorker: true },
    registry
  );
  assert.equal(route.harnessName, 'opencode-direct');
  const probe = routeProbeCandidate(out[0], route, { sources: [source] });
  assert.equal(probe.modelId, 'wire-x');
  assert.equal(probe.accessPath, source.endpoint);
  assert.equal(
    generateCandidates({ registry: { sources: [source] }, accounts: [], discoverPool: false })
      .length,
    0
  );
});
test('Controller commits native file changes with hooks and fails closed on hook rejection', () => {
  const calls = [];
  let committed = false;
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'commit') committed = true;
    return {
      status: 0,
      stdout: args[0] === 'status' ? (committed ? '' : ' M tracked.js\n') : 'a'.repeat(40),
    };
  };
  assert.equal(
    commitNativeWriterChanges({ workerRoot: 'fixture', workItemId: 'TASK-X', run }),
    'a'.repeat(40)
  );
  assert.ok(calls.some((args) => args[0] === 'commit'));
  assert.ok(calls.every((args) => !args.includes('--no-verify') && !args.includes('--amend')));
  committed = false;
  assert.throws(
    () =>
      commitNativeWriterChanges({
        workerRoot: 'fixture',
        workItemId: 'TASK-X',
        run: (args) => (args[0] === 'commit' ? { status: 1 } : run(args)),
      }),
    /NATIVE_WRITER_COMMIT_FAILED/
  );
});
const routing = require('../routing');
test('native login writer needs usable live quota; unknown never proves available capacity', () => {
  const [candidate] = generateCandidates({
    registry: { sources: [native] },
    accounts: [],
    codexOpts,
    discoverPool: false,
  });
  const profile = {
    taskId: 'FIXTURE',
    role: 'writer',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    contextSize: 1,
    qualityFloor: 0,
    costCeiling: 100,
    forbiddenFailureDomains: [],
  };
  const rank = (status) =>
    routing.rankForProfile(
      [candidate],
      profile,
      { weightProfile: 'QUALITY_FIRST' },
      {
        useStoredQuota: false,
        evidenceData: { combinations: [] },
        headrooms: status
          ? { [candidate.accountId]: { status, observedAt: new Date().toISOString() } }
          : {},
      }
    );
  assert.equal(rank().ranking.length, 0);
  assert.equal(rank('exhausted').ranking.length, 0);
  assert.equal(rank('open').ranking.length, 1);
});
test('native quota cache must have a fresh timestamp; stale open quota is not capacity', () => {
  const [candidate] = generateCandidates({
    registry: { sources: [native] },
    accounts: [],
    codexOpts,
    discoverPool: false,
  });
  const now = Date.now();
  const read = (value) =>
    resolveCandidateHeadroom(candidate, {
      now,
      useStoredQuota: false,
      headrooms: { [candidate.accountId]: value },
    });
  assert.equal(read({ status: 'open', observedAt: new Date(0).toISOString() }).status, 'unknown');
  assert.equal(read({ status: 'open' }).status, 'unknown');
  assert.equal(read({ status: 'open', observedAt: new Date(now).toISOString() }).status, 'open');
});
test('gateway refresh and inference preflight use injected HTTP only: 200 admits, unavailable refuses', async () => {
  const { refreshWriterRegistry } = require('../writer-selection');
  const { probeRoute } = require('../route-probe');
  const source = registry.sources.find((s) => s.id === 'agy-gateway');
  const refreshed = await refreshWriterRegistry(
    { sources: [source] },
    {
      env: { [source.credential.env]: 'fixture-only' },
      fetchModels: async (url) => {
        assert.equal(url, source.endpoint + '/models');
        return { ok: true, json: async () => ({ data: [{ id: 'live-wire' }] }) };
      },
    }
  );
  const [c] = generateCandidates({ registry: refreshed, accounts: [], discoverPool: false });
  assert.equal(c.modelId, source.opencodeProvider + '/live-wire');
  const route = resolveRoute(
    { provider: source.id, harness: c.harness, model: c.modelId },
    { isolatedWorker: true },
    registry
  );
  const probe = routeProbeCandidate(c, route, refreshed);
  for (const status of [200, 503]) {
    const result = await probeRoute(
      probe,
      probe.apiKeyEnv,
      { [probe.apiKeyEnv]: 'fixture-only' },
      {
        fetch: async (url, init) => {
          assert.equal(url, source.endpoint + '/chat/completions');
          assert.equal(JSON.parse(init.body).model, 'live-wire');
          return {
            ok: status === 200,
            status,
            headers: new Map(),
            text: async () => (status === 200 ? 'OK' : 'unavailable'),
          };
        },
      }
    );
    assert.equal(result.ok, status === 200);
    assert.equal(result.status, status);
  }
});
test('installed hooks are pinned on the production commit path without touching Git', (t) => {
  const cp = require('node:child_process');
  const fs = require('node:fs');
  const calls = [];
  let dirty = true;
  const path = require('node:path');
  t.mock.method(
    fs,
    'existsSync',
    (file) =>
      String(file).endsWith('pre-commit') ||
      String(file).endsWith('.git') ||
      String(file).endsWith('config')
  );
  t.mock.method(fs, 'statSync', () => ({
    isFile: () => true,
    isDirectory: () => true,
    mode: 0o755,
  }));
  t.mock.method(fs, 'lstatSync', () => ({
    isFile: () => false,
    isDirectory: () => true,
    mode: 0o755,
  }));
  t.mock.method(fs, 'realpathSync', (p) => path.resolve(p));
  t.mock.method(fs, 'accessSync', () => undefined);
  t.mock.method(cp, 'spawnSync', (cmd, args, opts) => {
    assert.equal(cmd, 'git');
    calls.push(args);
    if (args[0] === 'config') return { status: 0, stdout: 'core.repositoryformatversion\0' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: '/trusted/hooks' };
    assert.equal(args[1], 'core.hooksPath=/trusted/hooks');
    assert.equal(opts.env.LEFTHOOK, undefined);
    if (args.includes('commit')) dirty = false;
    return {
      status: 0,
      stdout: args.includes('status') ? (dirty ? ' M fixture.js' : '') : 'a'.repeat(40),
    };
  });
  assert.equal(
    commitNativeWriterChanges({ workerRoot: 'fixture', hostRoot: 'trusted', workItemId: 'TASK-X' }),
    'a'.repeat(40)
  );
  assert.ok(calls.some((args) => args.includes('commit')));
  t.mock.method(fs, 'existsSync', () => false);
  assert.throws(
    () => commitNativeWriterChanges({ workerRoot: 'fixture', hostRoot: 'trusted' }),
    /pre-commit hook missing/
  );
});
test('native agy model refresh follows registry harness even when account names change', (t) => {
  const runtime = require('../agy-pool-runtime');
  t.mock.method(runtime, 'discoverPoolModels', () => ['fresh-model']);
  const source = {
    id: 'native-any',
    kind: 'agent-cli',
    harness: 'agy',
    accessPath: 'cli',
    accountProviders: ['provider-any'],
  };
  const out = generateCandidates({
    registry: { sources: [source] },
    accounts: [{ id: 'renamed-account', provider: 'provider-any', models: ['stale-model'] }],
    discoverPool: true,
  });
  assert.deepEqual(
    out.map((c) => c.modelId),
    ['fresh-model']
  );
});
test('only author/repair jobs authorize Controller commits; review and schema probes do not', (t) => {
  const { resolveLauncher } = require('../orchestrate');
  const harness = require('../harness');
  t.mock.method(harness, 'getHarness', () => ({ id: 'fixture', launch: () => [] }));
  const seen = [];
  const launch = resolveLauncher({ isolatedWorker: true }, (adapter, args, opts) => {
    seen.push(opts.commitFileOnlyWriter);
    return { exitCode: 1 };
  });
  for (const role of ['author.foundation', 'author.lowrisk', 'repair', 'reviewer', undefined]) {
    launch({ harness: 'fixture', labels: { role } });
  }
  assert.deepEqual(seen, [true, true, true, false, false]);
});
