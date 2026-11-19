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
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { runOrchestration, publishCwdForReceipt } = require('../orchestrate');
const { Status: SessionStatus } = require('../supervisor');
const { runReviewLoop } = require('../review-loop');
const { publish } = require('../publisher');
const { candidateKey } = require('../candidates');
const { classifyFailure, Scope, Cause } = require('../failure-classifier');
const routing = require('../routing');
const decisions = require('../decisions');
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

function greenCiAt(sha) {
  return (args) => {
    assert.deepStrictEqual(args.slice(0, 2), ['pr', 'view']);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        headRefOid: sha,
        statusCheckRollup: require('../ci-gate')
          .ciGateConfig()
          .requiredChecks.map((name) => ({
            name,
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
          })),
      }),
      stderr: '',
    };
  };
}

function baseOpts(extra) {
  const sourcesDispatch = require('../sources.json').dispatch || {};
  const options = Object.assign(
    {
      specs: [{ id: 'A', files: ['a.js'], acceptanceCriteria: ['a works'] }],
      candidates: [cand()],
      registry: {
        sources: [],
        dispatch: { maxReviewDiffChars: sourcesDispatch.maxReviewDiffChars },
      },
      maxReviewDiffChars: sourcesDispatch.maxReviewDiffChars,
      sha: SHA_A,
      now: NOW,
      tests: PASS_TESTS,
      reviewer: PASS_REVIEW,
      repairer: FIX_REPAIR,
    },
    extra || {}
  );
  options.ranking = Object.assign({ priors: { ranking: [] } }, (extra && extra.ranking) || {});
  return options;
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

for (const scenario of ['checkpoint', 'missing-checkpoint', 'refused', 'signal']) {
  test('H3 terminal goal-run output carries reason: ' + scenario, async () => {
    const dir = tmpDir('h3-terminal-output-');
    try {
      const checkpoint = path.join(dir, 'checkpoint.json');
      const registerPath = path.join(dir, 'register.csv');
      fs.writeFileSync(
        registerPath,
        'delivery_order,work_item_id,status,dependencies,work_item_path\n1,A,READY_FOR_AUTHOR,,docs/A.md\n'
      );
      if (scenario === 'checkpoint')
        fs.writeFileSync(
          checkpoint,
          JSON.stringify({
            liveSteps: { A: { reason: 'WRITER_ROUTE_PROBE_FAILED PROBE_EXCEPTION', failures: [] } },
          })
        );
      const lines = [];
      await require('../next-runner').nextLoop(
        {
          rootDir: dir,
          registerPath,
          decisionDir: dir,
          maxIterations: 1,
        },
        {
          log: (line) => lines.push(line),
          sleep: async () => {},
          runIntake: async () => {
            if (scenario === 'refused') return { status: 'refused' };
            const child = new (require('node:events').EventEmitter)();
            setImmediate(() => child.emit('close', scenario === 'signal' ? null : 1));
            return { status: 'launched', child, runFiles: { checkpoint } };
          },
        }
      );
      const expected =
        scenario === 'checkpoint'
          ? 'WRITER_ROUTE_PROBE_FAILED PROBE_EXCEPTION'
          : scenario === 'refused'
            ? 'INTAKE_REFUSED'
            : 'INTAKE_FAILED';
      assert.match(lines.join('\n'), new RegExp('terminal state .*' + expected));
      assert.match(
        decisions
          .readDecisions({ dir })
          .map((r) => JSON.stringify(r))
          .join('\n'),
        new RegExp(expected)
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const scenario of ['success', 'failure', 'throw', 'budget', 'post-select-error']) {
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
  let repairCalls = 0;
  const result = await safeRun(
    baseOpts({
      decisionDir: dir,
      reviewBudget: 2,
      run: recorder([liveLaunch()]),
      // Each repair makes progress (a new commit), so only the budget can stop
      // the loop; a repair without progress stops earlier (REPAIR_NO_PROGRESS).
      repairer: () => {
        repairCalls += 1;
        return { sha: String(repairCalls).repeat(40) };
      },
      reviewer: (arg) => {
        reviewCalls += 1;
        return {
          pass: false,
          sha: (typeof arg === 'string' ? arg : arg && arg.sha) || SHA_A,
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

test('64-10b a repair that runs but leaves the SHA unchanged ends BLOCKED with REPAIR_NO_PROGRESS (TASK-AI-60)', async () => {
  const dir = tmpDir('task-ai-64-no-progress-');
  let repairCalls = 0;
  const result = await safeRun(
    baseOpts({
      decisionDir: dir,
      reviewBudget: 3,
      run: recorder([liveLaunch()]),
      repairer: (findings, sha) => {
        repairCalls += 1;
        return { sha: sha || SHA_A };
      },
      reviewer: (arg) => ({
        pass: false,
        sha: (typeof arg === 'string' ? arg : arg && arg.sha) || SHA_A,
        verdict: 'CHANGES_REQUIRED',
        findings: [{ id: 'F-NP', open: true }],
      }),
    })
  );
  assert.ok(result.log, 'the loop must return a run record: ' + result.refusal);
  assert.equal(repairCalls, 1, 'a repair without progress stops the loop after one repair');
  assert.equal(isLiveCompletion(result, 'A'), false);
  const text = decisionText(dir);
  assert.ok(text.includes('REPAIR_NO_PROGRESS'), 'the decision log must name REPAIR_NO_PROGRESS');
  assert.ok(
    !text.includes('REPAIR_BUDGET_EXHAUSTED'),
    'a no-progress stop is not a budget exhaustion'
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
        if (cargs && cargs.includes('rev-parse')) {
          return { status: 0, stdout: '0123456789012345678901234567890123456789\n' };
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
      // With no workerRoot the repair has no worker repo to advance. Had it bound
      // to the process.cwd() repo, HEAD there would differ from SHA_A and count as
      // progress; instead the repair makes none and the run stops (TASK-AI-60).
      assert.equal(reviewCalls, 1, 'a repair without progress stops after one review');
      assert.ok(
        decisionText(dirBudget).includes('REPAIR_NO_PROGRESS'),
        'decision log must record REPAIR_NO_PROGRESS'
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

describe('TASK-AI-64 worker timeout and upstream quota fallback (DEFECT M)', () => {
  test('worker killed by launcher timeout falls back to candidate in alternate upstream failure domain (fails at 790b644, passes after)', async () => {
    const hostRepo = makeTempRepo();
    const decisionDir = tmpDir('task-ai-64-defect-m-to-dec-');
    const evidenceDir = tmpDir('task-ai-64-defect-m-to-ev-');

    const candAg = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.7-flash-medium',
      source: 'oc',
    });
    const candGh = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/gh/gpt-5.3-codex',
      source: 'oc',
    });

    const calls = [];
    const run = (job) => {
      calls.push(job);
      if (job.upstream === 'ag' || (job.model && job.model.includes('gemini'))) {
        return {
          exitCode: -1,
          timedOut: true,
          stdout: '',
          stderr: '[ISOLATION_LAUNCHER] worker timed out after 1800000 ms and was killed',
        };
      }
      return {
        exitCode: 0,
        timedOut: false,
        stdout:
          'the agent changed production code\n{"sessionID":"session-defect-m-to","tokens":{"input":10,"output":20,"total":30}}',
        stderr: '',
        completionNonce: 'nonce-defect-m-to',
      };
    };

    try {
      const result = await safeRun(
        baseOpts({
          run,
          cwd: hostRepo.dir,
          baseSha: hostRepo.sha,
          sha: hostRepo.sha,
          decisionDir,
          evidenceDir,
          ranking: { priors: { ranking: [] } },
          candidates: [candAg, candGh],
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

      assert.ok(result.log, 'orchestration returns log');
      assert.strictEqual(
        result.log.status,
        'COMPLETED',
        'orchestration must succeed by falling back to alternate upstream'
      );
      assert.strictEqual(calls.length, 2, 'must attempt both candidates');
      assert.strictEqual(calls[0].upstream, 'ag', 'first attempt was ag');
      assert.strictEqual(calls[1].upstream, 'gh', 'fallback attempt was gh');
      assert.deepEqual(result.log.reconciliation.completed, ['TASK-AI-64']);

      const failedDecisions = decisionLines(decisionDir).filter((d) => d.stage === 'failed');
      assert.ok(failedDecisions.length > 0, 'decision log must contain failed record for timeout');
      assert.strictEqual(failedDecisions[0].failureScope, 'upstream');
      assert.strictEqual(failedDecisions[0].detail, 'timeout');
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });

  test('worker with upstream Unavailable error classifies as QUOTA_EXHAUSTED and falls back to alternate upstream (fails at 790b644, passes after)', async () => {
    const hostRepo = makeTempRepo();
    const decisionDir = tmpDir('task-ai-64-defect-m-quota-dec-');
    const evidenceDir = tmpDir('task-ai-64-defect-m-quota-ev-');

    const candAg = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.7-flash-medium',
      source: 'oc',
    });
    const candGh = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/gh/gpt-5.3-codex',
      source: 'oc',
    });

    const calls = [];
    const run = (job) => {
      calls.push(job);
      if (job.upstream === 'ag') {
        return {
          exitCode: 1,
          timedOut: false,
          stdout:
            'OpenCode error event: {"type":"error","error":{"message":"Unavailable (reset after 116h)"}}',
          stderr: '',
        };
      }
      return {
        exitCode: 0,
        timedOut: false,
        stdout:
          'the agent changed production code\n{"sessionID":"session-defect-m-quota","tokens":{"input":10,"output":20,"total":30}}',
        stderr: '',
        completionNonce: 'nonce-defect-m-quota',
      };
    };

    try {
      const result = await safeRun(
        baseOpts({
          run,
          cwd: hostRepo.dir,
          baseSha: hostRepo.sha,
          sha: hostRepo.sha,
          decisionDir,
          evidenceDir,
          ranking: { priors: { ranking: [] } },
          candidates: [candAg, candGh],
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

      assert.ok(result.log, 'orchestration returns log');
      assert.strictEqual(
        result.log.status,
        'COMPLETED',
        'orchestration must succeed by falling back to alternate upstream'
      );
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[1].upstream, 'gh');

      const failedDecisions = decisionLines(decisionDir).filter((d) => d.stage === 'failed');
      assert.ok(failedDecisions.length > 0);
      assert.strictEqual(failedDecisions[0].failureScope, 'upstream');
      assert.strictEqual(failedDecisions[0].detail, 'quota_exhausted');
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });

  test('worker timeout with no alternate failure domain blocks with structured reason and records cause in outcome (fails at 790b644, passes after)', async () => {
    const hostRepo = makeTempRepo();
    const decisionDir = tmpDir('task-ai-64-defect-m-noalt-dec-');
    const evidenceDir = tmpDir('task-ai-64-defect-m-noalt-ev-');

    const candAg = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.7-flash-medium',
      source: 'oc',
    });

    const run = () => ({
      exitCode: -1,
      timedOut: true,
      stderr: '[ISOLATION_LAUNCHER] worker timed out after 1800000 ms and was killed',
    });

    try {
      const result = await safeRun(
        baseOpts({
          run,
          cwd: hostRepo.dir,
          baseSha: hostRepo.sha,
          sha: hostRepo.sha,
          decisionDir,
          evidenceDir,
          candidates: [candAg],
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
      assert.ok(result.log.outcomes && result.log.outcomes.length > 0);
      assert.strictEqual(result.log.outcomes[0].status, 'blocked');
      assert.strictEqual(
        result.log.outcomes[0].reason,
        'NO_ALTERNATE_FAILURE_DOMAIN: upstream (timeout)'
      );
      assert.strictEqual(result.log.outcomes[0].cause, Cause.TIMEOUT);
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });

  test('worker quota error with no alternate failure domain blocks with structured reason and records cause in outcome (fails at 790b644, passes after)', async () => {
    const hostRepo = makeTempRepo();
    const decisionDir = tmpDir('task-ai-64-defect-m-noaltquota-dec-');
    const evidenceDir = tmpDir('task-ai-64-defect-m-noaltquota-ev-');

    const candAg = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.7-flash-medium',
      source: 'oc',
    });

    const run = () => ({
      exitCode: 1,
      stdout: '{"type":"error","error":{"message":"Unavailable (reset after 116h)"}}',
    });

    try {
      const result = await safeRun(
        baseOpts({
          run,
          cwd: hostRepo.dir,
          baseSha: hostRepo.sha,
          sha: hostRepo.sha,
          decisionDir,
          evidenceDir,
          candidates: [candAg],
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
      assert.ok(result.log.outcomes && result.log.outcomes.length > 0);
      assert.strictEqual(result.log.outcomes[0].status, 'blocked');
      assert.strictEqual(
        result.log.outcomes[0].reason,
        'NO_ALTERNATE_FAILURE_DOMAIN: upstream (quota_exhausted)'
      );
      assert.strictEqual(result.log.outcomes[0].cause, Cause.QUOTA_EXHAUSTED);
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });

  test('worker with OpenCode provider error envelope classifies as QUOTA_EXHAUSTED and falls back to alternate failure domain (Defect N)', async () => {
    const hostRepo = makeTempRepo();
    const decisionDir = tmpDir('task-ai-64-defect-n-fallback-dec-');
    const evidenceDir = tmpDir('task-ai-64-defect-n-fallback-ev-');

    const candCl = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'cl',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/cl/deepseek/deepseek-v4.1-flash',
      source: 'oc',
    });
    const candGh = cand({
      harness: 'opencode-direct',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/gh/gpt-5.3-codex',
      source: 'oc',
    });

    const live16Stdout =
      JSON.stringify({
        type: 'error',
        timestamp: 1790938156379,
        sessionID: 'ses_stripped',
        error: {
          name: 'APIError',
          data: {
            message:
              '[cline/cline-free/deepseek-v4.1-flash] [429]: {"error":{"code":"INFERENCE_CAP_ERROR","message":"Error 429: Daily free limit reached on model deepseek/deepseek-v4.1-flash. Try again in 15h 27m"}}\n (reset after 57s)',
            statusCode: 503,
            isRetryable: true,
            responseHeaders: {
              connection: 'keep-alive',
              'content-type': 'application/json',
              date: 'Fri, 02 Oct 2026 10:49:16 GMT',
              'keep-alive': 'timeout=5',
              'retry-after': '57',
              'transfer-encoding': 'chunked',
              vary: 'rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch',
            },
            responseBody:
              '{"error":{"message":"[cline/cline-free/deepseek-v4.1-flash] [429]: {\\"error\\":{\\"code\\":\\"INFERENCE_CAP_ERROR\\",\\"message\\":\\"Error 429: Daily free limit reached on model deepseek/deepseek-v4.1-flash. Try again in 15h 27m\\"}}\\n (reset after 57s)"}}',
            metadata: {
              url: 'http://127.0.0.1:20128/v1/chat/completions',
            },
          },
        },
      }) + '\r\n';

    const calls = [];
    const run = (job) => {
      calls.push(job);
      if (job.upstream === 'cl') {
        return {
          exitCode: 1,
          timedOut: false,
          completed: true,
          stderr: '',
          failureReason: '',
          stdout: live16Stdout,
          completionNonce: '049a76c079c16bf10e7fb9559dfabd9f',
        };
      }
      return {
        exitCode: 0,
        timedOut: false,
        completed: true,
        stdout:
          'the agent changed production code\n{"sessionID":"session-defect-n-fallback","tokens":{"input":10,"output":20,"total":30}}',
        stderr: '',
        completionNonce: 'nonce-defect-n-fallback',
      };
    };

    try {
      const result = await safeRun(
        baseOpts({
          run,
          cwd: hostRepo.dir,
          baseSha: hostRepo.sha,
          sha: hostRepo.sha,
          decisionDir,
          evidenceDir,
          ranking: { priors: { ranking: [] } },
          candidates: [candCl, candGh],
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

      assert.ok(result.log, 'orchestration returns log');
      assert.strictEqual(
        result.log.status,
        'COMPLETED',
        'orchestration must succeed by falling back to alternate upstream failure domain'
      );
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].upstream, 'cl');
      assert.strictEqual(calls[1].upstream, 'gh');

      const failedDecisions = decisionLines(decisionDir).filter((d) => d.stage === 'failed');
      assert.ok(failedDecisions.length > 0);
      assert.strictEqual(failedDecisions[0].failureScope, 'upstream');
      assert.strictEqual(failedDecisions[0].detail, 'quota_exhausted');
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });
});

describe('TASK-AI-64 hardened dirty check agrees with provisioned checkout line-ending normalization and worker excludes (DEFECT O)', () => {
  const isoMod = require('../isolation-launcher');
  const { isTreeDirty, verifyWorkerCommit } = require('../orchestrate');
  const { readSafeRepoConfig } = require('../supervisor');

  test('a provisioned worker root with a CRLF-normalized tracked file and excluded scratch is NOT dirty, a real uncommitted change IS dirty (fails at fdd1f80, passes after)', () => {
    const hostRepo = makeTempRepo();
    const git = (args, cwd) =>
      spawnSync('git', ['-c', 'safe.directory=*', ...args], {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
      });

    const trackedRelPath = path.join('docs', 'validate_docs.py');
    fs.mkdirSync(path.join(hostRepo.dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(hostRepo.dir, trackedRelPath), 'def validate():\n    return True\n');
    git(['add', '.'], hostRepo.dir);
    git(['commit', '-q', '-m', 'add validate_docs'], hostRepo.dir);
    const hostSha = git(['rev-parse', 'HEAD'], hostRepo.dir).stdout.trim();

    fs.mkdirSync(path.join(hostRepo.dir, 'scripts', 'ai', 'isolation'), { recursive: true });
    fs.writeFileSync(
      path.join(hostRepo.dir, 'scripts', 'ai', 'isolation', 'dummy.ps1'),
      '# dummy\n'
    );
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts', 'ai', 'isolation'));

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-worker-eol-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-eol-'));
    const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        verdict: 'CLOSED',
        timestamp: new Date().toISOString(),
        sid: 'TEST-SID',
        worktree: hostRepo.dir,
        policyHash,
        details: { check: 'PASS' },
      })
    );

    const runIso = isoMod.getIsolatedLauncher();
    const mockAdapter = { id: 'echo', command: 'echo' };

    try {
      runIso(mockAdapter, ['hello'], {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: hostSha,
        verdictPath,
        autocrlf: 'true', // Ubuntu-portable: explicit CRLF normalization requested for provision
        getWorkerSid: () => 'TEST-SID',
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, opts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh')
            return { status: 0, stdout: 'ok', stderr: '' };
          return spawnSync(cmd, args, opts);
        },
      });
    } catch {
      // provisioning is what we verify
    }

    try {
      // Ensure the tracked file on disk has CRLF line endings (matching a checkout under core.autocrlf=true)
      const trackedWorkerPath = path.join(workerDir, trackedRelPath);
      const content = fs.readFileSync(trackedWorkerPath, 'utf8');
      if (!content.includes('\r\n')) {
        fs.writeFileSync(trackedWorkerPath, content.replace(/\r?\n/g, '\r\n'), 'utf8');
      }

      // Worker commits its own work (so HEAD != baseSha)
      git(['config', 'user.name', 'Worker'], workerDir);
      git(['config', 'user.email', 'worker@example.com'], workerDir);
      fs.writeFileSync(path.join(workerDir, 'solution.js'), 'module.exports = 42;\n');
      git(['add', 'solution.js'], workerDir);
      git(['commit', '-q', '-m', 'feat: solution'], workerDir);
      const workerSha = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.notStrictEqual(workerSha, hostSha);

      // Excluded scratch across all standard worker categories
      fs.mkdirSync(path.join(workerDir, '.shipde'), { recursive: true });
      fs.writeFileSync(
        path.join(workerDir, '.shipde', 'launch-args.json'),
        JSON.stringify({ args: [] })
      );
      fs.writeFileSync(path.join(workerDir, 'run-target.ps1'), '# script');
      fs.writeFileSync(
        path.join(workerDir, 'run-target.complete.json'),
        JSON.stringify({ done: true })
      );
      fs.mkdirSync(path.join(workerDir, 'temp'), { recursive: true });
      fs.writeFileSync(path.join(workerDir, 'temp', 'scratch.tmp'), 'temp');
      fs.mkdirSync(path.join(workerDir, '.config'), { recursive: true });
      fs.writeFileSync(path.join(workerDir, '.config', 'cfg'), 'cfg');
      fs.mkdirSync(path.join(workerDir, '.local'), { recursive: true });
      fs.writeFileSync(path.join(workerDir, '.local', 'state'), 'state');
      fs.mkdirSync(path.join(workerDir, 'Microsoft'), { recursive: true });
      fs.writeFileSync(path.join(workerDir, 'Microsoft', 'telemetry'), 'telemetry');
      fs.mkdirSync(path.join(workerDir, 'tools', 'ai-brain', 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(workerDir, 'tools', 'ai-brain', 'test', 'e1-branch-name.test.js'),
        '// runner'
      );
      fs.writeFileSync(path.join(workerDir, 'opencode.json'), '{}');

      // Check 1: Provisioned worker root with CRLF-normalized tracked file and scratch is NOT dirty
      assert.strictEqual(
        isTreeDirty(workerDir),
        false,
        'provisioned worker root with CRLF tracked file and excluded scratch must NOT be dirty'
      );
      const commitCheck = verifyWorkerCommit(workerDir, hostSha);
      assert.strictEqual(
        commitCheck.pass,
        true,
        'verifyWorkerCommit must pass on clean worker root'
      );
      assert.strictEqual(commitCheck.headSha, workerSha);
      assert.strictEqual(commitCheck.baseSha, hostSha);

      // Check 2: A real uncommitted change IS dirty
      fs.appendFileSync(path.join(workerDir, 'solution.js'), '// uncommitted change\n');
      assert.strictEqual(
        isTreeDirty(workerDir),
        true,
        'worker root with real uncommitted changes MUST be dirty'
      );
      const commitCheckDirty = verifyWorkerCommit(workerDir, hostSha);
      assert.strictEqual(commitCheckDirty.pass, false);
      assert.strictEqual(commitCheckDirty.cause, 'NO_LOCAL_COMMIT');
      assert.match(commitCheckDirty.detail, /dirty tree/);
    } finally {
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
    }
  });

  test('hardened status honours worker-root excludes even when worker info/exclude cannot be resolved (workerWritable worktree)', () => {
    const repo = makeTempRepo();
    try {
      // Simulate scratch files in worker root without writing to .git/info/exclude
      fs.mkdirSync(path.join(repo.dir, '.shipde'), { recursive: true });
      fs.writeFileSync(path.join(repo.dir, '.shipde', 'marker.json'), '{}');
      fs.writeFileSync(path.join(repo.dir, 'run-target.ps1'), '# run target');
      fs.writeFileSync(path.join(repo.dir, 'run-target.complete.json'), '{}');
      fs.mkdirSync(path.join(repo.dir, 'temp'), { recursive: true });
      fs.writeFileSync(path.join(repo.dir, 'temp', 'foo.tmp'), 'tmp');
      fs.mkdirSync(path.join(repo.dir, '.config'), { recursive: true });
      fs.writeFileSync(path.join(repo.dir, '.config', 'cfg'), 'cfg');
      fs.mkdirSync(path.join(repo.dir, '.local'), { recursive: true });
      fs.writeFileSync(path.join(repo.dir, '.local', 'state'), 'state');
      fs.mkdirSync(path.join(repo.dir, 'Microsoft'), { recursive: true });
      fs.writeFileSync(path.join(repo.dir, 'Microsoft', 'telemetry'), 'telemetry');
      fs.mkdirSync(path.join(repo.dir, 'tools', 'ai-brain', 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(repo.dir, 'tools', 'ai-brain', 'test', 'e1-branch-name.test.js'),
        '// runner'
      );
      fs.writeFileSync(path.join(repo.dir, 'opencode.json'), '{}');

      // isTreeDirty must honour the worker-root excludes even if worker info/exclude was never populated
      assert.strictEqual(
        isTreeDirty(repo.dir),
        false,
        'hardened dirty check must honour all worker-root excludes'
      );
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('readSafeRepoConfig extracts safe settings and ignores worker-controlled hooks, fsmonitor, and filters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-safe-cfg-'));
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.git', 'config'),
      '[core]\n\tautocrlf = input\n\teol = lf\n\tfilemode = false\n\thooksPath = C:/malicious/hooks\n\tfsmonitor = C:/malicious/daemon\n[diff]\n\texternal = C:/malicious/diff\n'
    );
    try {
      const conf = readSafeRepoConfig(dir);
      assert.strictEqual(conf.autocrlf, 'input');
      assert.strictEqual(conf.eol, 'lf');
      assert.strictEqual(conf.filemode, 'false');
      assert.strictEqual(conf.hooksPath, undefined);
      assert.strictEqual(conf.fsmonitor, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TASK-AI-64 provisioned worker root pinned to base SHA in linked worktree (DEFECT Q)', () => {
  const { isTreeDirty, verifyWorkerCommit } = require('../orchestrate');
  const isoMod = require('../isolation-launcher');
  const { captureFailBefore } = require('../isolation-launcher');
  const supervisor = require('../supervisor');

  test('provisioning pins worker root to base SHA when host is a linked worktree whose primary HEAD differs from base SHA (fails at adb6cfc, passes after)', () => {
    const primaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-primary-'));
    const hostWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-linked-'));
    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-worker-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-verdict-'));
    const git = (args, cwd) =>
      spawnSync('git', ['-c', 'safe.directory=*', ...args], {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
      });

    try {
      git(['init', '-q', '-b', 'main'], primaryDir);
      git(['config', 'user.email', 'worker@shipde.test'], primaryDir);
      git(['config', 'user.name', 'Worker'], primaryDir);
      fs.writeFileSync(path.join(primaryDir, 'file.txt'), 'version 1\n');
      git(['add', '.'], primaryDir);
      git(['commit', '-q', '-m', 'commit 1'], primaryDir);
      const c1Sha = git(['rev-parse', 'HEAD'], primaryDir).stdout.trim();

      // Create branch feat/task-ai-64 pointing to c1
      git(['branch', 'feat/task-ai-64'], primaryDir);

      // Create commit c2 on main
      fs.writeFileSync(path.join(primaryDir, 'file.txt'), 'version 2\n');
      git(['commit', '-q', '-am', 'commit 2'], primaryDir);
      const c2Sha = git(['rev-parse', 'HEAD'], primaryDir).stdout.trim();
      assert.notStrictEqual(c1Sha, c2Sha);

      // Detach primary at c1 so primary HEAD is c1Sha, differing from base SHA c2Sha
      git(['checkout', '-q', c1Sha], primaryDir);
      assert.strictEqual(git(['rev-parse', 'HEAD'], primaryDir).stdout.trim(), c1Sha);

      // Add linked worktree hostWorktree at c2Sha
      git(['worktree', 'add', '--detach', '-q', hostWorktree, c2Sha], primaryDir);
      assert.strictEqual(git(['rev-parse', 'HEAD'], hostWorktree).stdout.trim(), c2Sha);

      fs.mkdirSync(path.join(hostWorktree, 'scripts', 'ai', 'isolation'), { recursive: true });
      fs.writeFileSync(
        path.join(hostWorktree, 'scripts', 'ai', 'isolation', 'dummy.ps1'),
        '# dummy\n'
      );
      const policyHash = isoMod.getFolderHash(
        path.join(hostWorktree, 'scripts', 'ai', 'isolation')
      );
      const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
      fs.writeFileSync(
        verdictPath,
        JSON.stringify({
          verdict: 'CLOSED',
          timestamp: new Date().toISOString(),
          sid: 'TEST-SID',
          worktree: hostWorktree,
          policyHash,
          details: { check: 'PASS' },
        })
      );

      const runIso = isoMod.getIsolatedLauncher();
      const mockAdapter = { id: 'echo', command: 'echo' };

      try {
        runIso(mockAdapter, ['hello'], {
          cwd: hostWorktree,
          workerRoot: workerDir,
          baseSha: c2Sha,
          workItemId: 'TASK-AI-64',
          branch: 'feat/task-ai-64',
          verdictPath,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          isWorkerPath: () => true,
          spawnSync: (cmd, args, opts) => {
            if (cmd === 'powershell.exe' || cmd === 'pwsh')
              return { status: 0, stdout: 'ok', stderr: '' };
            return spawnSync(cmd, args, opts);
          },
        });
      } catch {
        // provisioning is what we verify
      }

      // Worker root HEAD must be pinned to c2Sha (baseSha), NOT c1Sha (primary checkout / clone default)
      const workerHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.strictEqual(
        workerHead,
        c2Sha,
        'provisioned worker root HEAD must match requested baseSha exactly'
      );

      // Remote origin tracking ref in worker root must also be updated to c2Sha
      const remoteBranchSha = git(
        ['rev-parse', 'refs/remotes/origin/feat/task-ai-64'],
        workerDir
      ).stdout.trim();
      assert.strictEqual(
        remoteBranchSha,
        c2Sha,
        'remote origin tracking branch must be pinned to baseSha'
      );

      // Even after checking out the exercise branch, HEAD must remain at c2Sha
      git(['checkout', '-q', 'feat/task-ai-64'], workerDir);
      const postCheckoutHead = git(['rev-parse', 'HEAD'], workerDir).stdout.trim();
      assert.strictEqual(
        postCheckoutHead,
        c2Sha,
        'HEAD after checking out exercise branch must remain at baseSha'
      );
    } finally {
      fs.rmSync(primaryDir, { recursive: true, force: true });
      fs.rmSync(hostWorktree, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
    }
  });

  test('hard structured failure PROVISION_BASE_MISMATCH if provisioned worker root HEAD does not match requested base SHA', () => {
    const hostRepo = makeTempRepo();
    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-worker-mismatch-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-verdict-mismatch-'));
    fs.mkdirSync(path.join(hostRepo.dir, 'scripts', 'ai', 'isolation'), { recursive: true });
    fs.writeFileSync(
      path.join(hostRepo.dir, 'scripts', 'ai', 'isolation', 'dummy.ps1'),
      '# dummy\n'
    );
    const policyHash = isoMod.getFolderHash(path.join(hostRepo.dir, 'scripts', 'ai', 'isolation'));
    const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        verdict: 'CLOSED',
        timestamp: new Date().toISOString(),
        sid: 'TEST-SID',
        worktree: hostRepo.dir,
        policyHash,
        details: { check: 'PASS' },
      })
    );

    const runIso = isoMod.getIsolatedLauncher();
    const mockAdapter = { id: 'echo', command: 'echo' };

    const origWithClean = supervisor.withCleanGitEnv;
    supervisor.withCleanGitEnv = () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    let thrown = null;
    try {
      runIso(mockAdapter, ['hello'], {
        cwd: hostRepo.dir,
        workerRoot: workerDir,
        baseSha: hostRepo.sha,
        verdictPath,
        getWorkerSid: () => 'TEST-SID',
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        spawnSync: (cmd, args, opts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh')
            return { status: 0, stdout: 'ok', stderr: '' };
          return spawnSync(cmd, args, opts);
        },
      });
    } catch (err) {
      thrown = err;
    } finally {
      supervisor.withCleanGitEnv = origWithClean;
      fs.rmSync(hostRepo.dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
    }

    assert.ok(thrown, 'must throw on provisioned HEAD mismatch');
    assert.strictEqual(thrown.code, 'PROVISION_BASE_MISMATCH');
    assert.match(thrown.message, /PROVISION_BASE_MISMATCH/);
  });

  test('pre-launch check throws PROVISION_BASE_MISMATCH if worker root HEAD moves before agent start', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-prelaunch-'));
    const git = (args) =>
      spawnSync('git', ['-c', 'safe.directory=*', ...args], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
      });
    git(['init', '-q']);
    git(['config', 'user.email', 'worker@shipde.test']);
    git(['config', 'user.name', 'Worker']);
    fs.writeFileSync(path.join(dir, 'payload.txt'), 'init\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'init']);
    const c1 = git(['rev-parse', 'HEAD']).stdout.trim();
    fs.writeFileSync(path.join(dir, 'payload.txt'), 'second\n');
    git(['commit', '-q', '-am', 'second']);
    const c2 = git(['rev-parse', 'HEAD']).stdout.trim();

    const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-worker-pl-'));
    const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-64-verdict-pl-'));
    fs.mkdirSync(path.join(dir, 'scripts', 'ai', 'isolation'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'ai', 'isolation', 'dummy.ps1'), '# dummy\n');
    const policyHash = isoMod.getFolderHash(path.join(dir, 'scripts', 'ai', 'isolation'));
    const verdictPath = path.join(verdictDir, 'isolation-verdict.json');
    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        verdict: 'CLOSED',
        timestamp: new Date().toISOString(),
        sid: 'TEST-SID',
        worktree: dir,
        policyHash,
        details: { check: 'PASS' },
      })
    );

    const runIso = isoMod.getIsolatedLauncher();
    const mockAdapter = { id: 'echo', command: 'echo' };

    let thrown = null;
    try {
      runIso(mockAdapter, ['hello'], {
        cwd: dir,
        workerRoot: workerDir,
        baseSha: c2,
        verdictPath,
        getWorkerSid: () => 'TEST-SID',
        verifyBoundary: () => true,
        isWorkerPath: () => true,
        onProvisioned: (root) => {
          // Simulate moving HEAD away from baseSha before agent starts
          spawnSync('git', ['-c', 'safe.directory=*', 'checkout', '-q', c1], { cwd: root });
        },
        spawnSync: (cmd, args, opts) => {
          if (cmd === 'powershell.exe' || cmd === 'pwsh')
            return { status: 0, stdout: 'ok', stderr: '' };
          return spawnSync(cmd, args, opts);
        },
      });
    } catch (err) {
      thrown = err;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
      fs.rmSync(verdictDir, { recursive: true, force: true });
    }

    assert.ok(thrown, 'must throw when HEAD moves before launch');
    assert.strictEqual(thrown.code, 'PROVISION_BASE_MISMATCH');
    assert.match(thrown.message, /PROVISION_BASE_MISMATCH: worker root HEAD before agent start/);
  });

  test('captureFailBefore asserts ancestry and throws FAIL_BEFORE_ANCESTRY_MISMATCH when base SHA is not ancestor of worker HEAD', () => {
    const repo = makeTempRepo();
    const runnerDir = path.join(repo.dir, 'tools', 'ai-brain', 'test');
    fs.mkdirSync(runnerDir, { recursive: true });
    fs.writeFileSync(path.join(runnerDir, 'e1-branch-name.test.js'), '// runner\n');

    try {
      // 1. Ancestry matches: passes
      const matchingRes = captureFailBefore(repo.dir, {
        baseSha: repo.sha,
        exerciseCommand: 'git status',
      });
      assert.strictEqual(matchingRes.ancestry, true);

      // 2. Ancestry mismatch: throws FAIL_BEFORE_ANCESTRY_MISMATCH
      let ancestryErr = null;
      try {
        captureFailBefore(repo.dir, {
          baseSha: '1111222233334444555566667777888899990000',
          exerciseCommand: 'git status',
        });
      } catch (err) {
        ancestryErr = err;
      }
      assert.ok(ancestryErr, 'must throw on ancestry mismatch');
      assert.strictEqual(ancestryErr.code, 'FAIL_BEFORE_ANCESTRY_MISMATCH');
      assert.match(ancestryErr.message, /FAIL_BEFORE_ANCESTRY_MISMATCH/);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('verifyWorkerCommit fails with NO_LOCAL_COMMIT when worker commit is not a descendant of base SHA (fails at adb6cfc, passes after)', () => {
    const repo = makeTempRepo();
    const git = (args) =>
      spawnSync('git', ['-c', 'safe.directory=*', ...args], {
        cwd: repo.dir,
        encoding: 'utf8',
        windowsHide: true,
      });

    try {
      const c1Sha = repo.sha;

      git(['checkout', '-q', '-b', 'branchA']);
      fs.writeFileSync(path.join(repo.dir, 'a.txt'), 'branchA content\n');
      git(['add', '.']);
      git(['commit', '-q', '-m', 'branchA commit']);
      const branchASha = git(['rev-parse', 'HEAD']).stdout.trim();

      git(['checkout', '-q', c1Sha]);
      git(['checkout', '-q', '-b', 'branchB']);
      fs.writeFileSync(path.join(repo.dir, 'b.txt'), 'branchB content\n');
      git(['add', '.']);
      git(['commit', '-q', '-m', 'branchB commit']);
      const branchBSha = git(['rev-parse', 'HEAD']).stdout.trim();

      const check = verifyWorkerCommit(repo.dir, branchASha);
      assert.strictEqual(check.pass, false);
      assert.strictEqual(check.cause, 'NO_LOCAL_COMMIT');
      assert.match(check.detail, /not a descendant of base SHA/);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});
