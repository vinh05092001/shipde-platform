'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cli = require('../cli');
const routing = require('../routing');
const evidence = require('../evidence');
const health = require('../route-health');
const { candidateKey } = require('../candidates');

function fixture(t) {
  const scratch = path.join(__dirname, '../../../.oc');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'controller-route-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let externalCalls = 0;
  const forbidden = () => {
    externalCalls++;
    assert.fail('offline dispatch must not call a network or model');
  };
  t.after(() => assert.equal(externalCalls, 0, 'no swallowed network/model attempts'));
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const name of ['node:http', 'node:https']) {
    t.mock.method(require(name), 'request', forbidden);
    t.mock.method(require(name), 'get', forbidden);
  }
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
    t.mock.method(require('node:child_process'), name, forbidden);
  }
  for (const name of ['submitJob', 'runAdapter', 'discoverPoolModels']) {
    t.mock.method(require('../agy-pool-runtime'), name, forbidden);
  }
  t.mock.method(require('../route-probe'), 'probeRoute', forbidden);
  let credentialReads = 0;
  for (const [io, name] of [
    [fs, 'readFileSync'],
    [fs, 'readFile'],
    [fs, 'createReadStream'],
    [fs.promises, 'readFile'],
  ]) {
    const read = io[name];
    t.mock.method(io, name, function (file, ...args) {
      if (
        /(^|[\\/])(?:\.env[^\\/]*|\.pgpass|auth[^\\/]*|credentials[^\\/]*|\.credentials[^\\/]*)(?:$|[\\/])/i.test(
          String(file)
        )
      ) {
        credentialReads++;
        assert.fail('credential-file reads are forbidden');
      }
      return read.call(this, file, ...args);
    });
  }
  t.after(() => assert.equal(credentialReads, 0));
  const now = Date.parse('2026-11-07T00:00:00Z');
  const rows = ['first', 'ranked'].map((id, i) => ({
    harness: 'paseo',
    accessPath: 'fixture-cli',
    gateway: 'fixture-gateway',
    upstream: 'fixture-upstream',
    accountId: 'fixture-account',
    quotaScope: 'fixture-account',
    modelId: `fixture-upstream/${id}`,
    state: 'AVAILABLE',
    qualifiedRoles: ['author.foundation'],
    quality: 70,
    cost: 1,
    latencyMs: i === 0 ? 300000 : 1000,
  }));
  const routeHealthFile = path.join(root, 'health.json');
  const store = health.loadStore(routeHealthFile, { allowMissing: true });
  for (const row of rows) {
    health.recordResult(
      store,
      row.modelId,
      { id: row.gateway, accountId: row.accountId },
      { ok: true, status: 200 },
      now
    );
  }
  health.saveStore(routeHealthFile, store);
  fs.mkdirSync(path.join(root, 'discovery'));
  fs.writeFileSync(
    path.join(root, 'discovery/freshness.json'),
    JSON.stringify({ lastSuccessfulAt: new Date(now).toISOString(), complete: true })
  );
  const catalogue = t.mock.method(require('../discovery/read'), 'readDiscoveryCatalogue', () => ({
    candidates: rows,
  }));
  const freshness = t.mock.method(require('../catalogue-refresh'), 'catalogueFreshness');
  t.mock.method(evidence, 'loadEvidence', () => ({ combinations: [], cooldowns: {} }));
  const lines = [];
  const exits = [];
  const deps = {
    rootDir: root,
    home: root,
    registry: { sources: [], dispatch: { providers: {} } },
    accounts: [],
    registryAccounts: [],
    offerings: [],
    discoverPool: false,
    discoveryDataDir: path.join(root, 'discovery'),
    routeHealthFile,
    decisionDir: path.join(root, 'decisions'),
    decisionLogFile: path.join(root, 'decision.json'),
    storePath: path.join(root, 'quota.json'),
    quotaState: { scopes: {} },
    priors: { ranking: [] },
    reservations: [],
    headrooms: {},
    now,
    env: {},
    onboardingPrepared: true,
    readDispatchComboConfig: async () => ({ members: null, state: 'COMBO_CONFIG_UNAVAILABLE' }),
    jevAsk: async () => ({ choice: 'LATENCY_FIRST', confidence: 1 }),
    taskProfile: {
      taskId: 'TASK-ROUTE-FIXTURE',
      role: 'writer',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      latencyPriority: 'high',
    },
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  };
  const args = { item: 'TASK-ROUTE-FIXTURE', 'dry-run': true };
  return { args, deps, rows, lines, exits, catalogue, freshness };
}

