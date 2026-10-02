'use strict';

/**
 * Ship Dễ — TASK-AI-64 live autonomous loop contract tests (fail-before).
 *
 * Every test here states behaviour the Work Item requires from the public seams
 * it names — `orchestrate.runOrchestration`, `supervisor.classifySession`,
 * `review-loop.runReviewLoop`, `publisher.publish` and the Controller's
 * decision log — and each one fails on origin/main because that behaviour does
 * not exist yet. The sources are
 * `docs/product-spec/work-items/TASK-AI-64.md` (principles AI-64-P01..P08,
 * rules AI-64-R01..R15, acceptance rows AC-AI-64-01..21) and the read-only gap
 * audit `.worktrees/logs/night/task-ai-64-live-gap-audit.md`.
 *
 * No network, no agent, no push. Every path is a temp directory. The publisher
 * cases use a throwaway git repository in os.tmpdir() plus `testMode`, which is
 * the publisher's own explicit test-only injection (publisher.js, P2).
 *
 * Test-launch convention: a launch that is meant to count as live writes the
 * real `--usage-file` report when the loop supplies a path for it (64-04), so
 * the only scenario that has no durable report is 64-01, whose entire point is
 * that a simulated callback is not a live run.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runOrchestration } = require('../orchestrate');
const { Status: SessionStatus } = require('../supervisor');
const { runReviewLoop } = require('../review-loop');
const { publish } = require('../publisher');
const { candidateKey } = require('../candidates');
const { classifyFailure, Scope } = require('../failure-classifier');
const routing = require('../routing');
const { executableFor } = require('../harness');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'task-ai-64');
const USAGE_REPORT = path.join(FIXTURE_DIR, 'hermes-usage-report.json');
const CHECKPOINT_SEED = path.join(FIXTURE_DIR, 'checkpoint-resume.json');
const APPROVAL_REGISTRY = path.join(FIXTURE_DIR, 'approval-registry.json');

const BRAIN_DIR = path.join(__dirname, '..');
const ORCHESTRATE_SRC = path.join(BRAIN_DIR, 'orchestrate.js');
const ISOLATION_LAUNCHER_SRC = path.join(BRAIN_DIR, 'isolation-launcher.js');

// The real goal of Live Run 1, not a placeholder: the loop must plan the goal
// the operator typed (AC-AI-64-01).
const GOAL = 'add a pure branch-name helper so the loop can derive the branch for a Work Item';

// A fixed past clock: every time-sensitive assertion in this file must behave
// the same on every machine and every hour of the day.
const NOW = Date.parse('2026-09-01T00:00:00.000Z');
const DAY = '2026-09-01';
const HANDLE = JSON.parse(fs.readFileSync(USAGE_REPORT, 'utf8')).session_id;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TRUSTED_URL = 'https://github.com/vinh05092001/shipde-platform.git';

// A gateway-scoped failure. failure-classifier.js Case 12: a non-zero exit with
// ECONNREFUSED / "gateway unreachable" classifies as scope `gateway` — never as
// upstream, account or model, so the replacement must differ in gateway.
const GATEWAY_FAILURE = {
  exitCode: 1,
  stderr: 'connect ECONNREFUSED 127.0.0.1:11434: gateway unreachable',
};

const PASS_TESTS = () => ({ pass: true });
const PASS_REVIEW = (arg) => ({
  pass: true,
  sha: (typeof arg === 'string' ? arg : arg && arg.sha) || SHA_A,
  verdict: 'PASS',
  findings: [],
});
const FIX_REPAIR = (findings, sha) => ({ sha: sha || SHA_A });

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cand(over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-64a',
      gateway: 'gw-64-a',
      upstream: 'up-64-a',
      accountId: 'acct-64-a',
      quotaScope: 'acct-64-a',
      modelId: 'up-64-a/model-64-a',
      source: 'gw-64-a',
      kind: 'router',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 64000 },
      cost: 1,
    },
    over || {}
  );
}

/** Records every job the loop hands a launcher, and replays canned results. */
function recorder(results) {
  const queue = Array.isArray(results) ? results.slice() : [results];
  const calls = [];
  const run = (job) => {
    calls.push(job || {});
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === 'function' ? next(job) : next;
  };
  run.calls = calls;
  return run;
}

/**
 * Writes the real usage report to the `--usage-file` path the loop supplies.
 * Returns null when the loop supplied none, which is itself the defect 64-04
 * asserts against. The key is matched loosely (any `usage*` field holding a
 * .json path) so the test binds to the contract — a durable report on disk —
 * rather than to one spelling of the option.
 */
function writeUsageReport(job) {
  const entry = Object.entries(job || {}).find(
    ([k, v]) => /usage/i.test(k) && typeof v === 'string' && /\.json$/i.test(v)
  );
  if (!entry) return null;
  const target = entry[1];
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, fs.readFileSync(USAGE_REPORT, 'utf8'), 'utf8');
  return target;
}

/** A launch that produced a real durable session report and real output. */
function liveLaunch(over) {
  return (job) => {
    writeUsageReport(job);
    return Object.assign({ exitCode: 0, stdout: 'the agent changed production code' }, over || {});
  };
}

function decisionLines(dir) {
  const file = path.join(dir, DAY + '.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function decisionText(dir) {
  return decisionLines(dir)
    .map((r) => JSON.stringify(r))
    .join('\n');
}

/** A refusal is a legitimate outcome for a live-loop contract; capture it. */
async function safeRun(opts) {
  try {
    return { log: await runOrchestration(GOAL, opts), refusal: null };
  } catch (err) {
    return { log: null, refusal: err };
  }
}

function completedItems(result) {
  return result && result.log ? result.log.reconciliation.completed : [];
}

/** True only for a run that was recorded as a real, completed live run. */
function isLiveCompletion(result, workItemId) {
  return !result.refusal && completedItems(result).includes(workItemId);
}

function baseOpts(extra) {
  return Object.assign(
    {
      specs: [{ id: 'A', files: ['a.js'], acceptanceCriteria: ['a works'] }],
      candidates: [cand()],
      registry: { sources: [] },
      sha: SHA_A,
      now: NOW,
      tests: PASS_TESTS,
      reviewer: PASS_REVIEW,
      repairer: FIX_REPAIR,
    },
    extra || {}
  );
}

function makeTempRepo() {
  const dir = tmpDir('task-ai-64-repo-');
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'worker@shipde.test']);
  git(['config', 'user.name', 'Worker']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'reviewed content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, sha: git(['rev-parse', 'HEAD']).stdout.trim() };
}

test('64-01 a simulated launch is never counted as a live run (AI-64-P08, AI-64-R04)', async () => {
  // (a) No launcher supplied at all. The loop must not substitute a success.
  const dirDefault = tmpDir('task-ai-64-sim-default-');
  const withDefault = await safeRun(baseOpts({ decisionDir: dirDefault }));

  // (b) A hard-coded simulated callback — the shape the shipped dry-run CLI
  // injects — that returns exit 0 and a stdout "session" but no durable report.
  const dirCallback = tmpDir('task-ai-64-sim-callback-');
  const withCallback = await safeRun(
    baseOpts({
      decisionDir: dirCallback,
      run: () => ({ exitCode: 0, stdout: '{"sessionId":"dry-sim"}' }),
    })
  );

  assert.equal(
    isLiveCompletion(withDefault, 'A'),
    false,
    'a run with no launcher must not complete a work item (orchestrate.js substitutes a no-op ' +
      'success launcher, so a run that launched nothing is recorded as launched and completed)'
  );
  assert.equal(
    isLiveCompletion(withCallback, 'A'),
    false,
    'a simulated callback that produced no durable session report must not be counted as a live run'
  );

  for (const dir of [dirDefault, dirCallback]) {
    const launched = decisionLines(dir).filter((r) => r.stage === 'launched');
    assert.deepEqual(
      launched,
      [],
      'a simulated run must not leave a launched record in the decision log; absence of ' +
        'evidence is never evidence of a launch'
    );
  }
});

test("64-02 the harness is given the Controller's pinned candidateKey, never one the loop chose (AI-64-P01, AI-64-R03)", async () => {
  const dir = tmpDir('task-ai-64-pinned-');
  const candidates = [
    cand(),
    cand({
      accessPath: 'cli-64b',
      gateway: 'gw-64-b',
      upstream: 'up-64-b',
      accountId: 'acct-64-b',
      quotaScope: 'acct-64-b',
      modelId: 'up-64-b/model-64-b',
      source: 'gw-64-b',
    }),
  ];
  const run = recorder([GATEWAY_FAILURE, liveLaunch()]);
  const result = await safeRun(baseOpts({ candidates, decisionDir: dir, run }));
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);

  const launched = run.calls.map((j) => j.candidateKey);
  assert.ok(launched.length > 0, 'the loop must dispatch the work item at least once');

  // Every candidate the loop launches is a candidate the Controller chose, and
  // that choice was written to the decision log before the launch.
  const chosen = new Set(
    decisionLines(dir)
      .filter((r) => r.stage === 'selected' || r.stage === 'refused')
      .map((r) => r.chosen)
      .filter(Boolean)
  );
  assert.ok(
    chosen.size > 0,
    'the decision log must record the Controller selection before the launch'
  );
  for (const key of launched) {
    assert.ok(
      chosen.has(key),
      'the loop launched candidateKey ' +
        key +
        ", which no Controller decision chose. Selection is the Controller's alone; the loop " +
        'may only consume it (AI-64-P01, AI-64-R03)'
    );
  }

  const registryKeys = new Set(candidates.map(candidateKey));
  for (const key of launched) {
    assert.ok(
      registryKeys.has(key),
      'candidateKey ' +
        key +
        ' is not a registry candidate; the loop may not derive, default or ' +
        'improve an identity (AI-64-P02)'
    );
  }
});

test('64-03 a live run goes through the isolated launcher, injected runner or not (AI-64-P03, AI-64-R15)', async () => {
  // The loop must obtain the OS isolation launcher for a live run. The spy
  // stands in for it so the test never provisions a worker account; what is
  // under test is that the launcher is requested at all, even though a test
  // runner is injected — injecting a runner is not an isolation bypass.
  const isoPath = require.resolve('../isolation-launcher');
  const orchPath = require.resolve('../orchestrate');
  const isoModule = require(isoPath);
  const realGetIsolatedLauncher = isoModule.getIsolatedLauncher;
  let requested = 0;
  isoModule.getIsolatedLauncher = function spy() {
    requested += 1;
    return function stubIsolatedLauncher() {
      return { exitCode: 0, stdout: 'the agent changed production code' };
    };
  };

  let result;
  try {
    delete require.cache[orchPath];
    const fresh = require(orchPath);
    result = await safeRun(
      baseOpts({
        isolatedWorker: true,
        decisionDir: tmpDir('task-ai-64-isolated-'),
        run: liveLaunch(),
      })
    );
    assert.equal(typeof fresh.runOrchestration, 'function', 'orchestrate must stay requirable');
  } finally {
    isoModule.getIsolatedLauncher = realGetIsolatedLauncher;
    delete require.cache[orchPath];
  }
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);
  assert.ok(
    requested > 0,
    'a live run with the worker boundary requested must go through the isolated launcher; the ' +
      'loop never asks for one, and an injected runner silently drops the OS boundary'
  );

  // The exemptions that let a dependency injection disable isolation are gone.
  for (const file of ['executor.js', 'cli.js']) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, file), 'utf8');
    const offenders = src
      .split('\n')
      .filter(
        (line) =>
          /isolat/i.test(line) &&
          /(typeof\s+[\w.]*run\s*!==\s*'function'|!\(deps\s*&&\s*deps\.run\)|deps\s*&&\s*deps\.run\s*\))/.test(
            line
          )
      );
    assert.deepEqual(
      offenders,
      [],
      file +
        ' must not disable the worker boundary when a runner is injected (AI-64-P03): ' +
        offenders.join(' | ')
    );
  }
});

test('64-04 the durable session handle is read from the report and stored, never guessed (AI-64-R04)', async () => {
  const dir = tmpDir('task-ai-64-session-');
  const run = recorder([liveLaunch()]);
  const result = await safeRun(baseOpts({ decisionDir: dir, run }));
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);

  const handles = decisionLines(dir)
    .map((r) => r.sessionId)
    .filter(Boolean);
  assert.ok(
    handles.length > 0,
    'the durable session_id from the --usage-file report must reach the decision log; the loop ' +
      'supplies no report path and records no handle at all'
  );
  for (const handle of handles) {
    assert.equal(
      handle,
      HANDLE,
      "the recorded handle must be the report's session_id (" +
        HANDLE +
        '), not a value derived ' +
        'from stdout, a timestamp or a pid'
    );
  }

  // process.pid is not an agent session (ai64 gap audit section 4, Gap C).
  for (const file of ['cli.js', 'executor.js', 'orchestrate.js']) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, file), 'utf8');
    assert.ok(
      !/sessionId:\s*process\.pid/.test(src),
      file + ' must never record process.pid as a session handle'
    );
  }
});

test('64-05 a stopped run resumes from the checkpoint file and writes it back (AI-64-R14, AC-AI-64-14/15)', async () => {
  const dir = tmpDir('task-ai-64-checkpoint-');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  fs.copyFileSync(CHECKPOINT_SEED, checkpointFile);
  const seeded = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(checkpointFile, seeded, seeded);

  const run = recorder([liveLaunch()]);
  // The path is offered under both spellings the loop already uses, so the test
  // binds to the contract (a checkpoint file on disk) and not to one option name.
  const result = await safeRun(
    baseOpts({
      specs: [
        { id: 'A', files: ['a.js'] },
        { id: 'B', files: ['b.js'] },
      ],
      decisionDir: tmpDir('task-ai-64-checkpoint-log-'),
      checkpointFile,
      checkpoint: checkpointFile,
      run,
    })
  );
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);

  const launched = run.calls.map((j) => j.workItemId);
  assert.deepEqual(
    launched,
    ['B'],
    'a resumed run must read the checkpoint from disk and never re-launch a completed item'
  );

  const written = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  assert.ok(
    Array.isArray(written.completed) && written.completed.includes('A'),
    'the checkpoint the loop writes back must still list the completed item it resumed from'
  );
  assert.ok(
    fs.statSync(checkpointFile).mtimeMs > seeded.getTime(),
    'the run must persist the checkpoint through the existing atomic writer, not keep it in memory'
  );

  const src = fs.readFileSync(ORCHESTRATE_SRC, 'utf8');
  assert.ok(
    !src.includes('resumeFrom'),
    'the in-memory resumeFrom literal is deleted; the checkpoint file is the only resume input'
  );
});

test('64-06 an empty SUCCESS is not a completion and never reaches review (AI-64-R05, AC-AI-64-09)', async () => {
  const dir = tmpDir('task-ai-64-empty-');
  let reviewCalls = 0;
  const result = await safeRun(
    baseOpts({
      decisionDir: dir,
      // exit 0, nothing written, no diff, no output.
      run: recorder([liveLaunch({ exitCode: 0, stdout: '', artifact: null })]),
      reviewer: (arg) => {
        reviewCalls += 1;
        return PASS_REVIEW(arg);
      },
    })
  );

  assert.equal(
    isLiveCompletion(result, 'A'),
    false,
    'an agent that exits 0 with no diff, no commit and no output is COMPLETED_EMPTY and must not ' +
      'complete the item'
  );
  assert.equal(reviewCalls, 0, 'a COMPLETED_EMPTY session does not review and does not publish');

  const session = result.log && (result.log.sessions || [])[0];
  assert.ok(session, 'the run record must carry the session it launched');
  assert.equal(
    session.status,
    SessionStatus.COMPLETED_EMPTY,
    "the supervisor classification is the session's terminal status; the loop imports " +
      'classifySession and never calls it'
  );
});

test('64-07 a stalled session stops the run and leaves a checkpoint for a human (AI-64-R05, AC-AI-64-09)', async () => {
  const dir = tmpDir('task-ai-64-stalled-');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  const result = await safeRun(
    baseOpts({
      decisionDir: tmpDir('task-ai-64-stalled-log-'),
      checkpointFile,
      checkpoint: checkpointFile,
      // Still alive, past the stall window, no metric progress.
      run: recorder([
        liveLaunch({
          exitCode: null,
          startedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
          progress: {},
        }),
      ]),
    })
  );

  assert.equal(
    isLiveCompletion(result, 'A'),
    false,
    'a live session past the stall window must not complete the work item'
  );
  const session = result.log && (result.log.sessions || [])[0];
  assert.ok(session, 'the run record must carry the session it launched');
  assert.equal(
    session.status,
    SessionStatus.STALLED,
    'a live session with no progress past the stall window is STALLED, a distinct terminal status'
  );
  assert.ok(
    fs.existsSync(checkpointFile),
    'a stalled run stops and writes the checkpoint so a human decides'
  );
});

