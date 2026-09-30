'use strict';

/**
 * Ship Dễ — Autonomous loop orchestration (TASK-AI-60 loop, TASK-AI-64 live).
 *
 * user goal -> validated DAG -> Controller candidate -> pinned execution ->
 * isolated worker -> code/test/commit -> exact-SHA review -> bounded repair ->
 * checkpoint/resume -> publisher draft PR.
 *
 * What changed at the live level, and why each seam is the way it is:
 *
 *   - Selection is the Controller's alone (AI-64-P01). The loop calls
 *     ranking.rankAndRecord — the single ranking engine — as a live decision
 *     with the decision log's own options, so the choice is written *before* the
 *     launch instead of being computed and discarded. There is no second
 *     ranking, no second fallback scan and no queue here: the failure-domain
 *     rule is the Controller's sameFailureDomain, driven by the shared failure
 *     classifier.
 *   - A launch is a launch only with evidence (AI-64-P08). The no-op default
 *     launcher is gone. A run handed no launcher, or a launch that produced no
 *     durable session report, is a refusal that writes no `launched` record and
 *     completes nothing.
 *   - The session handle is the report the loop itself asked for; a process pid
 *     is never recorded as a session.
 *   - Progress, stall and empty success come from the supervisor, called where
 *     the old code only imported it, over host-side progress markers.
 *   - The checkpoint is the existing dispatch checkpoint, read with the existing
 *     reader, written with the existing atomic writer and extended with the live
 *     fields. The in-memory resume object is deleted.
 *   - Tests, review and repair have no defaults. A gate the caller forgot is a
 *     refusal; a review must name the commit it read; a review that resolves to
 *     the writer is refused.
 *   - Publication is a separate, gated stage: the reviewed SHA plus an approval a
 *     named human authority wrote, on the operator side, and the only Pull
 *     Request it can create is a draft.
 *
 * Every refusal carries its reason and every terminal string is distinct, so
 * "nothing happened" never reads as "it worked".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const planner = require('./planner');
const { compilePrompt } = require('./prompt-compiler');
const { classifySession, Status: SessionStatus, progressFromWorkerRoot } = require('./supervisor');
const { runReviewLoop, Status: ReviewStatus } = require('./review-loop');
const ranking = require('./ranking');
const decisions = require('./decisions');
const { candidateKey } = require('./candidates');
const { classifyFailure } = require('./failure-classifier');

const ItemStatus = Object.freeze({
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  DEFERRED: 'deferred',
});

const RunStatus = Object.freeze({
  PUBLISHED_DRAFT: 'PUBLISHED_DRAFT',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  REFUSED: 'REFUSED',
  FAILED: 'FAILED',
});

const PublicationStatus = Object.freeze({
  PUBLISHED_DRAFT: 'PUBLISHED_DRAFT',
  NOT_REQUESTED: 'NOT_REQUESTED',
  REFUSED: 'REFUSED',
});

const DEFAULT_REVIEW_BUDGET = 3;
const SHA_40 = /^[0-9a-f]{40}$/i;

function buildDefaults() {
  return {
    goal: null,
    plan: { workItems: [], errors: [] },
    prompts: [],
    selections: [],
    launches: [],
    sessions: [],
    reviews: [],
    review: null,
    outcomes: [],
    reconciliation: null,
    checkpoint: null,
    publications: [],
    publication: null,
    isolation: null,
    status: null,
    refusal: null,
  };
}

function roleOf(item) {
  return (item && item.roleRequirement && item.roleRequirement.role) || 'author.foundation';
}

/** The Controller seams this loop consumes instead of reimplementing. */
function controller() {
  // Required lazily: cli.js is the Controller entrypoint and requires this
  // module back for its own `orchestrate` command, so the two must not load each
  // other at module scope.
  return require('./cli');
}

/**
 * The launcher for one run.
 *
 * An injected runner stands in for the harness process (tests, and any caller
 * that drives the loop itself); the isolated launcher is what a live run uses
 * when the worker boundary is requested. Neither decides *whether* the boundary
 * exists — that is `isolatedWorker` alone.
 *
 * null when the run was handed no launcher at all: every item is then refused,
 * never simulated.
 */
function resolveLauncher(o, isolatedLauncher) {
  if (typeof o.run === 'function') return o.run;
  if (!isolatedLauncher) return null;
  const { getHarness } = require('./harness');
  return (job) => {
    const adapter = getHarness(job.harness);
    if (!adapter) throw new Error('HARNESS_UNKNOWN: ' + String(job.harness));
    return isolatedLauncher(adapter, adapter.launch(job), {
      cwd: job.cwd,
      baseSha: job.baseSha,
      verdictPath: job.verdictPath,
    });
  };
}

