'use strict';

/**
 * Ship Dễ — TASK-AI-117: a run interrupted after the worker commit resumes into
 * review, not a dead session.
 *
 * Defect found in the gate 5c live run (tools/ai-brain/orchestrate.js on main
 * 377d483):
 *
 *   The checkpoint for TASK-AI-111 stood at `fail_before_measured` with a
 *   completed launch — `launch.workerSha` set, `launch.exitCode` 0, `failBefore`
 *   recorded. The orchestrate process was killed (controlled interrupt) and
 *   rerun with the same `--checkpoint`. The resume reclaimed its writer claim
 *   (`resumed from fail_before_measured and reclaimed its writer claim`) and
 *   then tried to reattach to the finished writer session: the synthesised
 *   usage report carried `session_id: null`, the reattach read
 *   `HARNESS_NO_SESSION_ID`, and the item ended `blocked` with reasonCode
 *   `NO_ALTERNATE_FAILURE_DOMAIN` and no review launched. The worker session
 *   had already exited 0 — there is nothing to reattach to.
 *
 * A completed launch (workerSha present, exitCode 0) resumes straight into
 * review of that exact workerSha with the recorded failBefore: no relaunch, no
 * reattach, and never HARNESS_NO_SESSION_ID counted as a failure-domain
 * attempt. An incomplete launch (no workerSha) keeps the launch/reattach
 * behaviour it has today.
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
const NOW = Date.parse('2026-10-05T12:00:00Z');
const REVIEWER = 'paseo::cli::review-gw::review-up::reviewer::scope::review-model';
const ITEM = 'TASK-AI-117-TEST';

after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function candidate(id, role, over) {
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
      cost: id === 'writer' ? 0.1 : 1,
    },
    over || {}
  );
}

function checkpointOf(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function liveStepOf(file, id) {
  const checkpoint = checkpointOf(file);
  return (checkpoint.liveSteps && checkpoint.liveSteps[id]) || null;
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

function outcomeOf(log, id) {
  return (log.outcomes || []).find((entry) => entry.workItemId === id) || null;
}

/**
 * One real git repository as the worker root, one writer candidate, an
 * injected launcher that commits once and an injected fail-before. The writer
 * harness is opencode-direct by default: that is the adapter the gate 5c run
 * used, and the one whose resume reattach synthesises a `session_id: null`
 * report and reads HARNESS_NO_SESSION_ID from it.
 */
function setup(over) {
  const opts = over || {};
  const dir = tmpDir('task-ai-117-');
  const cwd = path.join(dir, 'repo');
  fs.mkdirSync(cwd);
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-117@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-117 test']);
  fs.writeFileSync(path.join(cwd, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  const sha = git(['rev-parse', 'HEAD']);
  const checkpointFile = path.join(dir, 'checkpoint.json');
  const decisionDir = path.join(dir, 'decisions');
  const writer = candidate('writer', 'author.foundation', {
    harness: opts.harness || 'opencode-direct',
  });
  const reviewer = candidate('reviewer', 'reviewer');
  const run = (job) => {
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'writer-session' }));
    }
    fs.writeFileSync(path.join(cwd, 'change.js'), 'completed\n');
    git(['add', 'change.js']);
    git(['commit', '-q', '-m', 'worker completion']);
    return { exitCode: 0, stdout: 'worker completed' };
  };
  const f = {
    specs: [{ id: ITEM, files: ['change.js'], verification: { command: 'test' } }],
    candidates: [writer],
    registry: { sources: [] },
    checkpointFile,
    decisionDir,
    usageDir: path.join(dir, 'usage'),
    now: NOW,
    cwd,
    git,
    workerRoot: cwd,
    baseSha: sha,
    sha,
    publisherCwd: cwd,
    branch: 'feat/task-ai-117-test',
    run,
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    reviewer: async (reviewedSha) => ({
      pass: true,
      sha: reviewedSha,
      verdict: 'PASS',
      reviewer: REVIEWER,
      findings: [],
    }),
    repairer: async (_findings, repairedSha) => ({ sha: repairedSha }),
    reviewerIdentity: candidateKey(reviewer),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    writer,
    reviewer,
    dir,
  };
  return f;
}

