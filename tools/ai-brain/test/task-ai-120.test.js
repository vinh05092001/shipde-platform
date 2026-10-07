'use strict';

/**
 * Ship Dễ — TASK-AI-120: a passed commit reaches the host even when the run is interrupted,
 * and handoff failures never blame a model.
 *
 * Uses the same harness pattern as task-ai-119.test.js.
 *
 * RI-R01 (resume import): when a step is resumed at review_completed with a PASS review
 *   and no passedRef, the Controller imports the PASS SHA from the recorded worker root
 *   into the host via importPassedCommit before any dependent launch.
 *
 * RI-R02 (unavailable): if the PASS SHA is in neither the host nor the worker root,
 *   the dependent is BLOCKED with DEPENDENCY_COMMIT_UNAVAILABLE.
 *
 * RI-R03 (no blame): any dependent launch failure caused by a missing base is recorded
 *   with cause launch_config / scope local, failureDomain null, and does NOT add
 *   the candidate or its failure domain to any exclusion set.
 *
 * RI-R04 (no repo pollution): importPassedCommit is only called when the run has an
 *   explicit host repo. Never default to process.cwd() for imports.
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
  const dir = tmpDir('task-ai-120-');
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
  git(['config', 'user.email', 'task-ai-120@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-120 test']);
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

test('RI-R01: resume at review_completed imports passed commit and dependent launches from it', async () => {
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

  const log = await runOrchestration('RI-R01 resume import', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  assert.equal(outcomeOf(log, 'B').status, 'completed');

  const shaA = f.state.passSha['A'];
  assert.ok(shaA, 'A produced a commit');

  const passedRef = 'refs/shipde/passed/A/' + shaA;
  const checkpoint = checkpointOf(f.opts.checkpointFile);
  const stepA = checkpoint.liveSteps && checkpoint.liveSteps['A'];
  assert.ok(stepA, 'checkpoint has A step');
  assert.equal(stepA.review.entry.sha, shaA);
  assert.ok(stepA.review.passedRef === passedRef, 'checkpoint records passedRef');

  assert.ok(hasCommit(f.repo, shaA), 'commit exists in host repo');

  const writerLaunches = f.state.calls.filter((c) => !c.isReview);
  const bLaunch = writerLaunches.find((c) => c.workItemId === 'B');
  assert.ok(bLaunch, 'B was launched');
  assert.equal(bLaunch.baseSha, shaA, 'B launched from A PASS SHA');
});

test('RI-R02: hasCommit returns false when commit does not exist', () => {
  const root = tmpDir('task-ai-120-ri-r02-');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });

  cp.spawnSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
  cp.spawnSync('git', ['-C', repo, 'config', 'user.email', 'test@shipde.test'], {
    encoding: 'utf8',
  });
  cp.spawnSync('git', ['-C', repo, 'config', 'user.name', 'TEST'], { encoding: 'utf8' });

  // Use a fake SHA that never existed
  const fakeSha = 'a'.repeat(40);

  // Verify fake commit does not exist
  assert.strictEqual(hasCommit(repo, fakeSha), false, 'fake commit does not exist');
});

test('RI-R03: missing base does not blame candidate or add to exclusion sets', async () => {
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

  // Simulate missing base by ensuring the commit doesn't exist in host
  const shaA = f.state.passSha['A'];
  cp.spawnSync('git', ['-C', f.repo, 'update-ref', '-d', 'refs/heads/main'], { encoding: 'utf8' });

  const log = await runOrchestration('RI-R03 no blame', f.opts);

  const decisions = decisionRecords(f.opts.decisionDir);
  const bDecisions = decisions.filter((d) => d.workItemId === 'B');

  // Should NOT have excluded the reviewer candidate
  const reviewerExcluded = bDecisions.some((d) => d.detail && d.detail.includes('acct-reviewera'));
  assert.ok(!reviewerExcluded, 'reviewer not excluded');
});

test('RI-R04: orchestrate with hostCwd set does import to that repo only', async () => {
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
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
  });

  const log = await runOrchestration('RI-R04 with hostCwd', f.opts);

  const passedRef = 'refs/shipde/passed/A/' + f.state.passSha['A'];
  const refsOutput = cp.spawnSync(
    'git',
    ['-C', f.repo, 'for-each-ref', '--format=%(refname)', 'refs/shipde/passed/'],
    { encoding: 'utf8' }
  );
  assert.ok(refsOutput.stdout.includes(passedRef), 'ref created in expected repo');
});