function harnessFor(candidate) {
  try {
    return require('./harness').getHarness(candidate && candidate.harness);
  } catch (err) {
    return null;
  }
}

/**
 * The host-side test gate: the item's own verification command, run here.
 *
 * Host-side because the worker is untrusted — a failing test the worker reports
 * is a failing test the worker can also hide. The command is the work item's own
 * declared verification command, authored in the plan, never anything the worker
 * produced, and an item that declares none is refused rather than assumed
 * (AI-64-R06).
 */
function runVerificationCommand(item, options) {
  const o = options || {};
  const verification = (item && item.verification) || null;
  const command = verification && verification.command;
  if (!command) {
    return {
      pass: false,
      cause: 'VERIFICATION_COMMAND_MISSING',
      findings: [
        {
          id: 'VERIFICATION_COMMAND_MISSING',
          open: true,
          detail: 'the work item declares no verification.command (AI-64-R06)',
        },
      ],
    };
  }
  const cwd = o.workerRoot || o.cwd || process.cwd();
  const res = spawnSync(command, {
    cwd,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    timeout: o.timeoutMs || 30 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = String((res && res.stdout) || '') + String((res && res.stderr) || '');
  const expect = verification.expect || null;
  const exitOk = Boolean(res) && res.status === 0;
  const expectOk = expect ? output.includes(expect) : true;
  return {
    pass: exitOk && expectOk,
    cause: exitOk && expectOk ? null : exitOk ? 'VERIFICATION_EXPECT_MISSING' : 'VERIFICATION_EXIT',
    command,
    expect,
    exitCode: res ? res.status : null,
    detail: output.slice(-2000),
  };
}

/**
 * The review lane, when the caller wired one.
 *
 * A reviewer is a Controller-scheduled role (scheduler.js REVIEW_ROLES), never a
 * literal here. This slice has no Node route for it: the live exact-SHA review is
 * the host-authenticated CLI control.ps1 drives against a Pull Request, and a
 * live run has no Pull Request at review time. Inventing one would be a guessed
 * external API and a hard-coded model, which AI-64-P01 and AI-64-P06 forbid, so
 * an unwired lane refuses loudly instead of passing the item.
 */
function reviewLane(o, writerKey) {
  if (o.reviewerIdentity && writerKey && o.reviewerIdentity === writerKey) {
    return () => ({
      pass: false,
      sha: null,
      verdict: 'REFUSED',
      findings: [
        {
          id: 'REVIEWER_EQUALS_WRITER',
          open: true,
          detail: 'the review lane resolved to the writer candidate ' + String(writerKey),
        },
      ],
    });
  }
  return () => {
    throw new Error(
      'REVIEW_ROUTE_UNAVAILABLE: no exact-SHA review lane is wired for the live loop'
    );
  };
}

/**
 * A repair task: the open findings become a new work-item spec whose acceptance
 * criteria are those findings, and the spec goes back through planner.plan, so the
 * fail-closed checks still run (AI-64-R09).
 *
 * A repair round claims no new file ownership: those files are already owned by
 * the item it repairs, and a repair that claimed them again is refused at the
 * planner's FILE_OWNED_TWICE check — which is the point. The refusal has to
 * happen at the planner, not downstream.
 */
function repairSpec(item, findings, round) {
  return {
    id: item.id + '-repair-' + round,
    role: roleOf(item),
    files: [],
    allowedPaths: (item.allowedPaths || []).slice(),
    dependencies: [item.id],
    acceptanceCriteria: (findings || []).map(
      (f) => (f && f.id ? f.id : 'finding') + ': ' + String((f && f.detail) || 'open finding')
    ),
    verification: (item && item.verification) || null,
  };
}

function headShaOf(cwd) {
  if (!cwd) return null;
  const res = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  if (!res || res.status !== 0) return null;
  return String(res.stdout || '').trim() || null;
}

/** Progress markers, measured host-side from the worker's own worktree. */
function progressOf(o, res, now) {
  const merged = Object.assign({}, (res && res.progress) || {});
  const root = o.workerRoot || o.cwd;
  if (root) Object.assign(merged, progressFromWorkerRoot(root, { baseSha: o.baseSha, now }));
  return merged;
}

/**
 * The report path for one launch, with any report already at that path removed.
 *
 * A leftover report from an earlier launch is not evidence about this one: reading
 * it would turn a launch that produced no handle into one that did, which is the
 * simulated-success failure this loop refuses to make. The path is per attempt, so
 * two attempts in one run cannot collide either.
 */
function prepareUsageReport(dir, stem) {
  const file = path.join(dir, stem + '.json');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.unlinkSync(file);
  } catch (err) {
    // No report there yet, which is the normal case.
  }
  return file;
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

const EXERCISE_CASES = path.join(__dirname, 'exercise', 'e1-branch-name.cases.json');
const EXERCISE_RUNNER = path.join('tools', 'ai-brain', 'test', 'e1-branch-name.test.js');
const THROWS = 'THROWS:';

/**
 * Materialises the exercise's runner INSIDE the worker root, from the committed
 * case data, before the agent is launched.
 *
 * The runner is deliberately never committed: `pnpm test:brain` is
 * `node --test "tools/ai-brain/test/*.test.js"`, so a committed copy at that path
 * would join the integration suite on main and break it there. The committed
 * artifact of the exercise is the data file, which asserts nothing by itself and
 * breaks nothing in CI.
 *
 * That gives the fail-before / pass-after pair its honesty: at the pinned base SHA
 * with this file present and `branch-name.js` absent, the command exits non-zero
 * with a missing-module error — a real captured run, not an assertion about one —
 * and after the agent implements the module the same command exits 0.
 *
 * `expect` is the exact expected string, or `THROWS:<CODE>` for the exact error
 * code the module must raise (as `err.code`, or as the start of `err.message`).
 *
 * Refuses a target that is not inside the worker root: the runner belongs in the
 * worker's own tree and nowhere else.
 */
function materialiseExercise(workerRoot, options) {
  const o = options || {};
  if (!workerRoot) {
    throw new Error(
      'EXERCISE_ROOT_MISSING: the exercise runner may only be written into a worker root'
    );
  }
  const root = path.resolve(workerRoot);
  const target = path.join(root, EXERCISE_RUNNER);
  if (path.relative(root, target).startsWith('..') || !path.isAbsolute(target)) {
    throw new Error('EXERCISE_ROOT_INVALID: refusing to write the runner outside the worker root');
  }
  if (!fs.existsSync(EXERCISE_CASES)) {
    throw new Error('EXERCISE_CASES_MISSING: ' + EXERCISE_CASES);
  }
  const cases = JSON.parse(fs.readFileSync(EXERCISE_CASES, 'utf8'));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('EXERCISE_CASES_EMPTY: ' + EXERCISE_CASES);
  }
  const body = [
    "'use strict';",
    '',
    '// Materialised inside the worker root from tools/ai-brain/exercise/e1-branch-name.cases.json.',
    '// Never committed: the test:brain glob would pick this file up on the integration',
    '// branch. Run it with: node --test tools/ai-brain/test/e1-branch-name.test.js',
    '',
    "const { test } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const cases = require('../exercise/e1-branch-name.cases.json');",
    "const { normalizeWorkItemBranch } = require('../branch-name');",
    '',
    'const THROWS = ' + JSON.stringify(THROWS) + ';',
    '',
    'for (const c of cases) {',
    '  test(c.name, () => {',
    '    if (typeof c.expect === "string" && c.expect.startsWith(THROWS)) {',
    '      const code = c.expect.slice(THROWS.length);',
    '      assert.throws(',
    '        () => normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome),',
    '        (err) => {',
    '          const named = String((err && err.code) || "") + " " + String((err && err.message) || "");',
    '          assert.ok(',
    '            named.includes(code),',
    '            "expected the thrown error to be " + code + ", got: " + named',
    '          );',
    '          return true;',
    '        }',
    '      );',
    '      return;',
    '    }',
    '    assert.equal(normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome), c.expect);',
    '  });',
    '}',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
  return { path: target, cases: cases.length };
}

/**
 * @param goal  user goal text
 * @param opts  {
 *   specs, specText, candidates, registry, run, isolatedWorker, tests, reviewer,
 *   repairer, reviewerIdentity, sha, baseSha, base, branch, cwd, workerRoot,
 *   usageDir, reviewBudget, decisionDir, checkpointFile, out, now, publication,
 *   ranking (Controller ranking inputs: headrooms, load, reservations, ...)
 * }
 */
function runOrchestration(goal, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const log = buildDefaults();
  log.goal = goal || null;

  // 1. plan (validated DAG). planner.js stays the only validator (AI-64-R01): an
  //    unknown dependency, a cycle or two items owning one file fails closed
  //    here, before anything is launched.
  log.plan = planner.plan(goal, { specs: o.specs || [] });

  const cli = controller();
  const decisionDir = o.decisionDir || null;
  const logOpts = { dir: decisionDir, now };
  const checkpointFile =
    o.checkpointFile || (typeof o.checkpoint === 'string' ? o.checkpoint : null);
  const usageDir = o.usageDir || path.join(os.tmpdir(), 'shipde-usage');

  // The trace is not optional (AI-64-R14): a run that cannot say where its
  // decisions are written is refused rather than quietly writing nothing.
  if (!decisionDir) {
    return refuseRun(log, 'DECISION_LOG_DIR_MISSING: a live run must be able to write its trace');
  }

  // 2. The worker boundary (AI-64-P03). The isolated launcher is obtained
  //    whenever the run asks for the boundary, whether or not a runner was
  //    injected: injecting a runner replaces what runs the process, never whether
  //    the boundary exists.
  let isolatedLauncher = null;
  if (o.isolatedWorker) {
    isolatedLauncher = require('./isolation-launcher').getIsolatedLauncher();
  }
  const launcher = resolveLauncher(o, isolatedLauncher);
  log.isolation = {
    requested: Boolean(o.isolatedWorker),
    launcherObtained: Boolean(isolatedLauncher),
    executor:
      typeof o.run === 'function' ? 'injected-runner' : isolatedLauncher ? 'isolated' : 'none',
    baseSha: o.baseSha || null,
  };

  // 3. Resume (AI-64-R14). The checkpoint file is the only resume input: a missing
  //    file is a clean first run, and an item the checkpoint already carries as
  //    completed is never launched again.
  const checkpointOnDisk = cli.readCheckpoint(checkpointFile);
  const completedBefore = new Set(
    checkpointOnDisk && Array.isArray(checkpointOnDisk.completed) ? checkpointOnDisk.completed : []
  );

  // 4. One writer per work item, and an unreadable log stops the run instead of
  //    reading as "no writers": the only evidence of a claim is the claim.
  const writers = decisions.openWritersDetailed(logOpts);
  const logUnreadable = writers.readable
    ? null
    : 'DECISION_LOG_UNREADABLE: ' + (writers.damaged.join('; ') || 'unknown');

  const statusOf = new Map();
  const candidates = Array.isArray(o.candidates) ? o.candidates : [];
  const registry = o.registry || { sources: [] };
  const sourcesApi = require('./sources');

  const outcome = (item, status, reason) => {
    statusOf.set(item.id, status);
    log.outcomes.push({ workItemId: item.id, status, reason: reason || null });
    return reason;
  };

  for (const item of log.plan.workItems) {
    if (log.plan.errors.length > 0) {
      // AI-64-R01: nothing is deferred silently; the errors travel in the run's
      // own outcome record and every item is reported as deferred.
      outcome(item, ItemStatus.DEFERRED, log.plan.errors.join('; '));
      continue;
    }
    if (completedBefore.has(item.id)) {
      outcome(item, ItemStatus.COMPLETED, 'CHECKPOINT_COMPLETED');
      continue;
    }
    if (logUnreadable) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: item.id,
          role: roleOf(item),
          detail: logUnreadable,
        },
        logOpts
      );
      outcome(item, ItemStatus.BLOCKED, logUnreadable);
      continue;
    }
    const claim = writers.writers.find((w) => w.workItemId === item.id);
    if (claim) {
      const reason = 'DUPLICATE_WRITER: session ' + (claim.sessionId || 'unknown') + ' holds it';
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: item.id,
          role: roleOf(item),
          detail: reason,
        },
        logOpts
      );
      outcome(item, ItemStatus.BLOCKED, reason);
      continue;
    }
    if (!launcher) {
      const reason =
        'LAUNCHER_MISSING: a live run needs a launcher; there is no default and no simulated success';
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: item.id,
          role: roleOf(item),
          detail: reason,
        },
        logOpts
      );
      outcome(item, ItemStatus.BLOCKED, reason);
      continue;
    }

    const launch = {
      workItemId: item.id,
      firstChoice: null,
      selected: null,
      fallbackReason: null,
      scope: null,
      cause: null,
      outcome: null,
    };
    const failedKeys = new Set();
    let blockedReason = null;
    let session = null;

    for (let attempt = 1; attempt <= candidates.length + 1; attempt += 1) {
      // 5. The Controller chooses every candidate (AI-64-P01). This is a live
      //    decision, not a dry run: it is written to the decision log before the
      //    launch, with the ranking inputs it was made from (AI-64-R03).
      const decision = ranking.rankAndRecord(
        candidates,
        Object.assign(
          {
            workItemId: item.id,
            role: roleOf(item),
            registry,
            now,
            dryRun: false,
            decisionOpts: logOpts,
          },
          o.ranking || {}
        )
      );
      log.selections.push({ workItemId: item.id, attempt, decision });
      if (!decision.chosen) {
        blockedReason = 'NO_ELIGIBLE_CANDIDATE: ' + (decision.reason || 'no candidate qualifies');
        break;
      }
      const candidate = candidates.find((c) => candidateKey(c) === decision.chosen);
      if (launch.firstChoice === null) launch.firstChoice = decision.chosen;
      launch.selected = decision.chosen;

      // The prompt carries the pinned key the Controller chose (AI-64-R02), so it
      // is compiled per attempt rather than once before any selection.
      const prompt = compilePrompt(item, {
        goal,
        specText: o.specText,
        candidateKey: decision.chosen,
      });
      log.prompts.push({ workItemId: item.id, attempt, candidateKey: decision.chosen, prompt });

      const route = sourcesApi.dispatchRoute(
        candidate.source || candidate.upstream || candidate.gateway,
        registry
      );
      const job = {
        workItemId: item.id,
        candidateKey: decision.chosen,
        harness: candidate.harness || null,
        provider: (route && route.provider) || candidate.source || candidate.upstream,
        model: sourcesApi.qualifyModel(candidate.modelId, route),
        accountId: candidate.accountId,
        gateway: candidate.gateway || '',
        upstream: candidate.upstream,
        quotaScope: candidate.quotaScope,
        prompt,
        branch: o.branch || 'feat/' + String(item.id).toLowerCase(),
        base: o.base || 'main',
        baseSha: o.baseSha || null,
        cwd: o.workerRoot || o.cwd,
        usageFile: prepareUsageReport(usageDir, String(item.id) + '-' + now + '-a' + attempt),
        checkpoint: checkpointFile,
        title: String(item.id),
        labels: { workItem: String(item.id), role: roleOf(item) },
      };

      // The exercise runner exists in the worker's own tree before the agent
      // starts, so the fail-before at the pinned base SHA is a real captured run
      // and the pass-after at the worker's head SHA is the same command.
      if (o.exercise && job.cwd) {
        job.exercise = materialiseExercise(job.cwd, o);
      }

      let res = null;
      try {
        res = launcher(job);
      } catch (err) {
        res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
      }

      // A definite non-zero exit is a failed launch. A session that has not exited
      // yet (exitCode null) is not a failure: it is the case the supervisor exists
      // for, because a live session past the stall window is STALLED and a live
      // session still working is still running.
      const exited = Boolean(res) && res.exitCode !== null && res.exitCode !== undefined;
      if (!res || (exited && res.exitCode !== 0)) {
        // The failure is classified by the shared classifier, and the replacement
        // is chosen by the Controller's failure-domain rule rather than by a scan
        // of this loop (AI-64-R11).
        const classification = classifyFailure({
          exitCode: res ? res.exitCode : -1,
          httpStatus: res ? res.httpStatus : undefined,
          body: res ? res.body : undefined,
          stderr: res ? res.stderr : undefined,
          accountId: candidate.accountId,
        });
        launch.scope = classification.scope;
        launch.cause = classification.cause;
        launch.outcome = 'failed';
        failedKeys.add(decision.chosen);
        cli.applyFailureBlocks(
          candidates,
          failedKeys,
          candidate,
          classification,
          true,
          cli.LIVE_BLOCK_CODES
        );
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: item.id,
            role: roleOf(item),
            chosen: decision.chosen,
            branch: job.branch,
            failureScope: classification.scope,
            detail: classification.cause,
          },
          logOpts
        );
        const alternate = candidates.find((c) => !c.blocked && !failedKeys.has(candidateKey(c)));
        if (!alternate) {
          blockedReason =
            'NO_ALTERNATE_FAILURE_DOMAIN: ' +
            classification.scope +
            ' (' +
            classification.cause +
            ')';
          break;
        }
        launch.fallbackReason =
          'FIRST_CANDIDATE_FAILED: ' + classification.scope + ' (' + classification.cause + ')';
        continue;
      }

      // The durable handle, read from the report this launch was given. An absent
      // or unparsable report means this was not a live run and nothing is recorded
      // as launched (AI-64-R04, AI-64-P08).
      const adapter = harnessFor(candidate);
      const reported = adapter
        ? require('./executor').readSessionId(adapter, job, res)
        : { id: null, cause: 'HARNESS_UNKNOWN' };
      if (!reported.id) {
        launch.outcome = 'not_a_live_run';
        blockedReason = reported.cause;
        break;
      }

      // The supervisor decides what the session actually was (AI-64-R05).
      const status = classifySession(
        Object.assign({}, res, { progress: progressOf(o, res, now) }),
        {
          now,
          stallMs: o.stallMs,
        }
      );
      session = {
        workItemId: item.id,
        attempt,
        firstChoice: launch.firstChoice,
        selected: launch.selected,
        fallbackReason: launch.fallbackReason,
        sessionId: reported.id,
        usageReport: job.usageFile,
        candidateKey: decision.chosen,
        harness: candidate.harness || null,
        branch: job.branch,
        baseSha: job.baseSha,
        exitCode: res.exitCode,
        status,
        startedAt: res.startedAt || null,
      };
      log.sessions.push(session);
      log.launches.push(launch);
      launch.outcome = 'launched';

      decisions.recordDecision(
        {
          stage: decisions.Stage.LAUNCHED,
          workItemId: item.id,
          role: roleOf(item),
          chosen: decision.chosen,
          harness: candidate.harness || null,
          branch: job.branch,
          sessionId: reported.id,
          detail: 'DURABLE_SESSION_ID',
          worktree: job.cwd || null,
        },
        logOpts
      );

      if (status !== SessionStatus.COMPLETED_WITH_ARTIFACT) {
        // COMPLETED_EMPTY, STALLED and FAILED all stop here: the run does not
        // review and does not publish, and the checkpoint is written for a human.
        blockedReason = status;
        break;
      }
      break;
    }

    if (!session) {
      outcome(item, ItemStatus.BLOCKED, blockedReason || 'NO_LIVE_SESSION');
      continue;
    }
    if (blockedReason) {
      // A real session that is not a completion. The claim is released as failed
      // so a human decides, and the reason is the session's own terminal status.
      decisions.recordDecision(
        {
          stage: decisions.Stage.FAILED,
          workItemId: item.id,
          role: roleOf(item),
          chosen: session.candidateKey,
          branch: session.branch,
          sessionId: session.sessionId,
          detail: blockedReason,
        },
        logOpts
      );
      outcome(item, ItemStatus.BLOCKED, blockedReason);
      continue;
    }

    const reviewed = reviewItem(o, item, session, log, logOpts, launcher, usageDir, now);
    if (reviewed.status === ReviewStatus.COMPLETED) {
      outcome(item, ItemStatus.COMPLETED, 'REVIEW_PASS');
    } else {
      outcome(item, ItemStatus.BLOCKED, reviewed.reason);
    }
  }

  // 6. Publication is its own gated stage (AI-64-P04/R12/R13), one entry per
  //    reviewed work item. The loop cannot mint the approval that authorises it, so
  //    an unwired run says so instead of pretending a draft Pull Request exists.
  for (const entry of log.reviews) log.publications.push(publication(o, entry));
  log.publication = log.publications[log.publications.length - 1] || {
    status: PublicationStatus.NOT_REQUESTED,
    reason: 'NO_REVIEWED_COMMIT: nothing to publish',
  };

  return finish(log, statusOf, { now, cli, checkpointFile, checkpointOnDisk, out: o.out });
}
/** The review / repair stage for one completed session. */
function reviewItem(o, item, session, log, logOpts, launcher, usageDir, now) {
  // AI-64-R07: a review is bound to an exact commit. A run that cannot name the
  // commit under review does not review it.
  if (!o.sha || !SHA_40.test(String(o.sha))) {
    return {
      status: ReviewStatus.BLOCKED,
      reason: 'REVIEW_SHA_UNPINNED: a 40-character commit under review is mandatory',
    };
  }
  const budget = Number.isFinite(Number(o.reviewBudget))
    ? Number(o.reviewBudget)
    : DEFAULT_REVIEW_BUDGET;
  const review = runReviewLoop(
    { sha: o.sha, budget },
    {
      runTests: typeof o.tests === 'function' ? o.tests : () => runVerificationCommand(item, o),
      review: typeof o.reviewer === 'function' ? o.reviewer : reviewLane(o, session.candidateKey),
      repair:
        typeof o.repairer === 'function'
          ? o.repairer
          : repairRound(o, item, session, log, logOpts, launcher, usageDir, now),
    }
  );

  const entry = {
    workItemId: item.id,
    sha: o.sha,
    reviewerIdentity: o.reviewerIdentity || null,
    writerCandidateKey: session.candidateKey,
    review,
  };
  log.reviews.push(entry);
  log.review = entry;

  // Every round is in the decision log: the trace is what a human reads to see what
  // was refused and why (AI-64-R14), including the open finding ids.
  for (const round of review.rounds) {
    decisions.recordDecision(
      {
        stage: decisions.Stage.REVIEW,
        workItemId: item.id,
        role: roleOf(item),
        chosen: session.candidateKey,
        branch: session.branch,
        round: round.round,
        roundStage: round.stage,
        cause: round.cause || null,
        verdict: round.verdict || null,
        reviewer: round.reviewer || o.reviewerIdentity || null,
        findings: round.findings || [],
        sha: round.sha || null,
        repairCount: review.repairCount,
      },
      logOpts
    );
  }

  const blocked = review.rounds.filter((r) => r.stage === 'blocked');
  const reason = blocked.length
    ? blocked[blocked.length - 1].cause || 'REVIEW_REFUSED'
    : review.status === ReviewStatus.COMPLETED
      ? 'REVIEW_PASS'
      : 'REPAIR_BUDGET_EXHAUSTED';
  decisions.recordDecision(
    {
      stage:
        review.status === ReviewStatus.COMPLETED
          ? decisions.Stage.COMPLETED
          : decisions.Stage.FAILED,
      workItemId: item.id,
      role: roleOf(item),
      chosen: session.candidateKey,
      branch: session.branch,
      sessionId: session.sessionId,
      outcome: review.status === ReviewStatus.COMPLETED ? 'passed' : 'failed',
      detail: reason,
      reviewedSha: review.finalSha,
    },
    logOpts
  );
  return { status: review.status, reason, finalSha: review.finalSha, verdict: review.verdict };
}

