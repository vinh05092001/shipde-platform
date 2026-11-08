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

test('P5 scan adds API proof to exact candidates in both assembly paths without writes', (t) => {
  const opts = fixture(t, [{}]);
  const original = JSON.stringify(candidate);
  const scanBefore = fs.readFileSync(opts.scanFile, 'utf8');
  for (const explicit of [true, false]) {
    const input = candidate;
    const rows = assembleForDispatch({ candidates: [input] }, [], registry, {
      ...opts,
      ...(explicit ? { candidates: [input] } : {}),
    });
    const row = rows.find((c) => c.modelId === input.modelId);
    assert.ok(row, 'API proof admits an exact route with missing health');
    assert.equal(row.scanLiveness.proofLevel, 'API_PASS');
    assert.equal(row.scanLiveness.status, 'passed');
    assert.equal(row.scanLiveness.elapsedMs, 17);
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
        const input = candidate;
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

test('P5b scan matches exact API IDs even when their namespace equals the dispatch prefix', (t) => {
  const namespaced = { ...candidate, modelId: 'fixture-provider/leaf' };
  const opts = fixture(t, [
    { modelId: 'leaf', reason: 'AUTH', httpStatus: 401 },
    { modelId: namespaced.modelId },
  ]);
  for (const explicit of [true, false]) {
    const assemble = () =>
      assembleForDispatch({ candidates: [namespaced] }, [], registry, {
        ...opts,
        allowUnprobedCandidates: true,
        ...(explicit ? { candidates: [namespaced] } : {}),
      });
    const rows = assemble();
    assert.equal(rows.length, 1, 'failure of leaf must not exclude fixture-provider/leaf');
    assert.equal(rows[0].scanLiveness.status, 'passed');
    fs.appendFileSync(
      opts.scanFile,
      JSON.stringify({
        sourceId: source.id,
        accountId: candidate.accountId,
        modelId: namespaced.modelId,
        reason: 'AUTH',
        httpStatus: 401,
      }) + '\n'
    );
    assert.equal(assemble().length, 0, 'failure of the exact namespaced ID must exclude it');
    // Restore the success so both assembly paths start with the same observations.
    fs.appendFileSync(
      opts.scanFile,
      JSON.stringify({
        sourceId: source.id,
        accountId: candidate.accountId,
        modelId: namespaced.modelId,
        reason: 'OK',
        httpStatus: 200,
      }) + '\n'
    );
  }
});

test('P5e admitted API namespace survives transport qualification at launch', (t) => {
  const namespaced = {
    ...candidate,
    offeringId: 'fixture-namespaced',
    modelId: 'fixture-provider/leaf',
  };
  const opts = fixture(t, [
    { modelId: namespaced.modelId },
    { modelId: 'leaf', reason: 'AUTH', httpStatus: 401 },
  ]);
  const inputs = [namespaced, { ...candidate, modelId: 'leaf' }];
  for (const explicit of [true, false]) {
    const rows = assembleForDispatch({ candidates: inputs }, [], registry, {
      ...opts,
      ...(explicit ? { candidates: inputs } : {}),
    });
    assert.deepEqual(
      rows.map((row) => row.modelId),
      [namespaced.modelId]
    );
    assert.equal(rows[0].scanLiveness.status, 'passed');
    const decision = JSON.parse(JSON.stringify({ selected: rows[0].offeringId, candidates: rows }));
    const launch = launchFromDecision(
      decision,
      { cwd: 'fixture-worktree', prompt: 'fake task', isolatedWorker: true },
      registry
    );
    assert.equal(launch.model, source.opencodeProvider + '/' + namespaced.modelId);
    assert.equal(launch.args[launch.args.indexOf('--model') + 1], launch.model);
    assert.equal(launch.model.slice(launch.model.indexOf('/') + 1), namespaced.modelId);
  }
});

test('P5b scan proof remains ephemeral and preserves existing candidate evidence', (t) => {
  const opts = fixture(t, [{}]);
  const { Level, Status, ProofLevel } = require('../evidence');
  const existing = [
    { level: Level.HARNESS, status: Status.PASSED, proofLevel: ProofLevel.HARNESS_PASS },
  ];
  const input = { ...candidate, evidence: existing };
  const [row] = assembleForDispatch(null, [], registry, { ...opts, candidates: [input] });
  assert.equal(row.scanLiveness.proofLevel, 'API_PASS', 'admission can use local scan proof');
  const saved = JSON.parse(JSON.stringify(row));
  assert.equal(saved.scanLiveness, undefined);
  assert.deepEqual(saved.evidence, existing, 'scan proof must not join persistent evidence');
  assert.equal({ ...row }.scanLiveness, undefined, 'candidate copies drop admission-only proof');
  assert.deepEqual(input, { ...candidate, evidence: existing });
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
  assert.equal(assemble()[0].scanLiveness.status, 'passed');
  assert.equal(assemble({ scanFile: undefined })[0].scanLiveness, undefined);
  fs.appendFileSync(opts.scanFile, 'not json\n');
  assert.throws(() => assemble(), /SCAN_INVALID_LINE:3/);
  assert.throws(() => assemble({ scanFile: opts.scanFile + '.missing' }), /ENOENT/);
});
