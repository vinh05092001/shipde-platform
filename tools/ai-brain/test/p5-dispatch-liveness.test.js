'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchRoute } = require('../sources');
const { launchFromDecision } = require('../route-handoff');
const { assembleForDispatch } = require('../cli');

const source = {
  id: 'fixture-direct',
  kind: 'model-source',
  endpoint: 'https://fixture.invalid/v1',
  accessPath: 'direct',
  credential: { type: 'api-key', env: 'FIXTURE_KEY' },
  opencodeProvider: 'fixture-provider',
  aliases: ['fixture-alias'],
};
const registry = { sources: [source], dispatch: { providers: {} } };
const candidate = {
  harness: 'opencode-direct',
  gateway: source.id,
  sourceId: source.id,
  upstream: source.opencodeProvider,
  accessPath: source.endpoint,
  accountId: 'fixture-account',
  modelId: 'org/Exact-Model',
};

function fixture(t, rows) {
  const scratch = path.resolve(__dirname, '../../../.oc');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'p5-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scanFile = path.join(root, 'scan.jsonl');
  const defaults = {
    sourceId: source.id,
    accountId: candidate.accountId,
    modelId: candidate.modelId,
    httpStatus: 200,
    reason: 'OK',
    elapsedMs: 17,
    evidence: 'fake response',
  };
  fs.writeFileSync(
    scanFile,
    rows.map((r) => JSON.stringify({ ...defaults, ...r })).join('\n') + '\n'
  );
  const forbidden = () => assert.fail('no network, model, credential or persistence calls');
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const module of ['node:http', 'node:https']) {
    for (const method of ['get', 'request']) t.mock.method(require(module), method, forbidden);
  }
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
    t.mock.method(require('node:child_process'), method, forbidden);
  }
  t.mock.method(require('../route-health'), 'saveStore', forbidden);
  t.mock.method(require('../evidence'), 'saveEvidence', forbidden);
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    if (
      /(^|[\\/])(?:\.env[^\\/]*|\.pgpass|auth[^\\/]*|credentials[^\\/]*)(?:$|[\\/])/i.test(
        String(file)
      )
    )
      forbidden();
    return read.call(this, file, ...args);
  });
  return {
    scanFile,
    registryAccounts: [],
    offerings: [],
    discoverPool: false,
    routeHealth: { paths: {} },
    registry,
  };
}

test('P5 derives direct dispatch from registry metadata and preserves explicit routes', (t) => {
  const opts = fixture(t, []);
  const file = path.join(path.dirname(opts.scanFile), 'sources.json');
  fs.writeFileSync(file, JSON.stringify(registry));
  assert.deepEqual(
    require('../sources').loadSources({ file }).dispatch.providers[source.id],
    dispatchRoute(source.id, registry)
  );
  assert.deepEqual(dispatchRoute(source.id, registry), {
    harness: 'opencode-direct',
    provider: 'opencode',
    modelPrefix: 'fixture-provider/',
    modelIdIsExact: true,
  });
  const fallback = { ...source, id: 'another-direct', opencodeProvider: undefined };
  assert.equal(dispatchRoute(fallback.id, { sources: [fallback] }).modelPrefix, fallback.id + '/');
  const explicit = { harness: 'paseo', provider: 'opencode', modelPrefix: 'explicit/' };
  assert.deepEqual(
    dispatchRoute(source.id, { ...registry, dispatch: { providers: { [source.id]: explicit } } }),
    explicit
  );
  for (const change of [
    { enabled: false },
    { servesModels: false },
    { disposition: 'deferred' },
    { disposition: 'compromised-credential' },
    { kind: 'agent-cli' },
    { accessPath: 'cli' },
    { endpoint: 'file:///fixture' },
    { credential: {} },
  ])
    assert.equal(dispatchRoute(source.id, { sources: [{ ...source, ...change }] }), null);
  assert.equal(dispatchRoute(source.id, { ...registry, retired: [{ id: source.id }] }), null);
});

test('P5 exact direct route reaches isolated launch without changing model identity', () => {
  const chosen = { ...candidate, offeringId: 'fixture-offering' };
  const decision = { selected: chosen.offeringId, candidates: [chosen] };
  const request = { cwd: 'fixture-worktree', prompt: 'fake task', isolatedWorker: true };
  const launch = launchFromDecision(decision, request, registry);
  assert.equal(launch.harness, 'opencode-direct');
  assert.equal(launch.model, source.opencodeProvider + '/' + candidate.modelId);
  assert.equal(launch.args[launch.args.indexOf('--model') + 1], launch.model);
  const explicitRegistry = {
    ...registry,
    dispatch: {
      providers: {
        [source.id]: {
          harness: 'opencode-direct',
          provider: 'opencode',
          modelPrefix: source.opencodeProvider + '/',
        },
      },
    },
  };
  chosen.modelId = launch.model;
  assert.equal(launchFromDecision(decision, request, explicitRegistry).model, launch.model);
  assert.throws(
    () => launchFromDecision(decision, { ...request, isolatedWorker: false }, registry),
    /REQUIRES_ISOLATION/
  );
});

for (const reason of ['AUTH', 'QUOTA', 'NO_CHANNEL']) {
}