/**
 * One live run that completes and commits the worker change, measures the
 * fail-before and is then killed inside the first review — the exact shape of
 * the gate 5c interrupt. Returns the checkpoint's launch record.
 */
async function interruptAfterWorkerCommit(f) {
  f.reviewer = async () => {
    const step = liveStepOf(f.checkpointFile, ITEM);
    assert.ok(step && step.failBefore, 'fail-before is recorded before the review starts');
    throw new Error('controlled interrupt after the worker commit');
  };
  await assert.rejects(
    runOrchestration('interrupt after worker commit', f),
    /controlled interrupt after the worker commit/
  );
  const step = liveStepOf(f.checkpointFile, ITEM);
  assert.equal(step.stage, 'fail_before_measured', JSON.stringify(step, null, 2));
  assert.ok(step.launch, JSON.stringify(step, null, 2));
  assert.equal(step.launch.exitCode, 0, JSON.stringify(step.launch, null, 2));
  assert.ok(step.launch.workerSha, JSON.stringify(step.launch, null, 2));
  assert.match(String(step.launch.workerSha), /^[0-9a-f]{40}$/);
  assert.ok(step.launch.failBefore, JSON.stringify(step.launch, null, 2));
  return step;
}

test('RS-R01 a resume after a completed launch goes straight to review of the recorded workerSha', async () => {
  const f = setup();
  const step = await interruptAfterWorkerCommit(f);
  const workerSha = step.launch.workerSha;
  const recordedFailBefore = step.launch.failBefore;

  let launches = 0;
  let measures = 0;
  const reviewedShas = [];
  f.run = () => {
    launches += 1;
    return { exitCode: 0, stdout: 'must not relaunch a finished worker session' };
  };
  f.measureFailBefore = () => {
    measures += 1;
    return { command: 'test', exitCode: 1 };
  };
  f.reviewer = async (reviewedSha) => {
    reviewedShas.push(reviewedSha);
    return { pass: true, sha: reviewedSha, verdict: 'PASS', reviewer: REVIEWER, findings: [] };
  };
  const before = decisionRecords(f.decisionDir);

  const second = await runOrchestration('resume into review', f);

  assert.equal(launches, 0, 'the finished writer session is not relaunched');
  assert.equal(measures, 0, 'the recorded failBefore is reused, not re-measured');
  assert.deepEqual(reviewedShas, [workerSha], 'the review reads that exact workerSha');
  assert.equal(second.status, 'COMPLETED', JSON.stringify(second.outcomes, null, 2));
  const outcome = outcomeOf(second, ITEM);
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.reason, 'REVIEW_PASS');
  assert.equal(outcome.reasonCode, undefined);
  assert.deepEqual(second.review.failBefore, recordedFailBefore);
  assert.deepEqual(second.failBefore, recordedFailBefore);
  assert.equal(second.resumed.from, 'fail_before_measured');
  assert.deepEqual(second.selections, [], 'no candidate is re-selected for a completed launch');
  assert.deepEqual(
    second.sessions.map((s) => s.headSha),
    [workerSha],
    'the session carries the checkpoint workerSha'
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8')).liveSteps[ITEM].launch.failBefore,
    recordedFailBefore,
    'the checkpoint keeps the recorded failBefore'
  );

  const added = decisionRecords(f.decisionDir).slice(before.length);
  assert.ok(
    added.some(
      (r) =>
        r.stage === 'resumed' &&
        r.workItemId === ITEM &&
        /resumed from fail_before_measured/.test(String(r.detail))
    ),
    'the decision log records the resume from fail_before_measured: ' + JSON.stringify(added)
  );
  assert.equal(
    added.filter((r) => r.stage === 'launched').length,
    0,
    'a completed launch is not reattached, so no second launched record: ' + JSON.stringify(added)
  );
  assert.equal(
    added.filter((r) => r.stage === 'failed').length,
    0,
    'a completed launch records no failure-domain attempt: ' + JSON.stringify(added)
  );
});