/**
 * The default repair: the open findings become a work-item spec, the spec goes back
 * through planner.plan, and a fresh worker runs under the same isolation on a new
 * commit. The review of the old commit is stale afterwards and is never reused.
 */
function repairRound(o, item, session, log, logOpts, launcher, usageDir, now) {
  return (findings, sha) => {
    const round = ((log.review && log.review.review.repairCount) || 0) + 1;
    const spec = repairSpec(item, findings, round);
    const replanned = planner.plan(log.goal, { specs: (o.specs || []).concat([spec]) });
    if (replanned.errors.length) {
      // AI-64-R09: refused at the planner, not downstream.
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: item.id,
          role: roleOf(item),
          detail: 'REPAIR_REPLAN_REFUSED: ' + replanned.errors.join('; '),
        },
        logOpts
      );
      return { sha, repairRefused: replanned.errors };
    }
    const planned = replanned.workItems.find((w) => w.id === spec.id);
    if (!planned) return { sha };

    const decision = ranking.rankAndRecord(
      o.candidates || [],
      Object.assign(
        {
          workItemId: planned.id,
          role: roleOf(planned),
          registry: o.registry,
          now,
          dryRun: false,
          decisionOpts: logOpts,
        },
        o.ranking || {}
      )
    );
    if (!decision.chosen) return { sha };
    const candidate = (o.candidates || []).find((c) => candidateKey(c) === decision.chosen);
    const usageFile = prepareUsageReport(usageDir, planned.id + '-' + now + '-repair' + round);
    const prompt = compilePrompt(planned, {
      goal: log.goal,
      specText: o.specText,
      candidateKey: decision.chosen,
    });
    let res = null;
    try {
      res = launcher({
        workItemId: planned.id,
        candidateKey: decision.chosen,
        harness: candidate.harness || null,
        model: candidate.modelId,
        accountId: candidate.accountId,
        gateway: candidate.gateway || '',
        upstream: candidate.upstream,
        quotaScope: candidate.quotaScope,
        prompt,
        branch: o.branch || 'feat/' + String(item.id).toLowerCase(),
        base: o.base || 'main',
        baseSha: o.baseSha || null,
        cwd: o.workerRoot || o.cwd,
        usageFile,
        checkpoint: o.checkpointFile || null,
        title: planned.id,
        labels: { workItem: planned.id, role: roleOf(planned), repairOf: item.id },
      });
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
    }
    if (!res || res.exitCode !== 0) return { sha };

    const adapter = harnessFor(candidate);
    const handle = adapter
      ? require('./executor').readSessionId(adapter, { usageFile }, res).id
      : null;
    const nextSha = headShaOf(o.workerRoot || o.cwd);
    if (!handle || !nextSha || nextSha === sha) return { sha };
    decisions.recordDecision(
      {
        stage: decisions.Stage.LAUNCHED,
        workItemId: planned.id,
        role: roleOf(planned),
        chosen: decision.chosen,
        harness: candidate.harness || null,
        branch: o.branch || 'feat/' + String(item.id).toLowerCase(),
        sessionId: handle,
        detail: 'REPAIR_ROUND: repairs ' + item.id,
        worktree: o.workerRoot || o.cwd || null,
      },
      logOpts
    );
    return { sha: nextSha };
  };
}