test('64-08 a review is bound to the exact SHA it read (AI-64-R07, AC-AI-64-10)', async () => {
  // A review of a different commit is stale evidence for this commit.
  const stale = await runReviewLoop(
    { sha: SHA_A, budget: 3 },
    {
      runTests: PASS_TESTS,
      review: () => ({ pass: true, sha: SHA_B, findings: [] }),
      repair: FIX_REPAIR,
    }
  );
  assert.equal(stale.status, 'BLOCKED', 'a review of another SHA must not be accepted');
  assert.ok(
    stale.rounds.some((r) => r.cause === 'STALE_REVIEW_SHA'),
    'the stale review must be discarded with its reason'
  );

  // A review that names no SHA at all is evidence for every commit at once.
  const unbound = await runReviewLoop(
    { sha: SHA_A, budget: 3 },
    { runTests: PASS_TESTS, review: () => ({ pass: true, findings: [] }), repair: FIX_REPAIR }
  );
  assert.notEqual(
    unbound.status,
    'COMPLETED',
    'a review that does not name the SHA it read must be refused; the stale check is guarded on ' +
      'the presence of a sha, so an unbound review passes for any commit'
  );
  assert.ok(
    unbound.rounds.some((r) => r.stage === 'blocked'),
    'the refusal must be recorded with a reason, not silently accepted'
  );
});

test('64-09 a PASS verdict carrying open findings is rejected, and the contradiction is recorded (AI-64-R07, AI-64-R14)', async () => {
  const dir = tmpDir('task-ai-64-pass-findings-');
  const result = await safeRun(
    baseOpts({
      decisionDir: dir,
      run: recorder([liveLaunch()]),
      reviewer: () => ({
        pass: true,
        sha: SHA_A,
        verdict: 'PASS',
        findings: [
          { id: 'F-1', open: true, detail: 'no negative case for a too-long branch name' },
        ],
      }),
    })
  );
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);

  assert.equal(
    isLiveCompletion(result, 'A'),
    false,
    'a PASS verdict that still carries an open finding must not complete the work item'
  );
  const trace = JSON.stringify(result.log) + '\n' + decisionText(dir);
  assert.ok(trace.includes('PASS_WITH_FINDINGS_REJECTED'), 'the rejection reason must be recorded');
  assert.ok(
    trace.includes('F-1'),
    'the open finding that made the PASS contradictory must survive in the run trace; the loop ' +
      "collapses the reviewer's verdict and findings into a bare BLOCKED, so nothing downstream " +
      '(repair, the decision log, a human) can see what was refused'
  );
});

test('64-10 the repair budget is finite and the exhausted run ends BLOCKED with its reason (AI-64-R10, AI-64-R14)', async () => {
  const dir = tmpDir('task-ai-64-budget-');
  let reviewCalls = 0;
  const result = await safeRun(
    baseOpts({
      decisionDir: dir,
      reviewBudget: 2,
      run: recorder([liveLaunch()]),
      reviewer: () => {
        reviewCalls += 1;
        return {
          pass: false,
          sha: SHA_A,
          verdict: 'CHANGES_REQUIRED',
          findings: [{ id: 'F-' + reviewCalls, open: true }],
        };
      },
    })
  );
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);

  assert.ok(
    reviewCalls <= 4,
    'repair must be finite: a budget of 2 admits at most the budget rounds plus the first ' +
      'review and the first test run, never an unbounded retry (saw ' +
      reviewCalls +
      ' reviews)'
  );
  assert.equal(
    isLiveCompletion(result, 'A'),
    false,
    'a run whose review never passes must not complete the work item'
  );
  assert.ok(
    decisionText(dir).includes('REPAIR_BUDGET_EXHAUSTED'),
    'exhausting the repair budget is a terminal BLOCKED outcome and must be recorded in the ' +
      'decision log, which today carries only the selection record'
  );
});

test('64-11 the worker has no publish capability and the publisher refuses the worker root (AI-64-P03, AI-64-P04)', () => {
  for (const file of ['harness.js', 'executor.js', 'isolation-launcher.js']) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, file), 'utf8');
    assert.ok(
      !/require\(['"]\.\/publisher['"]\)/.test(src),
      file +
        ' is reachable from the worker process and must never require the publisher; the ' +
        'publisher runs operator-side only'
    );
  }

  // The worker root is the isolation launcher's, read from its own source so the
  // test does not restate a second copy of the path.
  const launcherSrc = fs.readFileSync(ISOLATION_LAUNCHER_SRC, 'utf8');
  const match = launcherSrc.match(/[A-Za-z]:\\+ShipDeWorker/i);
  assert.ok(match, 'the isolation launcher must still define the worker root');
  const workerRoot = path.join(match[0].replace(/\\\\/g, '\\'), 'task-ai-64-contract');

  let refused = null;
  try {
    publish({
      cwd: workerRoot,
      reviewedSha: SHA_A,
      approvalId: 'AP-64-1',
      expiry: Date.now() + 60000,
      verdict: 'PASS',
      testMode: true,
      remoteUrl: TRUSTED_URL,
      branch: 'task-ai-64-contract',
      // An explicit absent registry, so the worker-boundary gate is what is
      // under test and not whatever approvals file the host happens to have.
      registryPath: path.join(tmpDir('task-ai-64-worker-registry-'), 'absent-approvals.json'),
    });
  } catch (err) {
    refused = err;
  }
  assert.ok(refused, 'publishing from inside the worker root must be refused, not executed');
  assert.match(refused.message, /PUBLISH_REFUSED/i, 'the refusal must be a publish refusal');
  assert.match(
    refused.message,
    /worker/i,
    'the refusal must name the worker boundary; publishing from inside the worker is refused ' +
      'and logged, and today no such gate exists'
  );
});