test('healthy catalogue dispatch selects the Controller ranking rather than catalogue order', async (t) => {
  const f = fixture(t);
  const rank = t.mock.method(routing, 'rankForProfile');
  const result = await cli.dispatchCommand(f.args, f.deps);
  assert.equal(result.exitCode, 0);
  assert.ok(f.freshness.mock.callCount() > 0, 'exercise the live freshness gate');
  assert.ok(f.freshness.mock.calls.every((call) => call.result.stale === false));
  assert.equal(f.catalogue.mock.callCount(), 1, 'assemble from the catalogue reader');
  assert.equal(rank.mock.callCount(), 1);
  assert.equal(result.decision.chosen, candidateKey(f.rows[1]));
  assert.notEqual(result.decision.chosen, candidateKey(f.rows[0]));
  assert.equal(result.decision.candidates.length, f.rows.length);
  assert.ok(result.decision.candidates[0].score > result.decision.candidates[1].score);
  assert.ok(f.lines.includes('Chosen: ' + result.decision.chosen));
  const saved = JSON.parse(fs.readFileSync(f.deps.decisionLogFile, 'utf8'));
  assert.equal(saved.selected, result.decision.chosen);
  assert.deepEqual(f.exits, [0]);
  [f.rows[0].latencyMs, f.rows[1].latencyMs] = [f.rows[1].latencyMs, f.rows[0].latencyMs];
  const reranked = await cli.dispatchCommand(f.args, f.deps);
  assert.equal(
    reranked.decision.chosen,
    candidateKey(f.rows[0]),
    'ranking follows changed evidence'
  );
});

test('P5 dispatch --scan-file excludes exact failed routes before Controller ranking', async (t) => {
  const f = fixture(t);
  const scanFile = path.join(f.deps.rootDir, 'scan.jsonl');
  const failed = f.rows[1];
  fs.writeFileSync(
    scanFile,
    JSON.stringify({
      sourceId: failed.gateway,
      accountId: failed.accountId,
      modelId: failed.modelId,
      httpStatus: 401,
      reason: 'AUTH',
      elapsedMs: 12,
      evidence: 'fake response',
    }) + '\n'
  );
  const rank = t.mock.method(routing, 'rankForProfile');
  const result = await cli.dispatchCommand({ ...f.args, 'scan-file': scanFile }, f.deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.decision.chosen, candidateKey(f.rows[0]));
  assert.ok(
    rank.mock.calls.every((call) => !JSON.stringify(call.arguments[0]).includes(failed.modelId))
  );
  assert.ok(result.decision.rejected.some((r) => r.reason === 'AUTH'));
});

test('Controller ranking failure rejects dispatch without a pool probe or chosen output', async (t) => {
  const f = fixture(t);
  const failure = new Error('FIXTURE_CONTROLLER_RANKING_FAILED');
  const rank = t.mock.method(routing, 'rankForProfile', () => {
    throw failure;
  });
  await assert.rejects(
    () => cli.dispatchCommand(f.args, f.deps),
    (err) => err === failure
  );
  assert.equal(rank.mock.callCount(), 1);
  assert.equal(
    f.lines.some((line) => String(line).startsWith('Chosen:')),
    false
  );
  assert.deepEqual(f.exits, []);
  assert.equal(fs.existsSync(f.deps.decisionLogFile), false, 'no successful decision is persisted');
});

test('dispatch CLI reports a Controller rejection and sets a failing exit status', async (t) => {
  const f = fixture(t);
  const previousExitCode = process.exitCode;
  t.after(() => {
    process.exitCode = previousExitCode;
  });
  const errors = [];
  let reported;
  const failureReported = new Promise((resolve) => {
    reported = resolve;
  });
  t.mock.method(console, 'error', (line) => {
    errors.push(line);
    reported();
  });
  const failure = new Error('FIXTURE_CONTROLLER_RANKING_FAILED');
  const rank = t.mock.method(routing, 'rankForProfile', () => {
    throw failure;
  });
  cli.main(['dispatch', '--dry-run', '--item', f.args.item], f.deps);
  await failureReported;
  assert.equal(rank.mock.callCount(), 1);
  assert.equal(process.exitCode, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Dispatch .*FIXTURE_CONTROLLER_RANKING_FAILED/);
  assert.equal(
    f.lines.some((line) => String(line).startsWith('Chosen:')),
    false
  );
  assert.deepEqual(f.exits, []);
});