/**
 * The publication stage for one reviewed work item.
 *
 * It runs operator-side, outside the worker, and only with an approval a named
 * human authority wrote and bound to the reviewed commit. The loop cannot mint
 * one, so a run with no approval records that fact and publishes nothing — which
 * is the correct outcome, not a fallback to an unapproved push.
 */
function publication(o, entry) {
  const review = entry && entry.review;
  if (!review || review.status !== ReviewStatus.COMPLETED) {
    return {
      status: PublicationStatus.NOT_REQUESTED,
      reason: 'NO_REVIEWED_COMMIT: the item did not reach a passing review',
    };
  }
  const request = o.publication;
  if (!request) {
    return {
      status: PublicationStatus.NOT_REQUESTED,
      reason: 'APPROVAL_NOT_SUPPLIED: the loop cannot mint the approval that authorises a publish',
    };
  }
  try {
    const result = require('./publisher').publish(
      Object.assign({}, request, {
        cwd: request.cwd || o.publisherCwd || o.cwd,
        reviewedSha: review.finalSha,
        verdict: review.verdict || 'PASS',
        log: typeof o.log === 'function' ? o.log : null,
      })
    );
    return { status: PublicationStatus.PUBLISHED_DRAFT, workItemId: entry.workItemId, result };
  } catch (err) {
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry.workItemId,
      reason: String((err && err.message) || err),
    };
  }
}

