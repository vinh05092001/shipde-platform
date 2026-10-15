'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const { probeRankedRoutes } = require('../hermes-session');
const { candidateKey } = require('../discovery/identity');
const health = require('../route-health');
const probeOrder = require('../probe-order');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeTempRepo() {
  const dir = tmpDir('starve-repo-');
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'worker@shipde.test']);
  git(['config', 'user.name', 'Worker']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'base\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, sha: git(['rev-parse', 'HEAD']).stdout.trim() };
}

function route(account, index, quality) {
  const c = {
    harness: 'opencode',
    accessPath: `https://${account}.example/v1`,
    gateway: account,
    upstream: 'vendor',
    accountId: account,
    quotaScope: account,
    modelId: `vendor/${account}-model-${index}`,
    source: account,
    kind: 'agent-cli',
    qualifiedRoles: ['author.foundation'],
    capabilities: { contextWindow: 64000 },
    evidence: [{ status: 'passed', kind: 'WORK_ITEM_PASS', proofLevel: 'WORK_ITEM_PASS' }],
    quality,
    cost: 1,
  };
  c.candidateKey = candidateKey(c);
  return c;
}

test('ranking work before the writer pre-probe does not spend the writer probe budget; the known-good route on a live account is probed and launched', async (t) => {
  const repo = makeTempRepo();
  const decisionDir = tmpDir('starve-dec-');
  const evidenceDir = tmpDir('starve-evi-');
  t.after(() => {
    for (const dir of [repo.dir, decisionDir, evidenceDir])
      fs.rmSync(dir, { recursive: true, force: true });
  });
  const candidates = [];
  let quality = 99;
  for (const account of ['cold-a', 'cold-b', 'big']) {
    for (let i = 0; i < 120; i += 1) {
      candidates.push(route(account, i, quality));
      quality -= 0.05;
    }
  }
  const live = route('live', 0, 71);
  candidates.push(live);
  const routeHealth = { version: 1, paths: {}, events: [] };
  const healthOpts = { routeHealth, routeHealthFile: path.join(evidenceDir, 'health.json') };
  for (const account of ['cold-a', 'cold-b']) {
    const cold = candidates.find((c) => c.accountId === account);
    health.rememberProbe(cold, { ok: false, status: 402, body: 'quota_exhausted' }, healthOpts);
  }
  health.rememberProbe(live, { ok: true, status: 200 }, healthOpts);
  const registry = {
    sources: candidates
      .filter((c, i, all) => all.findIndex((o) => o.gateway === c.gateway) === i)
      .map((c) => ({ id: c.gateway, endpoint: c.accessPath, credential: { env: 'TEST_KEY' } })),
    dispatch: { providers: {} },
  };
  for (const c of candidates)
    registry.dispatch.providers[c.gateway] = { harness: 'opencode-direct', provider: 'opencode' };

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  // Stand-in for jsonSchema proofs and other ranking work that runs before the pre-probe.
  const original = probeOrder.preferKnownGood;
  t.mock.method(probeOrder, 'preferKnownGood', (...args) => {
    t.mock.timers.tick(200000);
    return original(...args);
  });
  const probed = [];
  const launched = [];
  const result = await runOrchestration('writer probe starvation', {
    ...healthOpts,
    isolatedWorker: true,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.sha,
    sha: repo.sha,
    decisionDir,
    evidenceDir,
    candidates,
    registry,
    specs: [{ id: 'TASK-AI-142', files: ['a.js'], acceptanceCriteria: ['done'], qualityFloor: 0 }],
    routeProbe: async (probeCandidate) => {
      probed.push(probeCandidate.modelId);
      return probeCandidate.modelId === live.modelId
        ? { ok: true, status: 200, body: 'OK' }
        : { ok: false, status: 400, body: 'alias_mismatch' };
    },
    run: (job) => {
      launched.push(job.candidateKey);
      return {
        exitCode: 0,
        stdout: '{"sessionID":"ses_s","tokens":{"input":1,"output":1}}',
        stderr: '',
        completionNonce: 'nonce-s',
        workerSha: repo.sha,
      };
    },
    reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
    tests: () => ({ pass: true }),
    hostGate: () => ({ pass: true, failures: [] }),
    ranking: { priors: { ranking: [] } },
  });
  assert.equal(probed[0], live.modelId, 'the known-good route is probed first');
  assert.equal(launched[0], live.candidateKey);
  assert.equal(result.status, 'COMPLETED');
  const records = fs
    .readdirSync(decisionDir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) =>
      fs.readFileSync(path.join(decisionDir, name), 'utf8').trim().split('\n').map(JSON.parse)
    );
  const budgetSkipped = records
    .flatMap((record) => record.rejected || [])
    .filter((entry) => /budget exhausted/i.test(String(entry.reason)));
  assert.equal(budgetSkipped.length, 0, 'no route is labeled budget-exhausted before the budget');
});

test('one large account ranked above a live account cannot starve it within the budget', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const ordered = [];
  for (let i = 0; i < 300; i += 1) ordered.push({ candidateKey: `big-${i}`, account: 'big' });
  for (let i = 0; i < 200; i += 1) ordered.push({ candidateKey: `cold-${i}`, account: 'cold' });
  ordered.push({ candidateKey: 'live-0', account: 'live' });
  const started = [];
  let settled = false;
  const pending = probeRankedRoutes(ordered, {
    accountKey: (r) => r.account,
    deadline: 180000,
    now: Date.now,
    skip: (r) => (r.account === 'cold' ? 'PROBE_COOLDOWN_ACCOUNT: cold' : null),
    runProbe: (r) => {
      started.push(r.candidateKey);
      if (r.account === 'live') return Promise.resolve(true);
      return new Promise((resolve) => setTimeout(() => resolve(false), 2000));
    },
  }).finally(() => {
    settled = true;
  });
  while (!settled && Date.now() < 180000) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(2000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(settled, 'a live route must win inside the budget');
  const batch = await pending;
  assert.equal(batch.winner && batch.winner.candidateKey, 'live-0');
  assert.ok(started.includes('big-0'), 'the top route of the higher account is still probed first');
  assert.ok(started.length < 10, 'the large account is not exhausted before the live route wins');
});
