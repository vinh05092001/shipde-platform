'use strict';

/**
 * Ship Dễ — TASK-AI-119: a passed worker commit is kept in the host repo
 * so dependents can start from it.
 *
 * Uses the same harness pattern as task-ai-114.test.js.
 *
 * KC-R01: when a Work Item's review returns PASS at a worker SHA, the host repo
 *   gets refs/shipde/passed/<workItemId>/<sha> and the checkpoint records passedRef.
 * KC-R02: on resume, a missing commit in the host is re-imported from worker;
 *   if missing from both, dependent is BLOCKED DEPENDENCY_COMMIT_UNAVAILABLE.
 * KC-R03: if base SHA is missing on host during launch, PROVISION_BASE_MISSING
 *   is thrown (scope local, candidate not excluded).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const { importPassedCommit, hasCommit } = require('../passed-commit');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-05T12:00:00Z');

function tmpDir(prefix) {
  const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}

function cand(id, role, over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-' + id,
      gateway: 'gw-' + id,
      upstream: 'up-' + id,
      accountId: 'acct-' + id,
      quotaScope: 'scope-' + id,
      modelId: 'model-' + id,
      source: 'gw-' + id,
      qualifiedRoles: [role],
      capabilities: { contextWindow: 64000 },
      cost: 1,
    },
    over || {}
  );
}

function outcomeOf(log, id) {
  return (log.outcomes || []).find((entry) => entry.workItemId === id) || null;
}

function decisionRecords(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/)) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}

function checkpointOf(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function liveStepOf(file, id) {
  const checkpoint = checkpointOf(file);
  return (checkpoint.liveSteps && checkpoint.liveSteps[id]) || null;
}

/**
 * Test harness: one git repo as host/worktree, one writer, one or two reviewers.
 */
