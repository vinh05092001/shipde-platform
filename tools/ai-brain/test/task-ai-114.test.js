'use strict';

/**
 * Ship Dễ — TASK-AI-114: orchestrate reviews dependencies before dependents
 * and hands off their commit.
 *
 * Defects found in the gate 5 live run (tools/ai-brain/orchestrate.js on main
 * 56a42e8):
 *
 *   D1. A reviewer launch failure (e.g. HTTP 429 quota) returned
 *       `{verdict:'CHANGES_REQUIRED', launchFailed:true}` and was pushed into
 *       recordedReviewRounds and checkpointed as `review_round_completed`.
 *       After a resume the item read as reviewed, and the fake verdict even
 *       triggered a repair. A launch failure is NOT a verdict.
 *   D2. A work item with `dependencies` was launched from the global
 *       `--base-sha` instead of the dependency's last reviewed worker SHA.
 *   D3. A dependent item was launched while its dependency had no PASS.
 *
 * Every launcher and reviewer here is injected or faked: no network, no real
 * opencode.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../candidates');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-05T12:00:00Z');
const GLOBAL_BASE = 'a'.repeat(40);
const QUOTA_FAILURE = { exitCode: 1, httpStatus: 429, stderr: 'HTTP 429 quota exhausted' };

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
 * One real git repository as the worker root, one writer candidate, one or two
 * reviewer candidates and a recorded launcher. The default launcher commits a
 * change per work item and writes a PASS verdict per review.
 */
function setup(specs, options) {
  const opts = options || {};
  const dir = tmpDir('task-ai-114-');
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
  git(['config', 'user.email', 'task-ai-114@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-114 test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  const initialBaseSha = git(['rev-parse', 'HEAD']);

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
    baseSha: initialBaseSha,
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

test('R02 resuming a checkpoint whose review round result.launchFailed===true discards it and reviews again', async () => {
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    reviewer: (sha) => ({
      pass: true,
      sha,
      verdict: 'PASS',
      reviewer: 'reviewer::resumed',
      findings: [],
    }),
  });

  fs.writeFileSync(path.join(f.repo, 'change-A.js'), 'done\n');
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'work A']);
  const reviewedSha = f.git(['rev-parse', 'HEAD']);
  const writerKey = candidateKey(f.writer);

  fs.mkdirSync(path.dirname(f.opts.checkpointFile), { recursive: true });
  fs.writeFileSync(
    f.opts.checkpointFile,
    JSON.stringify({
      schemaVersion: 1,
      liveSteps: {
        A: {
          workItemId: 'A',
          stage: 'review_round_completed',
          selection: { candidateKey: writerKey, decision: { chosen: writerKey } },
          launch: {
            candidateKey: writerKey,
            exitCode: 0,
            hasArtifact: true,
            sessionId: 'sess-resumed',
            workerSha: reviewedSha,
            failBefore: null,
          },
          reviewRounds: [
            {
              round: 1,
              sha: reviewedSha,
              result: {
                pass: false,
                sha: reviewedSha,
                verdict: 'CHANGES_REQUIRED',
                launchFailed: true,
                findings: [
                  { id: 'REVIEWER_LAUNCH_FAILED', open: true, detail: 'reviewer launch failed' },
                ],
              },
            },
          ],
        },
      },
      completed: [],
    })
  );

  const log = await runOrchestration('resume an old launch-failed round', f.opts);

  const outcome = outcomeOf(log, 'A');
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.reason, 'REVIEW_PASS');
  assert.equal(f.state.repairCalls, 0, 'the discarded round must not trigger a repair');
  assert.ok(f.state.reviewCalls >= 1, 'the commit is reviewed again after the discard');

  const step = liveStepOf(f.opts.checkpointFile, 'A');
  const rounds = (step && step.reviewRounds) || [];
  assert.ok(rounds.length >= 1, 'the fresh review is the recorded round');
  for (const round of rounds) {
    assert.notEqual(
      round.result && round.result.launchFailed,
      true,
      'a launch-failed round is never kept in the checkpoint'
    );
    assert.notEqual(round.result && round.result.verdict, 'CHANGES_REQUIRED');
  }
  assert.equal(rounds[rounds.length - 1].result.verdict, 'PASS');
});

test('R04 no dependent launch before its dependency is PASS; a blocked dependency blocks the dependent', async () => {
  const f = setup(
    [
      { id: 'A', files: ['a.js'], verification: { command: 'test' } },
      { id: 'B', files: ['b.js'], dependencies: ['A'], verification: { command: 'test' } },
    ],
    {
      run: (job) => {
        if (job.workItemId === 'A') return QUOTA_FAILURE;
        return f.writerStep(job);
      },
    }
  );
  const log = await runOrchestration('dependency did not pass', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'blocked');
  const outcome = outcomeOf(log, 'B');
  assert.equal(outcome.status, 'blocked');
  assert.ok(
    String(outcome.reason).startsWith('DEPENDENCY_NOT_PASSED'),
    'the dependent is blocked with DEPENDENCY_NOT_PASSED, got: ' + outcome.reason
  );
  assert.equal(
    f.state.calls.filter((c) => String(c.workItemId).startsWith('B')).length,
    0,
    'the dependent is never launched'
  );
});