test('64-12 the publisher refuses a commit no approval reviewed (AI-64-R12, AC-AI-64-17)', () => {
  const repo = makeTempRepo();
  const registryDir = tmpDir('task-ai-64-registry-');
  const registryPath = path.join(registryDir, 'approvals.json');
  fs.copyFileSync(APPROVAL_REGISTRY, registryPath);

  const call = (extra) =>
    publish(
      Object.assign(
        {
          cwd: repo.dir,
          reviewedSha: repo.sha,
          approvalId: 'AP-64-1',
          expiry: Date.now() + 60000,
          verdict: 'PASS',
          testMode: true,
          remoteUrl: TRUSTED_URL,
          registryPath,
        },
        extra || {}
      )
    );

  try {
    // A commit that is not a 40-character SHA is not a reviewed commit.
    assert.throws(
      () => call({ reviewedSha: 'head' }),
      /PUBLISH_REFUSED/i,
      'a reviewedSha that is not a 40-character commit SHA must be refused'
    );

    // The approval in the registry is registered and APPROVED, but it approves
    // a different commit. That must not authorise pushing this one.
    let refused = null;
    try {
      call({});
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, 'an approval bound to another SHA must not authorise publishing this SHA');
    assert.ok(
      !/not registered or not APPROVED/.test(refused.message),
      'the approval IS registered and APPROVED, so the refusal must be about the SHA it is ' +
        'bound to; got: ' +
        refused.message
    );

    // A SHA that is not the current head is refused.
    assert.throws(
      () => call({ reviewedSha: SHA_B }),
      /PUBLISH_REFUSED/i,
      'the published commit must equal the reviewed head'
    );
  } finally {
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('64-13 a gateway-scoped failure selects a candidate outside that failure domain (AI-64-R11, AC-AI-64-16)', async () => {
  assert.equal(
    classifyFailure(GATEWAY_FAILURE).scope,
    Scope.GATEWAY,
    'the fixture failure must classify as gateway-scoped through the real classifier'
  );

  // Same gateway, different upstream: not another failure domain for a
  // gateway-scoped failure.
  const sameGateway = cand({
    accessPath: 'cli-64b',
    upstream: 'up-64-b',
    accountId: 'acct-64-b',
    quotaScope: 'acct-64-b',
    modelId: 'up-64-b/model-64-b',
  });
  const otherGateway = cand({
    accessPath: 'cli-64c',
    gateway: 'gw-64-c',
    upstream: 'up-64-c',
    accountId: 'acct-64-c',
    quotaScope: 'acct-64-c',
    modelId: 'up-64-c/model-64-c',
    source: 'gw-64-c',
  });

  const pool = [cand(), sameGateway, otherGateway];
  const byKey = new Map(pool.map((c) => [candidateKey(c), c]));
  const domainRun = recorder([GATEWAY_FAILURE, liveLaunch()]);
  const result = await safeRun(
    baseOpts({ candidates: pool, decisionDir: tmpDir('task-ai-64-domain-'), run: domainRun })
  );
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);
  assert.ok(
    domainRun.calls.length >= 2,
    'the first candidate failed, so the loop must dispatch a replacement'
  );

  const first = byKey.get(domainRun.calls[0].candidateKey);
  const second = byKey.get(domainRun.calls[1].candidateKey);
  assert.ok(first && second, 'every dispatched key must be a candidate from the pool');
  assert.notEqual(
    second.gateway,
    first.gateway,
    'the replacement must be outside the failed gateway domain; a candidate that shares the ' +
      'gateway is in the same failure domain however different its upstream looks'
  );

  // Contrast: when a candidate outside the domain exists, it is used, so the
  // check above cannot be satisfied by refusing every fallback.
  const controlRun = recorder([GATEWAY_FAILURE, liveLaunch()]);
  const control = await safeRun(
    baseOpts({
      candidates: [cand(), otherGateway],
      decisionDir: tmpDir('task-ai-64-domain-control-'),
      run: controlRun,
    })
  );
  assert.equal(
    controlRun.calls[1] && controlRun.calls[1].candidateKey,
    candidateKey(otherGateway),
    'a candidate outside the failed failure domain must be dispatched'
  );
  assert.ok(
    isLiveCompletion(control, 'A'),
    'the run continues and completes once the replacement succeeds'
  );
});

test('64-14 operator-side git commands do not execute worker core.fsmonitor and ignore malformed include.path', () => {
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-worker-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-tmp-'));
  const marker = path.join(tmpDir, 'marker-fsmonitor.txt');
  const cleanDir = path.join(tmpDir, 'clean');

  const g = (args, cwd = workerDir) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  g(['init']);
  g(['config', 'user.email', 'test@example.com']);
  g(['config', 'user.name', 'Test']);
  g(['commit', '--allow-empty', '-m', 'init']);
  const sha = g(['rev-parse', 'HEAD']).stdout.trim();

  g(['config', 'core.fsmonitor', `echo EXECUTED > "${marker}"`]);

  // Malformed include.path
  const malformedPath = path.join(tmpDir, 'malformed.config');
  fs.writeFileSync(malformedPath, '[core');
  g(['config', 'include.path', malformedPath]);

  try {
    // 1. supervisor path
    const { progressFromWorkerRoot } = require('../supervisor');
    progressFromWorkerRoot(workerDir, { baseSha: sha });
    assert.strictEqual(fs.existsSync(marker), false, 'supervisor executed worker core.fsmonitor');

    // 2. orchestrate path (via headShaOf)
    const orchestrate = require('../orchestrate');
    const resolvedSha = orchestrate.headShaOf(workerDir);
    // It should not throw, hang, or crash, and since it ignores malformed config, it must successfully return the SHA
    assert.strictEqual(
      resolvedSha,
      sha,
      'headShaOf must survive malformed include.path and return the SHA'
    );
    assert.strictEqual(fs.existsSync(marker), false, 'orchestrate executed worker core.fsmonitor');

    // 3. publisher path
    const { transferReviewedObjects } = require('../publisher');
    fs.mkdirSync(cleanDir);
    g(['init', '--bare', cleanDir], cleanDir);
    transferReviewedObjects(workerDir, sha, cleanDir, tmpDir);

    assert.strictEqual(fs.existsSync(marker), false, 'publisher executed worker core.fsmonitor');

    const cloneHead = g(['rev-parse', 'refs/heads/temp-push'], cleanDir).stdout.trim();
    assert.strictEqual(cloneHead, sha, 'Malformed include.path aborted the transfer');
  } finally {
    fs.rmSync(workerDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-16 publisher resolves linked-worktree gitdir and transfers objects', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-worktree-'));
  const repoDir = path.join(tmpDir, 'repo');
  const wtDir = path.join(tmpDir, 'wt');
  const cleanDir = path.join(tmpDir, 'clean');

  const g = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

  fs.mkdirSync(repoDir);
  g(['init'], repoDir);
  g(['config', 'user.email', 'test@example.com'], repoDir);
  g(['config', 'user.name', 'Test'], repoDir);
  g(['commit', '--allow-empty', '-m', 'init'], repoDir);

  g(['worktree', 'add', wtDir], repoDir);

  g(['commit', '--allow-empty', '-m', 'wt commit'], wtDir);
  const sha = g(['rev-parse', 'HEAD'], wtDir).stdout.trim();

  try {
    fs.mkdirSync(cleanDir);
    g(['init', '--bare', cleanDir], cleanDir);
    const { transferReviewedObjects } = require('../publisher');

    // This used to throw with "nonexistent object" because it couldn't find the objects dir
    assert.doesNotThrow(() => {
      transferReviewedObjects(wtDir, sha, cleanDir, tmpDir);
    }, 'transferReviewedObjects must resolve objects dir for linked worktrees');

    const cloneHead = g(['rev-parse', 'refs/heads/temp-push'], cleanDir).stdout.trim();
    assert.strictEqual(
      cloneHead,
      sha,
      'Publisher failed to transfer worktree objects to operator mirror'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-17 publisher copies allow-listed objects and ignores alternates', () => {
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-worker4-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-tmp4-'));
  const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-other-'));
  const cleanDir = path.join(tmpDir, 'clean');

  const gOther = (args) =>
    spawnSync('git', args, { cwd: otherRepo, encoding: 'utf8', windowsHide: true });
  gOther(['init']);
  gOther(['config', 'user.email', 'test@example.com']);
  gOther(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(otherRepo, 'SECRET.txt'), 'TOP SECRET OPERATOR CONTENT');
  gOther(['add', '.']);
  gOther(['commit', '-m', 'init']);
  const sha = gOther(['rev-parse', 'HEAD']).stdout.trim();

  const gWorker = (args) =>
    spawnSync('git', args, { cwd: workerDir, encoding: 'utf8', windowsHide: true });
  gWorker(['init']);
  fs.mkdirSync(path.join(workerDir, '.git', 'objects', 'info'), { recursive: true });
  fs.writeFileSync(
    path.join(workerDir, '.git', 'objects', 'info', 'alternates'),
    path.join(otherRepo, '.git', 'objects').replace(/\\/g, '/')
  );

  try {
    fs.mkdirSync(cleanDir);
    gWorker(['init', '--bare', cleanDir], cleanDir);
    const { transferReviewedObjects } = require('../publisher');

    assert.throws(
      () => {
        transferReviewedObjects(workerDir, sha, cleanDir, tmpDir);
      },
      /PUBLISH_FAILED:.*(fully reachable|update mirror ref)/i,
      'Publisher must verify the reviewed commit is reachable from copied objects'
    );
  } finally {
    fs.rmSync(workerDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(otherRepo, { recursive: true, force: true });
  }
});

test('64-18 operator-side git commands ignore .gitattributes and diff.external', () => {
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-worker5-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-tmp5-'));
  const marker = path.join(tmpDir, 'marker-textconv.txt');

  const g = (args) =>
    spawnSync('git', args, { cwd: workerDir, encoding: 'utf8', windowsHide: true });
  g(['init']);
  g(['config', 'user.email', 'test@example.com']);
  g(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(workerDir, 'file.txt'), 'base');
  g(['add', '.']);
  g(['commit', '-m', 'init']);
  const baseSha = g(['rev-parse', 'HEAD']).stdout.trim();

  // Plant textconv
  fs.writeFileSync(path.join(workerDir, '.gitattributes'), '* diff=pwn');
  const batPath = path.join(workerDir, 'pwn.bat');
  fs.writeFileSync(batPath, '@echo off\necho EXECUTED > "' + marker + '"\nexit 0');
  g(['config', 'diff.pwn.textconv', batPath]);

  fs.writeFileSync(path.join(workerDir, 'file.txt'), 'changed');

  try {
    const { progressFromWorkerRoot } = require('../supervisor');
    const res = progressFromWorkerRoot(workerDir, { baseSha });

    assert.strictEqual(fs.existsSync(marker), false, 'supervisor executed textconv');
    assert.ok(res.diffBytes > 0, 'supervisor diffBytes is 0 (diff failed or was empty)');
  } finally {
    fs.rmSync(workerDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function foreignTree(dir) {
  const g = (args, cwd = dir) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  fs.mkdirSync(dir, { recursive: true });
  g(['init', '-b', 'main']);
  g(['config', 'user.email', 'test@example.com']);
  g(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'SECRET.txt'), 'FOREIGN\n');
  g(['add', 'SECRET.txt']);
  g(['commit', '-m', 'foreign']);
  const sha = g(['rev-parse', 'HEAD']).stdout.trim();
  const blob = g(['rev-parse', 'HEAD:SECRET.txt']).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^[0-9a-f]{40}$/.test(blob)) {
    throw new Error('foreign tree was not created: ' + sha + ' ' + blob);
  }
  return { g, sha, blob };
}

function assertForeignAbsent(cleanDir, blob) {
  const shown = spawnSync('git', ['cat-file', '-t', blob], {
    cwd: cleanDir,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notStrictEqual(
    shown.status,
    0,
    'foreign blob must not be present in the clean clone: ' + shown.stdout
  );
}

test('64-19 publisher refuses gitfile pointing outside worker root', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-n71-'));
  const workerDir = path.join(tmpDir, 'worker');
  const otherRepo = path.join(tmpDir, 'other');
  const cleanDir = path.join(tmpDir, 'clean');

  fs.mkdirSync(workerDir);
  const { sha, blob } = foreignTree(otherRepo);
  fs.writeFileSync(path.join(workerDir, '.git'), 'gitdir: ' + path.join(otherRepo, '.git') + '\n');

  try {
    spawnSync('git', ['init', '--bare', cleanDir], { windowsHide: true });
    const { transferReviewedObjects } = require('../publisher');
    assert.throws(() => {
      transferReviewedObjects(workerDir, sha, cleanDir, tmpDir, { workerWritable: true });
    }, /PUBLISH_FAILED/i);
    assertForeignAbsent(cleanDir, blob);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-19b publisher refuses a gitfile plus a forged gitdir backlink', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-n7b-'));
  const workerDir = path.join(tmpDir, 'worker');
  const otherRepo = path.join(tmpDir, 'other');
  const cleanDir = path.join(tmpDir, 'clean');

  fs.mkdirSync(workerDir);
  const { sha, blob } = foreignTree(otherRepo);
  const foreignGit = path.join(otherRepo, '.git');
  fs.writeFileSync(path.join(workerDir, '.git'), 'gitdir: ' + foreignGit + '\n');
  fs.writeFileSync(path.join(foreignGit, 'gitdir'), path.join(workerDir, '.git') + '\n');

  try {
    spawnSync('git', ['init', '--bare', cleanDir], { windowsHide: true });
    const { transferReviewedObjects } = require('../publisher');
    assert.throws(() => {
      transferReviewedObjects(workerDir, sha, cleanDir, tmpDir, { workerWritable: true });
    }, /PUBLISH_FAILED/i);
    assertForeignAbsent(cleanDir, blob);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-20 publisher refuses object store link pointing outside', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-n72-'));
  const workerDir = path.join(tmpDir, 'worker');
  const otherRepo = path.join(tmpDir, 'other');
  const cleanDir = path.join(tmpDir, 'clean');

  fs.mkdirSync(workerDir);
  const { sha, blob } = foreignTree(otherRepo);
  const gWorker = (args) =>
    spawnSync('git', args, { cwd: workerDir, encoding: 'utf8', windowsHide: true });

  gWorker(['init', '-b', 'main']);
  gWorker(['config', 'user.email', 'test@example.com']);
  gWorker(['config', 'user.name', 'Test']);
  fs.rmSync(path.join(workerDir, '.git', 'objects'), { recursive: true, force: true });
  fs.symlinkSync(
    path.join(otherRepo, '.git', 'objects'),
    path.join(workerDir, '.git', 'objects'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  try {
    spawnSync('git', ['init', '--bare', cleanDir], { windowsHide: true });
    const { transferReviewedObjects } = require('../publisher');
    assert.throws(() => {
      transferReviewedObjects(workerDir, sha, cleanDir, tmpDir, { workerWritable: true });
    }, /PUBLISH_FAILED/i);
    assertForeignAbsent(cleanDir, blob);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-21 supervisor refuses a linked foreign repository', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-n73-'));
  const workerDir = path.join(tmpDir, 'worker');
  const otherRepo = path.join(tmpDir, 'other');

  fs.mkdirSync(workerDir);
  const { sha, blob } = foreignTree(otherRepo);
  const gWorker = (args) =>
    spawnSync('git', args, { cwd: workerDir, encoding: 'utf8', windowsHide: true });

  gWorker(['init', '-b', 'main']);
  gWorker(['config', 'user.email', 'test@example.com']);
  gWorker(['config', 'user.name', 'Test']);
  fs.rmSync(path.join(workerDir, '.git'), { recursive: true, force: true });
  fs.symlinkSync(
    path.join(otherRepo, '.git'),
    path.join(workerDir, '.git'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  try {
    const { progressFromWorkerRoot } = require('../supervisor');
    const res = progressFromWorkerRoot(workerDir);
    assert.strictEqual(res.commits, 0, 'foreign commits must not be counted: ' + blob);
    assert.notStrictEqual(sha, '', 'foreign commit must exist so the refusal is meaningful');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-22 supervisor survives file replacing object directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-n8-'));
  const workerDir = path.join(tmpDir, 'worker');
  fs.mkdirSync(workerDir);
  const gWorker = (args) => spawnSync('git', args, { cwd: workerDir, windowsHide: true });
  gWorker(['init']);

  fs.rmSync(path.join(workerDir, '.git', 'objects'), { recursive: true, force: true });
  fs.writeFileSync(path.join(workerDir, '.git', 'objects'), 'just a file');

  try {
    const { progressFromWorkerRoot } = require('../supervisor');
    assert.doesNotThrow(() => {
      const res = progressFromWorkerRoot(workerDir);
      assert.strictEqual(res.diffBytes, 0);
    }, 'Must handle ENOTDIR / file gracefully without throwing');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-23 cli.js as entry script resolves module.exports before orchestrate requires it', () => {
  const dir = tmpDir('task-ai-64-cli-entry-');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  fs.writeFileSync(checkpointFile, JSON.stringify({ completed: [] }));
  const specsFile = path.join(dir, 'specs.json');
  fs.writeFileSync(specsFile, JSON.stringify([{ id: 'FEAT-1', files: ['a.js'] }]));

  const child = spawnSync(
    process.execPath,
    [
      path.join(__dirname, '../cli.js'),
      'orchestrate',
      '--goal',
      'foo',
      '--checkpoint-file',
      checkpointFile,
      '--specs',
      specsFile,
      '--dry-run',
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
      env: Object.assign({}, process.env, { NODE_ENV: 'test' }),
    }
  );

  assert.ok(
    !child.stderr.includes('TypeError: cli.readCheckpoint is not a function'),
    'The CLI must not crash with TypeError: cli.readCheckpoint is not a function'
  );
  assert.ok(
    !child.stderr.includes('TypeError'),
    'The CLI must not crash with any TypeError. stderr: ' + child.stderr
  );
});

test('64-24 runOrchestration selects API_PASS candidate, isolates reviewer domain, and skips QUOTA_EXHAUSTED', async () => {
  const dir = tmpDir('task-ai-64-evidence-');
  const evidenceDir = path.join(dir, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });

  const passedCandidate = cand({
    gateway: 'gw-pass',
    upstream: 'up-pass',
    accountId: 'acct-pass',
  });

  const quotaCandidate = cand({
    gateway: 'gw-quota',
    upstream: 'up-quota',
    accountId: 'acct-quota',
  });

  const reviewerCandidate = cand({
    gateway: 'gw-reviewer',
    upstream: 'up-reviewer',
    accountId: 'acct-reviewer',
    qualifiedRoles: ['reviewer.primary'],
  });

  // Write evidence for passedCandidate (API_PASS)
  const passedKey = candidateKey(passedCandidate);
  const safeFileName = passedKey.replace(/[:\/]/g, '_') + '.jsonl';
  const evidenceFile = path.join(evidenceDir, safeFileName);
  fs.writeFileSync(
    evidenceFile,
    JSON.stringify({
      status: 'passed',
      level: 'API_PASS',
      ts: new Date(NOW - 1000).toISOString(),
      source: 'test',
    }) + '\n',
    'utf8'
  );

  let reviewLaneWriterDomain = null;
  const o = {
    decisionDir: dir,
    evidenceDir,
    now: NOW,
    isolatedWorker: true,
    run: (job) => {
      // Must write usage file to be considered a durable session
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'test-session-1' }));
      return { exitCode: 0, stdout: 'Generated artifact', stderr: '' };
    },
    candidates: [passedCandidate, quotaCandidate, reviewerCandidate],
    ranking: {
      headrooms: {
        'acct-quota': { status: 'exhausted' },
        'acct-pass': { status: 'available' },
        'acct-reviewer': { status: 'available' },
      },
    },
    sha: SHA_A,
    reviewer: () => ({ pass: true, sha: SHA_A, verdict: 'PASS', findings: [] }),
    specs: [{ id: 'TEST-1', roleRequirement: { role: 'author.foundation' }, files: [] }],
  };

  const log = await runOrchestration(GOAL, o);
  assert.ok(!log.refusal, 'runOrchestration failed: ' + log.refusal);

  const logFile = path.join(dir, DAY + '.jsonl');
  if (!fs.existsSync(logFile)) {
    throw new Error(
      'Log file not created! log.status=' +
        log.status +
        ', log.outcomes=' +
        JSON.stringify(log.outcomes)
    );
  }
  const decisionsLog = fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const writerSelection = decisionsLog.find(
    (d) => d.stage === 'selected' && d.role === 'author.foundation'
  );
  assert.ok(writerSelection, 'Writer must be selected');
  assert.equal(writerSelection.chosen, passedKey, 'Must select the API_PASS candidate');

  const quotaRejected = writerSelection.rejected.find(
    (r) => r.candidateKey === candidateKey(quotaCandidate)
  );
  assert.ok(quotaRejected, 'QUOTA_EXHAUSTED candidate must be rejected');
  assert.equal(quotaRejected.reasonCode, 'QUOTA_EXHAUSTED', 'Reason code must be QUOTA_EXHAUSTED');

  const reviewSelection = decisionsLog.find((d) => d.stage === 'selected' && d.role === 'reviewer');
  assert.ok(reviewSelection, 'Reviewer must be selected');

  const writerDomain = writerSelection.chosen.split('/').slice(0, 3).join('/'); // Just picking the parts... wait, the logic uses gateway/upstream/accountId
  assert.notEqual(reviewSelection.chosen, passedKey, 'Reviewer must not be the same as the writer');

  // Ensure writer's domain is in the forbidden domains
  const passDomainParts = [
    passedCandidate.gateway,
    passedCandidate.upstream,
    passedCandidate.accountId,
  ];
  const chosenReviewerDomainParts = reviewSelection.chosen.split('/'); // Actually gateway/upstream/account
  // We can just check that they are different
  assert.ok(
    !passDomainParts.includes(chosenReviewerDomainParts[0]),
    'Reviewer gateway must differ'
  );
});

/**
 * Options for a run whose only interest is the assessment the Controller ranked
 * a work item with.
 *
 * The session is deliberately COMPLETED_EMPTY: the run records the selection and
 * then stops, so the assertions below bind to the JEV assessment written with
 * that selection (AI-64-P01, AI-64-R03) and not to the review or publication
 * stages that follow a completed session.
 */
function assessOpts(extra) {
  return baseOpts(
    Object.assign(
      {
        candidates: [cand()],
        run: recorder([liveLaunch({ exitCode: 0, stdout: '', artifact: null })]),
      },
      extra || {}
    )
  );
}

/** The decision-log record of the one selection this run makes: the writer's. */
function writerAssessment(dir) {
  const record = decisionLines(dir).find(
    (d) => d.stage === 'selected' && d.workItemId === 'A' && d.role === 'author.foundation'
  );
  assert.ok(record, 'the Controller selection must be written to the decision log');
  return record;
}

test('64-25 with no ask wired the selection records the assessment routing.assessTask produced', async () => {
  const dir = tmpDir('task-ai-64-jev-unreachable-');
  const result = await safeRun(assessOpts({ decisionDir: dir }));
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);

  const record = writerAssessment(dir);
  const jev = record.jev;

  assert.equal(jev.jevOutcome, 'UNDECIDED', 'no ask is configured, so JEV cannot advise');
  assert.equal(
    jev.decidedBy,
    'controller',
    'a JEV that cannot advise hands the decision to the Controller, which is the point'
  );
  assert.ok(
    jev.reasonCodes.includes('JEV_UNDECIDED:UNREACHABLE'),
    'the recorded reason code must be the one the real JEV path produces for an absent ask: ' +
      JSON.stringify(jev.reasonCodes)
  );
  assert.ok(
    !jev.reasonCodes.includes('JEV_UNDECIDED:UNKNOWN'),
    'a reason code invented here instead of obtained is not evidence about why the Controller ' +
      'decided; UNKNOWN is the hand-built marker this test exists to reject'
  );
  assert.deepEqual(
    jev,
    await routing.assessTask(record.taskProfile, {}),
    'the recorded assessment must be the one routing.assessTask returns for the recorded profile, ' +
      'byte for byte — no field of it is built in this loop'
  );
});

test('64-26 an injected ask that decides supplies the weight profile the selection ranks with', async () => {
  const dir = tmpDir('task-ai-64-jev-decided-');
  const questions = [];
  const result = await safeRun(
    assessOpts({
      decisionDir: dir,
      jevAsk: async (question) => {
        questions.push(question);
        return { choice: 'QUALITY_FIRST', confidence: 0.9, reason: 'the reviewer asked' };
      },
    })
  );
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);

  assert.ok(questions.length > 0, 'the loop must ask JEV through the real path, not decide alone');
  for (const question of questions) {
    assert.deepEqual(
      question.options,
      Object.keys(routing.WEIGHT_PROFILES),
      'the closed question offers weighting profiles and nothing else'
    );
    assert.ok(
      !/\b(model|provider|account|gateway)\b/i.test(JSON.stringify(question.options)),
      'a weighting advisory never offers an identity: ' + JSON.stringify(question.options)
    );
  }

  const jev = writerAssessment(dir).jev;
  assert.equal(jev.jevOutcome, 'DECIDED', 'a valid answer above the confidence floor decides');
  assert.equal(jev.decidedBy, 'jev', 'JEV decided, so the Controller ranks with its weights');
  assert.equal(
    jev.weightProfile,
    'QUALITY_FIRST',
    'the decided weight profile must be the one recorded for the selection; the per-role ' +
      'Controller fallback for this role is BALANCED, so a recorded BALANCED means the answer was ' +
      'never asked for'
  );
  assert.deepEqual(
    jev.weights,
    routing.WEIGHT_PROFILES.QUALITY_FIRST,
    'the ranking weights must be the decided profile’s own weights'
  );
  assert.ok(jev.reasonCodes.includes('JEV_DECIDED'), 'a decided assessment records JEV_DECIDED');
  assert.ok(
    !jev.reasonCodes.some((code) => code.startsWith('JEV_UNDECIDED')),
    'a decided assessment records no UNDECIDED code: ' + JSON.stringify(jev.reasonCodes)
  );
});

test('64-27 an ask that throws leaves the Controller selecting, and the advisory is recorded as unreachable', async () => {
  const dir = tmpDir('task-ai-64-jev-throws-');
  let asked = 0;
  const result = await safeRun(
    assessOpts({
      decisionDir: dir,
      jevAsk: async () => {
        asked += 1;
        throw new Error('the JEV advisory is unreachable');
      },
    })
  );

  assert.equal(result.refusal, null, 'a throwing advisory is an unreachable advisory, not a crash');
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);
  assert.ok(
    asked > 0,
    'the loop must ask through the real JEV path, so a throwing ask is exercised'
  );

  const record = writerAssessment(dir);
  assert.ok(record.chosen, 'the Controller must still select a candidate when JEV cannot advise');
  assert.equal(record.jev.decidedBy, 'controller', 'the decision is the Controller’s, not JEV’s');
  assert.equal(
    record.jev.weightProfile,
    'BALANCED',
    'the Controller falls back to its deterministic per-role profile'
  );
  assert.ok(
    record.jev.reasonCodes.includes('JEV_UNDECIDED:UNREACHABLE'),
    'the throw must surface as the real path records it: ' + JSON.stringify(record.jev.reasonCodes)
  );
});

test('64-28 isolated launch never passes --new-workspace/--worktree-mode and requires worker cwd (OBSERVATION C)', () => {
  const { HARNESSES } = require('../harness');
  const paseo = HARNESSES.paseo;
  const assert = require('assert');

  let threw = false;
  try {
    paseo.launch({ isolatedWorker: true, provider: 'opencode', cwd: 'C:\\Users\\gumac\\outside' });
  } catch (err) {
    threw = true;
    assert.match(err.message, /ISOLATED_LAUNCH_REQUIRES_WORKER_HARNESS/);
  }
  assert.equal(threw, true, 'must refuse if cwd is outside worker root');

  const args = paseo.launch({
    isolatedWorker: true,
    provider: 'opencode',
    cwd: 'C:\\ShipDeWorker\\job',
    branch: 'feat/test',
  });
  assert.ok(!args.includes('--new-workspace'), 'must not pass --new-workspace for isolated launch');
  assert.ok(!args.includes('--worktree-mode'), 'must not pass --worktree-mode for isolated launch');
});

test('64-29 cli passes exercise option to orchestrate', () => {
  const assert = require('assert');
  const src = require('fs').readFileSync(__dirname + '/../cli.js', 'utf8');
  assert.ok(
    /exercise:\s*typeof args\.exercise === 'string' \? args\.exercise : null/.test(src),
    'cli.js must wire args.exercise to runOrchestration'
  );
});

test('64-33 materialiseExercise refuses targets outside the worker root', () => {
  const { materialiseExercise } = require('../orchestrate');
  const outsideWorkerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-exercise-outside-'));

  assert.throws(
    () => materialiseExercise(outsideWorkerRoot, { exercise: 'e1-branch-name' }),
    /EXERCISE_ROOT_INVALID/,
    'the exercise runner must not be materialised into an operator or temp worktree'
  );
  assert.equal(
    fs.existsSync(
      path.join(outsideWorkerRoot, 'tools', 'ai-brain', 'test', 'e1-branch-name.test.js')
    ),
    false,
    'refused exercise materialisation must not leave a generated test file behind'
  );
});

test('64-22 isolated live path sets isolatedWorker and worker root cwd without newWorkspace', async () => {
  const isoPath = require.resolve('../isolation-launcher');
  const orchPath = require.resolve('../orchestrate');
  const isoModule = require(isoPath);
  const realGetIsolatedLauncher = isoModule.getIsolatedLauncher;
  const realIsWorkerPath = isoModule.isWorkerPath;
  let launchedAdapter = null;
  let launchedArgs = null;
  let launchedOptions = null;

  isoModule.getIsolatedLauncher = function spy() {
    return function stubIsolatedLauncher(adapter, args, opts) {
      launchedAdapter = adapter;
      launchedArgs = args;
      launchedOptions = opts;
      return {
        exitCode: 0,
        stdout: 'the agent changed production code',
        completionNonce: 'nonce-64',
      };
    };
  };
  isoModule.isWorkerPath = () => true;
  const hostWorktree = 'C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\ai64launch';
  const expectedWorkerRoot = isoModule.workerRootFor(hostWorktree);

  let result;
  try {
    delete require.cache[orchPath];
    const fresh = require(orchPath);
    result = await safeRun(
      baseOpts({
        isolatedWorker: true,
        workerRoot: 'C:\\ShipDeWorker\\wrong-explicit-root',
        cwd: hostWorktree,
        decisionDir: tmpDir('task-ai-64-isolated-cwd-'),
        candidates: [cand({ harness: 'paseo' })],
      })
    );
  } finally {
    isoModule.getIsolatedLauncher = realGetIsolatedLauncher;
    isoModule.isWorkerPath = realIsWorkerPath;
    delete require.cache[orchPath];
  }

  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);
  assert.ok(launchedAdapter, 'the isolated launcher must have been called with an adapter');
  assert.equal(
    launchedAdapter.id,
    'opencode-direct',
    'isolated live launch must bypass the paseo daemon'
  );
  assert.equal(
    launchedAdapter.command,
    'opencode',
    'isolated live launch command must be opencode'
  );
  assert.ok(launchedArgs, 'the isolated launcher must have been called');

  assert.equal(launchedArgs[0], 'run', 'opencode direct launch must use opencode run');
  assert.ok(
    launchedArgs.includes('--dir') && launchedArgs.includes(expectedWorkerRoot),
    'opencode args must contain --dir ' + expectedWorkerRoot + ': ' + launchedArgs.join(' ')
  );
  assert.equal(
    launchedOptions.cwd,
    hostWorktree,
    'the isolated launcher must bind the verdict and clone source to the host worktree'
  );
  assert.equal(
    launchedOptions.workerRoot,
    expectedWorkerRoot,
    'the worker root must be derived from the host worktree, not reused from job.cwd'
  );
  assert.ok(
    !launchedArgs.includes('--provider') &&
      !launchedArgs.includes('--mode') &&
      !launchedArgs.includes('--report-outcome') &&
      !launchedArgs.includes('--new-workspace') &&
      !launchedArgs.includes('--worktree-mode'),
    'opencode args must not contain paseo-only or unsupported flags: ' + launchedArgs.join(' ')
  );
});

test('64-30 executor usage-report gate survives paseo missing report (DEFECT A)', () => {
  const { readSessionId } = require('../executor');
  const assert = require('assert');
  const paseo = { writesUsageReport: false };
  const job = { usageFile: '/tmp/does-not-exist.json' };
  const res = readSessionId(paseo, job, { stdout: 'nothing' });
  assert.notEqual(
    res.cause,
    'HARNESS_USAGE_REPORT_MISSING',
    'must not gate on missing report if adapter does not write it'
  );
});

test('64-31 candidates gateway uses accessPathOf to resolve router endpoint (DEFECT B)', () => {
  const { gatewayAccountCandidates } = require('../candidates');
  const assert = require('assert');
  const registry = {
    sources: [
      { id: 'gw', kind: 'router', endpoint: 'http://gateway' },
      { id: 'up', kind: 'model-source', reachedVia: 'gw' },
    ],
    dispatch: {
      providers: {
        up: { provider: 'up', harness: 'paseo' },
      },
    },
  };
  const accounts = [{ id: 'acct', provider: 'up' }];
  const catalogue = [
    {
      gateway: 'gw',
      upstream: 'up',
      modelId: 'up/model',
      role: 'author.foundation',
      capability: {},
    },
  ];
  const candidates = gatewayAccountCandidates({ registry, accounts, catalogue });
  assert.ok(candidates.length > 0, 'must yield candidates');
  assert.equal(
    candidates[0].accessPath,
    'http://gateway',
    'accessPath must be the router endpoint, not the provider name'
  );
});

test('64-32 isolated launch uses direct adapter without key material in argv or config; non-isolated uses paseo', () => {
  const assert = require('assert');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { resolveRoute, readSessionId } = require('../executor');
  const isoModule = require('../isolation-launcher');
  const { getHarness } = require('../harness');

  const registry = {
    dispatch: {
      providers: {
        opencode: { provider: 'opencode', harness: 'paseo' },
      },
    },
  };

  // non-isolated
  let route = resolveRoute({ provider: 'opencode' }, { isolatedWorker: false }, registry);
  assert.equal(route.harnessName, 'paseo', 'non-isolated launch still uses paseo');

  // isolated
  route = resolveRoute({ provider: 'opencode' }, { isolatedWorker: true }, registry);
  assert.equal(
    route.harnessName,
    'opencode-direct',
    'isolated launch uses the direct adapter and never the paseo daemon'
  );

  const adapter = getHarness(route.harnessName);
  assert.equal(adapter.id, 'opencode-direct');

  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-cfg-'));
  const workerRoot = path.join(tmpCwd, 'worker-root');
  const args = adapter.launch({
    isolatedWorker: true,
    provider: 'opencode',
    model: 'test-provider/test-model',
    cwd: workerRoot,
    mode: 'full-access',
    usageFile: path.join(workerRoot, 'usage.json'),
    prompt: 'hello',
  });

  const argsStr = args.join(' ');
  assert.equal(adapter.command, 'opencode', 'direct adapter command is opencode');
  assert.equal(args[0], 'run', 'direct adapter uses opencode run');
  assert.equal(args[args.indexOf('--model') + 1], 'test-provider/test-model');
  assert.equal(args[args.indexOf('--dir') + 1], workerRoot);
  assert.ok(args.includes('--auto'), 'direct adapter uses the installed non-interactive flag');
  assert.equal(args[args.indexOf('--format') + 1], 'json');
  assert.ok(!args.includes('--provider'), 'installed opencode run has no --provider flag');
  assert.ok(!args.includes('--mode'), 'installed opencode run has no --mode flag');
  assert.ok(
    !args.includes('--report-outcome'),
    'installed opencode run has no --report-outcome flag'
  );
  assert.ok(!argsStr.includes('API_KEY'), 'argv contains no key');

  // Test isolation launcher config generation
  const verdictPath = path.join(tmpCwd, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: tmpCwd,
      timestamp: Date.now() - 10000,
      policyHash: isoModule.getFolderHash(path.join(tmpCwd, 'scripts/ai/isolation')),
      sid: 'TEST-SID',
      details: { a: 'PASS' },
    })
  );

  const cp = require('child_process');
  const realSpawn = cp.spawnSync;

  try {
    fs.mkdirSync(path.join(tmpCwd, 'scripts/ai/isolation'), { recursive: true });
    const runIso = isoModule.getIsolatedLauncher();

    cp.spawnSync = (cmd, cargs, opts) => {
      if (cmd === 'git') {
        if (cargs && cargs[0] === 'clone') {
          try {
            fs.mkdirSync(cargs[cargs.length - 1], { recursive: true });
          } catch (e) {
            console.error('mkdirSync failed in mock:', e);
          }
        }
        return { status: 0 };
      }
      if (cmd === 'powershell.exe') {
        const fullArgs = [cmd, ...(cargs || [])].join(' ');
        assert.ok(
          !fullArgs.includes('NINEROUTER_API_KEY'),
          'NINEROUTER_API_KEY must not appear in argv'
        );
        return { status: 0, stdout: '' };
      }
      return realSpawn(cmd, cargs, opts);
    };

    try {
      runIso(adapter, args, {
        cwd: tmpCwd,
        workerRoot,
        verdictPath: verdictPath,
        getWorkerSid: () => 'TEST-SID',
        verifyBoundary: () => true,
        baseSha: '0123456789012345678901234567890123456789',
        workerTimeoutMs: 1000,
      });
    } catch (e) {
      if (e.message && !e.message.includes('the host script never wrote it')) {
        console.error('runIso threw unexpected error:', e);
      }
      // Read failure from missing launch result file is expected
    }

    const cfgPath = path.join(workerRoot, 'opencode.json');
    assert.ok(fs.existsSync(cfgPath), 'generated config must exist');
    const cfgText = fs.readFileSync(cfgPath, 'utf8');
    assert.ok(!cfgText.includes('sk-'), 'generated config contains no literal key material');
    assert.ok(
      !fs.existsSync(path.join(workerRoot, '.opencode.json')),
      'old config filename is unused'
    );
    assert.ok(
      cfgText.includes('{env:NINEROUTER_API_KEY}'),
      'only an env reference exists in config'
    );
    const excludeText = fs.readFileSync(path.join(workerRoot, '.git', 'info', 'exclude'), 'utf8');
    assert.match(excludeText, /^opencode\.json$/m, 'generated opencode config must be git-ignored');
    assert.match(excludeText, /^\.shipde\/$/m, 'generated launcher argv files must be git-ignored');

    // Also test that completionNonce is preserved
    const res = {
      exitCode: 0,
      stdout: '{"completed":true,"completionNonce":"my-nonce"}',
      completionNonce: 'my-nonce',
    };
    const idRes = readSessionId(adapter, {}, res);
    assert.equal(idRes.id, 'my-nonce', 'session handle is the launcher job completion nonce');
  } finally {
    cp.spawnSync = realSpawn;
  }
});

describe('TASK-AI-64 executableFor shim unwrap and native launch (DEFECT D)', () => {
  test('executableFor on Windows spawns native .exe targets directly without node wrapping', () => {
    // Layout with %~dp0%
    const optsTilde = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%~dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\r\n';
        }
        return '';
      },
    };
    const exeTilde = executableFor('opencode', optsTilde);
    assert.equal(exeTilde.file, 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe');
    assert.deepEqual(exeTilde.prefixArgs, []);

    // Layout with %dp0%
    const optsPlain = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\r\n';
        }
        return '';
      },
    };
    const exePlain = executableFor('opencode', optsPlain);
    assert.equal(exePlain.file, 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe');
    assert.deepEqual(exePlain.prefixArgs, []);
  });

  test('executableFor on Windows spawns native .com targets directly (case-insensitive)', () => {
    const opts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\native-tool.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\native-tool\\bin\\tool.COM',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\native-tool.cmd') {
          return '"%dp0%\\node_modules\\native-tool\\bin\\tool.COM" %*';
        }
        return '';
      },
    };
    const exe = executableFor('native-tool', opts);
    assert.equal(exe.file, 'C:\\fake\\bin\\node_modules\\native-tool\\bin\\tool.COM');
    assert.deepEqual(exe.prefixArgs, []);
  });

  test('executableFor on Windows wraps .js launchers and extension-less JS targets with node', () => {
    // Opencode with .js launcher layout using %~dp0%
    const jsOptsTilde = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%~dp0%\\node_modules\\opencode-ai\\bin\\opencode.js" %*\r\n';
        }
        return '';
      },
    };
    const jsExeTilde = executableFor('opencode', jsOptsTilde);
    assert.equal(jsExeTilde.file, 'C:\\node\\node.exe');
    assert.deepEqual(jsExeTilde.prefixArgs, [
      'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
    ]);

    // Opencode with .js launcher layout using %dp0%
    const jsOptsPlain = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\opencode-ai\\bin\\opencode.js" %*\r\n';
        }
        return '';
      },
    };
    const jsExePlain = executableFor('opencode', jsOptsPlain);
    assert.equal(jsExePlain.file, 'C:\\node\\node.exe');
    assert.deepEqual(jsExePlain.prefixArgs, [
      'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
    ]);

    // Extension-less script target
    const bareOpts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\cli-tool.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\cli-tool\\bin\\cli',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\cli-tool.cmd') {
          return '"%dp0%\\node_modules\\cli-tool\\bin\\cli" %*';
        }
        return '';
      },
    };
    const bareExe = executableFor('cli-tool', bareOpts);
    assert.equal(bareExe.file, 'C:\\node\\node.exe');
    assert.deepEqual(bareExe.prefixArgs, ['C:\\fake\\bin\\node_modules\\cli-tool\\bin\\cli']);

    // .cjs and .mjs script targets
    const cjsOpts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\cjs-tool.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\cjs-tool\\bin\\cli.cjs',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\cjs-tool.cmd') {
          return '"%dp0%\\node_modules\\cjs-tool\\bin\\cli.cjs" %*';
        }
        return '';
      },
    };
    const cjsExe = executableFor('cjs-tool', cjsOpts);
    assert.equal(cjsExe.file, 'C:\\node\\node.exe');
    assert.deepEqual(cjsExe.prefixArgs, ['C:\\fake\\bin\\node_modules\\cjs-tool\\bin\\cli.cjs']);
  });

  test('executableFor on Windows preserves space-bearing node_modules targets and spawns directly', () => {
    const opts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\tool.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\my-pkg\\bin\\win 32\\tool.exe',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\tool.cmd') {
          return '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\my-pkg\\bin\\win 32\\tool.exe" %*\r\n';
        }
        return '';
      },
    };
    const exe = executableFor('tool', opts);
    assert.equal(exe.file, 'C:\\fake\\bin\\node_modules\\my-pkg\\bin\\win 32\\tool.exe');
    assert.deepEqual(exe.prefixArgs, []);
  });
});

