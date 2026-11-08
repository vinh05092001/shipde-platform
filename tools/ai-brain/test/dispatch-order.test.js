'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Install before loading the dispatch modules; even a swallowed attempt fails cleanup.
function blockExternalCalls(t) {
  const attempts = [];
  const blocked = (name) => () => {
    attempts.push(name);
    throw new Error('Offline dispatch fixture blocked ' + name);
  };
  t.mock.method(globalThis, 'fetch', blocked('fetch'));
  for (const [module, methods] of [
    ['node:http', ['request', 'get']],
    ['node:https', ['request', 'get']],
    ['node:http2', ['connect']],
    ['node:tls', ['connect']],
    ['node:dgram', ['createSocket']],
    [
      'node:child_process',
      ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
    ],
  ]) {
    const api = require(module);
    for (const method of methods) t.mock.method(api, method, blocked(module + '.' + method));
  }
  t.mock.method(require('node:net').Socket.prototype, 'connect', blocked('net.connect'));
  t.after(() => assert.deepEqual(attempts, [], 'no network or external process attempted'));
}

function fixture(t) {
  blockExternalCalls(t);
  const { dispatchCommand } = require('../cli');
  const { candidateKey } = require('../candidates');
  const root = fs.mkdtempSync(path.join(__dirname, 'dispatch-order-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.parse('2026-01-01T00:00:00Z');
  const maxAgeMs = 60000;
  const candidates = [60, 83, 81, 80].map((quality, index) => ({
    harness: 'opencode',
    accessPath: 'https://fixture.invalid/v1',
    source: 'fixture',
    gateway: 'fixture',
    upstream: 'fixture',
    accountId: `account-${index}`,
    quotaScope: `fixture/model-${index}`,
    modelId: `fixture/model-${index}`,
    contextWindow: 128000,
    capabilities: { contextWindow: 128000 },
    qualifiedRoles: ['author.foundation'],
    quality,
    evidence: [],
  }));
  const profile = {
    taskId: 'TASK-DISPATCH-ORDER-FIXTURE',
    role: 'author.foundation',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    qualityFloor: 0,
    contextSize: 64000,
  };
  const assessment = {
    weightProfile: 'FIXTURE_QUALITY_ONLY',
    weights: { quality: 100, latency: 0, cost: 0, reliability: 0, applyPenalties: false },
  };
  const state = (proven, age = 0) => ({
    scopes: Object.fromEntries(
      proven.map((candidate) => [
        `fixture::${candidate.modelId}`,
        {
          source: 'fixture',
          scope: candidate.modelId,
          model: candidate.modelId,
          code: 'OK',
          at: new Date(now - age).toISOString(),
        },
      ])
    ),
  });
  const run = (offered, quotaState, extra = {}) => {
    const logs = [];
    const result = dispatchCommand(
      { 'dry-run': true, root },
      {
        candidates: offered,
        items: [{ workItemId: profile.taskId, role: profile.role }],
        accounts: [],
        registry: { sources: [], dispatch: { routeEvidenceMaxAgeMs: maxAgeMs } },
        now,
        priors: [],
        taskProfile: profile,
        assessment,
        quotaState,
        headrooms: { default: 'open' },
        reservations: [],
        home: root,
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: path.join(root, 'decisions'),
        routeHealthFile: path.join(root, 'route-health.json'),
        run: () => assert.fail('dry-run must never launch a worker'),
        log: (line) => logs.push(line),
        error: (line) => assert.fail(line),
        exit: (code) => assert.equal(code, 0),
        ...extra,
      }
    );
    assert.equal(result.exitCode, 0);
    const rows = result.decision.candidates;
    const printed = logs.filter((line) => /^  \d+\. /.test(line));
    assert.deepEqual(
      printed,
      rows.map(
        (row, index) =>
          `  ${index + 1}. ${row.offeringId} (score: ${row.qualityLabel || row.score})`
      ),
      'CLI prints the ranking in its existing order'
    );
    assert.equal(result.decision.chosen, rows[0].offeringId);
    assert.ok(logs.includes('Chosen: ' + rows[0].offeringId));
    assert.equal(fs.existsSync(path.join(root, 'decisions')), false);
    return rows;
  };
  return { candidates, candidateKey, state, run, maxAgeMs };
}

test('dispatch order: fresh route evidence precedes higher scores in CLI output', (t) => {
  const { candidates, state, run } = fixture(t);
  for (const offered of [candidates, candidates.slice().reverse()]) {
    const rows = run(offered, state([candidates[0]]));
    assert.deepEqual(
      rows.map((row) => row.score),
      [60, 83, 81, 80]
    );
    assert.deepEqual(
      rows.map((row) => row.hasFreshEvidence),
      [true, false, false, false]
    );
    assert.deepEqual(
      rows.map((row) => row.scoreBreakdown.quality),
      [60, 83, 81, 80]
    );
  }
});

test('dispatch order: equal evidence groups sort by score regardless of input order', (t) => {
  const { candidates, state, run } = fixture(t);
  for (const proven of [[], candidates]) {
    for (const offered of [candidates, candidates.slice().reverse()]) {
      assert.deepEqual(
        run(offered, state(proven)).map((row) => row.score),
        [83, 81, 80, 60]
      );
    }
  }
});

test('dispatch order: stale evidence cannot promote the lower scoring route', (t) => {
  const { candidates, state, run, maxAgeMs } = fixture(t);
  const rows = run(candidates, state([candidates[0]], maxAgeMs + 1));
  assert.deepEqual(
    rows.map((row) => row.score),
    [83, 81, 80, 60]
  );
  assert.ok(rows.every((row) => row.hasFreshEvidence === false));
});

test('dispatch order: known quality precedes fresh evidence with unknown quality', (t) => {
  const { candidates, candidateKey, state, run } = fixture(t);
  const unknown = { ...candidates[0], quality: undefined };
  const rows = run([unknown, candidates[1]], state([unknown]));
  assert.equal(rows[0].offeringId, candidateKey(candidates[1]));
  assert.equal(rows[1].qualityLabel, 'QUALITY_UNKNOWN');
  assert.equal(rows[1].hasFreshEvidence, true);
});

test('dispatch order: isolated worker retains the fresh route priority without changing scores', (t) => {
  const { candidates, state, run } = fixture(t);
  const rows = run(candidates.slice().reverse(), state([candidates[0]]), { isolatedWorker: true });
  assert.deepEqual(
    rows.map((row) => row.score),
    [60, 83, 81, 80]
  );
});
