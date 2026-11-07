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
const transportCandidate = { ...candidate, modelId: 'fixture-provider/' + candidate.modelId };

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
  chosen.modelId = launch.model;
  assert.equal(launchFromDecision(decision, request, registry).model, launch.model);
  assert.throws(
    () => launchFromDecision(decision, { ...request, isolatedWorker: false }, registry),
    /REQUIRES_ISOLATION/
  );
});

test('P5 scan adds API proof to exact candidates in both assembly paths without writes', (t) => {
  const opts = fixture(t, [{}]);
  const original = JSON.stringify(candidate);
  const scanBefore = fs.readFileSync(opts.scanFile, 'utf8');
  for (const explicit of [true, false]) {
    const input = explicit ? candidate : transportCandidate;
    const rows = assembleForDispatch({ candidates: [input] }, [], registry, {
      ...opts,
      ...(explicit ? { candidates: [input] } : {}),
    });
    const row = rows.find((c) => c.modelId === input.modelId);
    assert.ok(row, 'API proof admits an exact route with missing health');
    assert.equal(row.evidence.at(-1).proofLevel, 'API_PASS');
    assert.equal(row.evidence.at(-1).status, 'passed');
    assert.equal(row.evidence.at(-1).elapsedMs, 17);
    assert.equal(require('../evidence').isHarnessProven(row.evidence), false);
  }
  assert.equal(JSON.stringify(candidate), original);
  assert.deepEqual(opts.routeHealth, { paths: {} });
  assert.equal(fs.readFileSync(opts.scanFile, 'utf8'), scanBefore);
});

for (const reason of ['AUTH', 'QUOTA', 'NO_CHANNEL']) {
  test(
    'P5 latest exact scan refuses ' + reason + ' before ranking even with health bypass',
    (t) => {
      const opts = fixture(t, [{}, { reason, httpStatus: 403 }]);
      for (const explicit of [true, false]) {
        const input = explicit ? candidate : transportCandidate;
        const rows = assembleForDispatch({ candidates: [input] }, [], registry, {
          ...opts,
          allowUnprobedCandidates: true,
          ...(explicit ? { candidates: [input] } : {}),
        });
        assert.equal(
          rows.some((c) => c.modelId === input.modelId),
          false
        );
        assert.ok(rows.excludedRoutes.some((r) => r.reason === reason && r.reasonCode === reason));
      }
    }
  );
}

test('P5 scan identity never borrows source aliases, accounts, model aliases or case', (t) => {
  const opts = fixture(t, [
    { sourceId: 'fixture-alias', reason: 'AUTH' },
    { accountId: 'other-account', reason: 'QUOTA' },
    { modelId: 'org/exact-model', reason: 'NO_CHANNEL' },
    { modelId: 'alias-model', reason: 'AUTH' },
  ]);
  const rows = assembleForDispatch(null, [], registry, {
    ...opts,
    candidates: [{ ...candidate, aliases: ['alias-model'] }],
    probeEvidence: () => true,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scanLiveness, undefined);
});

test('P5 latest success replaces failure; scan is opt-in and malformed input fails closed', (t) => {
  const opts = fixture(t, [{ reason: 'AUTH', httpStatus: 401 }, {}]);
  const assemble = (extra) =>
    assembleForDispatch(null, [], registry, {
      ...opts,
      candidates: [candidate],
      probeEvidence: () => true,
      ...extra,
    });
  assert.equal(assemble()[0].evidence.at(-1).status, 'passed');
  assert.equal(assemble({ scanFile: undefined })[0].scanLiveness, undefined);
  fs.appendFileSync(opts.scanFile, 'not json\n');
  assert.throws(() => assemble(), /SCAN_INVALID_LINE:3/);
  assert.throws(() => assemble({ scanFile: opts.scanFile + '.missing' }), /ENOENT/);
});
