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

const { test } = require('node:test');
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
function safeRun(opts) {
  try {
    return { log: runOrchestration(GOAL, opts), refusal: null };
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

test('64-01 a simulated launch is never counted as a live run (AI-64-P08, AI-64-R04)', () => {
  // (a) No launcher supplied at all. The loop must not substitute a success.
  const dirDefault = tmpDir('task-ai-64-sim-default-');
  const withDefault = safeRun(baseOpts({ decisionDir: dirDefault }));

  // (b) A hard-coded simulated callback — the shape the shipped dry-run CLI
  // injects — that returns exit 0 and a stdout "session" but no durable report.
  const dirCallback = tmpDir('task-ai-64-sim-callback-');
  const withCallback = safeRun(
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

test("64-02 the harness is given the Controller's pinned candidateKey, never one the loop chose (AI-64-P01, AI-64-R03)", () => {
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
  const result = safeRun(baseOpts({ candidates, decisionDir: dir, run }));
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

test('64-03 a live run goes through the isolated launcher, injected runner or not (AI-64-P03, AI-64-R15)', () => {
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
    result = safeRun(
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

test('64-04 the durable session handle is read from the report and stored, never guessed (AI-64-R04)', () => {
  const dir = tmpDir('task-ai-64-session-');
  const run = recorder([liveLaunch()]);
  const result = safeRun(baseOpts({ decisionDir: dir, run }));
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

test('64-05 a stopped run resumes from the checkpoint file and writes it back (AI-64-R14, AC-AI-64-14/15)', () => {
  const dir = tmpDir('task-ai-64-checkpoint-');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  fs.copyFileSync(CHECKPOINT_SEED, checkpointFile);
  const seeded = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(checkpointFile, seeded, seeded);

  const run = recorder([liveLaunch()]);
  // The path is offered under both spellings the loop already uses, so the test
  // binds to the contract (a checkpoint file on disk) and not to one option name.
  const result = safeRun(
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

test('64-06 an empty SUCCESS is not a completion and never reaches review (AI-64-R05, AC-AI-64-09)', () => {
  const dir = tmpDir('task-ai-64-empty-');
  let reviewCalls = 0;
  const result = safeRun(
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

test('64-07 a stalled session stops the run and leaves a checkpoint for a human (AI-64-R05, AC-AI-64-09)', () => {
  const dir = tmpDir('task-ai-64-stalled-');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  const result = safeRun(
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

test('64-08 a review is bound to the exact SHA it read (AI-64-R07, AC-AI-64-10)', () => {
  // A review of a different commit is stale evidence for this commit.
  const stale = runReviewLoop(
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
  const unbound = runReviewLoop(
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

test('64-09 a PASS verdict carrying open findings is rejected, and the contradiction is recorded (AI-64-R07, AI-64-R14)', () => {
  const dir = tmpDir('task-ai-64-pass-findings-');
  const result = safeRun(
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

test('64-10 the repair budget is finite and the exhausted run ends BLOCKED with its reason (AI-64-R10, AI-64-R14)', () => {
  const dir = tmpDir('task-ai-64-budget-');
  let reviewCalls = 0;
  const result = safeRun(
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

test('64-13 a gateway-scoped failure selects a candidate outside that failure domain (AI-64-R11, AC-AI-64-16)', () => {
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
  const result = safeRun(
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
  const control = safeRun(
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

    // 2. orchestrate path (via headShaOf which runs during resolveLauncher)
    const orchestrate = require('../orchestrate');
    const launcher = orchestrate.resolveLauncher({ run: () => {} }, null);
    if (launcher) {
      launcher({ cwd: workerDir, baseSha: sha, verdictPath: path.join(tmpDir, 'v.json') });
    }
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

test('64-15 worker hooks do not run during publish', () => {
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-worker2-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-tmp2-'));
  const marker = path.join(tmpDir, 'marker-hook.txt');
  const cleanDir = path.join(tmpDir, 'clean');

  const g = (args, cwd = workerDir) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  g(['init']);
  g(['config', 'user.email', 'test@example.com']);
  g(['config', 'user.name', 'Test']);
  g(['commit', '--allow-empty', '-m', 'init']);
  const sha = g(['rev-parse', 'HEAD']).stdout.trim();

  // Create pre-push hook
  const hookDir = path.join(workerDir, '.git', 'hooks');
  fs.mkdirSync(hookDir, { recursive: true });
  const prePushScript = `@echo off\necho EXECUTED > "${marker}"\nexit 0`;
  fs.writeFileSync(path.join(hookDir, 'pre-push'), prePushScript);
  fs.writeFileSync(path.join(hookDir, 'pre-push.bat'), prePushScript);
  g(['config', 'core.hooksPath', hookDir]);

  try {
    fs.mkdirSync(cleanDir);
    g(['init', '--bare', cleanDir], cleanDir);
    const { transferReviewedObjects } = require('../publisher');
    transferReviewedObjects(workerDir, sha, cleanDir, tmpDir);

    assert.strictEqual(
      fs.existsSync(marker),
      false,
      'Worker pre-push hook executed during publish'
    );
  } finally {
    fs.rmSync(workerDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('64-16 worker-set remote URL cannot change push destination', async () => {
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-worker3-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sec-tmp3-'));
  const hostileDir = path.join(tmpDir, 'hostile');
  const cleanDir = path.join(tmpDir, 'clean');

  const g = (args, cwd = workerDir) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  g(['init']);
  g(['config', 'user.email', 'test@example.com']);
  g(['config', 'user.name', 'Test']);
  g(['commit', '--allow-empty', '-m', 'init']);
  const sha = g(['rev-parse', 'HEAD']).stdout.trim();

  fs.mkdirSync(hostileDir);
  g(['init', '--bare', hostileDir], hostileDir);
  g(['config', 'remote.origin.url', hostileDir]);
  g(['config', 'push.default', 'current']);

  try {
    fs.mkdirSync(cleanDir);
    g(['init', '--bare', cleanDir], cleanDir);
    const { transferReviewedObjects } = require('../publisher');
    transferReviewedObjects(workerDir, sha, cleanDir, tmpDir);

    const hostileHeadRes = g(['rev-parse', 'refs/heads/temp-push'], hostileDir);
    assert.notStrictEqual(
      hostileHeadRes.status,
      0,
      'Publisher pushed to worker-controlled remote URL'
    );

    const cloneHead = g(['rev-parse', 'refs/heads/temp-push'], cleanDir).stdout.trim();
    assert.strictEqual(cloneHead, sha, 'Publisher failed to transfer objects to operator mirror');
  } finally {
    fs.rmSync(workerDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
