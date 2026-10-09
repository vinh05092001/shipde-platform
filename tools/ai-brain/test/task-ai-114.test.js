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
    baseSha: GLOBAL_BASE,
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

test('R01 a reviewer launch failure is a failed attempt, never a review round or a CHANGES_REQUIRED verdict', async () => {
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    run: (job) => {
      if (job.isReview) return QUOTA_FAILURE;
      return f.writerStep(job);
    },
  });
  const log = await runOrchestration('reviewer launch failure', f.opts);

  const outcome = outcomeOf(log, 'A');
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.reason, 'REVIEWER_UNAVAILABLE');

  assert.equal(f.state.repairCalls, 0, 'a reviewer launch failure must not trigger a repair');

  const step = liveStepOf(f.opts.checkpointFile, 'A');
  const rounds = (step && step.reviewRounds) || [];
  assert.deepEqual(
    rounds,
    [],
    'a reviewer launch failure must never be checkpointed as a review round'
  );

  const records = decisionRecords(f.opts.decisionDir);
  assert.equal(
    records.filter((r) => r.stage === 'review' && r.verdict === 'CHANGES_REQUIRED').length,
    0,
    'a launch failure must never be recorded as a CHANGES_REQUIRED verdict'
  );
  assert.ok(
    records.some((r) => r.stage === 'failed' && r.role === 'reviewer'),
    'the launch failure stays a classified failed reviewer attempt'
  );
});

test('R01 reviewer re-selection after a launch failure: no round, no repair, the real verdict decides', async () => {
  let reviewLaunches = 0;
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    secondReviewer: true,
    run: (job) => {
      if (job.isReview) {
        reviewLaunches += 1;
        if (reviewLaunches === 1) return QUOTA_FAILURE;
        return f.reviewPass(job);
      }
      return f.writerStep(job);
    },
  });
  const log = await runOrchestration('reviewer launch failure then re-select', f.opts);

  const outcome = outcomeOf(log, 'A');
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.reason, 'REVIEW_PASS');

  assert.equal(f.state.repairCalls, 0, 'a launch failure must not trigger a repair');

  const step = liveStepOf(f.opts.checkpointFile, 'A');
  const rounds = (step && step.reviewRounds) || [];
  assert.equal(rounds.length, 1, 'only the real parsed verdict creates a review round');
  assert.equal(rounds[0].result.verdict, 'PASS');
  assert.notEqual(rounds[0].result.launchFailed, true);
  assert.ok(reviewLaunches >= 2, 'the failed reviewer attempt is re-selected and retried');
});

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

test('R03 a dependent launches from the dependency PASS SHA and records baseSha with baseFrom', async () => {
  const f = setup([
    { id: 'A', files: ['a.js'], verification: { command: 'test' } },
    { id: 'B', files: ['b.js'], dependencies: ['A'], verification: { command: 'test' } },
  ]);
  const log = await runOrchestration('dependent starts from the dependency commit', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  assert.equal(outcomeOf(log, 'B').status, 'completed');

  const depPassSha = f.state.passSha['A'];
  assert.ok(depPassSha, 'the dependency produced a reviewed commit');
  const writerLaunches = f.state.calls.filter((c) => !c.isReview);
  const bLaunch = writerLaunches.find((c) => c.workItemId === 'B');
  assert.equal(
    bLaunch.baseSha,
    depPassSha,
    'the dependent launch baseSha is the dependency PASS SHA, not the global --base-sha'
  );
  assert.notEqual(bLaunch.baseSha, GLOBAL_BASE);

  const step = liveStepOf(f.opts.checkpointFile, 'B');
  assert.equal(step.launch.baseSha, depPassSha);
  assert.equal(step.launch.baseFrom, 'A');

  const launched = decisionRecords(f.opts.decisionDir).find(
    (r) => r.stage === 'launched' && r.workItemId === 'B'
  );
  assert.ok(launched, 'the dependent launch is in the decision log');
  assert.equal(launched.baseSha, depPassSha);
  assert.equal(launched.baseFrom, 'A');
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

test('R04 dependencies are reviewed before dependents even when the plan lists the dependent first', async () => {
  const f = setup([
    { id: 'B', files: ['b.js'], dependencies: ['A'], verification: { command: 'test' } },
    { id: 'A', files: ['a.js'], verification: { command: 'test' } },
  ]);
  const log = await runOrchestration('dependent listed first', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  assert.equal(outcomeOf(log, 'B').status, 'completed');

  const writerOrder = f.state.calls.filter((c) => !c.isReview).map((c) => c.workItemId);
  assert.deepEqual(writerOrder, ['A', 'B'], 'the dependency is worked before its dependent');
  const depPassSha = f.state.passSha['A'];
  const bLaunch = f.state.calls.find((c) => !c.isReview && c.workItemId === 'B');
  assert.equal(bLaunch.baseSha, depPassSha);
});

test('R03 multiple dependencies fail closed with MULTI_DEPENDENCY_BASE_UNSUPPORTED and no launch', async () => {
  const f = setup([
    { id: 'A', files: ['a.js'], verification: { command: 'test' } },
    { id: 'C', files: ['c.js'], verification: { command: 'test' } },
    {
      id: 'B',
      files: ['b.js'],
      dependencies: ['A', 'C'],
      verification: { command: 'test' },
    },
  ]);
  const log = await runOrchestration('two dependencies', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  assert.equal(outcomeOf(log, 'C').status, 'completed');
  const outcome = outcomeOf(log, 'B');
  assert.equal(outcome.status, 'blocked');
  assert.ok(
    String(outcome.reason).startsWith('MULTI_DEPENDENCY_BASE_UNSUPPORTED'),
    'multiple dependencies fail closed, got: ' + outcome.reason
  );
  assert.equal(
    f.state.calls.filter((c) => String(c.workItemId).startsWith('B')).length,
    0,
    'the multi-dependent is never launched'
  );
});
