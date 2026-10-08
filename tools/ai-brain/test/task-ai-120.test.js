'use strict';

/**
 * Ship Dễ — TASK-AI-120: a passed commit reaches the host even when the run is
 * interrupted, and handoff failures never blame a model.
 *
 * Uses the same harness pattern as task-ai-119.test.js / task-ai-114.test.js
 * (runOrchestration with real temp git repos under the repo's .upstream-tmp).
 *
 * RI-R01 (resume import): a checkpoint at review_completed with a PASS review
 *   and no passedRef is resumed. The Controller imports the PASS SHA from the
 *   recorded worker root into the host via importPassedCommit before any
 *   dependent launch and records passedRef. A later resume reads the recorded
 *   ref instead of importing again.
 *
 * RI-R02 (unavailable): a checkpoint whose PASS SHA is in neither the host nor
 *   the worker root BLOCKS the dependent with DEPENDENCY_COMMIT_UNAVAILABLE and
 *   launches no writer for it.
 *
 * RI-R03 (no blame): a dependent launch failure caused by a missing base is
 *   recorded with cause launch_config / scope local / failureDomain null, adds
 *   neither the candidate nor its failure domain to any exclusion set, and the
 *   next selection — in the same run and after a resume — can choose the same
 *   candidate key again.
 *
 * RI-R04 (no repo pollution): without an explicit host repo the run imports
 *   nothing — no refs/shipde/* appear under process.cwd() and no passedRef is
 *   recorded.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const { importPassedCommit, hasCommit } = require('../passed-commit');
const { candidateKey } = require('../candidates');

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

/** One real git repository with a base commit. */
function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(
      result.status,
      0,
      (result.stderr || result.stdout || '') + ' [' + args.join(' ') + ']'
    );
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-120@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-120 test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  return { dir, git, base: git(['rev-parse', 'HEAD']) };
}

function commitIn(repo, name, content) {
  fs.writeFileSync(path.join(repo.dir, name), content);
  repo.git(['add', '.']);
  repo.git(['commit', '-q', '-m', 'work ' + name]);
  return repo.git(['rev-parse', 'HEAD']);
}

/**
 * The review receipt shape the live path persists at review_completed (the
 * interrupt window is between that persist and the passed import).
 */
function reviewEntryFor({ workItemId, sha, workerRoot, baseSha, reviewer }) {
  return {
    workItemId,
    sha,
    reviewedSha: sha,
    reviewerIdentity: reviewer,
    reviewer,
    writerCandidateKey: candidateKey(cand('writer', 'author.foundation')),
    workerRoot,
    branch: 'feat/' + String(workItemId).toLowerCase(),
    baseSha,
    draftTitle: 'Work item ' + workItemId,
    review: {
      status: 'COMPLETED',
      finalSha: sha,
      verdict: 'PASS',
      reviewer,
      workerRoot,
      rounds: [{ round: 1, stage: 'review', verdict: 'PASS', findings: [] }],
      repairCount: 0,
    },
  };
}

/** The exact checkpoint an interrupt after the review persist leaves behind. */
function writeInterruptedReviewCheckpoint(file, entry, extra) {
  const review = Object.assign({ status: 'COMPLETED', entry }, (extra && extra.review) || {});
  const checkpoint = Object.assign(
    {
      schemaVersion: 1,
      liveSteps: {
        [entry.workItemId]: {
          workItemId: entry.workItemId,
          stage: 'review_completed',
          updatedAt: new Date(NOW).toISOString(),
          failures: [],
          review,
        },
      },
      updatedAt: new Date(NOW).toISOString(),
    },
    (extra && extra.checkpoint) || {}
  );
  fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2));
}

function reviewPass(job) {
  fs.writeFileSync(
    job.verdictFile || path.join(job.cwd, 'verdict.json'),
    JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
  );
  return { exitCode: 0, stdout: 'review pass' };
}