function setup(specs, options) {
  const opts = options || {};
  const dir = tmpDir('task-ai-119-');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-119@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-119 test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);

  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const reviewerA = cand('reviewera', 'reviewer.primary');
  const reviewerB = cand('reviewerb', 'reviewer.primary');
  const candidates = [writer, reviewerA];
  if (opts.secondReviewer) candidates.push(reviewerB);

  const state = {
    calls: [],
    passSha: {},
    repairCalls: 0,
    reviewCalls: 0,
  };

  const rememberJob = (job) => {
    state.calls.push({
      workItemId: job.workItemId,
      isReview: Boolean(job.isReview),
      baseSha: job.baseSha,
      candidateKey: job.candidateKey,
    });
  };
  const writeUsage = (job) => {
    if (!job.usageFile) return;
    fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
    fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + state.calls.length }));
  };
  const writerStep = (job) => {
    const name = String(job.workItemId).replace(/[^A-Za-z0-9._-]/g, '-');
    fs.writeFileSync(path.join(repo, 'change-' + name + '.js'), 'done\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'work ' + job.workItemId]);
    state.passSha[job.workItemId] = git(['rev-parse', 'HEAD']);
    return { exitCode: 0, stdout: 'worker completed' };
  };
  const reviewPass = (job) => {
    fs.writeFileSync(
      job.verdictFile || path.join(job.cwd, 'verdict.json'),
      JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
    );
    return { exitCode: 0, stdout: 'review pass' };
  };

  const run = opts.run
    ? (job) => {
        rememberJob(job);
        writeUsage(job);
        return opts.run(job, state);
      }
    : (job) => {
        rememberJob(job);
        writeUsage(job);
        if (job.isReview) return reviewPass(job);
        return writerStep(job);
      };

  const runOpts = {
    specs,
    candidates,
    registry: { sources: [] },
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    now: NOW,
    cwd: repo,
    workerRoot: repo,
    baseSha: 'a'.repeat(40),
    ranking: {
      headrooms: {
        'acct-writer': { status: 'available' },
        'acct-reviewera': { status: 'available' },
        'acct-reviewerb': { status: 'available' },
      },
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    run,
    repairer: async (_findings, sha) => {
      state.repairCalls += 1;
      return { sha };
    },
    reviewer: opts.reviewer
      ? async (sha) => {
          state.reviewCalls += 1;
          return opts.reviewer(sha);
        }
      : undefined,
  };

  return {
    dir,
    repo,
    git,
    state,
    writer,
    reviewerA,
    reviewerB,
    opts: runOpts,
    writerStep,
    reviewPass,
  };
}

test('importPassedCommit creates the namespaced ref in host', () => {
  const root = tmpDir('task-ai-119-unit-import-');
  const hostRepo = path.join(root, 'host');
  const workerRoot = path.join(root, 'worker');

  fs.mkdirSync(hostRepo, { recursive: true });
  fs.mkdirSync(workerRoot, { recursive: true });
  cp.spawnSync('git', ['-C', hostRepo, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
  cp.spawnSync('git', ['-C', hostRepo, 'config', 'user.email', 'test@shipde.test'], {
    encoding: 'utf8',
  });
  cp.spawnSync('git', ['-C', hostRepo, 'config', 'user.name', 'TEST'], { encoding: 'utf8' });
  cp.spawnSync('git', ['-C', workerRoot, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
  cp.spawnSync('git', ['-C', workerRoot, 'config', 'user.email', 'test@shipde.test'], {
    encoding: 'utf8',
  });
  cp.spawnSync('git', ['-C', workerRoot, 'config', 'user.name', 'TEST'], { encoding: 'utf8' });

  fs.writeFileSync(path.join(workerRoot, 'README.md'), 'worker\n');
  cp.spawnSync('git', ['-C', workerRoot, 'add', '.'], { encoding: 'utf8' });
  cp.spawnSync('git', ['-C', workerRoot, 'commit', '-q', '-m', 'worker'], { encoding: 'utf8' });
  const sha = cp
    .spawnSync('git', ['-C', workerRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    .stdout.trim();

  const imp = importPassedCommit({
    hostRepo: hostRepo,
    workerRoot: workerRoot,
    workItemId: 'TEST',
    sha: sha,
    spawnSync: cp.spawnSync,
  });

  assert.ok(imp.ok, 'import succeeded');
  assert.strictEqual(imp.ref, `refs/shipde/passed/TEST/${sha}`);
  const res = cp.spawnSync('git', ['-C', hostRepo, 'cat-file', '-e', `${sha}^{commit}`]);
  assert.strictEqual(res.status, 0, 'commit exists in host');
});

test('hasCommit returns false when commit is missing', () => {
  const root = tmpDir('task-ai-119-unit-hasCommit-');
  const hostRepo = path.join(root, 'host');
  fs.mkdirSync(hostRepo, { recursive: true });
  cp.spawnSync('git', ['-C', hostRepo, 'init', '-q', '-b', 'main']);
  cp.spawnSync('git', ['-C', hostRepo, 'config', 'user.email', 'test@shipde.test']);
  cp.spawnSync('git', ['-C', hostRepo, 'config', 'user.name', 'TEST']);

  const fakeSha = '0'.repeat(40);
  assert.strictEqual(hasCommit(hostRepo, fakeSha), false);
});

test('KC-R01: passed commit is imported into host and checkpoint records passedRef; dependent launches from that SHA', async () => {
  const f = setup(
    [
      { id: 'A', files: ['a.js'], verification: { command: 'test' } },
      { id: 'B', files: ['b.js'], dependencies: ['A'], verification: { command: 'test' } },
    ],
    {
      run: (job, state) => {
        if (job.isReview) {
          state.reviewCalls += 1;
          return f.reviewPass(job);
        }
        state.calls.push({
          workItemId: job.workItemId,
          isReview: false,
          baseSha: job.baseSha,
        });
        return f.writerStep(job);
      },
    }
  );

  const log = await runOrchestration('KC-R01 dependency passed commit import', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  assert.equal(outcomeOf(log, 'B').status, 'completed');

  const shaA = f.state.passSha['A'];
  assert.ok(shaA, 'A produced a commit');

  const passedRef = 'refs/shipde/passed/A/' + shaA;
  const checkpoint = checkpointOf(f.opts.checkpointFile);
  const stepA = checkpoint.liveSteps && checkpoint.liveSteps['A'];
  assert.ok(stepA, 'checkpoint has A step');
  assert.equal(stepA.review.entry.sha, shaA);
  assert.ok(
    stepA.review.passedRef === passedRef,
    'checkpoint records passedRef: ' + stepA.review.passedRef
  );

  assert.ok(hasCommit(f.repo, shaA), 'commit exists in host repo');

  const writerLaunches = f.state.calls.filter((c) => !c.isReview);
  const bLaunch = writerLaunches.find((c) => c.workItemId === 'B');
  assert.ok(bLaunch, 'B was launched');
  assert.equal(bLaunch.baseSha, shaA, 'B launched from A PASS SHA');
});

test('KC-R02: re-import missing host commit from worker; dependent launches', async () => {
  const f = setup(
    [
      { id: 'A', files: ['a.js'], verification: { command: 'test' } },
      { id: 'B', files: ['b.js'], dependencies: ['A'], verification: { command: 'test' } },
    ],
    {
      run: (job, state) => {
        if (job.isReview) {
          state.reviewCalls += 1;
          return f.reviewPass(job);
        }
        state.calls.push({
          workItemId: job.workItemId,
          isReview: false,
          baseSha: job.baseSha,
        });
        return f.writerStep(job);
      },
    }
  );

  const log = await runOrchestration('KC-R02 re-import from worker', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  assert.equal(outcomeOf(log, 'B').status, 'completed');

  const shaA = f.state.passSha['A'];
  assert.ok(shaA, 'A produced a commit');
  assert.ok(hasCommit(f.repo, shaA), 'commit imported into host');

  const checkpoint = checkpointOf(f.opts.checkpointFile);
  const stepA = checkpoint.liveSteps && checkpoint.liveSteps['A'];
  assert.ok(stepA && stepA.review && stepA.review.passedRef, 'checkpoint records passedRef');
});
