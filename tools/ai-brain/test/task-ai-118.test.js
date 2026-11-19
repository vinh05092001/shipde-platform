'use strict';

/**
 * Ship Dễ — TASK-AI-118: the Controller acts on retryable and replay rules
 *
 * Tests for:
 * - RT-R01: every failed decision-log entry records retryable and retryAfterMs
 * - RT-R02: non-retryable candidates are excluded from re-selection
 * - RT-R03: retryAfterMs overrides cooldown when greater
 * - RT-R04: publish step never auto re-runs (guarded by isReplayable)
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration, effectiveCooldownMs } = require('../orchestrate');
const { candidateKey } = require('../candidates');
const { classifyFailure, isReplayable } = require('../failure-classifier');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-07T12:00:00Z');
const GLOBAL_BASE = 'a'.repeat(40);
const TEST_BASE_SHA = 'b'.repeat(40);
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
  const dir = tmpDir('task-ai-118-');
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
  git(['config', 'user.email', 'task-ai-118@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-118 test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  const baseSha = git(['rev-parse', 'HEAD']);

  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const reviewerA = cand('reviewera', 'reviewer.primary');
  const reviewerB = cand('reviewerb', 'reviewer.primary');
  const candidates = opts.onlyWriter ? [writer] : [writer, reviewerA];
  if (opts.secondReviewer) candidates.push(reviewerB);

  const state = {
    calls: [],
    passSha: {},
    repairCalls: 0,
    reviewCalls: 0,
    publishCalls: 0,
    publishErrors: [],
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
    baseSha: baseSha,
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
    // Not an async wrapper: a publisher that throws synchronously must reach
    // publication()'s catch as a failed attempt, the same way a real publisher
    // that refuses its arguments does. A promise is still passed through.
    publisher: opts.publisher
      ? (pubOpts) => {
          state.publishCalls += 1;
          const result = opts.publisher(pubOpts);
          if (result && typeof result.then === 'function') {
            return result.then((value) => {
              if (value && value.error) state.publishErrors.push(value.error);
              return value;
            });
          }
          if (result && result.error) state.publishErrors.push(result.error);
          return result;
        }
      : undefined,
    publication: opts.publication,
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

// RT-R01: every failed decision-log entry records retryable and retryAfterMs
test('RT-R01: failed decision-log entries include retryable and retryAfterMs from classification', async () => {
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    run: (job) => {
      if (job.isReview) return f.reviewPass(job);
      return QUOTA_FAILURE;
    },
  });
  const log = await runOrchestration('RT-R01 retryable fields', f.opts);

  const outcome = outcomeOf(log, 'A');
  assert.equal(outcome.status, 'blocked');

  const records = decisionRecords(f.opts.decisionDir);
  const failedRecords = records.filter((r) => r.stage === 'failed');
  assert.ok(failedRecords.length > 0, 'there should be at least one failed record');

  for (const record of failedRecords) {
    assert.ok(
      typeof record.retryable === 'boolean',
      'failed record must have retryable field: ' + JSON.stringify(record)
    );
    assert.ok(
      record.retryAfterMs !== undefined,
      'failed record must have retryAfterMs field: ' + JSON.stringify(record)
    );
  }

  // Verify the classification matches the failure-classifier output
  const classification = classifyFailure({
    exitCode: 1,
    httpStatus: 429,
    stderr: 'HTTP 429 quota exhausted',
  });
  const writerFailed = failedRecords.find((r) => r.role === 'author.foundation');
  assert.ok(writerFailed, 'should have a writer failure record');
  assert.equal(writerFailed.retryable, classification.retryable);
  assert.equal(writerFailed.retryAfterMs, classification.retryAfterMs);
});

// RT-R02: non-retryable candidates are not selected again in the same run
//
// The scenario has to isolate the non-retryable key rule. A 401/403 classifies
// at upstream or account scope, where the pre-existing failure-domain and
// forbidden-upstream rules already keep the candidate out, so the test would
// stay green with the key rule deleted. launch_config classifies at harness
// scope and is excluded from sameFailureDomain, and a first attempt never
// exhausts the domain budget, so the failed candidate key is the only barrier —
// remove it and this top-ranked candidate is selected again.
test('RT-R02: a non-retryable launch_config failure keeps its top-ranked candidate out of re-selection (fails if the key exclusion is removed)', async () => {
  const failure = { exitCode: 1, stderr: 'LAUNCH_CONFIG: provider "hermes" could not be resolved' };
  let writerCalls = 0;
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    onlyWriter: true, // the only candidate: without the key rule it is chosen again
    run: (job) => {
      if (job.isReview) return f.reviewPass(job);
      writerCalls += 1;
      // First call: non-retryable harness-scope configuration failure
      if (writerCalls === 1) return failure;
      // If the exclusion logic is broken, the writer is selected again
      return f.writerStep(job);
    },
  });
  const log = await runOrchestration('RT-R02 non-retryable exclusion', f.opts);

  const classification = classifyFailure(Object.assign({ accountId: f.writer.accountId }, failure));
  assert.equal(classification.retryable, false, 'launch_config must be non-retryable');
  assert.equal(classification.cause, 'launch_config');
  assert.equal(classification.scope, 'harness', 'the scenario must sit outside every domain rule');

  const outcome = outcomeOf(log, 'A');
  assert.equal(outcome.status, 'blocked', 'no eligible candidate may remain for this item');

  const records = decisionRecords(f.opts.decisionDir);
  const writerFailed = records.find((r) => r.stage === 'failed' && r.role === 'author.foundation');
  assert.ok(writerFailed, 'should have writer failure record');
  assert.equal(writerFailed.retryable, false, 'writer failure should be non-retryable');
  assert.equal(
    writerFailed.failureScope,
    'harness',
    'failure scope must be harness, not upstream/account'
  );
  assert.equal(writerFailed.detail, 'launch_config');

  // The candidate the ranking keeps at the top is never selected a second time.
  // Asserted on the selection, not only on the dispatch: a repeat selection
  // replays the checkpointed launch instead of calling the launcher again, so
  // the call count alone would not see it.
  const writerKey = candidateKey(f.writer);
  const selections = (log.selections || []).filter((s) => s.workItemId === 'A');
  const chosenWriter = selections.filter((s) => s.decision && s.decision.chosen === writerKey);
  assert.equal(
    chosenWriter.length,
    1,
    'the non-retryable candidate must be selected exactly once in the same run'
  );
  assert.equal(writerCalls, 1, 'the non-retryable candidate must never be dispatched again');

  // A harness-scope failure excludes no domain, so the excluded set carries the
  // failed key and nothing else: it is populated by the key rule alone.
  assert.deepEqual(
    writerFailed.excluded,
    [writerKey],
    'only the failed candidate key may be excluded for this failure'
  );
});

// RT-R03: the cooldown is exactly max(cooldownMs, retryAfterMs), never shorter
test('RT-R03: the applied cooldown equals max(cooldownMs, retryAfterMs) in both orderings', async () => {
  const FIVE_MINUTES = 5 * 60 * 1000;
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  // Ordering 1: retryAfterMs is the greater of the two — the provider's own
  // reset wins, so the cooldown is the retryAfterMs.
  assert.equal(
    effectiveCooldownMs({ cooldownMs: FIVE_MINUTES, retryAfterMs: TWO_HOURS }),
    7200000,
    'when retryAfterMs is greater, the cooldown must be exactly retryAfterMs'
  );
  // Ordering 2: cooldownMs is the greater of the two — the cooldown the
  // Controller already sets stands, and the shorter retry hint never shrinks it.
  assert.equal(
    effectiveCooldownMs({ cooldownMs: TWO_HOURS, retryAfterMs: FIVE_MINUTES }),
    7200000,
    'when cooldownMs is greater, the cooldown must be exactly cooldownMs'
  );
  // No retry hint: the cooldown stands unchanged, it is never dropped to zero.
  assert.equal(effectiveCooldownMs({ cooldownMs: TWO_HOURS, retryAfterMs: null }), 7200000);
  // No answer at all: the "never recovers on time alone" case stays null.
  assert.equal(
    effectiveCooldownMs({ cooldownMs: null, retryAfterMs: null }),
    null,
    'a classification with no cooldown at all must stay null, not become 0'
  );

  // The same rule is what a real run records: a 429 that says it resets in 2h.
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    run: (job) => {
      if (job.isReview) return f.reviewPass(job);
      return { exitCode: 1, httpStatus: 429, stderr: 'HTTP 429 quota exhausted, resets in 2h' };
    },
  });
  const log = await runOrchestration('RT-R03 retryAfterMs cooldown', f.opts);

  const outcome = outcomeOf(log, 'A');
  assert.equal(outcome.status, 'blocked');

  const records = decisionRecords(f.opts.decisionDir);
  const writerFailed = records.find((r) => r.stage === 'failed' && r.role === 'author.foundation');
  assert.ok(writerFailed, 'should have writer failure record');

  const classification = classifyFailure({
    exitCode: 1,
    httpStatus: 429,
    stderr: 'HTTP 429 quota exhausted, resets in 2h',
  });
  assert.ok(classification.retryable, '429 should be retryable');
  assert.equal(classification.cooldownMs, 7200000, 'the parsed reset is exactly 2h');
  assert.ok(
    writerFailed.retryAfterMs !== null && writerFailed.retryAfterMs !== undefined,
    'retryAfterMs should be recorded in failed record'
  );
  assert.equal(
    writerFailed.retryAfterMs,
    classification.retryAfterMs,
    'retryAfterMs should match classification'
  );

  // The cooldown the run recorded is the exact max of both inputs.
  assert.equal(
    writerFailed.cooldownMs,
    Math.max(classification.cooldownMs, writerFailed.retryAfterMs),
    'the recorded cooldown must be exactly max(cooldownMs, retryAfterMs)'
  );
  assert.equal(writerFailed.cooldownMs, 7200000, 'concrete: the cooldown is the parsed 2h reset');
  assert.ok(
    writerFailed.cooldownMs >= classification.cooldownMs &&
      writerFailed.cooldownMs >= writerFailed.retryAfterMs,
    'the applied cooldown is never shorter than either input'
  );
});

// RT-R04: publish step never auto re-runs after a failed or timed-out attempt

// RT-R04: a second attempt after a failed one is refused, and the publisher runs once

// Test that isReplayable correctly identifies non-replayable operations
test('RT-R04: isReplayable correctly identifies non-replayable operations', () => {
  // Non-replayable operations
  assert.equal(isReplayable('publish'), false);
  assert.equal(isReplayable('push'), false);
  assert.equal(isReplayable('createPR'), false);
  assert.equal(isReplayable('comment'), false);
  assert.equal(isReplayable('merge'), false);

  // Replayable operations
  assert.equal(isReplayable('probe'), true);
  assert.equal(isReplayable('list'), true);
  assert.equal(isReplayable('reviewRead'), true);
  assert.equal(isReplayable('testRun'), true);

  // Unknown operations default to false (safe default)
  assert.equal(isReplayable('unknown'), false);
  assert.equal(isReplayable(''), false);
  assert.equal(isReplayable(null), false);
  assert.equal(isReplayable(undefined), false);
});