test('RS-R02 HARNESS_NO_SESSION_ID is not raised for a completed launch and is not a failure-domain attempt', async () => {
  const f = setup();
  const step = await interruptAfterWorkerCommit(f);
  const workerSha = step.launch.workerSha;

  // The worker session is finished and its usage reports are gone: there is
  // nothing left to reattach to.
  fs.rmSync(f.usageDir, { recursive: true, force: true });

  let launches = 0;
  const reviewedShas = [];
  f.run = () => {
    launches += 1;
    return { exitCode: 0, stdout: 'must not relaunch a finished worker session' };
  };
  f.reviewer = async (reviewedSha) => {
    reviewedShas.push(reviewedSha);
    return { pass: true, sha: reviewedSha, verdict: 'PASS', reviewer: REVIEWER, findings: [] };
  };
  const before = decisionRecords(f.decisionDir);

  const second = await runOrchestration('resume without a reattach channel', f);

  assert.equal(launches, 0, 'the finished writer session is not relaunched');
  assert.deepEqual(reviewedShas, [workerSha], 'the review still reads the recorded workerSha');
  const outcome = outcomeOf(second, ITEM);
  assert.notEqual(outcome.reason, 'HARNESS_NO_SESSION_ID');
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome, null, 2));
  assert.equal(outcome.reason, 'REVIEW_PASS');
  assert.equal(outcome.reasonCode, undefined);
  assert.deepEqual(second.selections, [], 'the completed launch is not counted as an attempt');
  assert.deepEqual(
    (liveStepOf(f.checkpointFile, ITEM).failures || []).map(
      (failure) => failure.failedCandidateKey
    ),
    [],
    'no failure is recorded against the completed launch'
  );

  const added = decisionRecords(f.decisionDir).slice(before.length);
  assert.equal(
    added.filter((r) => r.stage === 'failed').length,
    0,
    'HARNESS_NO_SESSION_ID is not counted as a failure-domain attempt: ' + JSON.stringify(added)
  );
});

test('RS-R03 a resume whose launch has no workerSha keeps the launch/reattach behaviour', async () => {
  const f = setup({ harness: 'hermes' });
  await interruptAfterWorkerCommit(f);

  // The launch is genuinely incomplete: the checkpoint holds no worker commit.
  const onDisk = checkpointOf(f.checkpointFile);
  onDisk.liveSteps[ITEM].launch.workerSha = null;
  fs.writeFileSync(f.checkpointFile, JSON.stringify(onDisk, null, 2), 'utf8');

  let launches = 0;
  const reviewedShas = [];
  f.run = (job) => {
    launches += 1;
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'writer-session' }));
    }
    return { exitCode: 0, stdout: 'worker completed' };
  };
  f.reviewer = async (reviewedSha) => {
    reviewedShas.push(reviewedSha);
    return { pass: true, sha: reviewedSha, verdict: 'PASS', reviewer: REVIEWER, findings: [] };
  };
  const before = decisionRecords(f.decisionDir);

  const second = await runOrchestration('resume an incomplete launch', f);

  assert.equal(launches, 0, 'the incomplete launch is not relaunched: it is reattached');
  assert.equal(second.selections.length, 1, 'the resume goes through the launch machinery');
  assert.equal(reviewedShas.length, 1, 'today the reattached session is still reviewed');
  assert.equal(outcomeOf(second, ITEM).reason, 'REVIEW_PASS');
  const added = decisionRecords(f.decisionDir).slice(before.length);
  assert.equal(
    added.filter((r) => r.stage === 'launched' && r.workItemId === ITEM).length,
    1,
    'today the reattach re-records the durable session handle: ' + JSON.stringify(added)
  );
});