/** A run refused before any item could be attempted. */
function refuseRun(log, reason) {
  const ids = log.plan.workItems.map((i) => i.id);
  const failed = log.plan.errors.length > 0;
  const statusOf = new Map(
    ids.map((id) => [id, failed ? ItemStatus.DEFERRED : ItemStatus.BLOCKED])
  );
  log.refusal = reason;
  for (const id of ids) {
    log.outcomes.push({ workItemId: id, status: statusOf.get(id), reason });
  }
  return finish(log, statusOf, {
    now: Date.now(),
    cli: controller(),
    checkpointFile: null,
    checkpointOnDisk: null,
    out: null,
  });
}

/**
 * Reconciliation, the run's terminal status and the checkpoint.
 *
 * The checkpoint is the existing dispatch document, extended with the live fields
 * and written through the existing atomic writer: the same file, the same reader,
 * the same tmp+rename. It keeps the items a previous run completed, so a resumed
 * run never launches one of them again.
 */
function finish(log, statusOf, ctx) {
  const completed = [];
  const blocked = [];
  const deferred = [];
  for (const item of log.plan.workItems) {
    const status = statusOf.get(item.id) || ItemStatus.DEFERRED;
    if (status === ItemStatus.COMPLETED) completed.push(item.id);
    else if (status === ItemStatus.BLOCKED) blocked.push(item.id);
    else deferred.push(item.id);
  }
  log.reconciliation = {
    total: log.plan.workItems.length,
    completed,
    blocked,
    deferred,
  };

  const publications = log.publications || [];
  if (log.plan.errors.length > 0) {
    log.status = RunStatus.REFUSED;
    log.refusal = log.plan.errors.join('; ');
  } else if (publications.some((p) => p.status === PublicationStatus.REFUSED)) {
    log.status = RunStatus.REFUSED;
  } else if (publications.some((p) => p.status === PublicationStatus.PUBLISHED_DRAFT)) {
    log.status = RunStatus.PUBLISHED_DRAFT;
  } else if (blocked.length > 0) {
    log.status = RunStatus.BLOCKED;
  } else {
    log.status = RunStatus.COMPLETED;
  }

  const prior = ctx.checkpointOnDisk || {};
  const next = Object.assign({}, prior, {
    schemaVersion: 1,
    step: log.status === RunStatus.PUBLISHED_DRAFT ? 'live_published' : 'live_review',
    updatedAt: new Date(ctx.now).toISOString(),
    workItemIds: log.plan.workItems.map((i) => i.id),
    completed: unique((prior.completed || []).concat(completed)),
    blocked,
    deferred,
    sessions: log.sessions.map((s) => ({
      workItemId: s.workItemId,
      sessionId: s.sessionId,
      status: s.status,
      candidateKey: s.candidateKey,
    })),
    publication: log.publication,
  });
  log.checkpoint = next;
  if (ctx.checkpointFile) ctx.cli.writeJsonFile(ctx.checkpointFile, next);

  if (ctx.out) {
    fs.mkdirSync(path.dirname(ctx.out), { recursive: true });
    fs.writeFileSync(ctx.out, JSON.stringify(log, null, 2), 'utf8');
  }
  return log;
}

module.exports = {
  runOrchestration,
  runVerificationCommand,
  repairSpec,
  resolveLauncher,
  materialiseExercise,
  ItemStatus,
  RunStatus,
  PublicationStatus,
};
