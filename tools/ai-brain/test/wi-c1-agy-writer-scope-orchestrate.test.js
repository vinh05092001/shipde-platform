'use strict';

// WI-C1 scope follow-up, end to end: runOrchestration with an agy-pool writer (fake
// pool, real git root). An in-scope commit is recorded as the worker sha and reviewed;
// an out-of-scope or receipt-mismatched run records no worker sha and is never reviewed.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const pool = require('../agy-pool-runtime');
const { runOrchestration } = require('../orchestrate');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function setup(t, writeInPool) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-scope-e2e-'));
  dirs.push(dir);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  const git = (...args) => {
    const r = cp.spawnSync('git', ['-c', 'safe.directory=*', ...args], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return (r.stdout || '').trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');

  const state = { reviews: 0, submitted: 0 };
  t.mock.method(pool, 'submitJob', (accountId, job) => {
    state.submitted += 1;
    const receipt = writeInPool({ job, git, repo });
    return { state: 'ok', exitCode: 0, accountId, jobId: accountId + '/run-1', ...receipt };
  });
  t.mock.method(pool, 'readOutText', () => '{}');
  const quota = (claude, at) => ({
    at,
    groups: [
      {
        name: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus 5.5',
        buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: claude }],
      },
    ],
  });
  let reads = 0;
  const writer = {
    harness: 'agy-pool',
    accessPath: 'agy-pool',
    gateway: 'agy-pool',
    upstream: 'agy-pool',
    accountId: 'agy03',
    quotaScope: 'agy03:3p',
    modelId: 'claude-opus-5.5',
    source: 'agy-pool',
    qualifiedRoles: ['author.foundation'],
    capabilities: { contextWindow: 64000 },
    cost: 1,
  };
  const opts = {
    specs: [
      {
        id: 'A',
        files: ['src/a.js'],
        allowedPaths: ['src/**'],
        verification: { command: 'test' },
      },
    ],
    candidates: [writer],
    registry: { sources: [] },
    externalWorkers: 'agy-pool',
    allowAgyPoolWriter: true,
    poolTimeoutMs: 1000,
    readAgyQuota: () => {
      reads += 1;
      return reads % 2 === 1 ? quota(0.8, 1) : quota(0.7, Date.now() + 60000);
    },
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    now: Date.parse('2026-11-24T00:00:00Z'),
    cwd: repo,
    workerRoot: repo,
    baseSha: base,
    ranking: { headrooms: { agy03: { status: 'available' } } },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    reviewer: async (sha) => {
      state.reviews += 1;
      return { pass: true, sha, verdict: 'PASS', reviewer: 'reviewer::fixture', findings: [] };
    },
    repairer: async (_f, sha) => ({ sha }),
  };
  return { dir, repo, git, base, state, opts };
}

function launchOf(f) {
  const cp0 = JSON.parse(fs.readFileSync(f.opts.checkpointFile, 'utf8'));
  return (cp0.liveSteps && cp0.liveSteps.A && cp0.liveSteps.A.launch) || null;
}

test('C1 scope e2e: an in-scope agy writer commit is recorded and reviewed', async (t) => {
  let head = null;
  const f = setup(t, ({ git, repo }) => {
    fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'b\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'work A');
    head = git('rev-parse', 'HEAD');
    return { cwd: repo, headSha: head };
  });
  await runOrchestration('agy writer in scope', f.opts);
  assert.equal(f.state.submitted, 1);
  const launch = launchOf(f);
  assert.ok(launch, 'launch step recorded');
  assert.equal(launch.workerSha, head);
  assert.equal(launch.exitCode, 0);
  assert.ok(f.state.reviews >= 1, 'the verified commit goes to review');
});

for (const [name, write] of [
  [
    'out-of-scope commit',
    ({ git, repo }) => {
      fs.writeFileSync(path.join(repo, 'other.js'), 'x\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'outside');
      return { cwd: repo, headSha: git('rev-parse', 'HEAD') };
    },
  ],
  [
    'receipt head that is not the root HEAD',
    ({ git, repo }) => {
      fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'b\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'own');
      const own = git('rev-parse', 'HEAD');
      fs.writeFileSync(path.join(repo, 'src', 'c.js'), 'c\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'another job');
      return { cwd: repo, headSha: own };
    },
  ],
]) {
  test('C1 scope e2e: ' + name + ' records no worker sha and is never reviewed', async (t) => {
    const f = setup(t, write);
    const controllerSha = f.base;
    await runOrchestration('agy writer refused: ' + name, f.opts);
    assert.ok(f.state.submitted >= 1, 'the writer ran through the pool');
    const launch = launchOf(f);
    assert.ok(launch, 'launch step recorded');
    assert.notEqual(launch.exitCode, 0);
    assert.equal(launch.workerSha, null);
    assert.notEqual(launch.workerSha, controllerSha);
    assert.equal(f.state.reviews, 0, 'a refused commit is never reviewed or adopted');
  });
}
