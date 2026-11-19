'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../discovery/identity');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'task-ai-142-writer-probe-'));
}

function makeTempRepo() {
  const dir = tmpDir('repo-');
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'worker@shipde.test']);
  git(['config', 'user.name', 'Worker']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'base content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, sha: git(['rev-parse', 'HEAD']).stdout.trim() };
}

function createCandidate(overrides) {
  const c = Object.assign(
    {
      harness: 'opencode',
      accessPath: 'https://gateway.example/v1',
      gateway: 'oc',
      upstream: 'vendor',
      accountId: 'account-1',
      quotaScope: 'account-1',
      modelId: 'vendor/model-1',
      source: 'oc',
      kind: 'agent-cli',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 64000 },
      evidence: [{ status: 'passed', kind: 'WORK_ITEM_PASS', proofLevel: 'WORK_ITEM_PASS' }],
      quality: 90,
      cost: 1,
    },
    overrides || {}
  );
  c.candidateKey = candidateKey(c);
  return c;
}

for (const providerCause of ['upstream_credit_exhausted', '[credit.exhausted']) {
}

test('(d) next keeps brain decisions in the intake run instead of forwarding its global decision dir', async (t) => {
  const root = tmpDir('writer-intake-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registerPath = path.join(root, 'register.csv');
  const runDir = path.join(root, 'intake');
  fs.mkdirSync(runDir);
  fs.writeFileSync(
    registerPath,
    'delivery_order,work_item_id,status,dependencies\n1,GOAL-WRITER,READY_FOR_AUTHOR,\n'
  );
  let runFiles;
  await require('../next-runner').runNext(
    { rootDir: root, registerPath, decisionDir: path.join(root, 'runner-decisions'), run: true },
    {
      log: () => {},
      config: {},
      runIntake: async (options) => {
        assert.equal(
          options.decisionDir,
          undefined,
          'runner must not override the intake decision dir'
        );
        ({ runFiles } = require('../intake').composeOrchestrateCommand({
          root,
          runDir,
          baseSha: 'a'.repeat(40),
          repoRoot: root,
          decisionDir: options.decisionDir,
        }));
        return { status: 'failed', exitCode: 1, reason: 'dry intake routing check', runFiles };
      },
    }
  );
  assert.equal(runFiles.decisionDir, path.join(runDir, 'decisions'));
});

for (const [failedLaunch, pending] of [
  [false, false],
  [true, false],
  [true, true],
]) {
}

test('probe ordering preserves rank inside each health group', () => {
  const health = require('../route-health');
  const dir = tmpDir();
  try {
    const ranked = Array.from({ length: 6 }, (_, i) =>
      createCandidate({ modelId: `fixture/model-${i}` })
    );
    const options = {
      routeHealth: { version: 1, paths: {}, events: [] },
      routeHealthFile: path.join(dir, 'health.json'),
      now: Date.now(),
    };
    for (const i of [1, 4]) health.rememberProbe(ranked[i], { ok: true }, options);
    for (const i of [0, 3]) health.rememberProbe(ranked[i], { ok: false, status: 404 }, options);
    assert.deepEqual(health.orderProbeRoutes(ranked, options), [
      ranked[1],
      ranked[4],
      ranked[2],
      ranked[5],
      ranked[0],
      ranked[3],
    ]);
    assert.deepEqual(
      ranked.map((c) => c.modelId),
      Array.from({ length: 6 }, (_, i) => `fixture/model-${i}`)
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const reasonCode of ['PROBE_BUDGET_EXHAUSTED', 'PROBE_ROUTE_CONFIGURATION_UNAVAILABLE']) {
}

for (const fallbackProbe of ['success', 'budget-exhausted']) {
}

test('maxTurns counts writer launches: refused in-loop probe rounds do not end the item, launches beyond it do', async (t) => {
  const repo = makeTempRepo();
  const decisionDir = tmpDir('dec-turns-');
  const evidenceDir = tmpDir('evi-turns-');
  t.after(() => {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(decisionDir, { recursive: true, force: true });
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });
  const live = new Set([1, 5, 6, 7]);
  const candidates = [1, 2, 3, 4, 5, 6, 7].map((n) =>
    createCandidate({
      accessPath: 'https://gw-' + n + '.example/v1',
      gateway: 'gw-' + n,
      accountId: 'acc-' + n,
      quotaScope: 'acc-' + n,
      modelId: 'vendor/model-' + n,
      quality: 100 - n,
    })
  );
  const registry = {
    sources: candidates
      .map((c) => ({ id: c.gateway, endpoint: c.accessPath, credential: { env: 'TEST_KEY' } }))
      .concat([
        { id: 'oc', endpoint: 'https://gateway.example/v1', credential: { env: 'TEST_KEY' } },
      ]),
    dispatch: { providers: { oc: { harness: 'opencode-direct', provider: 'opencode' } } },
  };
  const launches = [];
  const result = await runOrchestration('turns count launches', {
    isolatedWorker: true,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.sha,
    sha: repo.sha,
    decisionDir,
    evidenceDir,
    candidates,
    registry,
    specs: [
      { id: 'TASK-AI-142', complexity: 'simple', files: ['a.js'], acceptanceCriteria: ['done'] },
    ],
    tokenBudgets: { byComplexity: { simple: { maxTurns: 2 } } },
    routeProbe: async (probeCandidate) => {
      const n = Number(probeCandidate.accessPath.split('gw-')[1].split('.')[0]);
      return live.has(n)
        ? { ok: true, status: 200, body: 'OK' }
        : { ok: false, status: 500, body: 'down' };
    },
    run: (job) => {
      launches.push(job.candidateKey);
      return { exitCode: 1, stdout: '', stderr: 'writer failed' };
    },
    reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
    tests: () => ({ pass: true }),
    hostGate: () => ({ pass: true, failures: [] }),
    ranking: { priors: { ranking: [] } },
  });
  assert.equal(launches.length, 2, 'two real launches fit maxTurns=2 across refused probe rounds');
  assert.match(JSON.stringify(result), /TURN_BUDGET_EXCEEDED/);
});

for (const [status, expected] of [
  [401, 'AUTH_NEEDED'],
  [451, 'GEO_BLOCKED'],
]) {
  test(`HTTP ${status} probe keeps its cause and cause-specific cooldown`, () => {
    const probe = require('../route-probe');
    const health = require('../route-health');
    assert.equal(
      probe.classifyProbeFailure({ ok: false, status, body: 'upstream refused' }),
      expected
    );
    assert.equal(health.probeCooldownMs(expected), status === 451 ? 24 * 3600000 : 6 * 3600000);
  });
}

test('known-good ordering expires old successes and respects a newer provider failure', () => {
  const health = require('../route-health');
  const order = require('../probe-order');
  const now = Date.now();
  const stale = createCandidate({ modelId: 'vendor/stale' });
  const fresh = createCandidate({ modelId: 'vendor/fresh' });
  const unknown = createCandidate({ modelId: 'other/unknown' });
  const routeHealth = { version: 1, paths: {}, events: [] };
  const opts = { routeHealth, persistRouteHealth: false, now };
  health.rememberProbe(stale, { ok: true, status: 200 }, { ...opts, now: now - 25 * 3600000 });
  assert.deepEqual(health.orderProbeRoutes([unknown, stale], opts), [unknown, stale]);
  health.rememberProbe(fresh, { ok: true, status: 200 }, { ...opts, now: now - 1000 });
  health.rememberProbe(
    createCandidate({ modelId: 'vendor/failed' }),
    { ok: false, status: 503, body: 'No active credentials for provider: vendor' },
    opts
  );
  assert.equal(order.recentRouteSuccess(fresh, routeHealth, opts), false);
});

for (const harness of ['paseo', 'direct-http']) {
}

for (const status of [401, 403, 451, 503]) {
  test(`HTTP ${status} response headers survive a stalled upstream error body`, async () => {
    const { probeRoute } = require('../route-probe');
    const result = await probeRoute(
      { accessPath: 'https://fixture.example/v1', modelId: 'vendor/m' },
      'KEY',
      { KEY: 'fixture' },
      {
        fetch: async () => ({
          ok: false,
          status,
          text: async () => {
            throw Object.assign(Error('body interrupted'), { name: 'AbortError' });
          },
        }),
      }
    );
    assert.equal(result.status, status);
    assert.equal(result.ok, false);
  });
}

test('HTTP refusal with a never-ending body returns before the outer probe deadline', async () => {
  const probe = require('../route-probe');
  const result = await probe.boundedProbe(
    probe.probeRoute,
    { accessPath: 'https://fixture.example/v1', modelId: 'vendor/m' },
    'KEY',
    { KEY: 'fixture' },
    {
      timeoutMs: 100,
      fetch: async () => ({ ok: false, status: 503, text: () => new Promise(() => {}) }),
    }
  );
  assert.equal(result.status, 503);
});

for (const [body, expected] of [
  ['upstream returned 401: re-authenticate', 'AUTH_NEEDED'],
  ['upstream returned 451: unavailable in your location', 'GEO_BLOCKED'],
]) {
  test(`gateway HTTP 503 preserves nested upstream cause ${expected}`, () => {
    assert.equal(require('../route-probe').classifyProbeFailure({ status: 503, body }), expected);
  });
}

// Live writer runs are isolated; the preflight is an isolated-worker gate.
for (const isolatedWorker of [true]) {
}

test('H3 HTTP 404 model_not_found without a credential message is route unavailable', () => {
  assert.equal(
    require('../route-probe').classifyProbeFailure({
      ok: false,
      status: 404,
      body: '{"error":{"code":"model_not_found"}}',
    }),
    'ROUTE_UNAVAILABLE'
  );
});