/**
 * Shared run options: one writer, one reviewer, injected launcher and tests.
 * `config.run` decides what a launch does; `config.host`/`config.launchRoot`
 * name the repos involved. `config.cwd` is only set when the run really has an
 * explicit host repo (RI-R04 runs without one).
 */
function launchHarness(specs, config) {
  const state = { calls: [], passSha: {}, reviewCalls: 0 };
  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const reviewerA = cand('reviewera', 'reviewer.primary');
  const run = (job) => {
    state.calls.push({
      workItemId: job.workItemId,
      isReview: Boolean(job.isReview),
      baseSha: job.baseSha,
      candidateKey: job.candidateKey,
      cwd: job.cwd || null,
    });
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + state.calls.length }));
    }
    return config.run(job, state);
  };
  const opts = {
    specs,
    candidates: [writer, reviewerA],
    registry: { sources: [] },
    checkpointFile: config.checkpointFile,
    decisionDir: config.decisionDir,
    usageDir: config.usageDir,
    now: NOW,
    workerRoot: config.launchRoot || config.host.dir,
    baseSha: (config.host && config.host.base) || null,
    ranking: {
      headrooms: {
        'acct-writer': { status: 'available' },
        'acct-reviewera': { status: 'available' },
      },
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    run,
    repairer: async (_findings, sha) => ({ sha }),
  };
  if (config.cwd) opts.cwd = config.cwd;
  return {
    state,
    writer,
    reviewerA,
    writerKey: candidateKey(writer),
    opts,
  };
}

const SPECS_AB = [
  { id: 'A', files: ['a.js'], verification: { command: 'test' } },
  { id: 'B', files: ['b.js'], dependencies: ['A'], verification: { command: 'test' } },
];

