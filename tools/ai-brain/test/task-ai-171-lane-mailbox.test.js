'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const pool = require('../agy-pool-runtime');
const laneLauncher = require('../lane-launcher');

test('TASK-AI-171 mailbox reproduction: pool submission vs active lane writer', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-171-mailbox-active-'));
  const prevRunsDir = process.env.AGY_POOL_RUNS_DIR;
  process.env.AGY_POOL_RUNS_DIR = runsDir;
  t.after(() => {
    if (prevRunsDir !== undefined) {
      process.env.AGY_POOL_RUNS_DIR = prevRunsDir;
    } else {
      delete process.env.AGY_POOL_RUNS_DIR;
    }
    try {
      fs.rmSync(runsDir, { recursive: true, force: true });
    } catch (_) {}
  });

  const accountId = 'agy01';
  const accountDir = pool.accountDir(accountId, { runsDir });
  fs.mkdirSync(accountDir, { recursive: true });

  // 1. Seed an existing result.json (prior completed job result)
  const resultFile = path.join(accountDir, 'result.json');
  const priorResult = { jobId: 'prior-job-fixture', exitCode: 0, stdout: 'prior-output' };
  fs.writeFileSync(resultFile, JSON.stringify(priorResult, null, 2), 'utf8');

  // 2. Seed an ACTIVE writer job exactly the way lane-launcher.launch publishes one
  const writerPayload = {
    cwd: path.join(runsDir, 'workspace'),
    prompt: 'task instructions for active writer',
    model: 'fixture-writer-model',
    candidateKey: 'fixture-candidate-key',
    accountId,
    harness: 'agy-pool',
  };
  const launchRes = laneLauncher.launch(accountDir, writerPayload);
  assert.equal(launchRes.ok, true, 'seed writer job via lane-launcher.launch succeeds');
  assert.equal(
    laneLauncher.readResult(accountDir, launchRes.job),
    null,
    'writer job has no matching result'
  );

  const jobFile = path.join(accountDir, 'job.json');
  const writerJobRawBefore = fs.readFileSync(jobFile, 'utf8');
  const writerJobShaBefore = crypto.createHash('sha256').update(writerJobRawBefore).digest('hex');
  const resultShaBefore = crypto
    .createHash('sha256')
    .update(fs.readFileSync(resultFile, 'utf8'))
    .digest('hex');

  // 3. Fake the scheduler / adapter call so no live scheduler calls execute
  let schedulerCalls = 0;
  t.mock.method(pool, 'runAdapter', () => {
    schedulerCalls += 1;
    return { exitCode: 0 };
  });

  // 4. Call agy-pool-runtime.submitJob for the same lane with {command: "models"} (discovery/live.js:174 path)
  const submitRes = pool.submitJob(
    accountId,
    { command: 'models', cwd: runsDir },
    { runsDir, timeoutMs: 50 }
  );

  // 5. Expected (B39 lane ownership):
  // - writer job.json sha256 is unchanged
  // - existing result.json is unchanged (not deleted)
  // - no scheduler call (fake it)
  // - submitJob refuses or waits
  const writerJobShaAfter = crypto
    .createHash('sha256')
    .update(fs.readFileSync(jobFile, 'utf8'))
    .digest('hex');
  assert.equal(writerJobShaAfter, writerJobShaBefore, 'writer job.json sha256 must be unchanged');

  assert.equal(fs.existsSync(resultFile), true, 'existing result.json must not be deleted');
  const resultShaAfter = crypto
    .createHash('sha256')
    .update(fs.readFileSync(resultFile, 'utf8'))
    .digest('hex');
  assert.equal(resultShaAfter, resultShaBefore, 'existing result.json sha256 must be unchanged');

  assert.equal(schedulerCalls, 0, 'no scheduler call when lane is owned by active writer');

  assert.equal(
    submitRes.state,
    'busy',
    'submitJob must refuse with busy state when lane has active writer'
  );
});

test('idle lane: models submission succeeds without active writer collision', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-171-mailbox-idle-'));
  const prevRunsDir = process.env.AGY_POOL_RUNS_DIR;
  process.env.AGY_POOL_RUNS_DIR = runsDir;
  t.after(() => {
    if (prevRunsDir !== undefined) {
      process.env.AGY_POOL_RUNS_DIR = prevRunsDir;
    } else {
      delete process.env.AGY_POOL_RUNS_DIR;
    }
    try {
      fs.rmSync(runsDir, { recursive: true, force: true });
    } catch (_) {}
  });

  const accountId = 'agy02';
  const accountDir = pool.accountDir(accountId, { runsDir });
  fs.mkdirSync(accountDir, { recursive: true });

  let schedulerCalls = 0;
  t.mock.method(pool, 'runAdapter', (acc, opts) => {
    schedulerCalls += 1;
    const dir = pool.accountDir(acc, opts);
    const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
    fs.writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({
        jobId: job.jobId,
        exitCode: 0,
        stdout: 'fixture-model-a\nfixture-model-b\n',
      }),
      'utf8'
    );
    return { exitCode: 0 };
  });

  const res = pool.submitJob(
    accountId,
    { command: 'models', cwd: runsDir },
    { runsDir, timeoutMs: 1000 }
  );

  assert.equal(schedulerCalls, 1, 'scheduler is called for idle lane models submission');
  assert.equal(res.exitCode, 0, 'idle submission succeeds with exitCode 0');
  assert.match(res.stdout, /fixture-model-a/, 'models listing output is returned');
});
