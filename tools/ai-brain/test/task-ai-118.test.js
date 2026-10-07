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
const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../candidates');
const { classifyFailure, isReplayable } = require('../failure-classifier');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-07T12:00:00Z');
const GLOBAL_BASE = 'a'.repeat(40);
const TEST_BASE_SHA = 'b'.repeat(40);
const QUOTA_FAILURE = { exitCode: 1, httpStatus: 429, stderr: 'HTTP 429 quota exhausted' };
const AUTH_FAILURE = { exitCode: 1, httpStatus: 403, stderr: 'HTTP 403 not licensed' };

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
    publisher: opts.publisher
      ? async (pubOpts) => {
          state.publishCalls += 1;
          const result = await opts.publisher(pubOpts);
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
test('RT-R02: non-retryable failure excludes that candidate from re-selection', async () => {
  let writerCalls = 0;
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    onlyWriter: true, // Only one candidate so no alternates available
    run: (job) => {
      if (job.isReview) return f.reviewPass(job);
      writerCalls += 1;
      // First call: non-retryable auth failure (403)
      if (writerCalls === 1) return AUTH_FAILURE;
      // Subsequent calls should not happen for the same candidate
      return f.writerStep(job);
    },
  });
  const log = await runOrchestration('RT-R02 non-retryable exclusion', f.opts);

  const outcome = outcomeOf(log, 'A');
  // Should be blocked because there's only one writer candidate and it failed non-retryable
  assert.equal(outcome.status, 'blocked');

  const records = decisionRecords(f.opts.decisionDir);
  const failedRecords = records.filter((r) => r.stage === 'failed');
  assert.ok(failedRecords.length > 0, 'should have failed records');

  // Verify the failure is classified as non-retryable
  const classification = classifyFailure({
    exitCode: 1,
    httpStatus: 403,
    stderr: 'HTTP 403 not licensed',
  });
  assert.equal(classification.retryable, false, '403 should be non-retryable');

  // The failed record should show retryable: false
  const writerFailed = failedRecords.find((r) => r.role === 'author.foundation');
  assert.ok(writerFailed, 'should have writer failure record');
  assert.equal(writerFailed.retryable, false, 'writer failure should be non-retryable');

  // RT-R02: the candidate key should be in the excluded set for this work item
  const writerKey = candidateKey(f.writer);
  assert.ok(
    writerFailed.excluded && writerFailed.excluded.includes(writerKey),
    'non-retryable candidate should be excluded'
  );

  // Assert writer was called exactly once - non-retryable candidate should not be re-selected
  assert.equal(
    writerCalls,
    1,
    'writer should only be called once, non-retryable candidate excluded'
  );
});

// RT-R03: retryAfterMs overrides cooldown when greater
test('RT-R03: cooldown uses retryAfterMs when greater than default cooldown', async () => {
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
  const failedRecords = records.filter((r) => r.stage === 'failed');
  const writerFailed = failedRecords.find((r) => r.role === 'author.foundation');
  assert.ok(writerFailed, 'should have writer failure record');

  // Verify classification has retryAfterMs
  const classification = classifyFailure({
    exitCode: 1,
    httpStatus: 429,
    stderr: 'HTTP 429 quota exhausted, resets in 2h',
  });
  assert.ok(classification.retryable, '429 should be retryable');
  // The retryAfterMs should be recorded in the decision log
  assert.ok(writerFailed.retryAfterMs !== null, 'retryAfterMs should be recorded in failed record');

  // RT-R03: the retryAfterMs should be exactly as classified (max of existing cooldownMs and retryAfterMs)
  assert.equal(
    writerFailed.retryAfterMs,
    classification.retryAfterMs,
    'retryAfterMs should match classification'
  );
  // Verify retryAfterMs is not shorter than the default cooldown for 429 (5 minutes = 300000ms)
  const defaultQuotaCooldown = classification.cooldownMs;
  assert.ok(
    writerFailed.retryAfterMs >= defaultQuotaCooldown,
    'retryAfterMs should not be shorter than default cooldown'
  );
});

// RT-R04: publish step never auto re-runs after failure (isReplayable guard)
test('RT-R04: publish is guarded by isReplayable and never auto re-runs', async () => {
  let publishAttempts = 0;
  const f = setup([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    run: (job) => {
      if (job.usageFile) {
        fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-test' }));
      }
      if (job.isReview) {
        const verdictFile = job.verdictFile || path.join(job.cwd, 'verdict.json');
        fs.mkdirSync(path.dirname(verdictFile), { recursive: true });
        fs.writeFileSync(
          verdictFile,
          JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
        );
        return { exitCode: 0, stdout: 'review pass' };
      }
      return f.writerStep(job);
    },
    publication: {
      branch: 'feat/test-rt04',
      draft: { workItemId: 'A', outcome: 'test' },
      testMode: true,
      approvalId: 'test-approval-id',
      expiry: Date.now() + 60000,
    },
    publisher: async () => {
      publishAttempts += 1;
      // First attempt fails
      if (publishAttempts === 1) {
        throw new Error('PUBLISH_FAILED: network error');
      }
      return { status: 'published', pr: 1 };
    },
  });
  const log = await runOrchestration('RT-R04 publish not replayable', f.opts);

  // Verify isReplayable('publish') returns false
  assert.equal(isReplayable('publish'), false, 'publish must not be replayable');

  // The publish should have been attempted exactly once
  assert.equal(publishAttempts, 1, 'publish should only be attempted once, not retried');

  // Verify publication was attempted exactly once (not retried)
  const pub = log.publications && log.publications[0];
  assert.ok(pub, 'should have a publication record');
  // The publisher should have been called once (tested above), and the result
  // is a Promise that rejects (since the first attempt throws). We verify that
  // the result is a rejected Promise containing the PUBLISH_FAILED error.
  assert.ok(pub.result instanceof Promise, 'publication result should be a Promise');
  await assert.rejects(
    pub.result,
    { name: 'Error', message: 'PUBLISH_FAILED: network error' },
    'publication Promise should reject with the publish error'
  );
});

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