test('RI-R01: resume at review_completed imports the PASS SHA from the recorded worker root and the dependent launches from it', async () => {
  const dir = tmpDir('task-ai-120-ri-r01-');
  const host = makeRepo(path.join(dir, 'host'));
  const worker = makeRepo(path.join(dir, 'worker'));
  const shaA = commitIn(worker, 'a.js', 'worker A done\n');
  assert.equal(hasCommit(host.dir, shaA), false, 'the host does not have the PASS commit yet');

  const checkpointFile = path.join(dir, 'checkpoint.json');
  const entry = reviewEntryFor({
    workItemId: 'A',
    sha: shaA,
    workerRoot: worker.dir,
    baseSha: worker.base,
    reviewer: 'reviewera',
  });
  // A real interrupt: the review PASS is checkpointed, no passedRef anywhere,
  // and the host never received the commit.
  writeInterruptedReviewCheckpoint(checkpointFile, entry);
  assert.equal(liveStepOf(checkpointFile, 'A').review.passedRef, undefined);

  const f = launchHarness(SPECS_AB, {
    host,
    cwd: host.dir,
    checkpointFile,
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    run: (job, state) => {
      if (job.isReview) {
        state.reviewCalls += 1;
        return reviewPass(job);
      }
      state.passSha[job.workItemId] = commitIn(host, 'change-' + job.workItemId + '.js', 'done\n');
      return { exitCode: 0, stdout: 'worker completed' };
    },
  });

  const log = await runOrchestration('RI-R01 resume import', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  assert.equal(outcomeOf(log, 'B').status, 'completed');

  const passedRef = 'refs/shipde/passed/A/' + shaA;
  assert.ok(hasCommit(host.dir, shaA), 'the host received the PASS commit');
  const refs = host.git(['for-each-ref', '--format=%(refname)', 'refs/shipde/passed/']);
  assert.ok(
    refs.split(/\r?\n/).includes(passedRef),
    'the namespaced passed ref exists in the host: ' + refs
  );

  const stepA = liveStepOf(checkpointFile, 'A');
  assert.equal(
    stepA.review.entry.passedRef,
    passedRef,
    'passedRef is recorded on the review entry'
  );
  assert.equal(stepA.review.passedRef, passedRef, 'passedRef is recorded beside the review entry');

  const writerLaunches = f.state.calls.filter((c) => !c.isReview);
  const bLaunch = writerLaunches.find((c) => c.workItemId === 'B');
  assert.ok(bLaunch, 'B was launched');
  assert.equal(bLaunch.baseSha, shaA, 'B launched from the dependency PASS SHA');

  // A later resume must read the recorded ref instead of importing again: the
  // worker root is gone and the entry-level record is stripped to the shape the
  // live path writes (passedRef beside the entry only).
  const raw = checkpointOf(checkpointFile);
  delete raw.liveSteps.A.review.entry.passedRef;
  fs.writeFileSync(checkpointFile, JSON.stringify(raw, null, 2));
  fs.renameSync(worker.dir, worker.dir + '-gone');

  const second = await runOrchestration('RI-R01 resume again', f.opts);
  assert.equal(outcomeOf(second, 'A').status, 'completed');
  const stepAfter = liveStepOf(checkpointFile, 'A');
  assert.equal(
    stepAfter.review.entry.passedRef,
    passedRef,
    'the resume reads the recorded passedRef and does not import again'
  );
  assert.ok(hasCommit(host.dir, shaA), 'the host still has the PASS commit');
});

test('RI-R01: a completed checkpoint with no passedRef imports the PASS SHA on resume', async () => {
  const dir = tmpDir('task-ai-120-ri-r01-late-');
  const host = makeRepo(path.join(dir, 'host'));
  const worker = makeRepo(path.join(dir, 'worker'));
  const shaA = commitIn(worker, 'a.js', 'worker A done\n');

  const checkpointFile = path.join(dir, 'checkpoint.json');
  const entry = reviewEntryFor({
    workItemId: 'A',
    sha: shaA,
    workerRoot: worker.dir,
    baseSha: worker.base,
    reviewer: 'reviewera',
  });
  // An interrupt after the outcome and before the import: the item is already
  // recorded as completed and the host has no ref.
  writeInterruptedReviewCheckpoint(checkpointFile, entry, {
    checkpoint: { completed: ['A'], reviews: [entry], liveSteps: {} },
  });

  const f = launchHarness([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    host,
    cwd: host.dir,
    checkpointFile,
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    run: (job, state) => {
      if (job.isReview) {
        state.reviewCalls += 1;
        return reviewPass(job);
      }
      state.passSha[job.workItemId] = commitIn(host, 'change-' + job.workItemId + '.js', 'done\n');
      return { exitCode: 0, stdout: 'worker completed' };
    },
  });

  const log = await runOrchestration('RI-R01 late resume import', f.opts);
  assert.equal(outcomeOf(log, 'A').status, 'completed');

  const passedRef = 'refs/shipde/passed/A/' + shaA;
  assert.ok(hasCommit(host.dir, shaA), 'the host received the PASS commit');
  const refs = host.git(['for-each-ref', '--format=%(refname)', 'refs/shipde/passed/']);
  assert.ok(refs.split(/\r?\n/).includes(passedRef), 'the namespaced passed ref exists: ' + refs);
  const stepA = liveStepOf(checkpointFile, 'A');
  assert.equal(stepA.review.entry.passedRef, passedRef);
  assert.equal(stepA.review.passedRef, passedRef);
  assert.equal(
    f.state.calls.filter((c) => !c.isReview).length,
    0,
    'a completed item is never relaunched'
  );
});

test('RI-R02: a PASS SHA in neither the host nor the worker root blocks the dependent and launches no writer', async () => {
  const dir = tmpDir('task-ai-120-ri-r02-');
  const host = makeRepo(path.join(dir, 'host'));
  const worker = makeRepo(path.join(dir, 'worker'));
  const goneSha = 'd'.repeat(40);
  assert.equal(hasCommit(host.dir, goneSha), false, 'precondition: absent from the host');
  assert.equal(hasCommit(worker.dir, goneSha), false, 'precondition: absent from the worker root');

  const checkpointFile = path.join(dir, 'checkpoint.json');
  const entry = reviewEntryFor({
    workItemId: 'A',
    sha: goneSha,
    workerRoot: worker.dir,
    baseSha: worker.base,
    reviewer: 'reviewera',
  });
  writeInterruptedReviewCheckpoint(checkpointFile, entry);

  const f = launchHarness(SPECS_AB, {
    host,
    cwd: host.dir,
    checkpointFile,
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    run: (job, state) => {
      if (job.isReview) {
        state.reviewCalls += 1;
        return reviewPass(job);
      }
      state.passSha[job.workItemId] = commitIn(host, 'change-' + job.workItemId + '.js', 'done\n');
      return { exitCode: 0, stdout: 'worker completed' };
    },
  });

  const log = await runOrchestration('RI-R02 dependency commit unavailable', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed');
  const outB = outcomeOf(log, 'B');
  assert.equal(outB.status, 'blocked');
  assert.ok(
    String(outB.reason).startsWith('DEPENDENCY_COMMIT_UNAVAILABLE'),
    'the dependent is BLOCKED with DEPENDENCY_COMMIT_UNAVAILABLE, got: ' + outB.reason
  );
  const bLaunches = f.state.calls.filter((c) => c.workItemId === 'B' && !c.isReview);
  assert.equal(bLaunches.length, 0, 'zero writer launches for the dependent');
  assert.equal(
    f.state.calls.filter((c) => c.workItemId === 'B').length,
    0,
    'the dependent is never launched at all'
  );
});

test('RI-R03: a missing-base launch failure records launch_config/local, excludes nothing and keeps the candidate selectable', async () => {
  const dir = tmpDir('task-ai-120-ri-r03-');
  const host = makeRepo(path.join(dir, 'host'));
  const worker = makeRepo(path.join(dir, 'worker'));
  const shaA = commitIn(worker, 'a.js', 'worker A done\n');
  // The launcher re-provisions the worker root by cloning the host; a clone
  // does not carry refs/shipde/*, so the PASS SHA is genuinely missing there.
  const launchRoot = path.join(dir, 'reprovisioned-worker');
  const clone = cp.spawnSync(
    'git',
    ['-c', 'safe.directory=*', 'clone', '-q', host.dir, launchRoot],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  assert.equal(clone.status, 0, clone.stderr || clone.stdout);
  assert.equal(hasCommit(launchRoot, shaA), false, 'precondition: the launch root lacks the base');

  const checkpointFile = path.join(dir, 'checkpoint.json');
  const entry = reviewEntryFor({
    workItemId: 'A',
    sha: shaA,
    workerRoot: worker.dir,
    baseSha: worker.base,
    reviewer: 'reviewera',
  });
  writeInterruptedReviewCheckpoint(checkpointFile, entry);

  const f = launchHarness(SPECS_AB, {
    host,
    launchRoot,
    cwd: host.dir,
    checkpointFile,
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    run: (job) => {
      if (job.isReview) return reviewPass(job);
      const check = cp.spawnSync(
        'git',
        ['-c', 'safe.directory=*', '-C', job.cwd, 'cat-file', '-e', job.baseSha + '^{commit}'],
        { encoding: 'utf8', windowsHide: true }
      );
      if (check.status !== 0) {
        // the launcher's real missing-base signal (isolation-launcher.js)
        return {
          exitCode: 128,
          stderr:
            'ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: ' + job.baseSha,
        };
      }
      return { exitCode: 0, stdout: 'worker completed' };
    },
  });

  const log = await runOrchestration('RI-R03 missing base no blame', f.opts);

  const writerKey = f.writerKey;
  const failedLaunch = f.state.calls.find((c) => c.workItemId === 'B' && !c.isReview);
  assert.ok(failedLaunch, 'the dependent launched and failed on its missing base');
  assert.equal(failedLaunch.candidateKey, writerKey);

  const stepB = liveStepOf(checkpointFile, 'B');
  const failure = (stepB.failures || []).find((x) => x.failedCandidateKey === writerKey);
  assert.ok(failure, 'the launch failure is recorded: ' + JSON.stringify(stepB.failures));
  assert.equal(failure.cause, 'launch_config');
  assert.equal(failure.failureScope, 'local');
  assert.equal(failure.failureDomain, null);

  for (const record of decisionRecords(f.opts.decisionDir)) {
    for (const field of ['excluded', 'excludedSet']) {
      if (Array.isArray(record[field])) {
        assert.ok(
          !record[field].includes(writerKey),
          record.stage +
            ' must not exclude the blamed-free candidate: ' +
            JSON.stringify(record[field])
        );
      }
    }
  }

  const chosenAgain = (runLog) =>
    (runLog.selections || []).filter(
      (s) => s.workItemId === 'B' && s.decision && s.decision.chosen
    );
  const selections = chosenAgain(log);
  assert.ok(selections.length >= 2, 'the same key is selected again in the same run');
  assert.equal(selections[1].decision.chosen, selections[0].decision.chosen);

  // A resume must not re-blame the candidate from the persisted failure.
  const second = await runOrchestration('RI-R03 resume no re-blame', f.opts);
  const secondSelections = chosenAgain(second);
  assert.ok(secondSelections.length >= 1, 'the resume selects a candidate again');
  assert.equal(
    secondSelections[0].decision.chosen,
    writerKey,
    'the same candidate key can be selected after the resume'
  );
});

test('RI-R03: classifyFailure returns launch_config/local for a missing base and blames no failure domain', () => {
  const { classifyFailure, Scope, Cause } = require('../failure-classifier');
  const { sameFailureDomain } = require('../routing');
  const result = classifyFailure({
    exitCode: 128,
    stderr:
      'ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: ' + 'a'.repeat(40),
  });
  assert.equal(result.cause, Cause.LAUNCH_CONFIG);
  assert.equal(result.scope, Scope.LOCAL);
  assert.equal(
    sameFailureDomain(
      cand('writer', 'author.foundation'),
      cand('writer', 'author.foundation'),
      result
    ),
    false
  );
});

test('RI-R04: a run without an explicit host repo creates no refs/shipde/* under process.cwd()', async () => {
  const dir = tmpDir('task-ai-120-ri-r04-');
  const work = makeRepo(path.join(dir, 'work'));
  // process.cwd() during the run is itself a git repository — the exact
  // situation that wrote refs/shipde/* into the real repository.
  const cwdRepo = makeRepo(path.join(dir, 'process-cwd'));

  const checkpointFile = path.join(dir, 'checkpoint.json');
  const f = launchHarness([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    host: work,
    launchRoot: work.dir,
    checkpointFile,
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    // no cwd, no hostCwd, no root — RI-R04's precondition
    run: (job, state) => {
      if (job.isReview) {
        state.reviewCalls += 1;
        return reviewPass(job);
      }
      state.passSha[job.workItemId] = commitIn(work, 'change-' + job.workItemId + '.js', 'done\n');
      return { exitCode: 0, stdout: 'worker completed' };
    },
  });
  assert.equal(f.opts.cwd, undefined, 'the run has no explicit host repo');
  assert.equal(f.opts.hostCwd, undefined);

  const previousCwd = process.cwd();
  process.chdir(cwdRepo.dir);
  let log = null;
  try {
    log = await runOrchestration('RI-R04 no explicit host', f.opts);
  } finally {
    process.chdir(previousCwd);
  }
  assert.equal(outcomeOf(log, 'A').status, 'completed');

  const refs = cwdRepo.git(['for-each-ref', '--format=%(refname)', 'refs/shipde/']);
  assert.equal(refs, '', 'no refs/shipde/* under process.cwd(), got: ' + refs);
  const stepA = liveStepOf(checkpointFile, 'A');
  assert.equal(stepA.review.entry.passedRef, undefined, 'no passedRef without an explicit host');
  assert.equal(stepA.review.passedRef, undefined, 'no passedRef without an explicit host');
});