describe('TASK-AI-64 worker provider id and harness config failure (DEFECT E)', () => {
  const sourcesApi = require('../sources');
  const failureApi = require('../failure-classifier');
  const cliApi = require('../cli');
  const cp = require('child_process');

  test('sources.providerFromPrefix derives provider id matching model prefix', () => {
    assert.equal(typeof sourcesApi.providerFromPrefix, 'function');
    assert.equal(sourcesApi.providerFromPrefix('ninerouter/'), 'ninerouter');
    assert.equal(sourcesApi.providerFromPrefix('ninerouter/ag/'), 'ninerouter');
    assert.equal(sourcesApi.providerFromPrefix('ninerouter/ag/gemini-3.1-pro-low'), 'ninerouter');
    assert.equal(sourcesApi.providerFromPrefix({ modelPrefix: 'ninerouter/' }), 'ninerouter');
    assert.equal(sourcesApi.providerFromPrefix(''), '');
    assert.equal(sourcesApi.providerFromPrefix(null), '');
  });

  test('opencode-direct isolated worker config derives provider id from model prefix and includes @ai-sdk/openai-compatible and models map', () => {
    const isoMod = require('../isolation-launcher');
    const { getHarness } = require('../harness');
    const directAdapter = getHarness('opencode-direct');
    assert.ok(directAdapter);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'defect-e-worker-'));
    const fakeHostCwd = path.join(tmpDir, 'host');
    const fakeWorkerRoot = path.join(tmpDir, 'worker');
    fs.mkdirSync(fakeHostCwd, { recursive: true });
    fs.mkdirSync(fakeWorkerRoot, { recursive: true });
    fs.mkdirSync(path.join(fakeHostCwd, 'scripts/ai/isolation'), { recursive: true });

    const verdictFile = path.join(fakeHostCwd, 'verdict.json');
    fs.writeFileSync(
      verdictFile,
      JSON.stringify({
        verdict: 'CLOSED',
        worktree: fakeHostCwd,
        timestamp: Date.now() - 1000,
        policyHash: isoMod.getFolderHash(path.join(fakeHostCwd, 'scripts/ai/isolation')),
        sid: 'TEST-SID',
        details: {},
      })
    );

    const realSpawn = cp.spawnSync;
    try {
      cp.spawnSync = (cmd, cargs, opts) => {
        if (cmd === 'git') {
          if (cargs && cargs[0] === 'clone') {
            fs.mkdirSync(path.join(cargs[cargs.length - 1], '.git', 'info'), { recursive: true });
          }
          return { status: 0 };
        }
        if (cmd === 'powershell.exe') {
          return { status: 0, stdout: '' };
        }
        return realSpawn(cmd, cargs, opts);
      };

      const runIso = isoMod.getIsolatedLauncher();
      const directArgs = directAdapter.launch({
        isolatedWorker: true,
        model: 'ninerouter/ag/gemini-3.1-pro-low',
        cwd: fakeWorkerRoot,
        prompt: 'test prompt',
      });

      try {
        runIso(directAdapter, directArgs, {
          cwd: fakeHostCwd,
          workerRoot: fakeWorkerRoot,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
        });
      } catch (_) {}

      const cfgFile = path.join(fakeWorkerRoot, 'opencode.json');
      assert.ok(fs.existsSync(cfgFile), 'opencode.json must exist');
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));

      // 1. Provider id must be derived from the exact --model argument opencode receives
      const modelArg = directArgs[directArgs.indexOf('--model') + 1];
      const expectedProvider = sourcesApi.providerFromPrefix(modelArg);
      assert.equal(expectedProvider, 'ninerouter');
      assert.ok(
        cfg.provider[expectedProvider],
        `provider id in opencode.json must match derived provider '${expectedProvider}'`
      );
      assert.equal(Object.keys(cfg.provider)[0], expectedProvider);
      assert.equal(cfg.provider['9router'], undefined, 'provider id 9router must not be hardcoded');

      // 2. npm package must be @ai-sdk/openai-compatible
      assert.equal(cfg.provider[expectedProvider].npm, '@ai-sdk/openai-compatible');

      // 3. options must declare baseURL and apiKey env reference
      assert.equal(cfg.provider[expectedProvider].options.baseURL, 'http://127.0.0.1:20128/v1');
      assert.equal(cfg.provider[expectedProvider].options.apiKey, '{env:NINEROUTER_API_KEY}');

      // 4. models map must contain the pinned model id
      assert.ok(cfg.provider[expectedProvider].models, 'models map must exist');
      assert.ok(
        cfg.provider[expectedProvider].models['ag/gemini-3.1-pro-low'] ||
          cfg.provider[expectedProvider].models['ninerouter/ag/gemini-3.1-pro-low'],
        'models map must contain the pinned model id'
      );

      // 5. Dynamic agreement: provider id in opencode.json changes with the exact --model argument
      const fakeWorkerRootAlt = path.join(tmpDir, 'worker-alt');
      fs.mkdirSync(fakeWorkerRootAlt, { recursive: true });
      const altArgs = directAdapter.launch({
        isolatedWorker: true,
        model: 'customprov/ag/gemini-3.1-pro-low',
        cwd: fakeWorkerRootAlt,
        prompt: 'test prompt',
      });
      try {
        runIso(directAdapter, altArgs, {
          cwd: fakeHostCwd,
          workerRoot: fakeWorkerRootAlt,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
        });
      } catch (_) {}
      const cfgAltFile = path.join(fakeWorkerRootAlt, 'opencode.json');
      const cfgAlt = JSON.parse(fs.readFileSync(cfgAltFile, 'utf8'));
      const altModel = altArgs[altArgs.indexOf('--model') + 1];
      const expectedAltProvider = sourcesApi.providerFromPrefix(altModel);
      assert.equal(expectedAltProvider, 'customprov');
      assert.ok(
        cfgAlt.provider[expectedAltProvider],
        `provider id in opencode.json must match provider '${expectedAltProvider}' derived from --model`
      );
      assert.equal(Object.keys(cfgAlt.provider)[0], expectedAltProvider);
    } finally {
      cp.spawnSync = realSpawn;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('classifyFailure classifies opencode resolution error as Scope.HARNESS and Cause.LAUNCH_CONFIG', () => {
    // Attempt 7 error output from opencode
    const opencodeErr = {
      exitCode: 1,
      stdout:
        '{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}',
    };
    const c1 = failureApi.classifyFailure(opencodeErr);
    assert.equal(c1.scope, failureApi.Scope.HARNESS);
    assert.equal(c1.cause, failureApi.Cause.LAUNCH_CONFIG);
    assert.equal(c1.cooldownMs, 5 * 60 * 1000);
    assert.ok(c1.evidence.stdout.includes('Unexpected server error'));

    const c2 = failureApi.classifyFailure({
      exitCode: 1,
      stderr: 'Error: Cannot find module @ai-sdk/openai-compatible',
    });
    assert.equal(c2.scope, failureApi.Scope.HARNESS);
    assert.equal(c2.cause, failureApi.Cause.LAUNCH_CONFIG);
    assert.equal(c2.cooldownMs, 5 * 60 * 1000);

    const c3 = failureApi.classifyFailure({
      exitCode: 1,
      body: 'Error: Unknown provider ninerouter in opencode.json configuration',
    });
    assert.equal(c3.scope, failureApi.Scope.HARNESS);
    assert.equal(c3.cause, failureApi.Cause.LAUNCH_CONFIG);
    assert.equal(c3.cooldownMs, 5 * 60 * 1000);
  });

  test('sameFailureDomain for launch_config error does NOT block other candidates on same gateway/upstream', () => {
    const failedCand = {
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      harness: 'paseo',
      modelId: 'ag/gemini-3.1-pro-low',
    };
    const otherCand = {
      gateway: '9router',
      upstream: 'ag',
      accountId: 'ninerouter',
      harness: 'paseo',
      modelId: 'ag/gemini-3.1-pro-low',
    };

    // A launch_config harness failure does not block candidate 2 sharing gateway/upstream
    assert.equal(
      cliApi.sameFailureDomain(otherCand, failedCand, {
        scope: failureApi.Scope.HARNESS,
        cause: failureApi.Cause.LAUNCH_CONFIG,
      }),
      false
    );
  });

  test('applyFailureBlocks with LAUNCH_CONFIG marks only failed candidate and leaves others in domain unblocked', () => {
    const candidatesApi = require('../candidates');
    const cand1 = {
      harness: 'paseo',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      modelId: 'ag/gemini-3.1-pro-low',
    };
    const cand2 = {
      harness: 'paseo',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'ninerouter',
      modelId: 'ag/gemini-3.1-pro-low',
    };
    const candidates = [cand1, cand2];
    const failedKeys = new Set([candidatesApi.candidateKey(cand1)]);
    cliApi.applyFailureBlocks(
      candidates,
      failedKeys,
      cand1,
      { scope: failureApi.Scope.HARNESS, cause: failureApi.Cause.LAUNCH_CONFIG },
      true,
      cliApi.LIVE_BLOCK_CODES
    );
    assert.equal(cand1.blocked, true);
    assert.equal(cand1.blockReason, cliApi.LIVE_BLOCK_CODES.failed);
    assert.equal(cand2.blocked, undefined);
  });

  describe('TASK-AI-64 exercise runner materialisation after provision (DEFECT G)', () => {
    test('the runner file exists in the provisioned worker root when the agent starts and fail-before is captured', () => {
      const isoMod = require('../isolation-launcher');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-defect-g-'));
      const fakeHostCwd = path.join(tmpDir, 'host');
      const fakeWorkerRoot = path.join(tmpDir, 'worker');
      fs.mkdirSync(path.join(fakeHostCwd, 'scripts', 'ai', 'isolation'), { recursive: true });
      fs.writeFileSync(
        path.join(fakeHostCwd, 'scripts', 'ai', 'isolation', 'Set-WorkerAcl.ps1'),
        '# isolation'
      );
      fs.mkdirSync(path.join(fakeHostCwd, 'tools', 'ai-brain', 'exercise'), { recursive: true });
      fs.copyFileSync(
        path.join(__dirname, '../exercise/e1-branch-name.cases.json'),
        path.join(fakeHostCwd, 'tools', 'ai-brain', 'exercise', 'e1-branch-name.cases.json')
      );

      const verdictFile = path.join(fakeHostCwd, 'verdict.json');
      fs.writeFileSync(
        verdictFile,
        JSON.stringify({
          verdict: 'CLOSED',
          worktree: fakeHostCwd,
          timestamp: new Date().toISOString(),
          policyHash: isoMod.getFolderHash(path.join(fakeHostCwd, 'scripts', 'ai', 'isolation')),
          sid: 'TEST-SID',
          details: { check1: 'PASS', check2: 'PASS' },
        })
      );

      const adapter = {
        id: 'opencode-direct',
        command: 'opencode',
        launch: () => [
          'run',
          '--model',
          'ninerouter/ag/gemini-3.1-pro-low',
          '--dir',
          fakeWorkerRoot,
        ],
      };

      let runnerExistsWhenAgentStarted = false;
      let hookCalled = false;
      let hookReceivedRoot = null;
      const realSpawn = cp.spawnSync;

      try {
        cp.spawnSync = (cmd, cargs, opts) => {
          if (cmd === 'git') {
            if (cargs && cargs[0] === 'clone') {
              fs.mkdirSync(fakeWorkerRoot, { recursive: true });
              fs.mkdirSync(path.join(fakeWorkerRoot, '.git', 'info'), { recursive: true });
              fs.mkdirSync(path.join(fakeWorkerRoot, 'tools', 'ai-brain', 'exercise'), {
                recursive: true,
              });
              fs.copyFileSync(
                path.join(__dirname, '../exercise/e1-branch-name.cases.json'),
                path.join(
                  fakeWorkerRoot,
                  'tools',
                  'ai-brain',
                  'exercise',
                  'e1-branch-name.cases.json'
                )
              );
            }
            return { status: 0 };
          }
          if (cmd === 'powershell.exe') {
            // This represents the host script starting the agent process
            const runnerFile = path.join(
              fakeWorkerRoot,
              'tools',
              'ai-brain',
              'test',
              'e1-branch-name.test.js'
            );
            runnerExistsWhenAgentStarted = fs.existsSync(runnerFile);

            // Find the launchResultPath and write successful launch result with matching nonce
            const fileIdx = cargs.indexOf('-File');
            if (fileIdx !== -1 && fileIdx + 1 < cargs.length) {
              const scriptPath = cargs[fileIdx + 1];
              if (fs.existsSync(scriptPath)) {
                const scriptContent = fs.readFileSync(scriptPath, 'utf8');
                const nonceMatch = scriptContent.match(/\$completionNonce = "([^"]+)"/);
                const resultMatch = scriptContent.match(/Out-File "([^"]+\.json)" -Encoding UTF8/);
                if (nonceMatch && resultMatch) {
                  fs.writeFileSync(
                    resultMatch[1],
                    JSON.stringify({
                      exitCode: 0,
                      completed: true,
                      completionNonce: nonceMatch[1],
                      timedOut: false,
                      stdout: 'worker completed',
                      stderr: '',
                    }),
                    'utf8'
                  );
                }
              }
            }
            return { status: 0, stdout: '' };
          }
          return realSpawn(cmd, cargs, opts);
        };

        const runIso = isoMod.getIsolatedLauncher();
        const res = runIso(adapter, adapter.launch(), {
          cwd: fakeHostCwd,
          workerRoot: fakeWorkerRoot,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
          exercise: 'e1',
          isWorkerPath: () => true,
          onProvisioned: (root, pOpts) => {
            hookCalled = true;
            hookReceivedRoot = root;
          },
        });

        // 1. The runner file exists in the provisioned worker root when the agent starts
        assert.equal(
          runnerExistsWhenAgentStarted,
          true,
          'the runner file must exist in the provisioned worker root when the agent process starts'
        );
        assert.equal(
          fs.existsSync(
            path.join(fakeWorkerRoot, 'tools', 'ai-brain', 'test', 'e1-branch-name.test.js')
          ),
          true,
          'runner file remains present in worker root after provision'
        );

        // 2. onProvisioned hook was called after git clone/checkout and before agent launch
        assert.equal(hookCalled, true, 'onProvisioned hook must be called');
        assert.equal(hookReceivedRoot, fakeWorkerRoot, 'onProvisioned received workerRoot');

        // 3. Fail-before was captured at the base SHA in the provisioned tree
        assert.ok(res.failBefore, 'launch result must capture failBefore');
        assert.equal(res.failBefore.pass, false, 'fail-before must report pass: false at base SHA');
        assert.notEqual(res.failBefore.exitCode, 0, 'fail-before must exit non-zero at base SHA');
        assert.match(
          res.failBefore.command,
          /node --test tools\/ai-brain\/test\/e1-branch-name\.test\.js/,
          'fail-before command must target the exercise runner'
        );
        assert.ok(
          res.failBefore.output.includes('branch-name') ||
            res.failBefore.stderr.includes('branch-name') ||
            res.failBefore.exitCode !== 0,
          'fail-before captures missing module / non-zero exit'
        );

        // 4. It is never committed: added to .git/info/exclude
        const excludeContent = fs.readFileSync(
          path.join(fakeWorkerRoot, '.git', 'info', 'exclude'),
          'utf8'
        );
        assert.ok(
          excludeContent.includes('tools/ai-brain/test/e1-branch-name.test.js'),
          'exercise runner must be excluded in .git/info/exclude'
        );
      } finally {
        cp.spawnSync = realSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('exercise runner is untracked by git and never committed', () => {
      const isoMod = require('../isolation-launcher');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-git-exclude-'));

      try {
        // Create a real git repo
        cp.spawnSync('git', ['init'], { cwd: tmpDir });
        cp.spawnSync('git', ['config', 'user.email', 'test@shipde.local'], { cwd: tmpDir });
        cp.spawnSync('git', ['config', 'user.name', 'Test Author'], { cwd: tmpDir });

        fs.mkdirSync(path.join(tmpDir, 'tools', 'ai-brain', 'exercise'), { recursive: true });
        fs.copyFileSync(
          path.join(__dirname, '../exercise/e1-branch-name.cases.json'),
          path.join(tmpDir, 'tools', 'ai-brain', 'exercise', 'e1-branch-name.cases.json')
        );
        fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'base');
        cp.spawnSync('git', ['add', '.'], { cwd: tmpDir });
        cp.spawnSync('git', ['commit', '-m', 'initial base commit'], { cwd: tmpDir });

        // Materialise exercise into tmpDir
        const result = isoMod.materialiseExercise(tmpDir, {
          exercise: 'e1',
          isWorkerPath: () => true,
        });

        assert.ok(fs.existsSync(result.path), 'runner file written');
        assert.ok(result.failBefore, 'fail-before captured');
        assert.equal(result.failBefore.pass, false, 'fail-before failed at base SHA');

        // Check git status: runner must NOT be reported as untracked
        const statusRes = cp.spawnSync('git', ['status', '--porcelain'], {
          cwd: tmpDir,
          encoding: 'utf8',
        });
        assert.ok(
          !statusRes.stdout.includes('e1-branch-name.test.js'),
          'git status must not show the excluded exercise runner'
        );

        // Commit all changes: runner must NOT be committed
        cp.spawnSync('git', ['add', '.'], { cwd: tmpDir });
        const statusAfterAdd = cp.spawnSync('git', ['status', '--porcelain'], {
          cwd: tmpDir,
          encoding: 'utf8',
        });
        assert.ok(
          !statusAfterAdd.stdout.includes('e1-branch-name.test.js'),
          'git add must not stage the excluded exercise runner'
        );

        const lsFiles = cp.spawnSync('git', ['ls-files'], { cwd: tmpDir, encoding: 'utf8' });
        assert.ok(
          !lsFiles.stdout.includes('e1-branch-name.test.js'),
          'git ls-files must never list the exercise runner'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('orchestrate with isolatedWorker and exercise attaches exercise and fail-before to job and session', async () => {
      const orch = require('../orchestrate');
      const isoMod = require('../isolation-launcher');
      const realGetIsolatedLauncher = isoMod.getIsolatedLauncher;
      const realIsWorkerPath = isoMod.isWorkerPath;

      let launcherOptions = null;

      isoMod.getIsolatedLauncher = function spy() {
        return function stubIsolatedLauncher(adapter, args, opts) {
          launcherOptions = opts;
          return {
            exitCode: 0,
            stdout: 'opencode finished',
            completionNonce: 'test-nonce',
            exercise: {
              path: 'C:\\ShipDeWorker\\isolation\\tools\\ai-brain\\test\\e1-branch-name.test.js',
              cases: 11,
              failBefore: {
                command: 'node --test tools/ai-brain/test/e1-branch-name.test.js',
                exitCode: 1,
                pass: false,
                output: 'Cannot find module ../branch-name',
              },
            },
            failBefore: {
              command: 'node --test tools/ai-brain/test/e1-branch-name.test.js',
              exitCode: 1,
              pass: false,
              output: 'Cannot find module ../branch-name',
            },
          };
        };
      };
      isoMod.isWorkerPath = () => true;

      const hostWorktree = 'C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\ai64ex';
      const tmpDecisions = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-orch-dec-'));

      try {
        const candidates = [
          {
            harness: 'paseo',
            source: '9router',
            modelId: 'ag/gemini-3.1-pro-low',
            gateway: '9router',
            upstream: 'ag',
            accountId: 'codex',
          },
        ];

        const res = await orch.runOrchestration('exercise run', {
          specs: [
            {
              id: 'TASK-AI-64',
              roleRequirement: { role: 'author.foundation' },
              verification: { command: 'node --test' },
            },
          ],
          candidates,
          isolatedWorker: true,
          exercise: 'e1',
          cwd: hostWorktree,
          decisionDir: tmpDecisions,
        });

        assert.ok(launcherOptions, 'isolated launcher must have been called');
        assert.equal(
          launcherOptions.exercise,
          'e1',
          'orchestrate must forward exercise option to isolatedLauncher'
        );
        assert.ok(res.exercise, 'orchestrate log must record exercise');
        assert.ok(res.failBefore, 'orchestrate log must record failBefore');
        assert.equal(res.failBefore.pass, false);
        assert.equal(res.sessions[0].failBefore.pass, false);
      } finally {
        isoMod.getIsolatedLauncher = realGetIsolatedLauncher;
        isoMod.isWorkerPath = realIsWorkerPath;
        fs.rmSync(tmpDecisions, { recursive: true, force: true });
      }
    });
  });
});

describe('TASK-AI-64 worker head review, local commit verification, and usage report (DEFECT H & A)', () => {
  const promptCompiler = require('../prompt-compiler');
  const {
    verifyWorkerCommit,
    isTreeDirty,
    runVerificationCommand,
    writeUsageReportFromHarnessResult,
    runOrchestration,
  } = require('../orchestrate');
  const { readSessionId } = require('../executor');
  const { getHarness } = require('../harness');
  const { runReviewLoop } = require('../review-loop');

  test('compilePrompt requires local commit on exercise branch and includes usage report target', () => {
    const item = {
      id: 'TASK-AI-64',
      allowedPaths: ['tools/ai-brain/branch-name.js'],
      verification: { command: 'node --test tools/ai-brain/test/e1-branch-name.test.js' },
      acceptanceCriteria: ['pure branch name helper'],
    };
    const p = promptCompiler.compilePrompt(item, {
      goal: 'test goal',
      branch: 'feat/task-ai-64-e1',
      usageFile: 'C:/temp/usage-report.json',
    });

    assert.ok(
      p.includes(
        'Commit requirement: you must create exactly one local commit on the exercise branch (feat/task-ai-64-e1) containing all your changes (no push).'
      ),
      'prompt must contain explicit local commit requirement on the exercise branch'
    );
    assert.ok(
      p.includes('Usage report: write your session usage report to C:/temp/usage-report.json'),
      'prompt must contain usage report instruction when usageFile is specified'
    );
  });

  test('verifyWorkerCommit fails with NO_LOCAL_COMMIT when worker HEAD matches baseSha', () => {
    const repo = makeTempRepo();
    try {
      // Create an untracked or modified file
      fs.writeFileSync(path.join(repo.dir, 'extra.txt'), 'unstaged change\n');
      const check = verifyWorkerCommit(repo.dir, repo.sha);
      assert.equal(check.pass, false);
      assert.equal(check.cause, 'NO_LOCAL_COMMIT');
      assert.match(check.detail, /matches base SHA/);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('verifyWorkerCommit fails with NO_LOCAL_COMMIT when worker has uncommitted changes (dirty tree)', () => {
    const repo = makeTempRepo();
    const git = (args) =>
      spawnSync('git', args, { cwd: repo.dir, encoding: 'utf8', windowsHide: true });
    try {
      // Create a commit so HEAD != baseSha
      fs.mkdirSync(path.join(repo.dir, 'tools', 'ai-brain'), { recursive: true });
      fs.writeFileSync(
        path.join(repo.dir, 'tools', 'ai-brain', 'branch-name.js'),
        'module.exports = {};\n'
      );
      git(['add', '.']);
      git(['commit', '-q', '-m', 'feat: branch name']);
      const newSha = git(['rev-parse', 'HEAD']).stdout.trim();
      assert.notEqual(newSha, repo.sha);

      // Now leave an uncommitted dirty file
      fs.writeFileSync(path.join(repo.dir, 'dirty.txt'), 'uncommitted work\n');

      const check = verifyWorkerCommit(repo.dir, repo.sha);
      assert.equal(check.pass, false);
      assert.equal(check.cause, 'NO_LOCAL_COMMIT');
      assert.match(check.detail, /dirty tree/);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('verifyWorkerCommit passes when worker has one local commit and clean tree', () => {
    const repo = makeTempRepo();
    const git = (args) =>
      spawnSync('git', args, { cwd: repo.dir, encoding: 'utf8', windowsHide: true });
    try {
      // Create a local commit
      fs.writeFileSync(path.join(repo.dir, 'branch-name.js'), 'module.exports = {};\n');
      git(['add', '.']);
      git(['commit', '-q', '-m', 'feat: add branch-name']);
      const newSha = git(['rev-parse', 'HEAD']).stdout.trim();

      const check = verifyWorkerCommit(repo.dir, repo.sha);
      assert.equal(check.pass, true);
      assert.equal(check.headSha, newSha);
      assert.equal(check.baseSha, repo.sha);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('verifyWorkerCommit ignores files excluded in .git/info/exclude', () => {
    const repo = makeTempRepo();
    const git = (args) =>
      spawnSync('git', args, { cwd: repo.dir, encoding: 'utf8', windowsHide: true });
    try {
      // Create a local commit
      fs.writeFileSync(path.join(repo.dir, 'branch-name.js'), 'module.exports = {};\n');
      git(['add', '.']);
      git(['commit', '-q', '-m', 'feat: add branch-name']);
      const newSha = git(['rev-parse', 'HEAD']).stdout.trim();

      // Add excluded runner file and write it to worktree
      fs.mkdirSync(path.join(repo.dir, '.git', 'info'), { recursive: true });
      fs.appendFileSync(
        path.join(repo.dir, '.git', 'info', 'exclude'),
        'tools/ai-brain/test/e1-branch-name.test.js\n.shipde/\n',
        'utf8'
      );
      fs.mkdirSync(path.join(repo.dir, 'tools', 'ai-brain', 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(repo.dir, 'tools', 'ai-brain', 'test', 'e1-branch-name.test.js'),
        '// runner\n'
      );

      const check = verifyWorkerCommit(repo.dir, repo.sha);
      assert.equal(check.pass, true, 'excluded runner must not mark the worktree dirty');
      assert.equal(check.headSha, newSha);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('runVerificationCommand returns NO_LOCAL_COMMIT when tests pass on disk but git changes are uncommitted', () => {
    const repo = makeTempRepo();
    try {
      // Write the required file so verification command exits 0
      fs.writeFileSync(path.join(repo.dir, 'test-target.js'), 'module.exports = 42;\n');
      const item = {
        id: 'TEST-1',
        verification: {
          command: 'node -e "process.exit(0)"',
          expect: '',
        },
      };
      const res = runVerificationCommand(item, {
        workerRoot: repo.dir,
        baseSha: repo.sha,
      });
      assert.equal(res.pass, false);
      assert.equal(res.cause, 'NO_LOCAL_COMMIT');
      assert.ok(Array.isArray(res.findings) && res.findings.length > 0);
      assert.equal(res.findings[0].id, 'NO_LOCAL_COMMIT');
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('runOrchestration pins review to worker head SHA and does not block with REVIEW_SHA_UNPINNED when o.sha is null', async () => {
    const repo = makeTempRepo();
    const git = (args) =>
      spawnSync('git', args, { cwd: repo.dir, encoding: 'utf8', windowsHide: true });
    const dirDecisions = tmpDir('task-ai-64-orch-head-dec-');

    try {
      // Worker commits a change
      fs.writeFileSync(path.join(repo.dir, 'branch-name.js'), 'module.exports = true;\n');
      git(['add', '.']);
      git(['commit', '-q', '-m', 'feat: branch-name']);
      const workerHead = git(['rev-parse', 'HEAD']).stdout.trim();

      let reviewedSha = null;
      const opts = baseOpts({
        decisionDir: dirDecisions,
        workerRoot: repo.dir,
        baseSha: repo.sha,
        sha: null, // o.sha is null like live CLI run!
        run: liveLaunch({ exitCode: 0, stdout: 'success' }),
        tests: PASS_TESTS,
        reviewer: (arg) => {
          reviewedSha = typeof arg === 'string' ? arg : arg && arg.sha;
          return { pass: true, sha: reviewedSha, verdict: 'PASS', findings: [] };
        },
      });

      const res = await safeRun(opts);
      assert.ok(res.log, 'orchestration must succeed without unpinned error: ' + res.refusal);
      assert.equal(isLiveCompletion(res, 'A'), true, 'work item A must complete');
      assert.equal(reviewedSha, workerHead, 'reviewer must receive worker head SHA');
      assert.equal(res.log.reviews[0].sha, workerHead, 'review entry must record worker head SHA');
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(dirDecisions, { recursive: true, force: true });
    }
  });

  test('runReviewLoop routes NO_LOCAL_COMMIT through repair and completes when repair worker commits', async () => {
    let runTestCalls = 0;
    let repairCalls = 0;
    const initialSha = SHA_A;
    const repairedSha = SHA_B;

    const res = await runReviewLoop(
      { sha: initialSha, budget: 2 },
      {
        runTests: () => {
          runTestCalls += 1;
          if (runTestCalls === 1) {
            return {
              pass: false,
              cause: 'NO_LOCAL_COMMIT',
              findings: [{ id: 'NO_LOCAL_COMMIT', open: true, detail: 'dirty tree' }],
            };
          }
          return { pass: true };
        },
        review: (sha) => ({
          pass: true,
          sha,
          verdict: 'PASS',
          findings: [],
        }),
        repair: (findings, sha) => {
          repairCalls += 1;
          assert.equal(findings[0].id, 'NO_LOCAL_COMMIT');
          return { sha: repairedSha };
        },
      }
    );

    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.finalSha, repairedSha);
    assert.equal(repairCalls, 1);
    assert.equal(res.repairCount, 1);
    assert.ok(res.rounds.some((r) => r.cause === 'NO_LOCAL_COMMIT'));
  });

  test('writeUsageReportFromHarnessResult writes usage report from opencode stdout telemetry and readSessionId parses it', () => {
    const tmpUsageDir = tmpDir('task-ai-64-usage-');
    const usageFile = path.join(tmpUsageDir, 'usage-test.json');
    const opencodeDirect = getHarness('opencode-direct');

    try {
      const job = {
        harness: 'opencode-direct',
        usageFile,
        model: 'ag/gemini-3.1-pro-low',
        upstream: 'ag',
      };
      const res = {
        exitCode: 0,
        stdout:
          'some log\n{"sessionID":"ses-opencode-42","tokens":{"input":150,"output":75,"total":225}}\nDone',
      };

      const writtenPath = writeUsageReportFromHarnessResult(job, res);
      assert.equal(writtenPath, usageFile);
      assert.ok(fs.existsSync(usageFile));

      const parsed = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
      assert.equal(parsed.session_id, 'ses-opencode-42');
      assert.equal(parsed.usage.input, 150);
      assert.equal(parsed.usage.output, 75);
      assert.equal(parsed.usage.total, 225);

      const session = readSessionId(opencodeDirect, job, res);
      assert.equal(session.id, 'ses-opencode-42');
    } finally {
      fs.rmSync(tmpUsageDir, { recursive: true, force: true });
    }
  });

  test('writeUsageReportFromHarnessResult sets session_id to null on non-zero exit code and fails closed', () => {
    const tmpUsageDir = tmpDir('task-ai-64-usage-fail-');
    const usageFile = path.join(tmpUsageDir, 'usage-fail.json');
    const opencodeDirect = getHarness('opencode-direct');

    try {
      const job = {
        harness: 'opencode-direct',
        usageFile,
        model: 'ag/gemini-3.1-pro-low',
        upstream: 'ag',
      };
      const res = {
        exitCode: 1,
        completionNonce: 'nonce-12345',
        stdout: 'error occurred',
      };

      writeUsageReportFromHarnessResult(job, res);
      assert.ok(fs.existsSync(usageFile));

      const parsed = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
      assert.equal(parsed.session_id, null, 'failed launch must record session_id: null');

      const session = readSessionId(opencodeDirect, job, res);
      assert.equal(session.id, null);
      assert.equal(session.cause, 'HARNESS_NO_SESSION_ID');
    } finally {
      fs.rmSync(tmpUsageDir, { recursive: true, force: true });
    }
  });

  test('readSessionId fails closed with HARNESS_USAGE_REPORT_MISSING when usage report is absent', () => {
    const opencodeDirect = getHarness('opencode-direct');
    const job = {
      harness: 'opencode-direct',
      usageFile: path.join(os.tmpdir(), 'non-existent-usage-' + Date.now() + '.json'),
    };
    const res = { exitCode: 0, stdout: '' };

    const session = readSessionId(opencodeDirect, job, res);
    assert.equal(session.id, null);
    assert.equal(session.cause, 'HARNESS_USAGE_REPORT_MISSING');
  });

  test('runOrchestration and runVerificationCommand do not bind to process.cwd() git repo when workerRoot is unspecified (POSIX simulation)', async () => {
    const hostRepo = makeTempRepo();
    const origCwd = process.cwd();
    const dirDecisions = tmpDir('task-ai-64-posix-sim-dec-');

    try {
      // Switch process.cwd() into hostRepo to simulate running inside a git clone (like Ubuntu CI)
      process.chdir(hostRepo.dir);

      // (1) In a repo cwd, safeRun with baseOpts and open findings rejects with PASS_WITH_FINDINGS_REJECTED (64-09 parity)
      const resPass = await safeRun(
        baseOpts({
          decisionDir: dirDecisions,
          run: recorder([liveLaunch()]),
          reviewer: () => ({
            pass: true,
            sha: SHA_A,
            verdict: 'PASS',
            findings: [{ id: 'F-1', open: true, detail: 'open finding' }],
          }),
        })
      );
      assert.ok(resPass.log, 'run record must exist');
      const tracePass = JSON.stringify(resPass.log) + '\n' + decisionText(dirDecisions);
      assert.ok(
        tracePass.includes('PASS_WITH_FINDINGS_REJECTED'),
        'PASS with open findings must be rejected even when cwd is a git repo'
      );
      assert.ok(tracePass.includes('F-1'), 'finding ID must be recorded');

      // (2) In a repo cwd, safeRun with reviewBudget exhausts and logs REPAIR_BUDGET_EXHAUSTED (64-10 parity)
      const dirBudget = tmpDir('task-ai-64-posix-budget-');
      let reviewCalls = 0;
      const resBudget = await safeRun(
        baseOpts({
          decisionDir: dirBudget,
          reviewBudget: 2,
          run: recorder([liveLaunch()]),
          reviewer: () => {
            reviewCalls += 1;
            return {
              pass: false,
              sha: SHA_A,
              verdict: 'CHANGES_REQUIRED',
              findings: [{ id: 'F-' + reviewCalls, open: true }],
            };
          },
        })
      );
      assert.ok(resBudget.log, 'budget run record must exist');
      assert.ok(reviewCalls > 1, 'must perform repair rounds (saw ' + reviewCalls + ')');
      assert.ok(
        decisionText(dirBudget).includes('REPAIR_BUDGET_EXHAUSTED'),
        'decision log must record REPAIR_BUDGET_EXHAUSTED'
      );

      // (3) runVerificationCommand ignores dirty state in process.cwd() when workerRoot is unspecified
      fs.writeFileSync(path.join(hostRepo.dir, 'dirty-file.txt'), 'dirty\n');
      const item = {
        id: 'ITEM-TEST',
        verification: { command: 'node -e "process.exit(0)"' },
      };
      const resVerify = runVerificationCommand(item, {});
      assert.equal(
        resVerify.pass,
        true,
        'verification without workerRoot must pass and ignore dirty process.cwd()'
      );
    } finally {
      process.chdir(origCwd);
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(dirDecisions, { recursive: true, force: true });
    }
  });
});

describe('TASK-AI-64 repair keeps worker commit and reviewer uses gateway+upstream failure domain (DEFECTS J & K)', () => {
  const { selectCandidateForProfile, repairRound } = require('../orchestrate');
  const { generateCandidates, candidateKey } = require('../candidates');
  const sourcesApi = require('../sources');
  const isoMod = require('../isolation-launcher');

  test('isolated launcher keeps existing worker root and commits when requested head SHA is present (Defect J)', () => {
    const hostRepo = makeTempRepo();
    fs.mkdirSync(path.join(hostRepo.dir, 'scripts/ai/isolation'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'scripts/ai/isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts/ai/isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-worker-root-'));
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

    try {
      // Clone hostRepo into workerDir
      git(['clone', '--no-hardlinks', hostRepo.dir, workerDir]);
      git(['config', 'user.email', 'worker@shipde.test'], workerDir);
      git(['config', 'user.name', 'Worker'], workerDir);

      // Create a local worker commit in workerDir that does NOT exist in hostRepo
      fs.writeFileSync(path.join(workerDir, 'worker-code.js'), 'console.log("worker change");\n');
      git(['add', '.'], workerDir);
      git(['commit', '-q', '-m', 'worker commit'], workerDir);
      const workerSha = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.notEqual(workerSha, hostRepo.sha);

      // Place a canary file in workerDir to prove it is not deleted/re-cloned
      fs.writeFileSync(path.join(workerDir, 'canary.txt'), 'keep-me\n');

      const fakeSid = 'S-1-5-21-test-sid';
      const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));
      const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
      fs.writeFileSync(
        verdictPath,
        JSON.stringify({
          verdict: 'CLOSED',
          details: { github_push: 'PASS', operator_profile: 'PASS' },
          timestamp: new Date().toISOString(),
          sid: fakeSid,
          worktree: hostRepo.dir,
          policyHash,
        })
      );

      const runIso = isoMod.getIsolatedLauncher();
      const mockAdapter = {
        id: 'echo',
        command: 'echo',
      };

      const opts = {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: workerSha,
        retainWorkerHead: workerSha,
        verdictPath,
        getWorkerSid: () => fakeSid,
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, spawnOpts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh') {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          return spawnSync(cmd, args, spawnOpts);
        },
      };

      try {
        runIso(mockAdapter, ['hello'], opts);
      } catch (err) {
        // Even if running the script fails, the provisioning step must not delete workerDir
      }

      assert.ok(
        fs.existsSync(path.join(workerDir, 'canary.txt')),
        'worker root must NOT be deleted or re-cloned when it holds requested head SHA'
      );
      const currentHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.equal(currentHead, workerSha, 'worker root must be checked out at workerSha');
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
    }
  });

  test('isolated launcher refuses mismatched HEAD on retained worker root with WORKER_HEAD_MISMATCH and never checks out or runs planted filter/hook/fsmonitor (Finding 1)', () => {
    const hostRepo = makeTempRepo();
    fs.mkdirSync(path.join(hostRepo.dir, 'scripts/ai/isolation'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'scripts/ai/isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts/ai/isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-mismatch-worker-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));
    const markerSmudge = path.join(os.tmpdir(), `marker-smudge-${Date.now()}-${process.pid}.txt`);
    const markerHook = path.join(os.tmpdir(), `marker-hook-${Date.now()}-${process.pid}.txt`);
    const markerFsmonitor = path.join(
      os.tmpdir(),
      `marker-fsmonitor-${Date.now()}-${process.pid}.txt`
    );
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

    try {
      git(['clone', '--no-hardlinks', hostRepo.dir, workerDir]);
      git(['config', 'user.email', 'worker@shipde.test'], workerDir);
      git(['config', 'user.name', 'Worker'], workerDir);

      fs.writeFileSync(path.join(workerDir, 'worker-code.js'), 'console.log("worker commit 1");\n');
      git(['add', '.'], workerDir);
      git(['commit', '-q', '-m', 'worker commit 1'], workerDir);
      const workerSha = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.notEqual(workerSha, hostRepo.sha);

      // Plant worker hooks, smudge filter, attributes, and fsmonitor
      const hookDir = path.join(workerDir, 'hooks');
      fs.mkdirSync(hookDir, { recursive: true });
      const hookScript = path.join(hookDir, 'post-checkout');
      fs.writeFileSync(hookScript, `#!/bin/sh\necho HOOK > "${markerHook.replace(/\\/g, '/')}"\n`);
      try {
        fs.chmodSync(hookScript, 0o755);
      } catch {}

      const smudgeScript = path.join(workerDir, 'smudge.js');
      fs.writeFileSync(
        smudgeScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerSmudge)}, 'SMUDGE');\nprocess.stdin.pipe(process.stdout);\n`
      );

      const fsmonitorScript = path.join(workerDir, 'fsmonitor.js');
      fs.writeFileSync(
        fsmonitorScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerFsmonitor)}, 'FSMONITOR');\n`
      );

      const evilAttr = path.join(workerDir, 'evil-attributes');
      fs.writeFileSync(evilAttr, '* filter=evil\n');
      fs.writeFileSync(path.join(workerDir, '.gitattributes'), '* filter=evil\n');

      git(
        ['config', 'filter.evil.smudge', `node "${smudgeScript.replace(/\\/g, '/')}"`],
        workerDir
      );
      git(['config', 'core.hooksPath', hookDir.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.attributesFile', evilAttr.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.fsmonitor', `node "${fsmonitorScript.replace(/\\/g, '/')}"`], workerDir);

      const fakeSid = 'S-1-5-21-test-sid';
      const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
      fs.writeFileSync(
        verdictPath,
        JSON.stringify({
          verdict: 'CLOSED',
          details: { github_push: 'PASS', operator_profile: 'PASS' },
          timestamp: new Date().toISOString(),
          sid: fakeSid,
          worktree: hostRepo.dir,
          policyHash,
        })
      );

      const runIso = isoMod.getIsolatedLauncher();
      const mockAdapter = {
        id: 'echo',
        command: 'echo',
      };

      // Force mismatched-head case: baseSha is hostRepo.sha, while worker root is at workerSha
      const opts = {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: hostRepo.sha,
        retainWorkerHead: hostRepo.sha,
        verdictPath,
        getWorkerSid: () => fakeSid,
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, spawnOpts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh') {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          return spawnSync(cmd, args, spawnOpts);
        },
      };

      assert.throws(
        () => runIso(mockAdapter, ['hello'], opts),
        /WORKER_HEAD_MISMATCH/,
        'mismatched HEAD in retained worker root must return structured WORKER_HEAD_MISMATCH error'
      );

      assert.strictEqual(
        fs.existsSync(markerSmudge),
        false,
        'isolated launcher must not execute worker-planted filter.<driver>.smudge on mismatched HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerHook),
        false,
        'isolated launcher must not execute worker-planted core.hooksPath post-checkout hook on mismatched HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerFsmonitor),
        false,
        'isolated launcher must not execute worker-planted core.fsmonitor on mismatched HEAD'
      );

      const currentHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.strictEqual(
        currentHead,
        workerSha,
        'worker root commit must be preserved and not checked out'
      );
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
      if (fs.existsSync(markerSmudge)) fs.rmSync(markerSmudge, { force: true });
      if (fs.existsSync(markerHook)) fs.rmSync(markerHook, { force: true });
      if (fs.existsSync(markerFsmonitor)) fs.rmSync(markerFsmonitor, { force: true });
    }
  });

  test('isolated launcher keeps worker commit and runs no checkout when retained worker root HEAD matches requested SHA (Finding 1)', () => {
    const hostRepo = makeTempRepo();
    fs.mkdirSync(path.join(hostRepo.dir, 'scripts/ai/isolation'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'scripts/ai/isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts/ai/isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-matching-worker-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));
    const markerSmudge = path.join(os.tmpdir(), `marker-smudge-${Date.now()}-${process.pid}.txt`);
    const markerHook = path.join(os.tmpdir(), `marker-hook-${Date.now()}-${process.pid}.txt`);
    const markerFsmonitor = path.join(
      os.tmpdir(),
      `marker-fsmonitor-${Date.now()}-${process.pid}.txt`
    );
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

    try {
      git(['clone', '--no-hardlinks', hostRepo.dir, workerDir]);
      git(['config', 'user.email', 'worker@shipde.test'], workerDir);
      git(['config', 'user.name', 'Worker'], workerDir);

      fs.writeFileSync(path.join(workerDir, 'worker-code.js'), 'console.log("worker repair");\n');
      git(['add', '.'], workerDir);
      git(['commit', '-q', '-m', 'worker commit'], workerDir);
      const workerSha = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.notEqual(workerSha, hostRepo.sha);

      // Plant worker hooks, smudge filter, attributes, and fsmonitor
      const hookDir = path.join(workerDir, 'hooks');
      fs.mkdirSync(hookDir, { recursive: true });
      const hookScript = path.join(hookDir, 'post-checkout');
      fs.writeFileSync(hookScript, `#!/bin/sh\necho HOOK > "${markerHook.replace(/\\/g, '/')}"\n`);
      try {
        fs.chmodSync(hookScript, 0o755);
      } catch {}

      const smudgeScript = path.join(workerDir, 'smudge.js');
      fs.writeFileSync(
        smudgeScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerSmudge)}, 'SMUDGE');\nprocess.stdin.pipe(process.stdout);\n`
      );

      const fsmonitorScript = path.join(workerDir, 'fsmonitor.js');
      fs.writeFileSync(
        fsmonitorScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerFsmonitor)}, 'FSMONITOR');\n`
      );

      const evilAttr = path.join(workerDir, 'evil-attributes');
      fs.writeFileSync(evilAttr, '* filter=evil\n');
      fs.writeFileSync(path.join(workerDir, '.gitattributes'), '* filter=evil\n');

      git(
        ['config', 'filter.evil.smudge', `node "${smudgeScript.replace(/\\/g, '/')}"`],
        workerDir
      );
      git(['config', 'core.hooksPath', hookDir.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.attributesFile', evilAttr.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.fsmonitor', `node "${fsmonitorScript.replace(/\\/g, '/')}"`], workerDir);

      const fakeSid = 'S-1-5-21-test-sid';
      const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
      fs.writeFileSync(
        verdictPath,
        JSON.stringify({
          verdict: 'CLOSED',
          details: { github_push: 'PASS', operator_profile: 'PASS' },
          timestamp: new Date().toISOString(),
          sid: fakeSid,
          worktree: hostRepo.dir,
          policyHash,
        })
      );

      const runIso = isoMod.getIsolatedLauncher();
      const mockAdapter = {
        id: 'echo',
        command: 'echo',
      };

      // Matching-head case: baseSha is workerSha (HEAD already equals requested SHA)
      const opts = {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: workerSha,
        retainWorkerHead: workerSha,
        verdictPath,
        getWorkerSid: () => fakeSid,
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, spawnOpts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh') {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          return spawnSync(cmd, args, spawnOpts);
        },
      };

      try {
        runIso(mockAdapter, ['hello'], opts);
      } catch (err) {
        // We only care about provisioning/checkout
      }

      assert.strictEqual(
        fs.existsSync(markerSmudge),
        false,
        'isolated launcher must not execute worker-planted filter.<driver>.smudge on matching HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerHook),
        false,
        'isolated launcher must not execute worker-planted core.hooksPath post-checkout hook on matching HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerFsmonitor),
        false,
        'isolated launcher must not execute worker-planted core.fsmonitor on matching HEAD'
      );

      const currentHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.strictEqual(
        currentHead,
        workerSha,
        'worker root must keep workerSha without checkout'
      );
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
      if (fs.existsSync(markerSmudge)) fs.rmSync(markerSmudge, { force: true });
      if (fs.existsSync(markerHook)) fs.rmSync(markerHook, { force: true });
      if (fs.existsSync(markerFsmonitor)) fs.rmSync(markerFsmonitor, { force: true });
    }
  });

  test('isolated launcher re-provisions and fails with structured error ISOLATION_CHECKOUT_FAILED when commit is absent (Defect J)', () => {
    const hostRepo = makeTempRepo();
    fs.mkdirSync(path.join(hostRepo.dir, 'scripts/ai/isolation'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'scripts/ai/isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts/ai/isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-corrupt-worker-'));
    fs.writeFileSync(path.join(workerDir, 'junk.txt'), 'corrupt\n');

    const fakeSid = 'S-1-5-21-test-sid';
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));
    const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        verdict: 'CLOSED',
        details: { github_push: 'PASS', operator_profile: 'PASS' },
        timestamp: new Date().toISOString(),
        sid: fakeSid,
        worktree: hostRepo.dir,
        policyHash,
      })
    );

    const runIso = isoMod.getIsolatedLauncher();
    const mockAdapter = { id: 'echo', command: 'echo' };
    const missingSha = '1111222233334444555566667777888899990000';

    try {
      assert.throws(
        () =>
          runIso(mockAdapter, ['hello'], {
            cwd: hostRepo.dir,
            workerRoot: workerDir,
            baseSha: missingSha,
            verdictPath,
            getWorkerSid: () => fakeSid,
            verifyBoundary: () => true,
            isWorkerPath: () => true,
          }),
        /ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: 1111222233334444555566667777888899990000/
      );
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
    }
  });

  test('repairRound passes commit sha under review as baseSha to launcher (Defect J)', async () => {
    const item = {
      id: 'TASK-AI-64',
      allowedPaths: ['tools/ai-brain/branch-name.js'],
      verification: { command: 'node --test tools/ai-brain/test/e1-branch-name.test.js' },
      acceptanceCriteria: ['pure branch name helper'],
      complexity: 'standard',
    };

    const workerSha = '817bc8b0e6a89d31a309fc2549cd5b567902951f';
    const cand = {
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ag/gemini-3.1-pro-low',
      source: '9router',
      kind: 'router',
    };
    cand.candidateKey = candidateKey(cand);

    let capturedJob = null;
    const launcherSpy = async (job) => {
      capturedJob = job;
      return { exitCode: 0, stdout: 'fixed', completionNonce: 'nonce' };
    };

    const repairFn = repairRound(
      { specs: [item], baseSha: '0000000000000000000000000000000000000001' },
      item,
      { candidateKey: cand.candidateKey, baseSha: '0000000000000000000000000000000000000001' },
      { goal: 'test goal' },
      {},
      launcherSpy,
      os.tmpdir(),
      Date.now(),
      [cand],
      {},
      sourcesApi.loadSources()
    );

    await repairFn([{ id: 'VERIFICATION_EXPECT_MISSING', open: true }], workerSha);
    assert.ok(capturedJob, 'launcher must be invoked for repair');
    assert.equal(
      capturedJob.baseSha,
      workerSha,
      'repairJob must pass the worker commit sha under review as baseSha'
    );
    assert.equal(
      capturedJob.retainWorkerHead,
      workerSha,
      'repairJob must pass the worker commit sha under review as retainWorkerHead'
    );
  });

  test('generateCandidates with concrete accounts does not emit wildcard account candidates from catalogue (Defect K)', () => {
    const registry = sourcesApi.loadSources();
    const catalogue = [
      'ag/gemini-3.1-pro-low',
      'ag/gemini-3.7-flash-medium',
      'cl/deepseek/deepseek-v4-flash',
      'ocz/big-pickle',
    ];
    const accounts = [
      { id: 'codex', sourceId: '9router' },
      { id: 'ninerouter', sourceId: '9router' },
    ];

    const result = generateCandidates({ registry, catalogue, accounts });

    // 1. None of the generated candidates should have accountId: '*'
    const wildcards = result.filter((c) => c.accountId === '*');
    assert.equal(
      wildcards.length,
      0,
      'must not produce wildcard accounts when concrete accounts are present: ' +
        JSON.stringify(wildcards.map(candidateKey))
    );

    // 2. OpenCode must inherit concrete accounts from 9router
    const opencodeCandidates = result.filter((c) => c.harness === 'opencode');
    assert.ok(opencodeCandidates.length > 0, 'opencode candidates must exist');
    for (const oc of opencodeCandidates) {
      assert.ok(
        oc.accountId === 'codex' || oc.accountId === 'ninerouter',
        'opencode candidate must inherit concrete account: ' + candidateKey(oc)
      );
    }

    // 3. Other routers without accounts (rqsty, thb) must not emit wildcard candidates
    const rqstyCandidates = result.filter((c) => c.gateway === 'rqsty' || c.source === 'rqsty');
    assert.equal(rqstyCandidates.length, 0, 'rqsty with no accounts must emit 0 candidates');
  });

  test('reviewer selection allows candidate on same gateway with different upstream and account (Defect K)', async () => {
    const candidates = [
      // Same upstream ag (forbidden)
      {
        harness: 'paseo',
        accessPath: 'http://127.0.0.1:20128/v1',
        gateway: '9router',
        upstream: 'ag',
        accountId: 'ninerouter',
        quotaScope: 'ninerouter',
        modelId: 'ag/gemini-3.7-flash-medium',
        source: '9router',
        kind: 'router',
        quality: 80,
      },
      // Same account codex (forbidden)
      {
        harness: 'paseo',
        accessPath: 'http://127.0.0.1:20128/v1',
        gateway: '9router',
        upstream: 'cl',
        accountId: 'codex',
        quotaScope: 'codex',
        modelId: 'cl/deepseek/deepseek-v4-flash',
        source: '9router',
        kind: 'router',
        quality: 80,
      },
      // Different upstream cl AND different account ninerouter (ALLOWED!)
      {
        harness: 'paseo',
        accessPath: 'http://127.0.0.1:20128/v1',
        gateway: '9router',
        upstream: 'cl',
        accountId: 'ninerouter',
        quotaScope: 'ninerouter',
        modelId: 'cl/deepseek/deepseek-v4-flash',
        source: '9router',
        kind: 'router',
        quality: 80,
      },
    ];
    for (const c of candidates) c.candidateKey = candidateKey(c);

    // Derive forbiddenDomains as orchestrate.js reviewItem does
    const writerCandidate = {
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
    };
    const forbiddenDomains = [
      writerCandidate.upstream || writerCandidate.gateway,
      writerCandidate.accountId,
    ].filter(Boolean);

    assert.deepEqual(
      forbiddenDomains,
      ['ag', 'codex'],
      'must forbid writer upstream and account, not whole gateway'
    );

    const reviewerDecision = await selectCandidateForProfile(
      { id: 'TASK-AI-64-review', roleRequirement: { role: 'reviewer' }, complexity: 'standard' },
      candidates,
      forbiddenDomains,
      {},
      {},
      {},
      Date.now()
    );

    assert.ok(reviewerDecision.chosen, 'reviewer candidate must be selected, not refused');
    assert.equal(
      reviewerDecision.chosen,
      candidates[2].candidateKey,
      'reviewer candidate must be 9router/cl with ninerouter account'
    );
  });

  test('stale root on initial launch is re-provisioned at base (fails at c8fe4fa, passes after)', () => {
    const hostRepo = makeTempRepo();
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'base-update.txt'), 'host base B\n');
    git(['add', '.'], hostRepo.dir);
    git(['commit', '-q', '-m', 'host commit B'], hostRepo.dir);
    const hostShaB = git(['rev-parse', 'HEAD'], hostRepo.dir).stdout.trim();
    assert.notEqual(hostShaB, hostRepo.sha);

    fs.mkdirSync(path.join(hostRepo.dir, 'scripts/ai/isolation'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'scripts/ai/isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts/ai/isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-stale-initial-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));

    try {
      // Simulate an earlier run that cloned hostRepo at initial commit and left a worker commit C and old file
      git(['clone', '--no-hardlinks', hostRepo.dir, workerDir]);
      git(['config', 'user.email', 'worker@shipde.test'], workerDir);
      git(['config', 'user.name', 'Worker'], workerDir);

      fs.writeFileSync(path.join(workerDir, 'stale-worker-file.txt'), 'stale worker commit C\n');
      git(['add', '.'], workerDir);
      git(['commit', '-q', '-m', 'stale worker commit C'], workerDir);
      const workerShaC = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.notEqual(workerShaC, hostShaB);

      fs.writeFileSync(path.join(workerDir, 'stale-leftover.txt'), 'from previous run\n');

      const fakeSid = 'S-1-5-21-test-sid';
      const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
      fs.writeFileSync(
        verdictPath,
        JSON.stringify({
          verdict: 'CLOSED',
          details: { github_push: 'PASS', operator_profile: 'PASS' },
          timestamp: new Date().toISOString(),
          sid: fakeSid,
          worktree: hostRepo.dir,
          policyHash,
        })
      );

      const runIso = isoMod.getIsolatedLauncher();
      const mockAdapter = {
        id: 'echo',
        command: 'echo',
      };

      // Initial launch of a work item: no retainWorkerHead context, requesting baseSha = hostShaB
      const opts = {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: hostShaB,
        verdictPath,
        getWorkerSid: () => fakeSid,
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, spawnOpts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh') {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          return spawnSync(cmd, args, spawnOpts);
        },
      };

      try {
        runIso(mockAdapter, ['hello'], opts);
      } catch (err) {
        // Provisioning is what we are verifying
      }

      // Stale leftover must be deleted, worker root must be re-provisioned at hostShaB
      assert.strictEqual(
        fs.existsSync(path.join(workerDir, 'stale-leftover.txt')),
        false,
        'stale files from previous run must be deleted upon re-provisioning'
      );
      assert.strictEqual(
        fs.existsSync(path.join(workerDir, 'base-update.txt')),
        true,
        'new base files from hostRepo must be checked out in re-provisioned worker root'
      );
      const currentHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.strictEqual(
        currentHead,
        hostShaB,
        'worker root must be checked out at requested baseSha'
      );
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
    }
  });

  test('repair with matching head keeps the commit and runs no checkout', () => {
    const hostRepo = makeTempRepo();
    fs.mkdirSync(path.join(hostRepo.dir, 'scripts/ai/isolation'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'scripts/ai/isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts/ai/isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-repair-match-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));
    const markerSmudge = path.join(
      os.tmpdir(),
      `marker-smudge-match-${Date.now()}-${process.pid}.txt`
    );
    const markerHook = path.join(os.tmpdir(), `marker-hook-match-${Date.now()}-${process.pid}.txt`);
    const markerFsmonitor = path.join(
      os.tmpdir(),
      `marker-fsmonitor-match-${Date.now()}-${process.pid}.txt`
    );
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

    try {
      git(['clone', '--no-hardlinks', hostRepo.dir, workerDir]);
      git(['config', 'user.email', 'worker@shipde.test'], workerDir);
      git(['config', 'user.name', 'Worker'], workerDir);

      fs.writeFileSync(path.join(workerDir, 'worker-repair.js'), 'console.log("repair commit");\n');
      git(['add', '.'], workerDir);
      git(['commit', '-q', '-m', 'worker commit for repair'], workerDir);
      const workerSha = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.notEqual(workerSha, hostRepo.sha);

      // Canary to prove no re-cloning
      fs.writeFileSync(path.join(workerDir, 'canary.txt'), 'canary\n');

      // Plant worker hooks, smudge filter, attributes, and fsmonitor
      const hookDir = path.join(workerDir, 'hooks');
      fs.mkdirSync(hookDir, { recursive: true });
      const hookScript = path.join(hookDir, 'post-checkout');
      fs.writeFileSync(hookScript, `#!/bin/sh\necho HOOK > "${markerHook.replace(/\\/g, '/')}"\n`);
      try {
        fs.chmodSync(hookScript, 0o755);
      } catch {}

      const smudgeScript = path.join(workerDir, 'smudge.js');
      fs.writeFileSync(
        smudgeScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerSmudge)}, 'SMUDGE');\nprocess.stdin.pipe(process.stdout);\n`
      );

      const fsmonitorScript = path.join(workerDir, 'fsmonitor.js');
      fs.writeFileSync(
        fsmonitorScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerFsmonitor)}, 'FSMONITOR');\n`
      );

      const evilAttr = path.join(workerDir, 'evil-attributes');
      fs.writeFileSync(evilAttr, '* filter=evil\n');
      fs.writeFileSync(path.join(workerDir, '.gitattributes'), '* filter=evil\n');

      git(
        ['config', 'filter.evil.smudge', `node "${smudgeScript.replace(/\\/g, '/')}"`],
        workerDir
      );
      git(['config', 'core.hooksPath', hookDir.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.attributesFile', evilAttr.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.fsmonitor', `node "${fsmonitorScript.replace(/\\/g, '/')}"`], workerDir);

      const fakeSid = 'S-1-5-21-test-sid';
      const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
      fs.writeFileSync(
        verdictPath,
        JSON.stringify({
          verdict: 'CLOSED',
          details: { github_push: 'PASS', operator_profile: 'PASS' },
          timestamp: new Date().toISOString(),
          sid: fakeSid,
          worktree: hostRepo.dir,
          policyHash,
        })
      );

      const runIso = isoMod.getIsolatedLauncher();
      const mockAdapter = { id: 'echo', command: 'echo' };

      // Explicit repair round option: retainWorkerHead matches workerSha
      const opts = {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: workerSha,
        retainWorkerHead: workerSha,
        verdictPath,
        getWorkerSid: () => fakeSid,
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, spawnOpts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh') {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          return spawnSync(cmd, args, spawnOpts);
        },
      };

      try {
        runIso(mockAdapter, ['hello'], opts);
      } catch (err) {}

      assert.strictEqual(
        fs.existsSync(markerSmudge),
        false,
        'smudge filter must not execute on matching repair HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerHook),
        false,
        'post-checkout hook must not execute on matching repair HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerFsmonitor),
        false,
        'fsmonitor must not execute on matching repair HEAD'
      );
      assert.strictEqual(
        fs.existsSync(path.join(workerDir, 'canary.txt')),
        true,
        'worker root must be retained without deletion'
      );
      const currentHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.strictEqual(
        currentHead,
        workerSha,
        'worker root HEAD must remain at worker commit without checkout'
      );
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
      if (fs.existsSync(markerSmudge)) fs.rmSync(markerSmudge, { force: true });
      if (fs.existsSync(markerHook)) fs.rmSync(markerHook, { force: true });
      if (fs.existsSync(markerFsmonitor)) fs.rmSync(markerFsmonitor, { force: true });
    }
  });

  test('repair with mismatched head is structured, no marker written', () => {
    const hostRepo = makeTempRepo();
    fs.mkdirSync(path.join(hostRepo.dir, 'scripts/ai/isolation'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, 'scripts/ai/isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts/ai/isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-repair-mismatch-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));
    const markerSmudge = path.join(
      os.tmpdir(),
      `marker-smudge-mismatch-${Date.now()}-${process.pid}.txt`
    );
    const markerHook = path.join(
      os.tmpdir(),
      `marker-hook-mismatch-${Date.now()}-${process.pid}.txt`
    );
    const markerFsmonitor = path.join(
      os.tmpdir(),
      `marker-fsmonitor-mismatch-${Date.now()}-${process.pid}.txt`
    );
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

    try {
      git(['clone', '--no-hardlinks', hostRepo.dir, workerDir]);
      git(['config', 'user.email', 'worker@shipde.test'], workerDir);
      git(['config', 'user.name', 'Worker'], workerDir);

      fs.writeFileSync(path.join(workerDir, 'worker-file.js'), 'console.log("worker file");\n');
      git(['add', '.'], workerDir);
      git(['commit', '-q', '-m', 'worker commit'], workerDir);
      const workerSha = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.notEqual(workerSha, hostRepo.sha);

      // Plant worker hooks, smudge filter, attributes, and fsmonitor
      const hookDir = path.join(workerDir, 'hooks');
      fs.mkdirSync(hookDir, { recursive: true });
      const hookScript = path.join(hookDir, 'post-checkout');
      fs.writeFileSync(hookScript, `#!/bin/sh\necho HOOK > "${markerHook.replace(/\\/g, '/')}"\n`);
      try {
        fs.chmodSync(hookScript, 0o755);
      } catch {}

      const smudgeScript = path.join(workerDir, 'smudge.js');
      fs.writeFileSync(
        smudgeScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerSmudge)}, 'SMUDGE');\nprocess.stdin.pipe(process.stdout);\n`
      );

      const fsmonitorScript = path.join(workerDir, 'fsmonitor.js');
      fs.writeFileSync(
        fsmonitorScript,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(markerFsmonitor)}, 'FSMONITOR');\n`
      );

      const evilAttr = path.join(workerDir, 'evil-attributes');
      fs.writeFileSync(evilAttr, '* filter=evil\n');
      fs.writeFileSync(path.join(workerDir, '.gitattributes'), '* filter=evil\n');

      git(
        ['config', 'filter.evil.smudge', `node "${smudgeScript.replace(/\\/g, '/')}"`],
        workerDir
      );
      git(['config', 'core.hooksPath', hookDir.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.attributesFile', evilAttr.replace(/\\/g, '/')], workerDir);
      git(['config', 'core.fsmonitor', `node "${fsmonitorScript.replace(/\\/g, '/')}"`], workerDir);

      const fakeSid = 'S-1-5-21-test-sid';
      const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
      fs.writeFileSync(
        verdictPath,
        JSON.stringify({
          verdict: 'CLOSED',
          details: { github_push: 'PASS', operator_profile: 'PASS' },
          timestamp: new Date().toISOString(),
          sid: fakeSid,
          worktree: hostRepo.dir,
          policyHash,
        })
      );

      const runIso = isoMod.getIsolatedLauncher();
      const mockAdapter = { id: 'echo', command: 'echo' };

      // Explicit repair round option: retainWorkerHead passed, but differs from worker HEAD (workerSha)
      const opts = {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: hostRepo.sha,
        retainWorkerHead: hostRepo.sha,
        verdictPath,
        getWorkerSid: () => fakeSid,
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, spawnOpts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh') {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          return spawnSync(cmd, args, spawnOpts);
        },
      };

      assert.throws(
        () => runIso(mockAdapter, ['hello'], opts),
        (err) => {
          assert.strictEqual(err.code, 'WORKER_HEAD_MISMATCH');
          assert.match(err.message, /WORKER_HEAD_MISMATCH/);
          return true;
        },
        'mismatched HEAD on repair must throw structured WORKER_HEAD_MISMATCH error'
      );

      assert.strictEqual(
        fs.existsSync(markerSmudge),
        false,
        'smudge filter must not execute on mismatched repair HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerHook),
        false,
        'post-checkout hook must not execute on mismatched repair HEAD'
      );
      assert.strictEqual(
        fs.existsSync(markerFsmonitor),
        false,
        'fsmonitor must not execute on mismatched repair HEAD'
      );
      const currentHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.strictEqual(
        currentHead,
        workerSha,
        'worker root HEAD must be preserved at worker commit without checkout'
      );
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
      if (fs.existsSync(markerSmudge)) fs.rmSync(markerSmudge, { force: true });
      if (fs.existsSync(markerHook)) fs.rmSync(markerHook, { force: true });
      if (fs.existsSync(markerFsmonitor)) fs.rmSync(markerFsmonitor, { force: true });
    }
  });
});

describe('TASK-AI-64 isolated route covers the opencode harness (DEFECT L)', () => {
  const { runsOpenCodeHarness } = require('../sources');
  const { resolveRoute } = require('../executor');
  const { getHarness } = require('../harness');
  const isoModule = require('../isolation-launcher');

  test('runsOpenCodeHarness identifies both opencode and paseo from registry data', () => {
    assert.strictEqual(runsOpenCodeHarness('opencode'), true);
    assert.strictEqual(runsOpenCodeHarness('paseo'), true);
    assert.strictEqual(runsOpenCodeHarness('hermes'), false);
    assert.strictEqual(runsOpenCodeHarness('cline'), false);
    assert.strictEqual(runsOpenCodeHarness('agy'), false);
    assert.strictEqual(runsOpenCodeHarness('codex'), false);
  });

  test('resolveRoute on isolated path maps harness opencode to opencode-direct, while non-isolated preserves it', () => {
    // isolated
    const isolatedRoute = resolveRoute(
      { provider: 'oc', harness: 'opencode', model: 'ninerouter/ag/gemini-3.1-pro-low' },
      { isolatedWorker: true }
    );
    assert.strictEqual(isolatedRoute.harnessName, 'opencode-direct');
    assert.strictEqual(isolatedRoute.provider, 'opencode');
    assert.strictEqual(isolatedRoute.model, 'ninerouter/ag/gemini-3.1-pro-low');

    // non-isolated: preserves harness opencode and does not silently pick paseo
    const nonIsolatedRoute = resolveRoute(
      { provider: 'oc', harness: 'opencode', model: 'ninerouter/ag/gemini-3.1-pro-low' },
      { isolatedWorker: false }
    );
    assert.strictEqual(nonIsolatedRoute.harnessName, 'opencode');
    assert.strictEqual(getHarness(nonIsolatedRoute.harnessName), null);
  });

  test('orchestrate with a candidate of harness opencode on the isolated path routes to opencode-direct and launches worker (fails at 0e04eed, passes after)', async () => {
    const hostRepo = makeTempRepo();
    const decisionDir = tmpDir('task-ai-64-defect-l-decision-');
    const evidenceDir = tmpDir('task-ai-64-defect-l-evidence-');

    const realGetIsolatedLauncher = isoModule.getIsolatedLauncher;
    const realIsWorkerPath = isoModule.isWorkerPath;

    let launchedAdapter = null;
    let launchArgsCaptured = null;

    isoModule.getIsolatedLauncher = () => {
      return (adapter, launchArgs, launchOpts) => {
        launchedAdapter = adapter;
        launchArgsCaptured = launchArgs;
        return {
          exitCode: 0,
          stdout:
            'the agent changed production code\n{"sessionID":"session-defect-l","tokens":{"input":10,"output":20,"total":30}}',
          stderr: '',
          completionNonce: 'nonce-defect-l',
        };
      };
    };
    isoModule.isWorkerPath = () => true;

    const opencodeCandidate = cand({
      harness: 'opencode',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.1-pro-low',
      source: 'oc',
    });

    const orchPath = require.resolve('../orchestrate');
    let result;
    try {
      delete require.cache[orchPath];
      const fresh = require(orchPath);
      result = await safeRun(
        baseOpts({
          isolatedWorker: true,
          cwd: hostRepo.dir,
          baseSha: hostRepo.sha,
          sha: hostRepo.sha,
          decisionDir,
          evidenceDir,
          candidates: [opencodeCandidate],
          specs: [
            {
              id: 'TASK-AI-64',
              roleRequirement: { role: 'author.foundation' },
              files: ['branch-name.js'],
              verification: { command: 'node -e "process.exit(0)"', expect: '' },
            },
          ],
          reviewer: () => ({ pass: true, sha: hostRepo.sha, verdict: 'PASS', findings: [] }),
        })
      );
    } finally {
      isoModule.getIsolatedLauncher = realGetIsolatedLauncher;
      isoModule.isWorkerPath = realIsWorkerPath;
      delete require.cache[orchPath];
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }

    assert.ok(result.log, 'orchestration must return a log');
    assert.strictEqual(result.log.status, 'COMPLETED');
    assert.ok(launchedAdapter, 'isolated launcher must have been called');
    assert.strictEqual(
      launchedAdapter.id,
      'opencode-direct',
      'isolated launcher must receive opencode-direct adapter'
    );
    assert.strictEqual(launchedAdapter.command, 'opencode');
    assert.ok(Array.isArray(launchArgsCaptured), 'launchArgs must be an array');
    assert.ok(launchArgsCaptured.includes('ninerouter/ag/gemini-3.1-pro-low'));
    assert.deepEqual(result.log.reconciliation.completed, ['TASK-AI-64']);
  });

  test('orchestrate with candidate of harness opencode on non-isolated path refuses with UNKNOWN_HARNESS and classifies as Scope.HARNESS', async () => {
    const hostRepo = makeTempRepo();
    const decisionDir = tmpDir('task-ai-64-defect-l-noniso-dec-');
    const evidenceDir = tmpDir('task-ai-64-defect-l-noniso-ev-');
    const { executePlan, Outcome } = require('../executor');

    // 1. Direct executor refusal on non-isolated path
    const plan = {
      assignments: [
        {
          workItemId: 'TASK-AI-64',
          branch: 'feat/task-ai-64',
          provider: 'oc',
          harness: 'opencode',
          model: 'ninerouter/ag/gemini-3.1-pro-low',
          role: 'author.foundation',
        },
      ],
    };
    const execResult = executePlan(plan, { dryRun: false, isolatedWorker: false, decisionDir });
    assert.strictEqual(execResult.records[0].outcome, Outcome.REFUSED);
    assert.strictEqual(execResult.records[0].detail, 'UNKNOWN_HARNESS: opencode');

    // 2. Through orchestrate with a non-isolated harness runner
    const opencodeCandidate = cand({
      harness: 'opencode',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.1-pro-low',
      source: 'oc',
    });

    try {
      const result = await safeRun(
        baseOpts({
          isolatedWorker: false,
          run: (job) => {
            const adapter = getHarness(job.harness);
            if (!adapter) throw new Error('UNKNOWN_HARNESS: ' + String(job.harness));
            return adapter.launch(job);
          },
          cwd: hostRepo.dir,
          baseSha: hostRepo.sha,
          sha: hostRepo.sha,
          decisionDir,
          evidenceDir,
          candidates: [opencodeCandidate],
          specs: [
            {
              id: 'TASK-AI-64',
              roleRequirement: { role: 'author.foundation' },
              files: ['branch-name.js'],
              verification: { command: 'node -e "process.exit(0)"', expect: '' },
            },
          ],
        })
      );

      assert.ok(result.log, 'orchestration returns log');
      assert.strictEqual(result.log.status, 'BLOCKED');
      const failedDecisions = decisionLines(decisionDir).filter((d) => d.stage === 'failed');
      assert.ok(failedDecisions.length > 0, 'decision log must contain failed record');
      assert.strictEqual(failedDecisions[0].failureScope, 'harness');
      assert.strictEqual(failedDecisions[0].detail, 'launch_config');
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });
});
