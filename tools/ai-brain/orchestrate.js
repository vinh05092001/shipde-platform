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
const { importPassedCommit, hasCommit } = require('./passed-commit');
const crypto = require('crypto');

const planner = require('./planner');
const { compilePrompt, compileReviewPrompt } = require('./prompt-compiler');
const { classifySession, Status: SessionStatus, progressFromWorkerRoot } = require('./supervisor');
const { runReviewLoop, Status: ReviewStatus } = require('./review-loop');
const ranking = require('./ranking');
const routing = require('./routing');
const evidence = require('./evidence');
const candidatesApi = require('./candidates');
const decisions = require('./decisions');
const sourcesApi = require('./sources');
const jev = require('./jev');
const { candidateKey } = require('./candidates');
const { parseCandidateKey } = require('./discovery/identity');
const {
  classifyFailure,
  isReplayable,
  isolationVerdictBlockReason,
  ISOLATION_VERDICT_HUMAN_ACTION,
} = require('./failure-classifier');
const { materialiseExercise, captureFailBefore } = require('./isolation-launcher');

const ItemStatus = Object.freeze({
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  DEFERRED: 'deferred',
  // DT-R02: an item the format gate stopped before review. It is neither
  // completed nor an infrastructure block — the work exists, it is unformatted,
  // and it is never reviewed or published until a repair round formats it.
  REFUSED: 'refused',
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
const ACCEPTED_VERDICTS = Object.freeze(['PASS', 'FALLBACK_PASS']);

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
    // DT-R02: one record per host-side format check the Controller ran, so an
    // unavailable prettier is a visible warning and not a silent pass.
    formatChecks: [],
    // TM-R03/TM-R04: one record per tool gate the Controller ran before
    // review, with the tool id and the verdict — never raw tool output.
    toolGates: [],
    reconciliation: null,
    checkpoint: null,
    resumed: null,
    publications: [],
    publication: null,
    isolation: null,
    // TASK-AI-121 LF-R03: the worker timeout this run launches with (ms).
    workerTimeoutMs: null,
    // TASK-AI-121 LF-R02: set when a stale/missing isolation verdict stopped
    // the run — the reason and the operator action that clears it.
    isolationStop: null,
    status: null,
    refusal: null,
  };
}

function roleOf(item) {
  return (
    (item && item.roleRequirement && item.roleRequirement.role) ||
    (item && item.role) ||
    'author.foundation'
  );
}

function routingRoleOf(item) {
  const role = roleOf(item);
  if (/review/i.test(role)) return 'reviewer';
  if (/security/i.test(role)) return 'security-review';
  if (/analyst|research/i.test(role)) return 'researcher';
  if (/scan/i.test(role)) return 'scanner';
  if (/integrat/i.test(role)) return 'integrator';
  return 'writer';
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

  const externalWorkers =
    typeof o.externalWorkers === 'string'
      ? o.externalWorkers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  if (!isolatedLauncher && externalWorkers.length === 0) return null;
  const { getHarness } = require('./harness');
  return (job) => {
    const adapter = getHarness(job.harness);
    if (!adapter) throw new Error('UNKNOWN_HARNESS: ' + String(job.harness));
    let launchArgs;
    try {
      launchArgs = adapter.launch(job);
    } catch (err) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: (err && err.message) || String(err),
        error: err,
      };
    }
    if (launchArgs && !Array.isArray(launchArgs)) {
      const reason =
        launchArgs.reason || launchArgs.refusal || launchArgs.error || 'LAUNCH_REFUSED';
      return {
        exitCode: launchArgs.exitCode !== undefined ? launchArgs.exitCode : 1,
        stdout: '',
        stderr: reason,
        refusal: launchArgs.refusal || reason,
      };
    }

    const isExternal = externalWorkers.includes(adapter.id);
    if (isExternal && (adapter.id === 'agy-pool' || adapter.id === 'autoclaw')) {
      const { runHarness } = require('./harness');
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const env = Object.assign({}, process.env);
      if (adapter.id === 'autoclaw') {
        const tokenFile = path.join(os.homedir(), '.openclaw-autoclaw', '.gateway-token');
        if (fs.existsSync(tokenFile)) {
          env.OPENCLAW_GATEWAY_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
        }
      }
      return runHarness(adapter, launchArgs, {
        cwd: job.cwd,
        timeoutMs: job.workerTimeoutMs || o.workerTimeoutMs,
        env,
      });
    }

    if (!isolatedLauncher) {
      throw new Error('LAUNCHER_MISSING: no isolated launcher for ' + adapter.id);
    }

    return isolatedLauncher(adapter, launchArgs, {
      cwd: job.hostWorktree || job.cwd,
      workerRoot: job.workerRoot,
      baseSha: job.baseSha,
      branch: job.branch,
      workItemId: job.title || (job.labels && job.labels.workItem) || null,
      retainWorkerHead: job.retainWorkerHead || undefined,
      verdictPath: job.verdictPath,
      exercise: job.exercise || o.exercise || null,
      onProvisioned: typeof o.onProvisioned === 'function' ? o.onProvisioned : undefined,
      candidateKey: job.candidateKey || null,
      gateway: job.gateway || null,
      // TASK-AI-121 LF-R03: the worker timeout the run was given, for writer,
      // reviewer and repair launches alike.
      workerTimeoutMs: o.workerTimeoutMs || job.workerTimeoutMs || undefined,
      // TASK-AI-127 WD-R03: a WORKER_DEPS_UNAVAILABLE warning is recorded in
      // the same decision log the run itself writes.
      decisionDir: o.decisionDir || undefined,
      checkpoint: o.checkpointFile || (typeof o.checkpoint === 'string' ? o.checkpoint : undefined),
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
 * TASK-AI-121 LF-R01: the launcher's own message for a failed launch — the
 * error a throw carried, the refusal a route returned, then the process text.
 * This is the "real error message" the failed decision entry must keep.
 */
function launchFailureText(res) {
  return String((res && (res.stderr || res.refusal || res.failureReason || res.body)) || '');
}

/**
 * A "failed" decision entry keeps the classified cause for provider failures,
 * but for a local launch infrastructure failure (LF-R01) the cause alone threw
 * the real message away — the exact thing a supervisor needs. The message is
 * scrubbed of secrets and capped at 300 chars.
 */
function failureMessageOf(res) {
  return decisions.scrubText(launchFailureText(res)).trim().slice(0, 300);
}

function failedDecisionDetail(classification, res) {
  const message = failureMessageOf(res);
  if (classification.scope === 'local' && message) return message;
  return classification.cause;
}

/**
 * LF-R02: a stale or missing isolation verdict fails every candidate the same
 * way, so the run records why it stopped and the operator action that clears
 * it. The first detection wins; the stop travels on the run log.
 */
function markIsolationVerdictStop(log, res, classification) {
  if (!log || (classification && classification.scope !== 'local')) return null;
  const reasonCode = isolationVerdictBlockReason(launchFailureText(res));
  if (!reasonCode) return null;
  if (!log.isolationStop) {
    log.isolationStop = {
      reasonCode,
      reason: failureMessageOf(res) || reasonCode,
      humanAction: ISOLATION_VERDICT_HUMAN_ACTION,
    };
  }
  return log.isolationStop;
}

function resolveLaunchRoute(candidate, options, registry) {
  const { resolveRoute } = require('./executor');
  return resolveRoute(
    {
      provider: candidate && (candidate.source || candidate.upstream || candidate.gateway),
      model: candidate && candidate.modelId,
      harness: candidate && candidate.harness,
    },
    { isolatedWorker: Boolean(options && options.isolatedWorker) },
    registry
  );
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
  if (!exitOk || !expectOk) {
    return {
      pass: false,
      cause: exitOk ? 'VERIFICATION_EXPECT_MISSING' : 'VERIFICATION_EXIT',
      command,
      expect,
      exitCode: res ? res.status : null,
      detail: output.slice(-2000),
    };
  }

  // After verification command passes, verify worker commit:
  const workerRoot =
    o.workerRoot ||
    (o.isolatedWorker
      ? require('./isolation-launcher').workerRootFor(o.cwd || process.cwd())
      : null) ||
    null;
  const commitCheck = verifyWorkerCommit(workerRoot, o.baseSha, o);
  if (!commitCheck.pass) {
    return {
      pass: false,
      cause: 'NO_LOCAL_COMMIT',
      findings: [
        {
          id: 'NO_LOCAL_COMMIT',
          open: true,
          detail: commitCheck.detail,
          dirtyPaths: commitCheck.dirtyPaths || [],
          headSha: commitCheck.headSha || null,
          baseSha: commitCheck.baseSha || null,
        },
      ],
      command,
      expect,
      exitCode: res ? res.status : null,
      detail: commitCheck.detail,
    };
  }

  return {
    pass: true,
    cause: null,
    command,
    expect,
    exitCode: res ? res.status : null,
    detail: output.slice(-2000),
  };
}

/**
 * Provision a separate read-only review root from the worker repository at the exact targetSha.
 * Hardened git per PR #184/#187/#189: never consults worker config, copies sanitized objects,
 * configures safe line endings and filemode, and verifies HEAD matches targetSha via hardened rev-parse.
 */
function provisionReviewRoot(workerRoot, reviewRoot, targetSha, options) {
  const o = options || {};
  if (!workerRoot || !fs.existsSync(workerRoot)) {
    fs.mkdirSync(reviewRoot, { recursive: true });
    return;
  }
  const workerGit = path.join(workerRoot, '.git');
  if (!fs.existsSync(workerGit)) {
    fs.mkdirSync(reviewRoot, { recursive: true });
    return;
  }

  if (fs.existsSync(reviewRoot)) {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }

  const { withCleanGitEnv, safeGit, getEffectiveEolConfig } = require('./supervisor');
  withCleanGitEnv(
    workerRoot,
    (safeGitDir) => {
      const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const safeRepoDir = path.dirname(safeGitDir);

      // Verify targetSha is present in the sanitized object store
      const revCheck = safeGit(safeGitDir, safeRepoDir, ['cat-file', '-e', targetSha], 20000);
      if (revCheck.status !== 0) {
        throw new Error(
          'PROVISION_REVIEW_FAILED: commit ' + targetSha + ' not found in worker object store'
        );
      }

      // Point a temporary branch ref at targetSha in the clean safe repo
      safeGit(
        safeGitDir,
        safeRepoDir,
        ['update-ref', 'refs/heads/review-target', targetSha],
        20000
      );

      // Clone from safe operator-controlled repository to reviewRoot with --no-hardlinks
      const cloneRes = (o.spawnSync || spawnSync)(
        'git',
        ['clone', '--no-checkout', '--no-hardlinks', safeRepoDir, reviewRoot],
        {
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (cloneRes.status !== 0) {
        throw new Error(
          'PROVISION_REVIEW_FAILED: failed to clone safe repository: ' + (cloneRes.stderr || '')
        );
      }

      const eolConfig = getEffectiveEolConfig(workerRoot, o);
      const normReviewRoot = path.resolve(reviewRoot).replace(/\\/g, '/');
      const checkoutArgs = [
        '-c',
        'core.hooksPath=' + nulDevice,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.attributesFile=' + nulDevice,
        '-c',
        'diff.external=',
        '-c',
        'safe.directory=' + normReviewRoot,
      ];
      if (process.platform === 'win32') {
        checkoutArgs.push('-c', 'core.filemode=false');
      }
      if (eolConfig.autocrlf !== null) {
        checkoutArgs.push('-c', 'core.autocrlf=' + eolConfig.autocrlf);
      }
      if (eolConfig.eol !== null) {
        checkoutArgs.push('-c', 'core.eol=' + eolConfig.eol);
      }
      checkoutArgs.push('checkout', targetSha);

      const checkoutRes = (o.spawnSync || spawnSync)('git', checkoutArgs, {
        cwd: reviewRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      });
      if (checkoutRes.status !== 0) {
        throw new Error(
          'PROVISION_REVIEW_FAILED: failed to checkout targetSha: ' + (checkoutRes.stderr || '')
        );
      }

      if (eolConfig.autocrlf !== null) {
        spawnSync('git', ['config', 'core.autocrlf', eolConfig.autocrlf], {
          cwd: reviewRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (eolConfig.eol !== null) {
        spawnSync('git', ['config', 'core.eol', eolConfig.eol], {
          cwd: reviewRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (process.platform === 'win32') {
        spawnSync('git', ['config', 'core.filemode', 'false'], {
          cwd: reviewRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      // Hardened rev-parse HEAD^{commit} verification (PR #189)
      let verifiedHead = null;
      try {
        verifiedHead = withCleanGitEnv(
          reviewRoot,
          (safeRevGitDir) => {
            const curRes = safeGit(
              safeRevGitDir,
              reviewRoot,
              ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
              20000
            );
            return curRes && curRes.status === 0 && curRes.stdout ? curRes.stdout.trim() : null;
          },
          { workerWritable: true }
        );
      } catch {
        verifiedHead = null;
      }
      if (!verifiedHead || verifiedHead.toLowerCase() !== targetSha.toLowerCase()) {
        throw new Error(
          'PROVISION_REVIEW_MISMATCH: review root HEAD (' +
            (verifiedHead || 'unknown') +
            ') does not match ' +
            targetSha
        );
      }
    },
    { workerWritable: true }
  );
}

/**
 * The review lane for the live isolated loop.
 *
 * Runs the reviewer candidate selected by the Controller outside the writer failure domain.
 * Operates in a SEPARATE read-only review root provisioned from the worker repository at the exact worker head SHA.
 * Gives the reviewer a compiled review prompt requiring a machine-readable verdict file (verdict.json).
 * Parses the verdict file fail-closed (missing/malformed/sha mismatch -> not PASS) and feeds findings into the repair path.
 */
function reviewLane(
  o,
  itemOrWriterKey,
  session,
  log,
  logOpts,
  launcher,
  usageDir,
  now,
  candidates,
  evidenceData,
  registry,
  opts
) {
  const writerKey =
    typeof itemOrWriterKey === 'string'
      ? itemOrWriterKey
      : (session && session.candidateKey) || null;
  const item = typeof itemOrWriterKey === 'object' ? itemOrWriterKey : null;
  const reviewerIdentity = (o && o.reviewerIdentity) || null;

  if (reviewerIdentity && writerKey && reviewerIdentity === writerKey) {
    return () => ({
      pass: false,
      sha: null,
      cause: 'REVIEWER_EQUALS_WRITER',
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

  if (!launcher && !item) {
    return () => {
      throw new Error(
        'REVIEW_ROUTE_UNAVAILABLE: no exact-SHA review lane is wired for the live loop'
      );
    };
  }

  return async (currentSha) => {
    if (!currentSha || typeof currentSha !== 'string' || !SHA_40.test(currentSha.trim())) {
      return {
        pass: false,
        sha: null,
        cause: 'REVIEW_SHA_UNBOUND',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEW_SHA_UNBOUND',
            open: true,
            detail: 'review target commit must be a valid 40-character SHA',
          },
        ],
      };
    }
    const targetSha = currentSha.trim();

    if (!reviewerIdentity) {
      return {
        pass: false,
        sha: targetSha,
        cause: 'NO_REVIEWER_CANDIDATE',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'NO_REVIEWER_CANDIDATE',
            open: true,
            detail: 'no eligible reviewer candidate available outside writer failure domain',
          },
        ],
      };
    }

    if (writerKey && reviewerIdentity === writerKey) {
      return {
        pass: false,
        sha: null,
        cause: 'REVIEWER_EQUALS_WRITER',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEWER_EQUALS_WRITER',
            open: true,
            detail: 'the review lane resolved to the writer candidate ' + String(writerKey),
          },
        ],
      };
    }

    const candidateList = Array.isArray(candidates) ? candidates : [];
    const candidate =
      candidateList.find((c) => candidateKey(c) === reviewerIdentity) ||
      parseCandidateKey(reviewerIdentity);
    if (!candidate) {
      return {
        pass: false,
        sha: targetSha,
        cause: 'REVIEWER_CANDIDATE_MISSING',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEWER_CANDIDATE_MISSING',
            open: true,
            detail: 'reviewer candidate could not be resolved from ' + reviewerIdentity,
          },
        ],
      };
    }

    const route = resolveLaunchRoute(candidate, o, registry);
    if (!route || !route.harnessName) {
      return {
        pass: false,
        sha: targetSha,
        cause: 'REVIEW_ROUTE_UNRESOLVABLE',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEW_ROUTE_UNRESOLVABLE',
            open: true,
            detail: 'cannot resolve launch route for reviewer candidate ' + reviewerIdentity,
          },
        ],
      };
    }

    const hostWorktree = o.cwd || process.cwd();
    const isolatedWorkerRoot = o.isolatedWorker
      ? require('./isolation-launcher').workerRootFor(hostWorktree)
      : null;
    const workerRoot =
      (o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot) ||
      (session && session.worktree) ||
      o.cwd;
    const reviewWorkerRoot =
      o.reviewRoot ||
      (o.isolatedWorker && isolatedWorkerRoot
        ? path.join(path.dirname(isolatedWorkerRoot), path.basename(isolatedWorkerRoot) + '-review')
        : workerRoot
          ? workerRoot + '-review'
          : path.join(os.tmpdir(), 'shipde-review-' + Date.now()));

    provisionReviewRoot(workerRoot, reviewWorkerRoot, targetSha, o);

    // Compute diff baseSha..targetSha host-side
    let diffText = '';
    const baseSha = (session && session.baseSha) || o.baseSha || null;
    if (baseSha && fs.existsSync(path.join(reviewWorkerRoot, '.git'))) {
      const { withCleanGitEnv, safeGit } = require('./supervisor');
      try {
        diffText =
          withCleanGitEnv(
            reviewWorkerRoot,
            (safeGitDir) => {
              const dRes = safeGit(
                safeGitDir,
                reviewWorkerRoot,
                ['diff', baseSha + '..' + targetSha],
                20000
              );
              return dRes && dRes.status === 0 ? dRes.stdout : '';
            },
            { workerWritable: true }
          ) || '';
      } catch {
        diffText = '';
      }
    }

    const verdictFile = path.join(reviewWorkerRoot, 'verdict.json');
    if (fs.existsSync(verdictFile)) {
      try {
        fs.unlinkSync(verdictFile);
      } catch {
        // ignore
      }
    }

    const usageFile = prepareUsageReport(
      usageDir,
      (item ? item.id : 'review') + '-' + (now || Date.now()) + '-review-' + targetSha.slice(0, 7)
    );

    const reviewPrompt = compileReviewPrompt(item, {
      goal: log ? log.goal : null,
      headSha: targetSha,
      baseSha,
      diffText,
      verdictFile,
      usageFile,
      candidateKey: reviewerIdentity,
      exercise: o.exercise || null,
      logOpts,
    });

    const reviewJob = {
      workItemId: (item ? item.id : 'item') + '-review',
      candidateKey: reviewerIdentity,
      harness: route.harnessName,
      provider: route.provider,
      model: route.model,
      accountId: normalizeAccount(candidate.accountId),
      gateway: candidate.gateway || '',
      upstream: candidate.upstream,
      quotaScope: candidate.quotaScope,
      prompt: reviewPrompt,
      branch:
        (session && session.branch) ||
        o.branch ||
        (item ? 'feat/' + String(item.id).toLowerCase() : 'review'),
      base: o.base || 'main',
      baseSha: targetSha,
      retainWorkerHead: targetSha,
      hostWorktree: o.isolatedWorker ? hostWorktree : null,
      workerRoot: o.isolatedWorker ? reviewWorkerRoot : o.workerRoot || null,
      cwd: reviewWorkerRoot,
      isolatedWorker: Boolean(o.isolatedWorker),
      usageFile,
      verdictFile,
      isReview: true,
      decisionDir: o.decisionDir || null,
      checkpoint: o.checkpointFile || null,
      title: (item ? item.id : 'item') + '-review',
      labels: {
        workItem: (item ? item.id : 'item') + '-review',
        role: 'reviewer',
        reviewOf: item ? item.id : undefined,
      },
      exercise: o.exercise || null,
      workerTimeoutMs: o.workerTimeoutMs || null,
    };

    let res = null;
    try {
      if (opts && typeof opts.onReviewerLaunch === 'function') {
        const eligible = opts.onReviewerLaunch(candidate);
        if (eligible === false) {
          return {
            pass: false,
            sha: targetSha,
            cause: 'NO_ALTERNATE_FAILURE_DOMAIN',
            verdict: 'REFUSED',
            reviewer: reviewerIdentity,
            findings: [
              {
                id: 'NO_ALTERNATE_FAILURE_DOMAIN',
                open: true,
                detail: 'reviewer failure domain is excluded or its attempt cap is exhausted',
              },
            ],
          };
        }
      }
      res = await launcher(reviewJob);
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
    }

    writeUsageReportFromHarnessResult(reviewJob, res);

    if (!res || res.exitCode !== 0) {
      if (opts && typeof opts.onReviewerLaunchFailure === 'function') {
        opts.onReviewerLaunchFailure(res, candidate, opts && opts.attempt);
      }
      // TASK-AI-114 R01: a launch failure is a failed reviewer attempt, never a
      // verdict. It carries no verdict value, so nothing downstream can record
      // it as a review round or read it as CHANGES_REQUIRED.
      return {
        pass: false,
        sha: targetSha,
        verdict: 'LAUNCH_FAILED',
        reviewer: reviewerIdentity,
        res,
        launchFailed: true,
        findings: [
          {
            id: 'REVIEWER_LAUNCH_FAILED',
            open: true,
            detail:
              'reviewer launch failed: ' +
              ((res && res.stderr) ||
                (res && res.failureReason) ||
                'exit code ' + (res && res.exitCode)),
          },
        ],
      };
    }

    if (logOpts) {
      const adapter = harnessFor({ harness: reviewJob.harness });
      const handle = adapter
        ? require('./executor').readSessionId(adapter, reviewJob, res).id
        : null;
      if (handle) {
        decisions.recordDecision(
          {
            stage: decisions.Stage.LAUNCHED,
            workItemId: (item ? item.id : 'item') + '-review',
            role: 'reviewer',
            attempt: opts && opts.attempt,
            attemptNumber: opts && opts.attempt,
            chosen: reviewerIdentity,
            harness: reviewJob.harness,
            branch: reviewJob.branch,
            sessionId: handle,
            detail: 'REVIEW_LANE: reviews ' + (item ? item.id : 'item') + ' at ' + targetSha,
            worktree: reviewWorkerRoot,
          },
          logOpts
        );
      }
    }

    // Fail-closed verdict parsing
    let effectiveVerdictFile = verdictFile;
    if (!fs.existsSync(effectiveVerdictFile)) {
      const altFile = path.join(reviewWorkerRoot, 'review-verdict.json');
      if (fs.existsSync(altFile)) {
        effectiveVerdictFile = altFile;
      }
    }

    if (!fs.existsSync(effectiveVerdictFile)) {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_FILE_MISSING',
            open: true,
            detail: 'review verdict file was not produced at ' + verdictFile,
          },
        ],
      };
    }

    let parsed = null;
    try {
      const raw = fs.readFileSync(effectiveVerdictFile, 'utf8');
      parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch (err) {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_FILE_MALFORMED',
            open: true,
            detail: 'verdict file is not valid JSON: ' + ((err && err.message) || err),
          },
        ],
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_FILE_INVALID',
            open: true,
            detail: 'verdict file root must be an object',
          },
        ],
      };
    }

    const verdictSha = typeof parsed.sha === 'string' ? parsed.sha.trim() : null;
    if (
      !verdictSha ||
      !SHA_40.test(verdictSha) ||
      verdictSha.toLowerCase() !== targetSha.toLowerCase()
    ) {
      return {
        pass: false,
        sha: verdictSha || null,
        verdict: 'CHANGES_REQUIRED',
        cause: 'STALE_REVIEW_SHA',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'STALE_REVIEW_SHA',
            open: true,
            detail:
              'verdict sha (' +
              (verdictSha || 'missing') +
              ') does not match reviewed sha (' +
              targetSha +
              ')',
          },
        ],
      };
    }

    const verdictStr = String(parsed.verdict || '')
      .trim()
      .toUpperCase();
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const findings = rawFindings.map((f, idx) => {
      if (typeof f === 'string') {
        return { id: 'FINDING_' + (idx + 1), open: true, detail: f };
      }
      return {
        id: (f && f.id) || 'FINDING_' + (idx + 1),
        open: f && f.closed === true ? false : true,
        detail: (f && f.detail) || 'open finding',
      };
    });

    if (verdictStr !== 'PASS' && verdictStr !== 'CHANGES_REQUIRED') {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_INVALID',
            open: true,
            detail: 'verdict must be PASS or CHANGES_REQUIRED, got: ' + verdictStr,
          },
        ],
      };
    }

    if (verdictStr === 'PASS') {
      return {
        pass: true,
        sha: targetSha,
        verdict: 'PASS',
        reviewer: reviewerIdentity,
        findings,
      };
    }

    return {
      pass: false,
      sha: targetSha,
      verdict: 'CHANGES_REQUIRED',
      reviewer: reviewerIdentity,
      findings:
        findings.length > 0
          ? findings
          : [
              {
                id: 'CHANGES_REQUIRED',
                open: true,
                detail: 'reviewer requested changes',
              },
            ],
    };
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
function formatFindingDetail(f) {
  if (!f) return 'open finding';
  let detail = String(f.detail || 'open finding');
  const dirty = Array.isArray(f.dirtyPaths) ? f.dirtyPaths : [];
  if (dirty.length > 0 && !dirty.some((p) => detail.includes(p))) {
    detail += '; offending paths: ' + dirty.join(', ');
  }
  if (f.headSha && !detail.includes(f.headSha)) {
    detail += '; HEAD SHA: ' + f.headSha;
  }
  if (f.baseSha && !detail.includes(f.baseSha)) {
    detail += '; base SHA: ' + f.baseSha;
  }
  return detail;
}

function repairSpec(item, findings, round) {
  const repairFindings = Array.isArray(findings) ? findings : [];
  const dirtyPaths = [
    ...new Set(
      repairFindings.flatMap((f) => (Array.isArray(f && f.dirtyPaths) ? f.dirtyPaths : []))
    ),
  ];
  const headSha =
    repairFindings.find((f) => f && f.headSha && typeof f.headSha === 'string')?.headSha || null;
  const baseSha =
    repairFindings.find((f) => f && f.baseSha && typeof f.baseSha === 'string')?.baseSha || null;

  return {
    id: item.id + '-repair-' + round,
    role: roleOf(item),
    files: [],
    allowedPaths: (item.allowedPaths || []).slice(),
    dependencies: [item.id],
    acceptanceCriteria: repairFindings.map(
      (f) => (f && f.id ? f.id : 'finding') + ': ' + formatFindingDetail(f)
    ),
    verification: (item && item.verification) || null,
    dirtyPaths,
    headSha,
    baseSha,
  };
}

function headShaOf(cwd, options) {
  if (!cwd || !fs.existsSync(path.join(cwd, '.git'))) return null;
  const { withCleanGitEnv, safeGit } = require('./supervisor');
  try {
    return withCleanGitEnv(
      cwd,
      (tmpDir) => {
        const res = safeGit(tmpDir, cwd, ['rev-parse', 'HEAD'], 20000, options);
        if (!res || res.status !== 0) return null;
        return String(res.stdout || '').trim() || null;
      },
      Object.assign({ workerWritable: true }, options)
    );
  } catch (err) {
    return null;
  }
}

function isTestFilePath(filePath) {
  return /(?:^|\/)tests?(?:\/|$)|\.(?:test|spec)\./i.test(filePath);
}

function measureFailBefore(workerRoot, baseSha, headSha, command, options) {
  if (
    typeof workerRoot !== 'string' ||
    !workerRoot ||
    typeof baseSha !== 'string' ||
    !baseSha ||
    typeof headSha !== 'string' ||
    !headSha ||
    typeof command !== 'string' ||
    !command.trim()
  ) {
    return null;
  }

  const o = options || {};
  const check = o.spawnSync || spawnSync;
  const timeout = o.timeoutMs || 120000;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-brain-fail-before-'));
  const baseTree = path.join(tempRoot, 'base-tree');
  const archiveFile = path.join(tempRoot, 'base.tar');

  try {
    fs.mkdirSync(baseTree, { recursive: true });

    const archive = check(
      'git',
      [
        '-c',
        'safe.directory=*',
        '-C',
        workerRoot,
        'archive',
        '--format=tar',
        '--output',
        archiveFile,
        baseSha,
      ],
      { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }
    );
    if (!archive || archive.status !== 0 || !fs.existsSync(archiveFile)) return null;

    const extracted = check('tar', ['-xf', 'base.tar', '-C', 'base-tree'], {
      cwd: tempRoot,
      encoding: 'utf8',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!extracted || extracted.status !== 0) return null;

    const diff = check(
      'git',
      ['-c', 'safe.directory=*', '-C', workerRoot, 'diff', '--name-only', '-z', baseSha, headSha],
      { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }
    );
    if (!diff || diff.status !== 0) return null;

    const changedPaths = String(diff.stdout || '')
      .split('\0')
      .filter(Boolean);
    const testFiles = changedPaths.filter(isTestFilePath);
    for (const filePath of testFiles) {
      const segments = filePath.split(/[\\/]/);
      if (
        path.isAbsolute(filePath) ||
        segments.some((segment) => segment === '..' || segment === '.')
      ) {
        return null;
      }
      const fileResult = check(
        'git',
        ['-c', 'safe.directory=*', '-C', workerRoot, 'show', headSha + ':' + filePath],
        { encoding: null, timeout, maxBuffer: 16 * 1024 * 1024 }
      );
      if (!fileResult || fileResult.status !== 0 || !Buffer.isBuffer(fileResult.stdout)) {
        return null;
      }
      const destination = path.resolve(baseTree, ...segments);
      if (!destination.startsWith(path.resolve(baseTree) + path.sep)) return null;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, fileResult.stdout);
    }

    const env = Object.assign({}, process.env);
    delete env.NODE_TEST_CONTEXT;
    const result = check(command, [], {
      cwd: baseTree,
      env,
      shell: true,
      encoding: 'utf8',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!result || !Number.isInteger(result.status)) return null;

    return {
      command,
      exitCode: result.status,
      output: (String(result.stdout || '') + String(result.stderr || '')).slice(-4000),
      baseSha,
      headSha,
      testFiles,
      measuredBy: 'supervisor-base-tree',
    };
  } catch (_) {
    return null;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function getTreeStatus(cwd, options) {
  if (!cwd || !fs.existsSync(path.join(cwd, '.git'))) {
    return { isDirty: false, dirtyPaths: [], lines: [] };
  }
  const { withCleanGitEnv, safeGit } = require('./supervisor');
  try {
    return withCleanGitEnv(
      cwd,
      (tmpDir) => {
        const res = safeGit(tmpDir, cwd, ['status', '--porcelain'], 20000, options);
        if (!res || res.status !== 0) return { isDirty: false, dirtyPaths: [], lines: [] };
        const raw = String(res.stdout || '').trim();
        if (!raw) return { isDirty: false, dirtyPaths: [], lines: [] };
        const lines = raw
          .split(/\r?\n/)
          .map((l) => l.trimEnd())
          .filter(Boolean);
        const dirtyPaths = [
          ...new Set(
            lines.map((line) => {
              let p = line.slice(3).trim();
              if (p.includes(' -> ')) {
                p = p.split(' -> ')[1].trim();
              }
              if (p.startsWith('"') && p.endsWith('"')) {
                p = p.slice(1, -1);
              }
              return p;
            })
          ),
        ];
        return { isDirty: lines.length > 0, dirtyPaths, lines };
      },
      Object.assign({ workerWritable: true }, options)
    );
  } catch (err) {
    return { isDirty: false, dirtyPaths: [], lines: [] };
  }
}

function isTreeDirty(cwd, options) {
  return getTreeStatus(cwd, options).isDirty;
}

function verifyWorkerCommit(workerRoot, baseSha, options) {
  if (!workerRoot) return { pass: true };
  const headSha = headShaOf(workerRoot, options);
  const isGitRepo = fs.existsSync(path.join(workerRoot, '.git'));
  const cleanBase = baseSha ? String(baseSha).trim() : null;
  if (!headSha) {
    if (isGitRepo) {
      return {
        pass: false,
        cause: 'NO_LOCAL_COMMIT',
        headSha: null,
        baseSha: cleanBase,
        dirtyPaths: [],
        detail:
          'no commit found at HEAD in worker root; HEAD SHA: none, base SHA: ' +
          (cleanBase || 'none'),
      };
    }
    return { pass: true };
  }
  if (cleanBase && headSha.toLowerCase() === cleanBase.toLowerCase()) {
    const treeStatus = getTreeStatus(workerRoot, options);
    const dirtyPaths = treeStatus.dirtyPaths;
    const pathsDetail = dirtyPaths.length > 0 ? '; offending paths: ' + dirtyPaths.join(', ') : '';
    return {
      pass: false,
      cause: 'NO_LOCAL_COMMIT',
      headSha,
      baseSha: cleanBase,
      dirtyPaths,
      detail:
        'worker head matches base SHA ' +
        cleanBase +
        ' (no local commit created)' +
        pathsDetail +
        '; HEAD SHA: ' +
        headSha +
        ', base SHA: ' +
        cleanBase,
    };
  }
  if (cleanBase && headSha) {
    const isAncestor = (() => {
      try {
        const check = (options && options.spawnSync) || spawnSync;
        const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
        const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
        const res = check(
          'git',
          [
            '-c',
            'safe.directory=' + normWorkerRoot,
            '-c',
            'core.hooksPath=' + nulDevice,
            '-c',
            'core.fsmonitor=false',
            '-c',
            'core.attributesFile=' + nulDevice,
            'merge-base',
            '--is-ancestor',
            cleanBase,
            headSha,
          ],
          {
            cwd: workerRoot,
            windowsHide: true,
            env: Object.assign({}, process.env, {
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: nulDevice,
              GIT_CONFIG_SYSTEM: nulDevice,
            }),
          }
        );
        return res && res.status === 0;
      } catch {
        return false;
      }
    })();
    if (!isAncestor) {
      const treeStatus = getTreeStatus(workerRoot, options);
      const dirtyPaths = treeStatus.dirtyPaths;
      const pathsDetail =
        dirtyPaths.length > 0 ? '; offending paths: ' + dirtyPaths.join(', ') : '';
      return {
        pass: false,
        cause: 'NO_LOCAL_COMMIT',
        headSha,
        baseSha: cleanBase,
        dirtyPaths,
        detail:
          'worker commit ' +
          headSha +
          ' is not a descendant of base SHA ' +
          cleanBase +
          pathsDetail +
          '; HEAD SHA: ' +
          headSha +
          ', base SHA: ' +
          cleanBase,
      };
    }
  }
  const treeStatus = getTreeStatus(workerRoot, options);
  if (treeStatus.isDirty) {
    const dirtyPaths = treeStatus.dirtyPaths;
    const pathsStr = dirtyPaths.join(', ');
    return {
      pass: false,
      cause: 'NO_LOCAL_COMMIT',
      headSha,
      baseSha: cleanBase,
      dirtyPaths,
      detail:
        'worker left uncommitted changes in the worktree (dirty tree); offending paths: ' +
        pathsStr +
        '; HEAD SHA: ' +
        (headSha || 'none') +
        ', base SHA: ' +
        (cleanBase || 'none'),
    };
  }
  return {
    pass: true,
    headSha,
    baseSha: cleanBase,
  };
}

function writeUsageReportFromHarnessResult(job, res) {
  if (!job || !job.usageFile || typeof job.usageFile !== 'string') return null;
  if (fs.existsSync(job.usageFile)) return job.usageFile;

  // Hermes CLI writes its own --usage-file; an absent report for Hermes is an error (AI-64-R04, 64-01).
  // Adapters like opencode-direct do not have a CLI --usage-file flag, so the loop writes it from the result.
  if (job.harness === 'hermes') return null;
  if (typeof job.run === 'function' && job.harness !== 'opencode-direct') return null;

  let sessionId = null;
  let tokens = { input: 0, output: 0, total: 0 };

  const stdout = String((res && res.stdout) || '');
  if (stdout) {
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.sessionID || parsed.sessionId || parsed.session_id) {
            sessionId = parsed.sessionID || parsed.sessionId || parsed.session_id;
          }
          if (parsed.tokens) {
            tokens.input = Number(parsed.tokens.input) || tokens.input;
            tokens.output = Number(parsed.tokens.output) || tokens.output;
            tokens.total = Number(parsed.tokens.total) || tokens.total;
          } else if (parsed.part && parsed.part.tokens) {
            tokens.input = Number(parsed.part.tokens.input) || tokens.input;
            tokens.output = Number(parsed.part.tokens.output) || tokens.output;
            tokens.total = Number(parsed.part.tokens.total) || tokens.total;
          }
        } catch (e) {
          // ignore non-json line
        }
      }
    }
  }

  if (!sessionId && res && res.completionNonce) {
    sessionId = res.completionNonce;
  }

  // A failed launch reports session_id: null per AC-AI-64-23 / TASK-AI-63
  if (res && res.exitCode !== 0 && res.exitCode !== null && res.exitCode !== undefined) {
    sessionId = null;
  }

  const report = {
    session_id: sessionId,
    model: job.model || (job.candidate && job.candidate.model) || null,
    provider: job.upstream || job.provider || (job.candidate && job.candidate.provider) || null,
    usage: {
      input: tokens.input,
      output: tokens.output,
      total: tokens.total || tokens.input + tokens.output,
    },
  };

  try {
    fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
    fs.writeFileSync(job.usageFile, JSON.stringify(report, null, 2), 'utf8');
    return job.usageFile;
  } catch (err) {
    return null;
  }
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

/**
 * A receipt count: a number, or null when the field is absent, null or not a
 * number. `Number(null)` is `0`, so coercing first would launder an omitted
 * `repairCount` into "no repairs happened" — absence is never evidence
 * (AI-64-P08), and each count check downstream tests the raw field for null.
 */
function receiptCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

/**
 * Extracts and normalizes the recorded review result for one work item from a checkpoint.
 * Supports checkpoint.reviews as array or object, as well as completedReviews/reviewResults.
 */
function extractCheckpointReview(checkpoint, workItemId) {
  if (!checkpoint) return null;
  let raw = null;
  if (Array.isArray(checkpoint.reviews)) {
    raw = checkpoint.reviews.find((r) => r && (r.workItemId === workItemId || r.id === workItemId));
  } else if (checkpoint.reviews && typeof checkpoint.reviews === 'object') {
    raw = checkpoint.reviews[workItemId];
  }
  if (!raw && Array.isArray(checkpoint.completedReviews)) {
    raw = checkpoint.completedReviews.find(
      (r) => r && (r.workItemId === workItemId || r.id === workItemId)
    );
  } else if (
    !raw &&
    checkpoint.completedReviews &&
    typeof checkpoint.completedReviews === 'object'
  ) {
    raw = checkpoint.completedReviews[workItemId];
  }
  if (!raw && Array.isArray(checkpoint.reviewResults)) {
    raw = checkpoint.reviewResults.find(
      (r) => r && (r.workItemId === workItemId || r.id === workItemId)
    );
  } else if (!raw && checkpoint.reviewResults && typeof checkpoint.reviewResults === 'object') {
    raw = checkpoint.reviewResults[workItemId];
  }
  if (!raw || typeof raw !== 'object') return null;

  const sha =
    raw.sha || raw.reviewedSha || (raw.review && (raw.review.finalSha || raw.review.sha)) || null;
  const verdict = raw.verdict || (raw.review && raw.review.verdict) || null;
  const reviewer =
    raw.reviewer ||
    raw.reviewerKey ||
    raw.reviewerIdentity ||
    (raw.review && raw.review.reviewer) ||
    null;
  const workerRoot =
    raw.workerRoot || raw.worktree || (raw.review && raw.review.workerRoot) || null;
  const publishCwd = raw.publishCwd || (raw.review && raw.review.publishCwd) || null;
  const branch = raw.branch || (raw.review && raw.review.branch) || null;
  const baseSha = raw.baseSha || (raw.review && raw.review.baseSha) || null;
  const writerCandidateKey = raw.writerCandidateKey || raw.writer || null;
  const draftTitle = raw.draftTitle || raw.title || null;

  const record = {
    workItemId: raw.workItemId || raw.id || workItemId,
    sha: typeof sha === 'string' ? sha.trim() : null,
    reviewedSha: typeof sha === 'string' ? sha.trim() : null,
    verdict: typeof verdict === 'string' ? verdict.trim() : null,
    reviewer: typeof reviewer === 'string' ? reviewer.trim() : null,
    reviewerKey: typeof reviewer === 'string' ? reviewer.trim() : null,
    workerRoot: typeof workerRoot === 'string' ? workerRoot : null,
    publishCwd: typeof publishCwd === 'string' ? publishCwd : null,
    branch: typeof branch === 'string' ? branch : null,
    baseSha: typeof baseSha === 'string' ? baseSha.trim() : null,
    writerCandidateKey: typeof writerCandidateKey === 'string' ? writerCandidateKey.trim() : null,
    draftTitle: typeof draftTitle === 'string' ? draftTitle.trim() : null,
    tests: raw.tests && typeof raw.tests === 'object' ? raw.tests : null,
    reviewRounds: receiptCount(raw.reviewRounds),
    openFindings: receiptCount(raw.openFindings),
    decisionLog: raw.decisionLog && typeof raw.decisionLog === 'object' ? raw.decisionLog : null,
    repairCount: receiptCount(raw.repairCount),
    integrity: raw.integrity && typeof raw.integrity === 'object' ? raw.integrity : null,
  };
  // Absence stays absence. The integrity digest covers the keys that are
  // present, so re-materialising a field the checkpoint never carried as
  // `null` would rename an incomplete receipt "integrity mismatch" instead of
  // letting the check for that exact field report what is missing.
  for (const key of Object.keys(record)) {
    if (record[key] === null && !Object.prototype.hasOwnProperty.call(raw, key)) {
      delete record[key];
    }
  }
  return record;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => stableJson(v)).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableJson(value[k]))
      .join(',') +
    '}'
  );
}

function sha256Text(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex');
}

function digestObject(value) {
  return sha256Text(stableJson(value));
}

function receiptIntegrityPayload(receipt) {
  const r = Object.assign({}, receipt || {});
  delete r.integrity;
  delete r.reviewedSha;
  delete r.reviewerKey;
  return r;
}

function attachReceiptIntegrity(receipt) {
  const r = Object.assign({}, receipt || {});
  r.integrity = {
    algorithm: 'sha256:stable-json:v1',
    digest: digestObject(receiptIntegrityPayload(r)),
  };
  return r;
}

/**
 * The open findings of the COMPLETED review, not the sum of every round.
 *
 * A run that needed a repair has a first round carrying the finding that caused
 * the repair and a final round that passed with no findings at all (AI-64-R07).
 * Summing every round made every repaired run's own receipt contradictory —
 * `verdict: PASS` with `openFindings: 1` — and the receipt was then refused by
 * the very validator that wrote it, so a completed REVIEW_PASS could never be
 * published. The final round is the round the item completed on, so only its
 * findings describe the receipt; earlier rounds stay in the decision log.
 */
function countOpenFindings(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return 0;
  const final = rounds[rounds.length - 1];
  const findings = final && Array.isArray(final.findings) ? final.findings : [];
  let count = 0;
  for (const finding of findings) {
    if (!finding || finding.closed !== true) count += 1;
  }
  return count;
}

function compactTestEvidence(result, failBefore) {
  const headExit =
    result && result.headExitCode !== undefined && result.headExitCode !== null
      ? result.headExitCode
      : result && result.exitCode !== undefined && result.exitCode !== null
        ? result.exitCode
        : null;
  const baseExit =
    result && result.baseExitCode !== undefined && result.baseExitCode !== null
      ? result.baseExitCode
      : failBefore && failBefore.exitCode !== undefined && failBefore.exitCode !== null
        ? failBefore.exitCode
        : null;
  const headOutput =
    (result &&
      (result.detail || result.output || result.stdout || result.stderr || result.cause)) ||
    '';
  const baseOutput =
    (result && result.baseOutput) ||
    (failBefore &&
      (failBefore.output || failBefore.detail || failBefore.stdout || failBefore.stderr || '')) ||
    '';
  return {
    command: (result && result.command) || (failBefore && failBefore.command) || null,
    baseExitCode: baseExit,
    headExitCode: headExit,
    outputDigest: digestObject({
      base: String(baseOutput),
      head: String(headOutput),
    }),
  };
}

function normalizedReceiptTests(tests) {
  if (!tests || typeof tests !== 'object') return null;
  const baseExitCode = Number(tests.baseExitCode);
  const headExitCode = Number(tests.headExitCode);
  return {
    command: tests.command ? String(tests.command) : null,
    baseExitCode: Number.isFinite(baseExitCode) ? baseExitCode : null,
    headExitCode: Number.isFinite(headExitCode) ? headExitCode : null,
    outputDigest: tests.outputDigest ? String(tests.outputDigest) : null,
  };
}

/**
 * DT-R01: a draft Pull Request title is "[<workItemId>] <outcome>".
 *
 * The outcome is the Work Item's own title/outcome field — never acceptance
 * criteria text — it carries exactly one Work Item ID (the one in the prefix),
 * and the whole title is truncated to 72 characters. A title that quotes
 * another Work Item ID fails the Feature contract gate, so foreign IDs are
 * removed from the outcome before the title is composed.
 */
const WORK_ITEM_ID = /\b(?:FEAT|TASK-FOUND|TASK-AI)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;
const DRAFT_TITLE_LIMIT = 72;

function draftTitleFor(workItemId, outcome, fallback) {
  const id = String(workItemId || '').trim() || 'WORK-ITEM';
  const raw = outcome ? String(outcome).trim() : '';
  const withoutIds = raw.replace(WORK_ITEM_ID, '');
  // Only a removed ID can leave doubled whitespace behind, so an untouched
  // outcome keeps its own spacing exactly as the spec wrote it.
  const clean = withoutIds === raw ? raw : withoutIds.replace(/\s{2,}/g, ' ').trim();
  const body = clean || String(fallback || 'verified work item');
  const title = '[' + id + '] ' + body;
  return title.length > DRAFT_TITLE_LIMIT ? title.slice(0, DRAFT_TITLE_LIMIT) : title;
}

function draftTitleForItem(item, goal) {
  const goalText = goal ? String(goal).trim() : '';
  const firstLine = goalText.split(/\r?\n/)[0];
  const outcome =
    (item && (item.outcome || item.title || item.name)) ||
    (item && item.businessOutcome) ||
    firstLine ||
    null;
  return draftTitleFor(item && item.id, outcome, 'work item');
}

function receiptFailureDomain(candidateKeyValue) {
  const domain = routing.canonicalFailureDomain(candidateKeyValue);
  if (domain && domain !== 'unknown') return domain;
  const parsed = parseCandidateKey(candidateKeyValue);
  if (!parsed) return null;
  return parsed.upstream || parsed.gateway || null;
}

function normalizeAccount(id) {
  return !id || id === '*' || id === 'UNPINNED' ? 'UNPINNED' : id;
}

/**
 * The operator-side directory a publish of this receipt runs from.
 *
 * `workerRoot` is where the reviewed commit was produced and is where the
 * receipt verifies it, but an isolated run's worker root sits inside the worker
 * boundary and the publisher refuses to run there (`publisher.js`, unchanged).
 * The receipt therefore carries the publish cwd separately:
 *
 *   - an explicitly designated `publisherCwd` wins;
 *   - an isolated run publishes from the host worktree, never from the worker;
 *   - otherwise the worker root is operator-side already and stays the cwd.
 *
 * Absence is not a default: a receipt with no publish cwd is refused.
 */
function publishCwdForReceipt(o, workerRoot) {
  const opts = o || {};
  if (opts.publisherCwd) return String(opts.publisherCwd);
  if (opts.isolatedWorker) return String(opts.cwd || process.cwd());
  return workerRoot ? String(workerRoot) : null;
}

/**
 * The single cwd expression shared by receipt validation and publication.
 *
 * Both stages used to resolve it separately, so they could disagree about the
 * directory being published from: validation saw the operator input while
 * publication fell back to the worker root. One expression, one answer.
 */
function resolvePublishCwd(o, rec) {
  const opts = o || {};
  return (
    (opts.publication && opts.publication.cwd) ||
    opts.publisherCwd ||
    opts.cwd ||
    (rec && rec.publishCwd) ||
    null
  );
}

function hardenedGitEnv() {
  const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return Object.assign({}, process.env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nulDevice,
    GIT_CONFIG_SYSTEM: nulDevice,
  });
}

function hardenedGitArgs(cwd, extraSafeDirs) {
  const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const dirs = [cwd].concat(Array.isArray(extraSafeDirs) ? extraSafeDirs : []).filter(Boolean);
  const args = [];
  for (const dir of dirs) {
    args.push('-c', 'safe.directory=' + path.resolve(dir).replace(/\\/g, '/'));
  }
  args.push(
    '-c',
    'core.hooksPath=' + nulDevice,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.attributesFile=' + nulDevice,
    '-c',
    'diff.external=',
    '-c',
    'uploadpack.packObjectsHook='
  );
  return args;
}

function runHardenedGit(cwd, args, extraSafeDirs) {
  return spawnSync('git', hardenedGitArgs(cwd, extraSafeDirs).concat(args), {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    env: hardenedGitEnv(),
  });
}

function assertGitOk(res, refusal) {
  if (!res || res.status !== 0) {
    const detail = res && (res.stderr || res.stdout) ? String(res.stderr || res.stdout).trim() : '';
    throw new Error(refusal + (detail ? ': ' + detail : ''));
  }
  return String((res && res.stdout) || '').trim();
}

function reviewedPublishBranch(entry, request) {
  const branch = (entry && entry.branch) || (request && request.branch) || null;
  if (!branch) throw new Error('PUBLISH_REFUSED: missing publish branch');
  return String(branch).replace(/^refs\/heads\//, '');
}

function importReviewedCommitForPublish(o, entry, request) {
  const reviewedSha = entry && (entry.sha || entry.reviewedSha);
  const workerRoot = entry && entry.workerRoot;
  const baseSha = entry && entry.baseSha;
  const publishCwd = resolvePublishCwd(o, entry);
  const branch = reviewedPublishBranch(entry, request);

  if (!reviewedSha || !SHA_40.test(String(reviewedSha))) {
    throw new Error('PUBLISH_REFUSED: invalid reviewed commit for publish import');
  }
  if (!baseSha || !SHA_40.test(String(baseSha))) {
    throw new Error('PUBLISH_REFUSED: publish import missing valid baseSha');
  }
  if (!workerRoot || !fs.existsSync(path.join(workerRoot, '.git'))) {
    throw new Error('PUBLISH_REFUSED: publish import workerRoot is not a git repository');
  }
  if (!publishCwd || !fs.existsSync(path.join(publishCwd, '.git'))) {
    throw new Error('PUBLISH_REFUSED: publish import cwd is not a git repository');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-publish-import-'));
  const cloneDir = path.join(tmpDir, 'publish-worktree');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  try {
    assertGitOk(
      runHardenedGit(
        tmpDir,
        ['clone', '--no-local', '--no-hardlinks', '--no-tags', publishCwd, cloneDir],
        [publishCwd]
      ),
      'PUBLISH_REFUSED: failed to create operator-side publish clone'
    );
    assertGitOk(
      runHardenedGit(
        cloneDir,
        ['fetch', '--no-tags', '--no-recurse-submodules', workerRoot, reviewedSha],
        [workerRoot]
      ),
      'PUBLISH_REFUSED: failed to import reviewed commit from worker repo'
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['rev-parse', '--verify', reviewedSha + '^{commit}']),
      'PUBLISH_REFUSED: imported reviewed commit is missing'
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['merge-base', '--is-ancestor', baseSha, reviewedSha]),
      'PUBLISH_REFUSED: reviewed commit ' + reviewedSha + ' does not descend from base ' + baseSha
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['check-ref-format', '--branch', branch]),
      'PUBLISH_REFUSED: invalid publish branch'
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['branch', '-f', branch, reviewedSha]),
      'PUBLISH_REFUSED: failed to point publish branch at reviewed commit'
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['checkout', '-f', branch]),
      'PUBLISH_REFUSED: failed to checkout publish branch'
    );
    const head = assertGitOk(
      runHardenedGit(cloneDir, ['rev-parse', 'HEAD']),
      'PUBLISH_REFUSED: could not verify publish import HEAD'
    );
    if (head !== reviewedSha) {
      throw new Error(
        'PUBLISH_REFUSED: publish import HEAD mismatch. Expected ' + reviewedSha + ', got ' + head
      );
    }
    return { cwd: cloneDir, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function decisionLogEvidenceFor(logOpts, workItemId, sha, verdict, reviewer) {
  const out = {
    dir: (logOpts && logOpts.dir) || null,
    now: (logOpts && logOpts.now) || null,
    completed: false,
    reviewedSha: null,
    verdict: verdict || null,
    reviewer: reviewer || null,
    reviewRounds: null,
    repairCount: null,
    tests: null,
    rounds: [],
    digest: null,
  };
  if (!out.dir) return out;
  const records = decisions.readDecisionsSafe(logOpts);
  const matched = records.filter((r) => r && r.workItemId === workItemId);
  const completed = matched
    .slice()
    .reverse()
    .find((r) => r.stage === decisions.Stage.COMPLETED && r.reviewedSha === sha);
  const reviewRecords = matched.filter(
    (r) =>
      r.stage === decisions.Stage.REVIEW &&
      (r.sha === sha || r.reviewedSha === sha) &&
      (!reviewer || r.reviewer === reviewer) &&
      (!verdict || r.verdict === verdict)
  );
  const completedTests = normalizedReceiptTests(completed && completed.tests);
  out.completed = Boolean(completed);
  out.reviewedSha = completed ? completed.reviewedSha || sha : null;
  out.reviewRounds = reviewRecords.length;
  out.repairCount =
    completed && Number.isFinite(Number(completed.repairCount))
      ? Number(completed.repairCount)
      : reviewRecords.reduce(
          (max, r) =>
            Number.isFinite(Number(r.repairCount)) ? Math.max(max, Number(r.repairCount)) : max,
          0
        );
  out.tests = completedTests;
  out.rounds = reviewRecords.map((r) => ({
    round: r.round || null,
    stage: r.roundStage || null,
    sha: r.sha || r.reviewedSha || null,
    verdict: r.verdict || null,
    reviewer: r.reviewer || null,
    findings: Array.isArray(r.findings) ? r.findings : [],
  }));
  out.digest = digestObject({
    completed: completed || null,
    reviews: reviewRecords,
  });
  return out;
}

function verifyReceiptIntegrity(rec) {
  if (!rec || !rec.integrity || rec.integrity.algorithm !== 'sha256:stable-json:v1') {
    return 'PUBLISH_REFUSED: receipt integrity missing';
  }
  const expected = digestObject(receiptIntegrityPayload(rec));
  if (rec.integrity.digest !== expected) {
    return 'PUBLISH_REFUSED: receipt integrity mismatch';
  }
  return null;
}

function verifyReceiptCommit(rec, publishCwd) {
  // The publish cwd is rebuilt from the receipt, so it has to be present and it
  // has to be a directory the publisher may run from: an isolated run's worker
  // root sits inside the worker boundary and `publisher.js` refuses it. The
  // worker root stays where the commit is verified — that is its own role.
  if (!rec || !rec.publishCwd) return 'PUBLISH_REFUSED: receipt missing publish cwd';
  const { isWorkerPath } = require('./isolation-launcher');
  if (isWorkerPath(rec.publishCwd)) {
    return (
      'PUBLISH_REFUSED: receipt publish cwd is inside the worker root (' +
      String(rec.publishCwd) +
      '); the publisher runs operator-side only'
    );
  }
  const workerRoot = rec && rec.workerRoot;
  if (!workerRoot) return 'PUBLISH_REFUSED: receipt missing workerRoot';
  if (!fs.existsSync(workerRoot) || !fs.existsSync(path.join(workerRoot, '.git'))) {
    return 'PUBLISH_REFUSED: receipt workerRoot is not a git repository: ' + String(workerRoot);
  }
  if (!publishCwd) return 'PUBLISH_REFUSED: missing publish cwd for receipt check';
  if (path.resolve(publishCwd) !== path.resolve(rec.publishCwd)) {
    return 'PUBLISH_REFUSED: receipt publish cwd does not match publish cwd';
  }
  const { withCleanGitEnv, safeGit } = require('./supervisor');
  try {
    return withCleanGitEnv(
      workerRoot,
      (tmpDir) => {
        const exists = safeGit(tmpDir, workerRoot, ['rev-parse', rec.sha + '^{commit}'], 20000, {
          workerWritable: true,
        });
        if (!exists || exists.status !== 0) {
          return 'PUBLISH_REFUSED: reviewed commit not found in worker repo: ' + rec.sha;
        }
        if (!rec.baseSha || !SHA_40.test(rec.baseSha)) {
          return 'PUBLISH_REFUSED: receipt missing valid baseSha';
        }
        if (rec.sha.toLowerCase() === rec.baseSha.toLowerCase()) {
          return 'PUBLISH_REFUSED: reviewed commit equals base (no worker commit)';
        }
        const ancestor = safeGit(
          tmpDir,
          workerRoot,
          ['merge-base', '--is-ancestor', rec.baseSha, rec.sha],
          20000,
          { workerWritable: true }
        );
        if (!ancestor || ancestor.status !== 0) {
          return (
            'PUBLISH_REFUSED: reviewed commit ' +
            rec.sha +
            ' does not descend from base ' +
            rec.baseSha
          );
        }
        return null;
      },
      { workerWritable: true }
    );
  } catch (err) {
    return 'PUBLISH_REFUSED: hardened git receipt check failed: ' + String(err && err.message);
  }
}

function verifyReceiptTests(rec) {
  const tests = rec && rec.tests;
  if (!tests || typeof tests !== 'object') return 'PUBLISH_REFUSED: receipt missing test evidence';
  if (!tests.command) return 'PUBLISH_REFUSED: receipt missing verification command';
  const baseExitCode = Number(tests.baseExitCode);
  const headExitCode = Number(tests.headExitCode);
  if (!Number.isFinite(baseExitCode) || baseExitCode === 0) {
    return 'PUBLISH_REFUSED: receipt fail-before did not fail';
  }
  if (!Number.isFinite(headExitCode) || headExitCode !== 0) {
    return 'PUBLISH_REFUSED: receipt pass-after did not pass';
  }
  if (!tests.outputDigest || !/^[0-9a-f]{64}$/i.test(String(tests.outputDigest))) {
    return 'PUBLISH_REFUSED: receipt missing test output digest';
  }
  return null;
}

function verifyReceiptReviewerSeparation(rec) {
  if (!rec.writerCandidateKey) return 'PUBLISH_REFUSED: receipt missing writer identity';
  const writerDomain = receiptFailureDomain(rec.writerCandidateKey);
  const reviewerDomain = receiptFailureDomain(rec.reviewer);
  if (!writerDomain || !reviewerDomain) {
    return 'PUBLISH_REFUSED: receipt cannot parse writer/reviewer failure domain';
  }
  if (writerDomain === reviewerDomain) {
    return 'PUBLISH_REFUSED: reviewer shares writer failure domain';
  }
  return null;
}

function verifyReceiptDecisionLog(rec, workItemId) {
  const evidenceRecord = rec && rec.decisionLog;
  if (!evidenceRecord || !evidenceRecord.dir) {
    return 'PUBLISH_REFUSED: receipt missing decision log evidence';
  }
  let current;
  try {
    current = decisionLogEvidenceFor(
      { dir: evidenceRecord.dir, now: evidenceRecord.now || undefined },
      workItemId,
      rec.sha,
      rec.verdict,
      rec.reviewer
    );
  } catch (err) {
    return 'PUBLISH_REFUSED: decision log unreadable: ' + String(err && err.message);
  }
  if (!current.completed || current.reviewedSha !== rec.sha) {
    return 'PUBLISH_REFUSED: decision log does not confirm reviewed commit';
  }
  if (!evidenceRecord.digest || current.digest !== evidenceRecord.digest) {
    return 'PUBLISH_REFUSED: decision log evidence mismatch';
  }
  // Like with like: both sides count the `review` records that attest to THIS
  // receipt's reviewed commit and verdict (the matched set). The receipt used
  // to store the total round count, which also holds the repair rounds that
  // reviewed earlier commits, so every multi-round run refused against a log
  // that reported the matched count. Repair history is `repairCount`.
  if (current.reviewRounds !== rec.reviewRounds) {
    return 'PUBLISH_REFUSED: decision log review round count mismatch';
  }
  // Absence is not evidence (AI-64-P08): an omitted repairCount is an
  // incomplete receipt and refuses on the raw field, before any coercion —
  // `Number(null)` is 0 and would otherwise read as "no repairs happened".
  if (typeof rec.repairCount !== 'number' || !Number.isFinite(rec.repairCount)) {
    return 'PUBLISH_REFUSED: receipt missing repair count';
  }
  if (current.repairCount !== rec.repairCount) {
    return 'PUBLISH_REFUSED: decision log repair count mismatch';
  }
  if (
    !current.tests ||
    digestObject(current.tests) !== digestObject(normalizedReceiptTests(rec.tests))
  ) {
    return 'PUBLISH_REFUSED: decision log test evidence mismatch';
  }
  return null;
}

function validateCheckpointReceipt(rec, item, o) {
  if (!rec) return 'NO_REVIEWED_COMMIT: missing review record in checkpoint for ' + item.id;
  if (!rec.sha || !SHA_40.test(rec.sha)) {
    return 'PUBLISH_REFUSED: invalid reviewedSha in checkpoint for ' + item.id + ': ' + rec.sha;
  }
  if (!ACCEPTED_VERDICTS.includes(rec.verdict)) {
    return (
      'PUBLISH_REFUSED: checkpoint did not record a PASS verdict for ' +
      item.id +
      ', got: ' +
      String(rec.verdict)
    );
  }
  if (!rec.reviewer)
    return 'PUBLISH_REFUSED: checkpoint review record missing reviewer for ' + item.id;
  // No open findings in the COMPLETED review (AI-64-R07 / AC-AI-64-24), which
  // is what `countOpenFindings` now counts: the round the item completed on.
  if (rec.openFindings !== 0) return 'PUBLISH_REFUSED: receipt has open findings';
  if (!rec.reviewRounds || rec.reviewRounds < 1) {
    return 'PUBLISH_REFUSED: receipt missing review rounds';
  }
  if (!rec.branch) return 'PUBLISH_REFUSED: receipt missing branch';
  if (!rec.draftTitle) return 'PUBLISH_REFUSED: receipt missing draft title';
  return (
    verifyReceiptIntegrity(rec) ||
    verifyReceiptCommit(rec, resolvePublishCwd(o, rec)) ||
    verifyReceiptTests(rec) ||
    verifyReceiptReviewerSeparation(rec) ||
    verifyReceiptDecisionLog(rec, item.id)
  );
}

function normalizeReviewForCheckpoint(entry, workItemId, logOpts) {
  const sha =
    entry.sha ||
    entry.reviewedSha ||
    (entry.review && (entry.review.finalSha || entry.review.sha)) ||
    null;
  const verdict = (entry.review && entry.review.verdict) || entry.verdict || null;
  const reviewer =
    entry.reviewer ||
    entry.reviewerKey ||
    entry.reviewerIdentity ||
    (entry.review && entry.review.reviewer) ||
    null;
  const workerRoot =
    entry.workerRoot || entry.worktree || (entry.review && entry.review.workerRoot) || null;
  const branch = entry.branch || (entry.review && entry.review.branch) || null;
  const baseSha =
    entry.baseSha ||
    (entry.session && entry.session.baseSha) ||
    (entry.review && entry.review.baseSha) ||
    null;
  const writerCandidateKey = entry.writerCandidateKey || entry.writer || null;
  const publishCwd = entry.publishCwd || null;
  const repairCount =
    entry.review && Number.isFinite(Number(entry.review.repairCount))
      ? Number(entry.review.repairCount)
      : null;
  const openFindings = countOpenFindings(entry.review && entry.review.rounds);
  const tests =
    entry.tests || compactTestEvidence(entry.testResult || null, entry.failBefore || null);

  if (!sha) return null;

  const cleanSha = String(sha).trim();
  const cleanVerdict = verdict ? String(verdict).trim() : null;
  const cleanReviewer = reviewer ? String(reviewer).trim() : null;
  // One decision-log read anchors both counts. `reviewRounds` is taken from it
  // rather than from `entry.review.rounds.length`, so the receipt and the log
  // compare the same set: the `review` records that attest to THIS reviewed
  // commit and verdict. The receipt's total round count would also contain the
  // repair rounds that reviewed earlier commits, and every multi-round run then
  // refused against a log that never held them.
  const decisionLog = decisionLogEvidenceFor(
    logOpts || {},
    workItemId,
    cleanSha,
    cleanVerdict,
    cleanReviewer
  );
  const receipt = {
    workItemId,
    sha: cleanSha,
    baseSha: baseSha ? String(baseSha).trim() : null,
    verdict: cleanVerdict,
    reviewer: cleanReviewer,
    writerCandidateKey: writerCandidateKey ? String(writerCandidateKey).trim() : null,
    workerRoot: workerRoot ? String(workerRoot).trim() : null,
    publishCwd: publishCwd ? String(publishCwd).trim() : null,
    branch: branch ? String(branch).trim() : null,
    draftTitle:
      entry.draftTitle || draftTitleForItem(entry.item || { id: workItemId }, (logOpts || {}).goal),
    tests,
    reviewRounds: decisionLog.reviewRounds,
    repairCount,
    openFindings,
    decisionLog,
  };
  return attachReceiptIntegrity(receipt);
}

function buildCheckpointReviews(log, prior, completedIds, logOpts) {
  const map = new Map();
  if (prior) {
    const priorReviews = Array.isArray(prior.reviews)
      ? prior.reviews
      : prior.reviews && typeof prior.reviews === 'object'
        ? Object.values(prior.reviews)
        : [];
    for (const r of priorReviews) {
      if (r && (r.workItemId || r.id)) {
        const id = r.workItemId || r.id;
        if (r.checkpointReviewError) continue;
        map.set(id, r);
      }
    }
  }

  if (Array.isArray(log.reviews)) {
    for (const entry of log.reviews) {
      if (!entry || !entry.workItemId) continue;
      if (entry.fromCheckpoint && entry.checkpointReviewError) continue;
      const normalized = normalizeReviewForCheckpoint(entry, entry.workItemId, logOpts);
      if (normalized) map.set(entry.workItemId, normalized);
    }
  }

  const completedSet = new Set(completedIds || []);
  const result = [];
  for (const [id, rec] of map.entries()) {
    if (completedSet.has(id)) {
      result.push(rec);
    }
  }
  return result;
}

function buildProfile(item, o, forbiddenFailureDomains) {
  const role = routingRoleOf(item);
  const roleCaps = (item && item.roleRequirement && item.roleRequirement.requires) || {};
  const strictProfile =
    Boolean(o && o.enforceProofFloors === true) ||
    /^TASK-AI-73\b/.test(String((item && item.id) || ''));
  const capSet = new Set();
  for (const cap of Array.isArray(item && item.requiredCapabilities)
    ? item.requiredCapabilities
    : []) {
    if (cap) capSet.add(String(cap));
  }
  for (const cap of Array.isArray(item && item.capabilities) ? item.capabilities : []) {
    if (cap) capSet.add(String(cap));
  }
  if (strictProfile) {
    for (const cap of Array.isArray(
      item && item.roleRequirement && item.roleRequirement.capabilities
    )
      ? item.roleRequirement.capabilities
      : []) {
      if (cap) capSet.add(String(cap));
    }
    for (const [cap, enabled] of Object.entries(roleCaps || {})) {
      if (cap !== 'minContext' && enabled) capSet.add(cap);
    }
  }
  const requiredCapabilities = Array.from(capSet);
  const codingOrReview = role === 'writer' || role === 'reviewer' || role === 'security-review';
  const explicitExploration = Boolean(item && item.exploration);
  const proofFloor =
    item && item.proofFloor
      ? item.proofFloor
      : explicitExploration
        ? 'HARNESS_PASS'
        : codingOrReview && strictProfile
          ? 'WORK_ITEM_PASS'
          : 'NONE';
  return {
    taskId: item.id,
    role,
    complexity: item.complexity || 'standard',
    requiredCapabilities,
    proofFloor,
    contextSize:
      item.contextSize !== null &&
      item.contextSize !== undefined &&
      Number.isFinite(Number(item.contextSize)) &&
      Number(item.contextSize) > 0
        ? Number(item.contextSize)
        : strictProfile &&
            roleCaps.minContext !== null &&
            roleCaps.minContext !== undefined &&
            Number.isFinite(Number(roleCaps.minContext)) &&
            Number(roleCaps.minContext) > 0
          ? Number(roleCaps.minContext)
          : 64000,
    expectedDuration:
      item.expectedDuration !== null &&
      item.expectedDuration !== undefined &&
      Number.isFinite(Number(item.expectedDuration)) &&
      Number(item.expectedDuration) > 0
        ? Number(item.expectedDuration)
        : 30 * 60 * 1000,
    latencyPriority: item.latencyPriority || (codingOrReview ? 'normal' : 'high'),
    qualityFloor:
      item.qualityFloor !== null &&
      item.qualityFloor !== undefined &&
      Number.isFinite(Number(item.qualityFloor)) &&
      Number(item.qualityFloor) >= 0
        ? Number(item.qualityFloor)
        : codingOrReview
          ? 70
          : 40,
    costCeiling:
      item.costCeiling !== null &&
      item.costCeiling !== undefined &&
      Number.isFinite(Number(item.costCeiling)) &&
      Number(item.costCeiling) >= 0
        ? Number(item.costCeiling)
        : 1000000,
    requiredHarness: null,
    forbiddenFailureDomains: expandForbiddenDomains(
      [].concat(forbiddenFailureDomains || [], item.forbiddenFailureDomains || [])
    ),
    resourceCeiling:
      item.resourceCeiling !== null &&
      item.resourceCeiling !== undefined &&
      Number.isFinite(Number(item.resourceCeiling)) &&
      Number(item.resourceCeiling) > 0
        ? Number(item.resourceCeiling)
        : 4,
    currentWorkload:
      item.currentWorkload !== null &&
      item.currentWorkload !== undefined &&
      Number.isFinite(Number(item.currentWorkload)) &&
      Number(item.currentWorkload) >= 0
        ? Number(item.currentWorkload)
        : 0,
  };
}

function buildTaskProfile(item, options) {
  const o = Object.assign({ enforceProofFloors: true }, options || {});
  return buildProfile(item || {}, o, o.forbiddenFailureDomains || []);
}

function expandForbiddenDomains(domains) {
  const out = new Set();
  for (const domain of domains || []) {
    if (domain === undefined || domain === null || domain === '') continue;
    const value = String(domain);
    out.add(value);
    for (const part of value.split('/')) {
      if (part) out.add(part);
    }
  }
  return Array.from(out);
}

function hasQuotaAccountReadings(options) {
  const o = options || {};
  const rankingOpts = o.ranking || {};
  const home = o.home || rankingOpts.home;
  const storeFile =
    rankingOpts.storePath || (home ? path.join(home, '.shipde', 'agy-quota.json') : null);
  if (!storeFile) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    return Boolean(parsed && parsed.accounts && Object.keys(parsed.accounts).length > 0);
  } catch {
    return false;
  }
}

function mergeEvidenceAccounts(inputAccounts, registryAccounts) {
  const input = Array.isArray(inputAccounts) ? inputAccounts : [];
  const registry = Array.isArray(registryAccounts) ? registryAccounts : [];
  if (registry.length === 0) return input;
  const map = new Map();
  const noId = [];
  const hasCaps = (a) => Boolean(a && a.capabilities && Object.keys(a.capabilities).length > 0);

  for (const acc of input) {
    if (!acc || typeof acc !== 'object') continue;
    if (!acc.id) {
      noId.push(acc);
      continue;
    }
    map.set(acc.id, Object.assign({}, acc));
  }
  for (const reg of registry) {
    if (!reg || typeof reg !== 'object' || !reg.id) continue;
    if (map.has(reg.id)) {
      const existing = map.get(reg.id);
      if (!hasCaps(existing) && hasCaps(reg)) {
        map.set(reg.id, Object.assign({}, reg, existing, { capabilities: reg.capabilities }));
      }
    } else {
      map.set(reg.id, Object.assign({}, reg));
    }
  }
  return [...Array.from(map.values()), ...noId];
}

function resolveEvidenceAccounts(o) {
  const inputAccounts = (o && o.accounts) || (o && o.ranking && o.ranking.accounts) || [];
  const registryAccounts =
    o && Array.isArray(o.registryAccounts)
      ? o.registryAccounts
      : o && typeof o.listAccounts === 'function'
        ? o.listAccounts()
        : [];
  return mergeEvidenceAccounts(inputAccounts, registryAccounts);
}

function buildCandidates(options, evidenceData) {
  const o = options || {};
  let baseCandidates = [];
  if (Array.isArray(o.candidates)) {
    baseCandidates = o.candidates;
  } else if (o.accounts || o.catalogue) {
    baseCandidates = candidatesApi.generateCandidates({
      registry: o.registry || sourcesApi.loadSources(),
      catalogue: o.catalogue || [],
      accounts: o.accounts || [],
      openCodeIds: o.openCodeIds || [],
    });
  }
  const testsInjectedCandidates = Array.isArray(o.candidates);
  const evData =
    evidenceData !== undefined
      ? evidenceData
      : o.evidenceData !== undefined
        ? o.evidenceData
        : o.evidenceDir
          ? evidence.loadEvidence(o.evidenceDir)
          : testsInjectedCandidates
            ? null
            : evidence.loadEvidence(path.join(__dirname, 'data', 'evidence'));
  const accounts = resolveEvidenceAccounts(o);
  const evCandidates =
    evData && Array.isArray(evData.combinations)
      ? candidatesApi.candidatesFromEvidence(evData, { accounts }).filter((c) => !c.legacy)
      : [];
  return candidatesApi.mergeCandidates(baseCandidates, evCandidates);
}

function recordLaunchFailureEvidence(
  evidenceDir,
  evidenceData,
  candidate,
  res,
  classification,
  now
) {
  const payload = {
    status: 'failed',
    exitCode: res && typeof res.exitCode === 'number' ? res.exitCode : 1,
    stderr: res ? res.stderr : undefined,
    body: res ? res.body : undefined,
    cause: classification.cause,
    scope: classification.scope,
    httpStatus: res ? res.httpStatus : undefined,
    level: evidence.Level ? evidence.Level.API : 'API',
    source: 'launch-failure',
  };
  if (evidenceDir) {
    try {
      evidence.recordOutcome(evidenceDir, candidate, payload);
      const reloaded = evidence.loadEvidence(evidenceDir);
      if (evidenceData && typeof evidenceData === 'object' && reloaded) {
        Object.assign(evidenceData, reloaded);
      }
      return reloaded || evidenceData;
    } catch (_) {}
  }
  if (evidenceData && typeof evidenceData === 'object') {
    if (!evidenceData.cooldowns) evidenceData.cooldowns = {};
    const key = candidateKey(candidate);
    evidenceData.cooldowns[key] = {
      lastStatus: 'blocked',
      failCount: ((evidenceData.cooldowns[key] && evidenceData.cooldowns[key].failCount) || 0) + 1,
      blockedAt: new Date(now).toISOString(),
      blockReason: classification.cause,
      cause: classification.cause,
      scope: classification.scope,
      // RT-R03: the applied cooldown never drops below the retryAfterMs the
      // classifier reported for this same failure.
      cooldownMs: evidence.effectiveCooldownMs(classification),
    };
    if (classification.scope === 'upstream' && candidate.upstream) {
      if (!evidenceData.upstreamStatus) evidenceData.upstreamStatus = {};
      evidenceData.upstreamStatus[candidate.upstream] = {
        lastStatus: 'blocked',
        failCount:
          ((evidenceData.upstreamStatus[candidate.upstream] &&
            evidenceData.upstreamStatus[candidate.upstream].failCount) ||
            0) + 1,
        blockedAt: new Date(now).toISOString(),
        blockReason: classification.cause,
        cause: classification.cause,
        scope: 'upstream',
        cooldownMs: evidence.effectiveCooldownMs(classification),
      };
    }
  }
  return evidenceData;
}

function resolveDomainAttempts(options, item, extra, o) {
  const da =
    (options && options.domainAttempts) ||
    (item && item.domainAttempts) ||
    (extra && extra.domainAttempts) ||
    (o && o.domainAttempts) ||
    null;
  const map =
    da instanceof Map ? da : new Map(da && typeof da === 'object' ? Object.entries(da) : []);
  if (item && !item.domainAttempts) item.domainAttempts = map;
  return map;
}

function resolveEvidenceDir(options, o) {
  return (
    (options && options.evidenceDir) ||
    (o && o.evidenceDir) ||
    (Array.isArray(o && o.candidates) ? null : path.join(__dirname, 'data', 'evidence'))
  );
}

async function selectCandidateForProfile(
  item,
  annotatedCandidates,
  forbiddenDomains,
  evidenceData,
  o,
  logOpts,
  now,
  opts
) {
  const options = opts || {};
  const failedKeys = options.failedKeys || (item && item.failedKeys) || (o && o.failedKeys) || null;
  const failedKeySet =
    failedKeys instanceof Set ? failedKeys : new Set(Array.isArray(failedKeys) ? failedKeys : []);
  const excludedDomains = options.excludedDomains || (item && item.excludedDomains) || null;
  const excludedDomainSet =
    excludedDomains instanceof Set
      ? excludedDomains
      : new Set(Array.isArray(excludedDomains) ? excludedDomains : []);
  const domainAttemptsMap = resolveDomainAttempts(options, item, null, o);
  const attemptNumber = options.attempt !== undefined ? options.attempt : item && item.attempt;

  const profile = buildProfile(item, o, forbiddenDomains);
  const registry = (o && o.registry) || sourcesApi.loadSources();
  const jevSource = sourcesApi.getSource('jev', registry);
  const jevAsk =
    o.jevAsk ||
    jev.buildJevAsk(jevSource, {
      home: o && o.home,
      env: (o && o.env) || process.env,
      httpClient: o && o.jevHttpClient,
      timeoutMs: o && o.jevTimeoutMs,
    });

  const evData =
    evidenceData && (evidenceData.combinations || Object.keys(evidenceData).length > 0)
      ? evidenceData
      : o && o.evidenceDir
        ? evidence.loadEvidence(o.evidenceDir)
        : evidenceData;

  let candidates = Array.isArray(annotatedCandidates) ? annotatedCandidates : [];
  if (evData && Array.isArray(evData.combinations) && evData.combinations.length > 0) {
    const accounts = resolveEvidenceAccounts(o);
    const evCandidates = candidatesApi
      .candidatesFromEvidence(evData, { accounts })
      .filter((c) => !c.legacy);
    candidates = candidatesApi.mergeCandidates(candidates, evCandidates);
    candidates = candidatesApi.annotateCandidates(
      candidates.map((c) => Object.assign({}, c)),
      evData,
      { now }
    );
  }

  if (failedKeySet.size > 0 || excludedDomainSet.size > 0 || domainAttemptsMap.size > 0) {
    candidates = candidates.map((c) => {
      const k = candidateKey(c);
      if (failedKeySet.has(k)) {
        return Object.assign({}, c, {
          blocked: true,
          blockReason: 'LAUNCH_FAILED',
          blockScope: 'candidate',
        });
      }
      const cDomain = routing.canonicalFailureDomain(c);
      if (excludedDomainSet.has(cDomain) || (domainAttemptsMap.get(cDomain) || 0) >= 2) {
        return Object.assign({}, c, {
          blocked: true,
          blockReason: excludedDomainSet.has(cDomain)
            ? 'FAILURE_DOMAIN_EXCLUDED'
            : 'DOMAIN_ATTEMPTS_EXHAUSTED',
          blockScope: 'domain',
        });
      }
      return c;
    });
  }

  // The weighting assessment is the Controller's own, obtained through the real
  // JEV source declared in sources.json. The ask is closed and only about
  // weighting profiles, never a model, provider, account or gateway.
  const assessment = await routing.assessTask(profile, {
    ask: jevAsk,
    minConfidence: jevSource && jevSource.minConfidence,
  });

  const rankCtx = {
    now,
    taskId: profile.taskId,
    evidenceData: evData,
    priors: o && o.ranking && o.ranking.priors,
    headrooms: o && o.ranking && o.ranking.headrooms,
    reservations: o && o.ranking && o.ranking.reservations,
    accounts: o && o.ranking && o.ranking.accounts,
    useStoredQuota: true,
    home: (o && o.home) || (o && o.ranking && o.ranking.home),
    storePath: o && o.ranking && o.ranking.storePath,
    explorationBudget:
      o && o.ranking && o.ranking.explorationBudget !== undefined
        ? Number(o.ranking.explorationBudget)
        : item && item.exploration
          ? 1
          : 0,
    enforceKnownQuota:
      o && o.ranking && o.ranking.enforceKnownQuota === true
        ? true
        : o && o.ranking && o.ranking.enforceKnownQuota === false
          ? false
          : hasQuotaAccountReadings(o),
  };

  const result = routing.rankForProfile(candidates, profile, assessment, rankCtx);

  if (result.chosen) {
    if (failedKeySet.has(result.chosen)) {
      result.chosen = null;
      result.reason = 'REFUSED: candidate launch previously failed';
    } else {
      const chosenCand = candidates.find((c) => candidateKey(c) === result.chosen);
      if (chosenCand) {
        const cDomain = routing.canonicalFailureDomain(chosenCand);
        if (excludedDomainSet.has(cDomain) || (domainAttemptsMap.get(cDomain) || 0) >= 2) {
          result.chosen = null;
          result.reason = excludedDomainSet.has(cDomain)
            ? 'REFUSED: failure domain previously excluded'
            : 'REFUSED: failure domain attempt budget exhausted';
        }
      }
    }
  }

  const writerKey = (item && item.writerCandidateKey) || null;
  if (writerKey) {
    if (result.chosen && result.chosen === writerKey) {
      result.chosen = null;
      result.reason = 'REFUSED: reviewer equals writer';
    }
    const existingRejection = result.rejected.find((r) => r.candidateKey === writerKey);
    if (existingRejection) {
      existingRejection.reasonCode = 'REVIEWER_EQUALS_WRITER';
      existingRejection.reason = 'reviewer must not equal writer';
      existingRejection.scope = 'candidate';
    }
    const alreadyRejected = Boolean(existingRejection);
    if (!alreadyRejected) {
      const writerCand = (candidates || []).find((c) => candidateKey(c) === writerKey);
      if (writerCand) {
        result.rejected.push({
          candidateKey: writerKey,
          reasonCode: 'REVIEWER_EQUALS_WRITER',
          reason: 'reviewer must not equal writer',
          scope: 'candidate',
          upstream: writerCand.upstream,
          modelId: writerCand.modelId,
          accountId: writerCand.accountId || '*',
        });
      }
    }
  }

  const stage =
    profile.role === 'reviewer'
      ? (decisions.Stage && decisions.Stage.REVIEWER_SELECTION) || 'reviewer-selection'
      : (decisions.Stage && decisions.Stage.SELECTED) || 'selected';

  const allExcluded = new Set(failedKeySet);
  for (const c of candidates) {
    const k = candidateKey(c);
    const cDomain = routing.canonicalFailureDomain(c);
    if (excludedDomainSet.has(cDomain) || (domainAttemptsMap.get(cDomain) || 0) >= 2) {
      allExcluded.add(k);
    }
  }
  for (const d of excludedDomainSet) {
    allExcluded.add(d);
  }
  for (const [d, count] of domainAttemptsMap.entries()) {
    if (count >= 2) {
      allExcluded.add(d);
    }
  }

  const decisionRecorded = {
    stage,
    workItemId: profile.taskId,
    role: roleOf(item),
    attempt: attemptNumber !== undefined ? attemptNumber : undefined,
    attemptNumber: attemptNumber !== undefined ? attemptNumber : undefined,
    profile,
    taskProfile: profile,
    jev: assessment,
    weightProfile: assessment.weightProfile,
    jevModel: assessment.jevModel || null,
    confidence: assessment.confidence !== undefined ? assessment.confidence : null,
    probabilities: assessment.probabilities || null,
    top3: result.top3.map((c) => ({
      candidateKey: c.candidateKey,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      proof: routing.proofObserved(evData, c) || 'NONE',
      capabilityEvidence: c.capabilities || {},
      account: normalizeAccount(c.accountId),
      quota: {
        headroom: c.headroomStatus || 'unknown',
        reasonCode: c.quotaReasonCode || null,
        quotaScope: c.quotaScope || null,
        accountId: normalizeAccount(c.accountId),
      },
      failureDomain: routing.failureDomainOf(c),
      reservationsHeld: c.reservationsHeld || 0,
      sessions: c.sessionsHeld || 0,
    })),
    ranking: result.ranking.map((c) => ({
      candidateKey: c.candidateKey,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      proof: routing.proofObserved(evData, c) || 'NONE',
      capabilityEvidence: c.capabilities || {},
      headroom: c.headroomStatus || 'unknown',
      quotaReasonCode: c.quotaReasonCode || null,
      failureDomain: routing.failureDomainOf(c),
      account: normalizeAccount(c.accountId),
      reservationsHeld: c.reservationsHeld || 0,
    })),
    rejected: result.rejected.slice(0, 50),
    rejectedCount: result.rejected.length,
    fallbackSequence: [],
    firstChoice: result.top3[0] ? result.top3[0].candidateKey : null,
    selected: result.chosen,
    chosen: result.chosen,
    chosenKey: result.chosen,
    reason: result.reason,
    excluded: Array.from(allExcluded),
    excludedSet: Array.from(allExcluded),
  };
  decisions.recordDecision(decisionRecorded, logOpts);

  return {
    chosen: result.chosen,
    reason: result.reason,
    result,
    decisionRecorded,
  };
}

/**
 * TASK-AI-114 (D3): dependencies first, dependents after them, plan order
 * preserved for everything else. A dependency the planner already refused
 * (unknown id or cycle) cannot appear here; the visiting mark still keeps a
 * malformed edge from recursing forever.
 */
function orderDependenciesFirst(items) {
  const list = Array.isArray(items) ? items : [];
  const byId = new Map();
  for (const item of list) {
    if (item && item.id) byId.set(item.id, item);
  }
  const state = new Map();
  const ordered = [];
  const visit = (item) => {
    const mark = state.get(item.id);
    if (mark === 'done' || mark === 'visiting') return;
    state.set(item.id, 'visiting');
    for (const depId of item.dependencies || []) {
      const depItem = byId.get(depId);
      if (depItem) visit(depItem);
    }
    state.set(item.id, 'done');
    ordered.push(item);
  };
  for (const item of list) visit(item);
  return ordered;
}

/**
 * @param goal  user goal text
 * @param opts  {
 *   specs, specText, candidates, registry, run, isolatedWorker, tests, reviewer,
 *   repairer, reviewerIdentity, sha, baseSha, base, branch, cwd, workerRoot,
 *   usageDir, reviewBudget, decisionDir, checkpointFile, out, now, publication,
 *   ranking (Controller ranking inputs: headrooms, load, reservations, ...),
 *   jevAsk (optional JEV advisory; absent means the Controller decides)
 * }
 * @returns a promise for the run record: the JEV assessment is an async call, so
 *   the loop is too.
 */
async function runOrchestration(goal, opts) {
  const o = Object.assign({ goal }, opts || {});
  const now = o.now || Date.now();
  const log = buildDefaults();
  log.goal = goal || null;

  // 1. plan (validated DAG). planner.js stays the only validator (AI-64-R01): an
  //    unknown dependency, a cycle or two items owning one file fails closed
  //    here, before anything is launched.
  log.plan = planner.plan(goal, { specs: o.specs || [] });

  const cli = controller();
  const decisionDir = o.decisionDir || null;
  // TASK-AI-120 RI-R04: the host repo for passed-commit imports and host-side
  // commit checks is named explicitly. There is deliberately no default to the
  // incidental process.cwd(): a run that names no host repo imports nothing
  // instead of writing refs/shipde/* into whatever repository the process
  // happens to sit in.
  const hostCwd =
    o.hostCwd || o.cwd || o.workdir || (o && o.host && o.host.cwd) || (o && o.root) || null;
  const logOpts = { dir: decisionDir, now, goal: o.goal };
  const checkpointFile =
    o.checkpointFile || (typeof o.checkpoint === 'string' ? o.checkpoint : null);
  const usageDir = o.usageDir || path.join(os.tmpdir(), 'shipde-usage');

  // The trace is not optional (AI-64-R14): a run that cannot say where its
  // decisions are written is refused rather than quietly writing nothing.
  if (!decisionDir) {
    return refuseRun(log, 'DECISION_LOG_DIR_MISSING: a live run must be able to write its trace');
  }

  // TASK-AI-121 LF-R03: the worker timeout every launch (writer, reviewer and
  // repair) starts with, in milliseconds. The CLI flag's unit is minutes
  // (--worker-timeout-min, 1..240, default 30); this is its run-log form.
  o.workerTimeoutMs =
    Number.isFinite(Number(o.workerTimeoutMs)) && Number(o.workerTimeoutMs) > 0
      ? Number(o.workerTimeoutMs)
      : 30 * 60 * 1000;
  log.workerTimeoutMs = o.workerTimeoutMs;

  // 2. The worker boundary (AI-64-P03). The isolated launcher is obtained
  //    whenever the run asks for the boundary, whether or not a runner was
  //    injected: injecting a runner replaces what runs the process, never whether
  //    the boundary exists.
  let isolatedLauncher = null;
  if (o.isolatedWorker) {
    isolatedLauncher = require('./isolation-launcher').getIsolatedLauncher();
  }
  const hostWorktree = o.cwd || process.cwd();
  const isolatedWorkerRoot = o.isolatedWorker
    ? require('./isolation-launcher').workerRootFor(hostWorktree)
    : null;
  const launcher = resolveLauncher(o, isolatedLauncher);
  log.isolation = {
    requested: Boolean(o.isolatedWorker),
    launcherObtained: Boolean(isolatedLauncher),
    executor:
      typeof o.run === 'function' ? 'injected-runner' : isolatedLauncher ? 'isolated' : 'none',
    hostWorktree: o.isolatedWorker ? hostWorktree : null,
    workerRoot: isolatedWorkerRoot,
    baseSha: o.baseSha || null,
  };

  // 3. Resume (AI-64-R14). The checkpoint file is the only resume input: a missing
  //    file is a clean first run, and an item the checkpoint already carries as
  //    completed is never launched again.
  let checkpointOnDisk = cli.readCheckpoint(checkpointFile);
  const liveSteps =
    checkpointOnDisk && checkpointOnDisk.liveSteps && typeof checkpointOnDisk.liveSteps === 'object'
      ? checkpointOnDisk.liveSteps
      : {};
  const persistStep = (workItemId, stage, fields) => {
    if (!checkpointFile) return;

    // TASK-AI-128 P1: re-read from disk so we don't clobber updates made by the launcher (adopted repair shas)
    const diskContent = cli.readCheckpoint(checkpointFile);
    if (diskContent && diskContent.liveSteps && diskContent.liveSteps[workItemId]) {
      const diskStep = diskContent.liveSteps[workItemId];
      if (liveSteps[workItemId]) {
        if (diskStep.launch && diskStep.launch.workerSha) {
          liveSteps[workItemId].launch = liveSteps[workItemId].launch || {};
          liveSteps[workItemId].launch.workerSha = diskStep.launch.workerSha;
        }
        if (diskStep.repair && diskStep.repair.sha) {
          liveSteps[workItemId].repair = liveSteps[workItemId].repair || {};
          liveSteps[workItemId].repair.sha = diskStep.repair.sha;
        }
      } else {
        liveSteps[workItemId] = diskStep;
      }
    }

    const previous = liveSteps[workItemId] || { workItemId, failures: [] };
    const nextStep = Object.assign({}, previous, fields || {}, {
      workItemId,
      stage,
      updatedAt: new Date(now).toISOString(),
    });
    liveSteps[workItemId] = nextStep;
    const next = Object.assign({}, checkpointOnDisk || {}, diskContent || {}, {
      schemaVersion: 1,
      liveSteps,
      updatedAt: new Date(now).toISOString(),
    });
    checkpointOnDisk = next;
    cli.writeJsonFile(checkpointFile, next);
  };
  const completedBefore = new Set(
    checkpointOnDisk && Array.isArray(checkpointOnDisk.completed) ? checkpointOnDisk.completed : []
  );
  const publishedBefore = new Set(
    Object.entries(liveSteps)
      .filter(
        ([, step]) =>
          step && step.publication && step.publication.status === PublicationStatus.PUBLISHED_DRAFT
      )
      .map(([workItemId]) => workItemId)
  );

  // TASK-AI-120 RI-R01/RI-R04: one passed-ref import path for every resume
  // shape. The live path records passedRef on the review entry and as its
  // sibling; a resume must see either before importing again (a second import
  // is a fetch that can fail or duplicate). The import runs only with an
  // explicit host repo and only from the recorded worker root — never from the
  // incidental process.cwd() (RI-R04).
  const recordedPassedRefOf = (step, entry) =>
    (entry && entry.passedRef) || (step && step.review && step.review.passedRef) || null;
  const importPassedRefFor = (workItemId, entry, step) => {
    const recorded = recordedPassedRefOf(step, entry);
    if (recorded || !entry || !entry.sha || !hostCwd) return recorded;
    try {
      const imp = importPassedCommit({
        hostRepo: hostCwd,
        workerRoot: entry.workerRoot || entry.worktree || null,
        workItemId,
        sha: entry.sha,
        spawnSync,
      });
      return imp.ok ? imp.ref : null;
    } catch (e) {
      return null;
    }
  };

  // 4. One writer per work item, and an unreadable log stops the run instead of
  //    reading as "no writers": the only evidence of a claim is the claim.
  // One decision-log read anchors both questions this gate asks: who holds a
  // writer claim now, and which work items this log already records as
  // launched. The second one is what stops an empty or one-step-stale
  // checkpoint from silently relaunching a worker (CK-R01 P2-4).
  const decisionLogRead = decisions.readDecisionsDetailed(logOpts);
  const writers = decisionLogRead.readable
    ? decisions.openWritersDetailed(
        Object.assign({}, logOpts, { records: decisionLogRead.records })
      )
    : { writers: [], readable: false, damaged: decisionLogRead.damaged };
  const logUnreadable = writers.readable
    ? null
    : 'DECISION_LOG_UNREADABLE: ' + (writers.damaged.join('; ') || 'unknown');
  const launchedBefore = new Set();
  for (const record of decisionLogRead.records) {
    if (record && record.stage === decisions.Stage.LAUNCHED && record.workItemId) {
      launchedBefore.add(String(record.workItemId));
    }
  }

  const statusOf = new Map();
  const testsInjectedCandidates = Array.isArray(o.candidates);
  const evidenceDir =
    o.evidenceDir || (testsInjectedCandidates ? null : path.join(__dirname, 'data', 'evidence'));
  let evidenceData =
    o.evidenceData !== undefined
      ? o.evidenceData
      : evidenceDir
        ? evidence.loadEvidence(evidenceDir)
        : null;
  const rawCandidates = buildCandidates(o, evidenceData);
  const candidates = candidatesApi.annotateCandidates(
    rawCandidates.map((c) => Object.assign({}, c)),
    evidenceData,
    { now }
  );

  const registry = o.registry || { sources: [] };

  const outcome = (item, status, reason, extra) => {
    statusOf.set(item.id, status);
    const extraFields = Object.assign({}, extra);
    if (status === ItemStatus.BLOCKED) {
      const itemTried = (item && item.triedKeys) || (extra && extra.triedKeys);
      if (itemTried) {
        const arr = Array.isArray(itemTried) ? itemTried : Array.from(itemTried);
        if (!extraFields.triedKeys) extraFields.triedKeys = arr;
        if (!extraFields.tried) extraFields.tried = arr;
      }
    }
    const entry = Object.assign(
      { workItemId: item.id, status, reason: reason || null },
      extraFields
    );
    log.outcomes.push(entry);
    return reason;
  };

  // TASK-AI-114 R04 (D3): a dependency is worked and reviewed before its
  // dependent, so the dependent can start from the dependency's PASS commit.
  // The order is stable: items without dependencies keep the plan order, and a
  // dependent is only moved after its own dependencies.
  const dependencyPassShaOf = (depId) => {
    for (let i = log.reviews.length - 1; i >= 0; i -= 1) {
      const entry = log.reviews[i];
      if (
        entry &&
        entry.workItemId === depId &&
        entry.sha &&
        SHA_40.test(String(entry.sha)) &&
        entry.review &&
        entry.review.status === ReviewStatus.COMPLETED
      ) {
        return String(entry.sha).trim();
      }
    }
    return null;
  };

  for (const item of orderDependenciesFirst(log.plan.workItems)) {
    if (log.plan.errors.length > 0) {
      // AI-64-R01: nothing is deferred silently; the errors travel in the run's
      // own outcome record and every item is reported as deferred.
      outcome(item, ItemStatus.DEFERRED, log.plan.errors.join('; '));
      continue;
    }
    if (completedBefore.has(item.id) || publishedBefore.has(item.id)) {
      outcome(item, ItemStatus.COMPLETED, 'CHECKPOINT_COMPLETED');
      log.resumed = {
        stage: 'resumed',
        workItemId: item.id,
        from: checkpointOnDisk.step || 'completed',
      };
      const savedStep = liveSteps[item.id];
      const rec = extractCheckpointReview(checkpointOnDisk, item.id);
      const checkpointReviewError = validateCheckpointReceipt(rec, item, o);
      const anchoredEvidence =
        !checkpointReviewError && rec
          ? decisionLogEvidenceFor(
              { dir: rec.decisionLog.dir, now: rec.decisionLog.now || undefined },
              item.id,
              rec.sha,
              rec.verdict,
              rec.reviewer
            )
          : null;

      const reviewEntry = {
        workItemId: item.id,
        sha: rec ? rec.sha : null,
        reviewedSha: rec ? rec.sha : null,
        reviewerIdentity: rec ? rec.reviewer : null,
        reviewer: rec ? rec.reviewer : null,
        writerCandidateKey: rec ? rec.writerCandidateKey : null,
        workerRoot: rec ? rec.workerRoot : null,
        publishCwd: rec ? rec.publishCwd : null,
        branch: rec ? rec.branch : null,
        baseSha: rec ? rec.baseSha : null,
        draftTitle: rec ? rec.draftTitle : null,
        tests: rec ? rec.tests : null,
        reviewRounds: rec ? rec.reviewRounds : null,
        repairCount: rec ? rec.repairCount : null,
        openFindings: rec ? rec.openFindings : null,
        decisionLog: rec ? rec.decisionLog : null,
        integrity: rec ? rec.integrity : null,
        fromCheckpoint: true,
        checkpointReviewError,
        review:
          !checkpointReviewError && rec
            ? {
                status: ReviewStatus.COMPLETED,
                finalSha: rec.sha,
                verdict: rec.verdict,
                reviewer: rec.reviewer,
                workerRoot: rec.workerRoot,
                branch: rec.branch,
                baseSha: rec.baseSha,
                rounds: anchoredEvidence.rounds,
                repairCount: anchoredEvidence.repairCount,
              }
            : null,
      };
      // TASK-AI-120 RI-R01 (finding 6): an item completed before this run may
      // still be missing its passed ref — the interrupt that created this
      // checkpoint could land after the outcome and before the import. Import
      // now, before anything depends on the commit.
      const completedPassedRef = importPassedRefFor(item.id, reviewEntry, savedStep);
      if (completedPassedRef && !reviewEntry.passedRef) {
        reviewEntry.passedRef = completedPassedRef;
        persistStep(item.id, 'review_completed', {
          review: {
            status: ReviewStatus.COMPLETED,
            entry: reviewEntry,
            passedRef: completedPassedRef,
          },
        });
      }
      if (!log.reviews.some((review) => review.workItemId === item.id))
        log.reviews.push(reviewEntry);
      log.review = log.reviews[log.reviews.length - 1] || reviewEntry;
      continue;
    }
    const savedStep = liveSteps[item.id] || null;
    if (savedStep && savedStep.review && savedStep.review.status === ReviewStatus.COMPLETED) {
      const reviewEntry = savedStep.review.entry;
      if (reviewEntry) {
        // TASK-AI-120 RI-R01: a step resumed at review_completed with a PASS
        // review and no passedRef imports the PASS SHA from the recorded
        // worker root before any dependent launch, and records passedRef on
        // the review entry and beside it — the two places the live path records
        // it, so a later resume sees the ref instead of importing again.
        const passedRef = importPassedRefFor(item.id, reviewEntry, savedStep);
        if (passedRef && !reviewEntry.passedRef) {
          reviewEntry.passedRef = passedRef;
          persistStep(item.id, 'review_completed', {
            review: {
              status: savedStep.review.status,
              entry: reviewEntry,
              passedRef,
            },
          });
        }
        outcome(item, ItemStatus.COMPLETED, 'CHECKPOINT_REVIEW_COMPLETED');
        log.reviews.push(reviewEntry);
        log.review = reviewEntry;
        log.resumed = { stage: 'resumed', workItemId: item.id, from: savedStep.stage };
        continue;
      }
    }
    // TASK-AI-121 LF-R02: the run already stopped on an unusable isolation
    // verdict. Every remaining item would fail the same way, so nothing else is
    // launched; each is reported BLOCKED with the reason and the operator
    // action. Items already completed above stay completed.
    if (log.isolationStop) {
      outcome(item, ItemStatus.BLOCKED, log.isolationStop.reason, {
        reasonCode: log.isolationStop.reasonCode,
        humanAction: log.isolationStop.humanAction,
      });
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
    // CK-R02 (P1-3): the session this checkpoint recorded is the session that
    // owns the claim. A claim held by that same session is reclaimed on resume;
    // a claim held by any other live session is still a duplicate writer. The
    // check runs before the RESUMED record so a foreign claim is never
    // overwritten by the resuming run's own record.
    const recordedSessionId =
      savedStep && savedStep.launch && savedStep.launch.sessionId
        ? String(savedStep.launch.sessionId)
        : null;
    const ownClaim = Boolean(
      claim && recordedSessionId && claim.sessionId && String(claim.sessionId) === recordedSessionId
    );
    if (claim && !ownClaim) {
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
    if (checkpointOnDisk && !(savedStep && savedStep.launch) && launchedBefore.has(item.id)) {
      // CK-R01 (P2-4): the decision log already records a launched worker for
      // this item and this checkpoint carries no launch record to resume from.
      // A stale or emptied checkpoint is not evidence that nothing happened, so
      // the run refuses loudly instead of silently relaunching the worker.
      const reason =
        'CHECKPOINT_LAUNCH_RECORD_MISSING: the decision log already records a launched worker for ' +
        item.id +
        ' and this checkpoint holds no launch record to resume from';
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
    if (savedStep && savedStep.stage && checkpointOnDisk) {
      log.resumed = { stage: 'resumed', workItemId: item.id, from: savedStep.stage };
      decisions.recordDecision(
        {
          stage: decisions.Stage.RESUMED,
          workItemId: item.id,
          role: roleOf(item),
          sessionId: recordedSessionId || undefined,
          detail: ownClaim
            ? 'resumed from ' + savedStep.stage + ' and reclaimed its writer claim'
            : 'resumed from ' + savedStep.stage,
          checkpoint: checkpointFile,
        },
        logOpts
      );
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

    // TASK-AI-114 R03/R04 (D2/D3): a dependent work item is launched only after
    // its dependency is PASS, and it starts from the dependency's reviewed PASS
    // commit rather than the global --base-sha. The handoff is recorded as
    // `baseSha` with `baseFrom: <dependency id>`. Multiple dependencies are
    // refused fail-closed (MULTI_DEPENDENCY_BASE_UNSUPPORTED): one launch base
    // cannot be several commits at once.
    const depIds = Array.isArray(item.dependencies)
      ? item.dependencies.filter((depId) => typeof depId === 'string' && depId)
      : [];
    let dependencyBase = null;
    if (depIds.length > 1) {
      const reason =
        'MULTI_DEPENDENCY_BASE_UNSUPPORTED: ' +
        item.id +
        ' depends on ' +
        depIds.join(', ') +
        '; a dependent launch takes exactly one dependency commit';
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
    if (depIds.length === 1) {
      const depId = depIds[0];
      let depPassSha = dependencyPassShaOf(depId);
      if (
        !depPassSha &&
        liveSteps[depId] &&
        liveSteps[depId].review &&
        liveSteps[depId].review.entry &&
        liveSteps[depId].review.entry.sha
      ) {
        depPassSha = liveSteps[depId].review.entry.sha;
      }
      if (!depPassSha) {
        const reason =
          'DEPENDENCY_NOT_PASSED: ' +
          item.id +
          ' needs a PASS review of ' +
          depId +
          ' before it can be launched';
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
      // TASK-AI-120 RI-R02: a dependent can start only from a commit that still
      // exists — in the host or in the dependency's recorded worker root. When
      // the PASS SHA is in neither, the dependent is BLOCKED with
      // DEPENDENCY_COMMIT_UNAVAILABLE before any writer launch.
      const savedDepStep = liveSteps[depId];
      const depReviewEntry = savedDepStep && savedDepStep.review && savedDepStep.review.entry;
      const workerRoot =
        (depReviewEntry && (depReviewEntry.workerRoot || depReviewEntry.worktree)) || null;
      const hostHasDep = hostCwd ? hasCommit(hostCwd, depPassSha) : false;
      const workerHasDep = workerRoot ? hasCommit(workerRoot, depPassSha) : false;
      if (!hostHasDep && !workerHasDep) {
        const reason =
          'DEPENDENCY_COMMIT_UNAVAILABLE: ' +
          item.id +
          ' depends on ' +
          depId +
          ' (sha ' +
          depPassSha +
          ') which is present in neither the host repository nor the worker root';
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
      dependencyBase = { baseSha: depPassSha, baseFrom: depId };
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
    if (!item.failedKeys || !(item.failedKeys instanceof Set)) {
      item.failedKeys = new Set(Array.isArray(item.failedKeys) ? item.failedKeys : []);
    }
    if (!item.excludedDomains || !(item.excludedDomains instanceof Set)) {
      item.excludedDomains = new Set(
        Array.isArray(item.excludedDomains) ? item.excludedDomains : []
      );
    }
    if (!item.domainAttempts || !(item.domainAttempts instanceof Map)) {
      item.domainAttempts =
        item.domainAttempts instanceof Map
          ? item.domainAttempts
          : item.domainAttempts && typeof item.domainAttempts === 'object'
            ? new Map(Object.entries(item.domainAttempts))
            : new Map();
    }
    if (!item.triedKeys || !(item.triedKeys instanceof Set)) {
      item.triedKeys = new Set(Array.isArray(item.triedKeys) ? item.triedKeys : []);
    }
    const failedKeys = item.failedKeys;
    const forbiddenDomains = [];
    const excludedDomains = item.excludedDomains;
    const domainAttempts = item.domainAttempts;
    const triedKeys = item.triedKeys;
    for (const failure of (savedStep && savedStep.failures) || []) {
      // TASK-AI-120 RI-R03: a local failure (a missing base commit) blames
      // nothing — not on the fresh attempt and not on a later resume.
      const blaming = failure.failureScope !== 'local';
      if (blaming && failure.failedCandidateKey) failedKeys.add(failure.failedCandidateKey);
      if (blaming && failure.failureDomain) excludedDomains.add(failure.failureDomain);
      if (
        blaming &&
        failure.forbiddenDomain &&
        !forbiddenDomains.includes(failure.forbiddenDomain)
      ) {
        forbiddenDomains.push(failure.forbiddenDomain);
      }
    }
    let blockedReason = null;
    let session = null;

    // TASK-AI-117 (RS-R01/RS-R02): a checkpoint whose launch already completed
    // (a worker commit and exit 0) has nothing to relaunch and nothing to
    // reattach to — that writer session is finished. The run proceeds directly
    // to review of that exact workerSha with the recorded failBefore: no
    // candidate is re-selected, no session is reattached, and
    // HARNESS_NO_SESSION_ID is never raised (nor counted as a failure-domain
    // attempt) for a completed launch. A launch with no workerSha is genuinely
    // incomplete and keeps the launch/reattach path below (RS-R03).
    const recordedLaunch = savedStep && savedStep.launch ? savedStep.launch : null;
    const recordedLaunchExit = recordedLaunch ? recordedLaunch.exitCode : null;

    // TASK-AI-128 P2: resume must read step.repair.sha so the next resume asks for the repair SHA.
    const resumedWorkerSha =
      (savedStep && savedStep.repair && savedStep.repair.sha) ||
      (recordedLaunch && recordedLaunch.workerSha) ||
      null;

    const resumedCompletedLaunch = Boolean(
      recordedLaunch &&
      resumedWorkerSha &&
      SHA_40.test(String(resumedWorkerSha).trim()) &&
      (recordedLaunchExit === 0 || recordedLaunchExit === '0')
    );
    if (resumedCompletedLaunch) {
      const workerSha = String(resumedWorkerSha).trim();
      const resumedCandidate = (Array.isArray(candidates) ? candidates : []).find(
        (c) => candidateKey(c) === recordedLaunch.candidateKey
      );
      const resumeBase = recordedLaunch.baseSha || o.baseSha || null;
      const resumeWorktree = o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || o.cwd || null;
      let resumedFailBefore = recordedLaunch.failBefore || null;
      if (!resumedFailBefore && resumeBase && item.verification && item.verification.command) {
        // The recorded failBefore is reused whenever it exists; only a launch
        // interrupted before its measurement is measured here, exactly as the
        // launch path would have measured it.
        const measure = o.measureFailBefore || measureFailBefore;
        resumedFailBefore = measure(
          resumeWorktree,
          resumeBase,
          workerSha,
          item.verification.command
        );
      }
      session = {
        workItemId: item.id,
        attempt: 1,
        firstChoice: recordedLaunch.candidateKey || null,
        selected: recordedLaunch.candidateKey || null,
        fallbackReason: null,
        sessionId: recordedLaunch.sessionId || null,
        usageReport: null,
        candidateKey: recordedLaunch.candidateKey || null,
        harness: (resumedCandidate && resumedCandidate.harness) || null,
        branch: o.branch || 'feat/' + String(item.id).toLowerCase(),
        baseSha: resumeBase,
        exitCode: recordedLaunch.exitCode,
        status: SessionStatus.COMPLETED_WITH_ARTIFACT,
        startedAt: null,
        exercise: null,
        failBefore: resumedFailBefore,
        worktree: resumeWorktree,
        headSha: workerSha,
      };
      log.sessions.push(session);
      log.launches.push({
        workItemId: item.id,
        firstChoice: session.firstChoice,
        selected: session.selected,
        fallbackReason: null,
        scope: null,
        cause: null,
        outcome: 'resumed',
      });
      log.exercise = session.exercise;
      log.failBefore = session.failBefore;
    }

    for (let attempt = 1; !session && attempt <= candidates.length + 1; attempt += 1) {
      // 5. The Controller chooses every candidate (AI-64-P01). This is a live
      //    decision, not a dry run: it is written to the decision log before the
      //    launch, with the ranking inputs it was made from (AI-64-R03).
      const currentItemStep = liveSteps[item.id] || savedStep;
      const failedForSelection = new Set(failedKeys);
      const excludedForSelection = new Set(excludedDomains);
      const selectedCheckpoint =
        attempt === 1 &&
        currentItemStep &&
        currentItemStep.selection &&
        !(currentItemStep.failures || []).some(
          (failure) => failure.failedCandidateKey === currentItemStep.selection.candidateKey
        )
          ? currentItemStep.selection
          : null;
      const decision = selectedCheckpoint
        ? selectedCheckpoint.decision
        : await selectCandidateForProfile(
            item,
            candidates,
            [...new Set(forbiddenDomains)],
            evidenceData,
            o,
            logOpts,
            now,
            {
              failedKeys: failedForSelection,
              excludedDomains: excludedForSelection,
              domainAttempts,
              attempt,
            }
          );

      log.selections.push({ workItemId: item.id, attempt, decision });
      if (!decision.chosen) {
        if (failedKeys.size > 0) {
          blockedReason =
            'NO_ALTERNATE_FAILURE_DOMAIN' +
            (launch.scope && launch.cause ? ': ' + launch.scope + ' (' + launch.cause + ')' : '');
        } else {
          blockedReason = 'NO_ELIGIBLE_CANDIDATE: ' + (decision.reason || 'no candidate qualifies');
        }
        break;
      }
      const candidate = candidates.find((c) => candidateKey(c) === decision.chosen);
      if (launch.firstChoice === null) launch.firstChoice = decision.chosen;
      launch.selected = decision.chosen;
      triedKeys.add(decision.chosen);
      const candDomain = routing.canonicalFailureDomain(candidate);
      domainAttempts.set(candDomain, (domainAttempts.get(candDomain) || 0) + 1);
      if (!selectedCheckpoint) {
        const currentStep = liveSteps[item.id] || savedStep;
        persistStep(item.id, 'candidate_selected', {
          selection: { candidateKey: decision.chosen, decision },
          failures: (currentStep && currentStep.failures) || [],
        });
      }

      const branch = o.branch || 'feat/' + String(item.id).toLowerCase();
      const usageFile = prepareUsageReport(usageDir, String(item.id) + '-' + now + '-a' + attempt);

      // The prompt carries the pinned key the Controller chose (AI-64-R02), so it
      // is compiled per attempt rather than once before any selection.
      const compiledPrompt = compilePrompt(item, {
        goal,
        specText: o.specText,
        candidateKey: decision.chosen,
        branch,
        usageFile,
        isolatedWorker: Boolean(o.isolatedWorker),
        recordTools: false,
        returnTools: true,
      });
      const prompt = compiledPrompt.prompt;
      const promptToolIds = compiledPrompt.tools;
      if (Array.isArray(promptToolIds) && promptToolIds.length > 0) {
        decisions.recordDecision(
          {
            stage: decisions.Stage.PROMPT_TOOLS,
            workItemId: item.id,
            role: roleOf(item),
            tools: promptToolIds,
          },
          logOpts
        );
        decisions.recordDecision(
          Object.assign({}, decision.decisionRecorded || {}, { tools: promptToolIds }),
          logOpts
        );
      }
      log.prompts.push({ workItemId: item.id, attempt, candidateKey: decision.chosen, prompt });

      const route = resolveLaunchRoute(candidate, o, registry);
      if (!route) {
        blockedReason = 'HARNESS_UNKNOWN: no dispatch route for ' + String(decision.chosen);
        break;
      }
      const job = {
        workItemId: item.id,
        candidateKey: decision.chosen,
        harness: route.harnessName,
        provider: route.provider,
        model: route.model,
        accountId: normalizeAccount(candidate.accountId),
        gateway: candidate.gateway || '',
        upstream: candidate.upstream,
        quotaScope: candidate.quotaScope,
        prompt,
        branch,
        base: o.base || 'main',
        // TASK-AI-114 R03: a dependent starts from its dependency's PASS commit.
        baseSha: dependencyBase ? dependencyBase.baseSha : o.baseSha || null,
        hostWorktree: o.isolatedWorker ? hostWorktree : null,
        workerRoot: o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || null,
        cwd: o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || o.cwd,
        isolatedWorker: Boolean(o.isolatedWorker),
        usageFile,
        decisionDir: o.decisionDir || null,
        checkpoint: checkpointFile,
        title: String(item.id),
        labels: { workItem: String(item.id), role: roleOf(item) },
        exercise: o.exercise || null,
        workerTimeoutMs: o.workerTimeoutMs || null,
      };

      // The exercise runner exists in the worker's own tree before the agent
      // starts, so the fail-before at the pinned base SHA is a real captured run
      // and the pass-after at the worker's head SHA is the same command.
      // For isolated worker launches, the runner is materialised inside the
      // isolated launcher AFTER the worker root is provisioned so git clone does
      // not overwrite it. For non-isolated or injected runners, materialise here.
      if (o.exercise && job.cwd && (!o.isolatedWorker || typeof o.run === 'function')) {
        job.exercise = materialiseExercise(job.cwd, o);
        if (job.exercise && job.exercise.failBefore) {
          job.failBefore = job.exercise.failBefore;
        }
      }

      const previousLaunch = currentItemStep && currentItemStep.launch;
      // TASK-AI-120 RI-R03: the blame decision must use the classification this
      // attempt earned. A replayed launch carries its recorded classification;
      // a fresh failure is classified from its own signals below.
      const replayedLaunch = Boolean(
        previousLaunch && previousLaunch.candidateKey === decision.chosen
      );
      let launchClassification = null;
      let res = null;
      if (replayedLaunch) {
        launchClassification = previousLaunch.failureClassification || null;
        // TASK-AI-121 LF-R01: the replay reports the failure the first attempt
        // earned, real message included — an empty stderr here is what lost the
        // message for every attempt after the first.
        const recordedMessage =
          previousLaunch.failureMessage ||
          (launchClassification &&
            launchClassification.evidence &&
            launchClassification.evidence.stderr) ||
          '';
        res = {
          exitCode: previousLaunch.exitCode,
          stdout: previousLaunch.hasArtifact ? 'checkpointed worker output was present' : '',
          stderr: recordedMessage,
          sessionId: previousLaunch.sessionId,
        };
        job.failBefore = previousLaunch.failBefore || null;
        log.resumed = {
          stage: 'resumed',
          workItemId: item.id,
          from: previousLaunch.failBefore ? 'fail_before_measured' : 'worker_launch_finished',
        };
      } else {
        try {
          res = launcher(job);
        } catch (err) {
          res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
        }
        if (res && res.exercise) job.exercise = res.exercise;
        writeUsageReportFromHarnessResult(job, res);
        const adapter = harnessFor({ harness: job.harness });
        const launchHandle = adapter
          ? require('./executor').readSessionId(adapter, job, res).id
          : null;
        const launchFailed =
          !res || (res.exitCode !== null && res.exitCode !== undefined && res.exitCode !== 0);
        const currentSavedStep = liveSteps[item.id] || savedStep;
        const failureList =
          currentSavedStep && currentSavedStep.failures ? currentSavedStep.failures.slice() : [];
        if (launchFailed) {
          // TASK-AI-120 RI-R03: the shared classifier owns the missing-base
          // rule (ISOLATION_CHECKOUT_FAILED / ISOLATION_BASE_SHA_* ->
          // launch_config / local), so a fresh failure classifies exactly like
          // a replayed one and the guard below is never dead. The inputs are
          // the full launch signals — including worker stdout, where provider
          // quota events travel — so this is the one classification of record.
          const isLaunchTimedOut = Boolean(
            res &&
            (res.timedOut === true ||
              /\[ISOLATION_LAUNCHER\] worker timed out/i.test(res.stderr || '') ||
              /\[ISOLATION_LAUNCHER\] worker timed out/i.test(res.failureReason || ''))
          );
          launchClassification = classifyFailure({
            exitCode: res ? res.exitCode : -1,
            httpStatus: res ? res.httpStatus : undefined,
            body: res ? res.body : undefined,
            stdout: res ? res.stdout : undefined,
            stderr: res ? res.stderr : undefined,
            accountId: candidate.accountId,
            timedOut: isLaunchTimedOut,
          });
          failureList.push({
            failedCandidateKey: decision.chosen,
            failureScope: launchClassification.scope,
            failureDomain:
              launchClassification.scope === 'gateway' || launchClassification.scope === 'upstream'
                ? routing.canonicalFailureDomain(candidate)
                : null,
            forbiddenDomain:
              launchClassification.scope === 'upstream'
                ? candidate.upstream
                : launchClassification.scope === 'gateway'
                  ? candidate.gateway
                  : null,
            cause: launchClassification.cause,
          });
        }
        persistStep(item.id, 'worker_launch_finished', {
          failures: failureList,
          launch: {
            candidateKey: decision.chosen,
            exitCode: res ? res.exitCode : -1,
            hasArtifact: Boolean(res && (res.stdout || res.artifact)),
            sessionId: launchHandle,
            failureClassification: launchClassification,
            // TASK-AI-121 LF-R01: the real launcher message (scrubbed, capped)
            // so a replayed attempt records it instead of losing it.
            failureMessage: launchFailed ? failureMessageOf(res) : null,
            workerSha: headShaOf(job.cwd) || o.sha || null,
            failBefore: null,
            // TASK-AI-114 R03: the commit this launch starts from and where it
            // came from: the dependency id for a dependent, the global
            // --base-sha otherwise.
            baseSha: job.baseSha || null,
            baseFrom: dependencyBase ? dependencyBase.baseFrom : null,
          },
        });
      }

      if (previousLaunch && previousLaunch.candidateKey === decision.chosen) {
        writeUsageReportFromHarnessResult(job, res);
        if (job.usageFile && res && res.sessionId && !fs.existsSync(job.usageFile)) {
          fs.writeFileSync(
            job.usageFile,
            JSON.stringify({ session_id: res.sessionId }, null, 2),
            'utf8'
          );
        }
      }

      if (res && res.exercise) {
        job.exercise = res.exercise;
      }
      if (res && res.failBefore) {
        job.failBefore = res.failBefore;
      }
      if (
        !job.failBefore &&
        res &&
        res.exitCode === 0 &&
        job.cwd &&
        job.baseSha &&
        item.verification &&
        item.verification.command
      ) {
        const workerHead = headShaOf(job.cwd);
        if (workerHead) {
          const measure = o.measureFailBefore || measureFailBefore;
          job.failBefore = measure(job.cwd, job.baseSha, workerHead, item.verification.command);
        }
      }
      {
        const currentStep = liveSteps[item.id] || {};
        const recordedFailBefore = currentStep.launch && currentStep.launch.failBefore;
        if (JSON.stringify(recordedFailBefore || null) !== JSON.stringify(job.failBefore || null)) {
          persistStep(item.id, 'fail_before_measured', {
            launch: Object.assign({}, currentStep.launch, { failBefore: job.failBefore || null }),
            failBefore: job.failBefore || null,
          });
        }
      }
      if (previousLaunch && previousLaunch.failBefore) {
        job.failBefore = previousLaunch.failBefore;
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
        const isLauncherTimedOut = Boolean(
          res &&
          (res.timedOut === true ||
            /\[ISOLATION_LAUNCHER\] worker timed out/i.test(res.stderr || '') ||
            /\[ISOLATION_LAUNCHER\] worker timed out/i.test(res.failureReason || ''))
        );
        // TASK-AI-120 RI-R03: never recompute a different classification here —
        // the failure is recorded and blamed (or not) as one thing.
        const classification =
          launchClassification ||
          classifyFailure({
            exitCode: res ? res.exitCode : -1,
            httpStatus: res ? res.httpStatus : undefined,
            body: res ? res.body : undefined,
            stdout: res ? res.stdout : undefined,
            stderr: res ? res.stderr : undefined,
            accountId: candidate.accountId,
            timedOut: isLauncherTimedOut,
          });
        launch.scope = classification.scope;
        launch.cause = classification.cause;
        launch.outcome = 'failed';
        const currentStep = liveSteps[item.id] || {};
        const failureList = (currentStep.failures || []).slice();
        if (!failureList.some((f) => f.failedCandidateKey === decision.chosen)) {
          failureList.push({
            failedCandidateKey: decision.chosen,
            failureScope: classification.scope,
            failureDomain:
              classification.scope === 'gateway' || classification.scope === 'upstream'
                ? routing.canonicalFailureDomain(candidate)
                : null,
            forbiddenDomain:
              classification.scope === 'upstream'
                ? candidate.upstream
                : classification.scope === 'gateway'
                  ? candidate.gateway
                  : null,
            cause: classification.cause,
          });
        }
        persistStep(item.id, 'worker_launch_failed', { failures: failureList });
        // RI-R03: local scope failures (like missing base commit) don't add to failedKeys
        if (classification.scope !== 'local') {
          failedKeys.add(decision.chosen);
          if (classification.scope === 'gateway' || classification.scope === 'upstream') {
            excludedDomains.add(candDomain);
            const forbidden =
              classification.scope === 'upstream' ? candidate.upstream : candidate.gateway;
            if (forbidden && !forbiddenDomains.includes(forbidden))
              forbiddenDomains.push(forbidden);
          }
        } else {
          // A local failure is nobody's fault: it consumes no failure-domain
          // attempt budget either, so the same candidate key stays selectable.
          domainAttempts.set(candDomain, Math.max(0, (domainAttempts.get(candDomain) || 0) - 1));
        }
        // TASK-AI-121 LF-R01: a local launch infrastructure failure is not
        // evidence about the candidate — it sets no evidence cooldown.
        if (classification.scope !== 'local') {
          evidenceData = recordLaunchFailureEvidence(
            evidenceDir,
            evidenceData,
            candidate,
            res,
            classification,
            now
          );
        }

        const attemptsInDomain = domainAttempts.get(candDomain) || 0;
        const domainExhausted = attemptsInDomain >= 2;
        const scopeExcludesDomain =
          classification.scope === 'upstream' || classification.scope === 'gateway';
        // TASK-AI-120 RI-R03: a local failure (e.g. a missing base commit) must
        // not add the candidate or its failure domain to any exclusion set.
        if (classification.scope !== 'local' && (scopeExcludesDomain || domainExhausted)) {
          if (candDomain) {
            excludedDomains.add(candDomain);
          }
          if (classification.scope === 'upstream' || (domainExhausted && candidate.upstream)) {
            if (candidate.upstream && !forbiddenDomains.includes(candidate.upstream)) {
              forbiddenDomains.push(candidate.upstream);
            }
          }
          if (classification.scope === 'gateway' || (domainExhausted && !candidate.upstream)) {
            if (candidate.gateway && !forbiddenDomains.includes(candidate.gateway)) {
              forbiddenDomains.push(candidate.gateway);
            }
          }
        }

        cli.applyFailureBlocks(
          candidates,
          failedKeys,
          candidate,
          classification,
          true,
          cli.LIVE_BLOCK_CODES
        );
        const allFailedExcluded = new Set(failedKeys);
        for (const c of candidates) {
          const k = candidateKey(c);
          const cDomain = routing.canonicalFailureDomain(c);
          if (excludedDomains.has(cDomain)) {
            allFailedExcluded.add(k);
          }
        }
        for (const d of excludedDomains) {
          allFailedExcluded.add(d);
        }
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: item.id,
            role: roleOf(item),
            attempt,
            attemptNumber: attempt,
            chosen: decision.chosen,
            chosenKey: decision.chosen,
            branch: job.branch,
            failureScope: classification.scope,
            cause: classification.cause,
            // TASK-AI-121 LF-R01: a local launch infrastructure failure keeps
            // the launcher's real message (first 300 chars, no secrets) so the
            // human reads what actually broke, not the cause word alone.
            detail: failedDecisionDetail(classification, res),
            excluded: Array.from(allFailedExcluded),
            excludedSet: Array.from(allFailedExcluded),
            // RT-R01: record retryable and retryAfterMs from classification
            retryable: classification.retryable,
            retryAfterMs: classification.retryAfterMs,
            // RT-R03: the cooldown this failure actually sets — the longer of
            // the default cooldown and the provider's own retryAfterMs. A local
            // failure sets none.
            cooldownMs:
              classification.scope === 'local' ? 0 : evidence.effectiveCooldownMs(classification),
          },
          logOpts
        );
        // TASK-AI-121 LF-R02: a stale or missing isolation verdict would fail
        // every candidate identically. The run stops here — one launch, one
        // recorded failure, and the operator action that clears it.
        const verdictStop = markIsolationVerdictStop(log, res, classification);
        if (verdictStop) {
          blockedReason = verdictStop.reason;
          break;
        }
        const alternate = candidates.find((c) => {
          const k = candidateKey(c);
          if (failedKeys.has(k)) return false;
          if (c.blocked) return false;
          const cDomain = routing.canonicalFailureDomain(c);
          if (excludedDomains.has(cDomain)) return false;
          if ((domainAttempts.get(cDomain) || 0) >= 2) return false;
          if (routing.isForbiddenCandidate && routing.isForbiddenCandidate(c, forbiddenDomains))
            return false;
          return true;
        });
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
      const adapter = harnessFor({ harness: job.harness });
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
        harness: job.harness,
        branch: job.branch,
        baseSha: job.baseSha,
        exitCode: res.exitCode,
        status,
        startedAt: res.startedAt || null,
        exercise: job.exercise || null,
        failBefore: job.failBefore || (job.exercise && job.exercise.failBefore) || null,
        worktree: job.cwd || null,
      };
      const workerHead = headShaOf(job.cwd);
      if (workerHead) {
        session.headSha = workerHead;
      }
      log.sessions.push(session);
      log.launches.push(launch);
      log.exercise = session.exercise;
      log.failBefore = session.failBefore;
      launch.outcome = 'launched';

      decisions.recordDecision(
        {
          stage: decisions.Stage.LAUNCHED,
          workItemId: item.id,
          role: roleOf(item),
          chosen: decision.chosen,
          harness: job.harness,
          branch: job.branch,
          sessionId: reported.id,
          detail: 'DURABLE_SESSION_ID',
          worktree: job.cwd || null,
          // TASK-AI-114 R03: the handoff commit, with the dependency it came
          // from when this work item is a dependent.
          baseSha: job.baseSha || null,
          baseFrom: dependencyBase ? dependencyBase.baseFrom : null,
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
      const isNoAlt =
        failedKeys.size > 0 ||
        triedKeys.size > 0 ||
        Boolean(blockedReason && blockedReason.startsWith('NO_ALTERNATE_FAILURE_DOMAIN'));
      const verdictStop = log.isolationStop || null;
      outcome(
        item,
        ItemStatus.BLOCKED,
        (verdictStop && verdictStop.reason) || blockedReason || 'NO_LIVE_SESSION',
        Object.assign(
          {
            reasonCode: verdictStop
              ? verdictStop.reasonCode
              : isNoAlt
                ? 'NO_ALTERNATE_FAILURE_DOMAIN'
                : undefined,
            triedKeys: Array.from(triedKeys),
            tried: Array.from(triedKeys),
          },
          verdictStop ? { humanAction: verdictStop.humanAction } : undefined,
          launch.cause ? { cause: launch.cause } : undefined
        )
      );
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
          // RT-R01: retryable is false for terminal session failures (no classification available)
          retryable: false,
          retryAfterMs: null,
          cooldownMs: null,
        },
        logOpts
      );
      outcome(
        item,
        ItemStatus.BLOCKED,
        blockedReason,
        Object.assign(
          {
            triedKeys: Array.from(triedKeys),
            tried: Array.from(triedKeys),
          },
          log.isolationStop
            ? {
                reasonCode: log.isolationStop.reasonCode,
                humanAction: log.isolationStop.humanAction,
              }
            : undefined,
          launch.cause ? { cause: launch.cause } : undefined
        )
      );
      continue;
    }

    const reviewed = await reviewItem(
      o,
      item,
      session,
      log,
      logOpts,
      launcher,
      usageDir,
      now,
      candidates,
      evidenceData,
      registry,
      {
        failedKeys,
        excludedDomains,
        domainAttempts,
        triedKeys,
        evidenceDir,
        onCheckpoint: (reviewStage, reviewData) => persistStep(item.id, reviewStage, reviewData),
        resumedReview: savedStep && savedStep.review ? savedStep.review : null,
        resumedReviewRounds: (savedStep && savedStep.reviewRounds) || [],
      }
    );
    const reviewEntry = log.reviews[log.reviews.length - 1];
    // DT-R02: the format gate refuses before any review record is written, so a
    // stale entry from an earlier item must never be checkpointed as this one.
    if (reviewEntry && reviewEntry.workItemId === item.id) {
      // The interrupt window (TASK-AI-120 RI-R01): the PASS is checkpointed
      // before the import, so a kill here resumes into a step with no passedRef.
      persistStep(item.id, 'review_completed', {
        review: { status: reviewed.status, entry: reviewEntry },
      });
    }
    if (reviewed.status === ReviewStatus.COMPLETED) {
      // TASK-AI-119/120: import the passed commit into the host repo and record
      // passedRef on the review entry and beside it (RI-R01).
      const passedRef = reviewEntry
        ? importPassedRefFor(item.id, reviewEntry, liveSteps[item.id])
        : null;
      if (reviewEntry) {
        if (passedRef) reviewEntry.passedRef = passedRef;
        persistStep(item.id, 'review_completed', {
          review: {
            status: reviewed.status,
            entry: reviewEntry,
            passedRef: passedRef || undefined,
          },
        });
      }
      outcome(item, ItemStatus.COMPLETED, 'REVIEW_PASS');
    } else if (reviewed.status === ItemStatus.REFUSED) {
      // DT-R02: the format gate stopped the item before review. It is neither a
      // completed item nor an infrastructure block — the commit exists and is
      // unformatted, so it is refused and the next run retries it after a
      // repair formats the files.
      outcome(
        item,
        ItemStatus.REFUSED,
        reviewed.reason,
        Object.assign(
          { triedKeys: Array.from(triedKeys), tried: Array.from(triedKeys) },
          reviewed.gate ? { reasonCode: reviewed.gate } : undefined
        )
      );
    } else {
      const isNoAlt =
        reviewed.reason === 'NO_ALTERNATE_FAILURE_DOMAIN' ||
        (item.blockedReason && item.blockedReason.startsWith('NO_ALTERNATE_FAILURE_DOMAIN')) ||
        (reviewed.reason && reviewed.reason.startsWith('NO_ALTERNATE_FAILURE_DOMAIN'));
      const verdictStop = log.isolationStop || null;
      const extra = Object.assign(
        {
          triedKeys: Array.from(triedKeys),
          tried: Array.from(triedKeys),
        },
        verdictStop
          ? { reasonCode: verdictStop.reasonCode, humanAction: verdictStop.humanAction }
          : isNoAlt
            ? { reasonCode: 'NO_ALTERNATE_FAILURE_DOMAIN' }
            : undefined
      );
      outcome(
        item,
        ItemStatus.BLOCKED,
        verdictStop
          ? verdictStop.reason
          : isNoAlt
            ? 'NO_ALTERNATE_FAILURE_DOMAIN'
            : reviewed.reason,
        extra
      );
    }
  }

  // 6. Publication is its own gated stage (AI-64-P04/R12/R13), one entry per
  //    reviewed work item. The loop cannot mint the approval that authorises it, so
  //    an unwired run says so instead of pretending a draft Pull Request exists.
  //
  // RT-R04 (TASK-AI-118): publish is never replayable. The run records whether an
  //    attempt already failed or timed out and refuses every later attempt with
  //    PUBLISH_NOT_REPLAYABLE — in the publication record and in the decision log.
  //    A failed publish can already have left an external effect behind, so the run
  //    starts no second one until an operator reconciles in a fresh run.
  const publishGuard = { failed: null };
  // TASK-AI-122 PI-R03: what this run published — workItemId -> published
  // branch. A dependent draft PR stacks on its dependency's branch.
  const publishedByItem = new Map();
  const recordPublishDecision = (entry, published) => {
    const reason = published.reason || null;
    const notReplayable = Boolean(reason && reason.startsWith('PUBLISH_NOT_REPLAYABLE'));
    if (!logOpts || (!o.publication && !notReplayable)) return;
    decisions.recordDecision(
      {
        stage:
          published.status === PublicationStatus.PUBLISHED_DRAFT
            ? decisions.Stage.COMPLETED
            : decisions.Stage.REFUSED,
        workItemId: entry.workItemId,
        role: roleOf(entry.item || entry),
        status: published.status,
        detail: notReplayable
          ? 'PUBLISH_NOT_REPLAYABLE'
          : published.attempted
            ? 'PUBLISH_ATTEMPT'
            : 'PUBLISH_NOT_ATTEMPTED',
        reason,
        refusalCode: notReplayable
          ? 'PUBLISH_NOT_REPLAYABLE'
          : published.status === PublicationStatus.REFUSED && published.attempted
            ? 'PUBLISH_FAILED'
            : undefined,
      },
      logOpts
    );
  };

  for (const entry of log.reviews) {
    const itemStep = liveSteps[entry.workItemId] || {};
    // CK-R03 (P1-2): a draft publication already recorded in the checkpoint is
    // returned exactly as it was written — including a run cut between the
    // publication persist and finish(). Never a second publish, never a rebuilt
    // receipt, whatever the rebuilt review record for this resume looks like.
    const recordedPublication =
      itemStep.publication && itemStep.publication.status === PublicationStatus.PUBLISHED_DRAFT
        ? itemStep.publication
        : null;
    if (recordedPublication) {
      if (!log.publications.some((saved) => saved.workItemId === entry.workItemId)) {
        log.publications.push(recordedPublication);
      }
      const recordedBranch =
        recordedPublication.branch ||
        (recordedPublication.result && recordedPublication.result.branch) ||
        (entry && entry.branch) ||
        null;
      if (recordedBranch) {
        publishedByItem.set(entry.workItemId, String(recordedBranch).replace(/^refs\/heads\//, ''));
      }
      log.resumed = {
        stage: 'resumed',
        workItemId: entry.workItemId,
        from: 'publication',
      };
      continue;
    }

    // RT-R04: a publish attempt already failed or timed out in this run, and
    // isReplayable('publish') says that attempt may never be made again.
    if (publishGuard.failed && !isReplayable('publish')) {
      const refused = {
        status: PublicationStatus.REFUSED,
        workItemId: entry.workItemId,
        reason:
          'PUBLISH_NOT_REPLAYABLE: publish cannot be replayed after a failed or timed-out attempt (' +
          publishGuard.failed.workItemId +
          ': ' +
          publishGuard.failed.reason +
          ')',
      };
      log.publications.push(refused);
      entry.publication = refused;
      if (liveSteps[entry.workItemId]) {
        liveSteps[entry.workItemId].publication = refused;
      }
      recordPublishDecision(entry, refused);
      continue;
    }

    const published = publication(o, entry, publishGuard, publishedByItem);
    log.publications.push(published);

    // The publication record lives on the entry as well, so this run's guard and
    // a later resume both see what the attempt actually did.
    entry.publication = published;
    if (liveSteps[entry.workItemId]) {
      liveSteps[entry.workItemId].publication = published;
    }

    if (published.status === PublicationStatus.PUBLISHED_DRAFT) {
      persistStep(entry.workItemId, 'publication', { publication: published });
      if (published.result && typeof published.result.then === 'function') {
        // CK-R03 keeps the draft receipt exactly as written. The attempt itself is
        // awaited so a failed or timed-out publish marks the guard before this loop
        // can reach the next entry, and so the record stops claiming a draft that
        // never landed.
        try {
          await published.result;
        } catch (_) {
          // publication() already corrected the record and marked the guard.
        }
      }
      // PI-R03: record the published branch so a dependent can stack on it.
      // Only a draft that still stands counts: an attempt that failed after the
      // record was written publishes no branch.
      const publishedBranch =
        published.status === PublicationStatus.PUBLISHED_DRAFT
          ? published.branch ||
            (published.result && published.result.branch) ||
            (entry && entry.branch) ||
            null
          : null;
      if (publishedBranch) {
        publishedByItem.set(
          entry.workItemId,
          String(publishedBranch).replace(/^refs\/heads\//, '')
        );
      }
    }
    recordPublishDecision(entry, published);
  }

  log.publication = log.publications[log.publications.length - 1] || {
    status: o.publication ? PublicationStatus.REFUSED : PublicationStatus.NOT_REQUESTED,
    reason: 'NO_REVIEWED_COMMIT: nothing to publish',
  };
  log.evidenceData = evidenceData;

  return finish(log, statusOf, { now, cli, checkpointFile, checkpointOnDisk, out: o.out, logOpts });
}
/**
 * L-R02 (TASK-AI-83): After each review round the loop writes the human markdown
 * artifact and JSON manifest next to the decision log (data dir of the run), and
 * validates the manifest with validateManifest against the exact reviewed SHA.
 */
function writeReviewManifestAndArtifact(opts) {
  const {
    dir,
    repoCwd,
    workItemId,
    baseSha,
    reviewedSha,
    writerCandidateKey,
    reviewerCandidateKey,
    verdict,
    findings,
    tests,
    roundNumber,
  } = opts;

  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });

  const artifactPath = path.join(dir, 'review-artifact.md');
  const manifestPath = path.join(dir, 'review-manifest.json');

  const findingsList = Array.isArray(findings) ? findings : [];
  const testsList = Array.isArray(tests) ? tests : [];

  const markdownContent = [
    `# Review for ${workItemId}`,
    '',
    `- **Commit**: ${reviewedSha}`,
    `- **Verdict**: ${verdict}`,
    `- **Reviewer**: ${reviewerCandidateKey || 'reviewer'}`,
    `- **Round**: ${roundNumber || 1}`,
    '',
    '## Findings',
    findingsList.length === 0
      ? 'No open findings.'
      : findingsList
          .map((f) => {
            const st = f && (f.status || (f.open ? 'open' : 'resolved'));
            const id = f && f.id;
            const sum = (f && (f.summary || f.detail)) || '';
            return `- [${st}] ${id}: ${sum}`;
          })
          .join('\n'),
    '',
    '## Tests',
    testsList.length === 0
      ? 'No tests recorded.'
      : testsList
          .map((t) => {
            const cmd = t && t.command;
            const res = t && (t.result || (t.pass ? 'pass' : 'fail'));
            const sum = (t && (t.summary || t.detail)) || '';
            return `- ${cmd}: ${res} (${sum})`;
          })
          .join('\n'),
    '',
  ].join('\n');

  fs.writeFileSync(artifactPath, markdownContent, 'utf8');

  if (roundNumber) {
    const roundArtifactPath = path.join(
      dir,
      `review-artifact-${workItemId}-round-${roundNumber}.md`
    );
    fs.writeFileSync(roundArtifactPath, markdownContent, 'utf8');
  }
  const itemArtifactPath = path.join(dir, `review-artifact-${workItemId}.md`);
  fs.writeFileSync(itemArtifactPath, markdownContent, 'utf8');

  const { buildManifest, validateManifest } = require('./review-manifest');
  const manifest = buildManifest({
    repoCwd,
    workItemId,
    baseSha,
    reviewedSha,
    writerCandidateKey,
    reviewerCandidateKey,
    verdict,
    findings: findingsList,
    tests: testsList,
    artifactPath: itemArtifactPath,
  });

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(manifestPath, manifestJson, 'utf8');
  if (roundNumber) {
    const roundManifestPath = path.join(
      dir,
      `review-manifest-${workItemId}-round-${roundNumber}.json`
    );
    fs.writeFileSync(roundManifestPath, manifestJson, 'utf8');
  }
  const itemManifestPath = path.join(dir, `review-manifest-${workItemId}.json`);
  fs.writeFileSync(itemManifestPath, manifestJson, 'utf8');

  const validation = validateManifest(manifest, {
    repoCwd,
    expected: { workItemId, commit: reviewedSha },
    artifactPath: itemArtifactPath,
  });

  // PI-R01: the per-Work-Item manifest and artifact are the artifacts of
  // record. The shared review-manifest.json / review-artifact.md pair is still
  // written for legacy readers, but it is last-writer-wins across a multi-item
  // run, so nothing downstream may treat it as this item's evidence.
  return {
    manifestPath: itemManifestPath,
    artifactPath: itemArtifactPath,
    manifest,
    validation,
  };
}

/** DT-R02: what a host-side format check concluded about a worker commit. */
const FormatGate = Object.freeze({
  PASSED: 'PASSED',
  REFUSED: 'REFUSED',
  UNAVAILABLE: 'UNAVAILABLE',
});

const ToolGate = Object.freeze({
  PASSED: 'PASSED',
  REFUSED: 'REFUSED',
  UNAVAILABLE: 'UNAVAILABLE',
});

/** The file types `prettier --check` can judge. */
const PRETTIER_FILE = /\.(js|jsx|ts|tsx|json|md|html|css|scss|less|yaml|yml)$/i;

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * The repository's own prettier, resolved from this module instead of from the
 * process cwd: DT-R02 is a host-side gate and the worker's files sit in a
 * worker root that carries no node_modules of its own.
 */
function prettierEntry() {
  const pkgPath = require.resolve('prettier/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.prettier;
  return bin ? path.join(path.dirname(pkgPath), bin) : null;
}

/**
 * The worker's changed files between the handoff base and the commit under
 * review, filtered to the ones prettier can check and that still exist.
 */
function changedPrettierFiles(workerRoot, baseSha, targetSha) {
  const diff = spawnSync('git', ['diff', '--name-only', baseSha + '..' + targetSha], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (diff.error || diff.status !== 0) {
    const detail =
      (diff.error && diff.error.message) || String(diff.stderr || '').trim() || 'git diff failed';
    return { files: [], detail: 'changed files are unknown: ' + stripAnsi(detail).trim() };
  }
  const names = String(diff.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const files = names
    .filter((name) => PRETTIER_FILE.test(name) && fs.existsSync(path.join(workerRoot, name)))
    .map((name) => path.join(workerRoot, name));
  return { files, detail: null };
}

/** `prettier --check` over exactly these files, run from the host repository. */
function prettierCheck(files) {
  let entry = null;
  try {
    entry = prettierEntry();
  } catch (err) {
    return { status: 'UNAVAILABLE', detail: 'prettier is not installed: ' + (err && err.message) };
  }
  if (!entry) return { status: 'UNAVAILABLE', detail: 'prettier has no executable entry point' };
  const result = spawnSync(
    process.execPath,
    [entry, '--check', '--ignore-unknown', '--'].concat(files),
    { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8', windowsHide: true }
  );
  if (result.error) return { status: 'UNAVAILABLE', detail: String(result.error.message) };
  const lines = stripAnsi(String(result.stderr || '') + String(result.stdout || ''))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Checking formatting/.test(line));
  if (/Cannot find module/.test(lines.join('\n'))) {
    return { status: 'UNAVAILABLE', detail: lines[0] || 'prettier could not be loaded' };
  }
  if (result.status === 0) return { status: 'PASSED', detail: null };
  return {
    status: 'FAILED',
    detail: lines[0] || 'prettier --check exited with code ' + result.status,
  };
}

/**
 * The worker's changed names between the handoff base and the commit under
 * review — the same host-side `git diff` the format gate judges, without the
 * prettier filter (TM-R03).
 */
function changedFileNames(workerRoot, baseSha, targetSha) {
  const diff = spawnSync('git', ['diff', '--name-only', baseSha + '..' + targetSha], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (diff.error || diff.status !== 0) {
    const detail =
      (diff.error && diff.error.message) || String(diff.stderr || '').trim() || 'git diff failed';
    return { names: [], detail: 'changed files are unknown: ' + stripAnsi(detail).trim() };
  }
  const names = String(diff.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { names, detail: null };
}

/**
 * A manifest `command` is the repository's package.json script name (the same
 * convention as the eslint/prettier/prisma entries), so a gate runs as
 * `pnpm run <command>` host-side in the worker root — the tree that carries
 * the reviewed SHA.
 */
function runGateCommand(o, gateTool, workerRoot) {
  const check = o.spawnSync || spawnSync;
  return check('pnpm', ['run', String(gateTool.command)], {
    cwd: workerRoot,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    timeout: o.timeoutMs || 300000,
  });
}

/** A gate that cannot run here is UNAVAILABLE, never a failing scan. */
function gateUnavailableReason(res) {
  if (res && res.error) return String(res.error.message || res.error);
  const text = String((res && res.stdout) || '') + String((res && res.stderr) || '');
  if (/cannot find module|is not recognized|command not found|ENOENT/i.test(text)) {
    return 'gate command is not runnable here: ' + (text.trim().split(/\r?\n/)[0] || '');
  }
  return null;
}

/** Scrubbed tail of the tool output — the only place raw output survives. */
function gateOutput(res) {
  return decisions
    .scrubText(String((res && res.stdout) || '') + String((res && res.stderr) || ''))
    .slice(-2000);
}

/**
 * TM-R03: the tool gates, run after a worker commit and before review the
 * same way as the format gate (DT-R02): host-side against the reviewed SHA.
 *
 * Every gatesFor() tool that applies to the changed files (or to the item's
 * risk domains) and carries a command runs in the worker root. A failing gate
 * gets exactly one bounded repair round carrying its tool output; if the
 * repaired commit still fails, the item is refused — never reviewed, never
 * published. A gate with no command, or one that is not installed or cannot
 * run here, records TOOL_GATE_UNAVAILABLE, does not block, and is never
 * counted as a pass. Decision entries carry the tool id and pass/fail only
 * (TM-R04); the scrubbed tool output goes only into the repair finding.
 */
async function runToolGates(params) {
  const o = params.o;
  const item = params.item;
  const log = params.log;
  const logOpts = params.logOpts;
  const workerRoot = params.workerRoot;
  const baseSha = params.baseSha;
  const targetSha = params.targetSha;
  const repair = params.repair;

  let currentSha = targetSha;
  const record = (toolId, status, entry) => {
    const value = Object.assign(
      { workItemId: item.id, status, tool: toolId, baseSha: baseSha || null, sha: currentSha },
      entry || {}
    );
    if (log) {
      if (!Array.isArray(log.toolGates)) log.toolGates = [];
      log.toolGates.push(value);
    }
    if (typeof o.log === 'function') o.log('TOOL_GATE_' + status, value);
    if (logOpts) {
      try {
        const decisions = require('./decisions');
        decisions.recordDecision(
          {
            stage: decisions.Stage.TOOL_GATE,
            workItemId: item.id,
            role: roleOf(item),
            tool: toolId,
            toolStatus: status,
            code: 'TOOL_GATE_' + status,
          },
          logOpts
        );
      } catch (err) {
        // A broken decision log must not break the gate verdict.
      }
    }
    return value;
  };

  let tm;
  try {
    tm = require('./tool-manifest');
  } catch (err) {
    record('tool-manifest', ToolGate.UNAVAILABLE, {
      reason: 'tool manifest missing or unreadable',
    });
    return {
      status: ToolGate.UNAVAILABLE,
      reason: 'tool manifest missing or unreadable',
      sha: currentSha,
    };
  }

  let gates;
  try {
    gates = tm.gatesFor();
  } catch (err) {
    record('tool-manifest', ToolGate.UNAVAILABLE, { reason: 'tool manifest is unreadable' });
    return { status: ToolGate.UNAVAILABLE, reason: 'tool manifest is unreadable', sha: currentSha };
  }

  const changed = changedFileNames(workerRoot, baseSha, targetSha);
  if (!changed.detail && changed.names.length === 0) {
    return { status: ToolGate.PASSED, sha: currentSha };
  }
  // Unnamed changed files cannot narrow applicability; the risk domains can.
  const changedFiles = changed.names;
  const riskDomains =
    (item && (item.riskDomains || (item.roleRequirement && item.roleRequirement.riskDomains))) ||
    [];

  for (const gateTool of gates) {
    if (!tm.appliesTo(gateTool, changedFiles, riskDomains)) continue;

    if (!gateTool.command || gateTool.installed !== true) {
      record(gateTool.id, ToolGate.UNAVAILABLE, {
        reason: gateTool.command ? 'gate tool is not installed' : 'gate tool has no command',
      });
      continue;
    }

    const first = runGateCommand(o, gateTool, workerRoot);
    const unavailable = gateUnavailableReason(first);
    if (unavailable) {
      record(gateTool.id, ToolGate.UNAVAILABLE, { reason: unavailable });
      continue;
    }
    if (first && first.status === 0) {
      record(gateTool.id, ToolGate.PASSED, { exitCode: 0 });
      continue;
    }

    record(gateTool.id, 'FAILED', {
      exitCode: first ? first.status : -1,
      reason: gateTool.id + ' gate failed',
    });
    const findings = [
      {
        id: 'TOOL_GATE_FAILED',
        status: 'open',
        summary:
          gateTool.id +
          ' gate failed on ' +
          changedFiles.length +
          ' changed file(s): ' +
          changedFiles.slice(0, 5).join(', '),
        detail: gateTool.id + ' gate failed:\n' + gateOutput(first),
        dirtyPaths: changedFiles,
      },
    ];
    const repaired = await repair(findings, currentSha);
    const repairedSha = repaired && repaired.sha ? String(repaired.sha) : '';
    if (!SHA_40.test(repairedSha)) {
      const reason =
        'TOOL_GATE_FAILED: ' +
        gateTool.id +
        ' gate failed and the repair round produced no reviewable commit';
      record(gateTool.id, 'REFUSED', { reason, exitCode: first ? first.status : -1 });
      return { status: ToolGate.REFUSED, reason, gate: gateTool.id, sha: currentSha };
    }

    const second = runGateCommand(o, gateTool, workerRoot);
    const secondUnavailable = gateUnavailableReason(second);
    if (secondUnavailable) {
      record(gateTool.id, ToolGate.UNAVAILABLE, { reason: secondUnavailable, sha: repairedSha });
      return {
        status: ToolGate.UNAVAILABLE,
        reason: secondUnavailable,
        gate: gateTool.id,
        sha: repairedSha,
      };
    }
    if (second && second.status === 0) {
      currentSha = repairedSha;
      record(gateTool.id, ToolGate.PASSED, { exitCode: 0, sha: currentSha, repaired: true });
      continue;
    }

    const reason = 'TOOL_GATE_FAILED: ' + gateTool.id + ' gate still fails after the repair round';
    record(gateTool.id, 'REFUSED', {
      reason,
      exitCode: second ? second.status : -1,
      sha: repairedSha,
    });
    return { status: ToolGate.REFUSED, reason, gate: gateTool.id, sha: repairedSha };
  }

  return { status: ToolGate.PASSED, sha: currentSha };
}

/**
 * DT-R02: the format gate, run after a worker commit and before review.
 *
 * Every verdict is written to the run's `formatChecks` list and emitted through
 * `o.log` as FORMAT_CHECK_PASSED / FORMAT_CHECK_FAILED / FORMAT_CHECK_UNAVAILABLE
 * / FORMAT_CHECK_REFUSED, so a missing prettier is a recorded warning rather
 * than a silent pass. A failing check gets one bounded repair round through the
 * existing repair path; if the repaired commit still does not format the item
 * is refused — never reviewed, never published.
 */
async function runFormatGate(params) {
  const o = params.o;
  const item = params.item;
  const log = params.log;
  const logOpts = params.logOpts;
  const workerRoot = params.workerRoot;
  const baseSha = params.baseSha;
  const targetSha = params.targetSha;
  const repair = params.repair;
  const namesOf = (files) =>
    files.map((file) => path.relative(workerRoot, file) || file).slice(0, 5);
  const record = (status, entry) => {
    const value = Object.assign(
      { workItemId: item.id, status, baseSha: baseSha || null, sha: targetSha },
      entry || {}
    );
    if (log && Array.isArray(log.formatChecks)) log.formatChecks.push(value);
    if (typeof o.log === 'function') o.log('FORMAT_CHECK_' + status, value);
    return value;
  };

  const changed = changedPrettierFiles(workerRoot, baseSha, targetSha);
  if (changed.detail) {
    // The changed files cannot be named, so nothing can be verified. That is the
    // same situation as a missing prettier: recorded, never a silent pass.
    record('UNAVAILABLE', { reason: changed.detail });
    return { status: FormatGate.UNAVAILABLE, reason: changed.detail };
  }
  if (changed.files.length === 0) return { status: FormatGate.PASSED, files: [] };

  const first = prettierCheck(changed.files);
  if (first.status === 'UNAVAILABLE') {
    record('UNAVAILABLE', { files: namesOf(changed.files), reason: first.detail });
    return { status: FormatGate.UNAVAILABLE, reason: first.detail };
  }
  if (first.status === 'PASSED') {
    record('PASSED', { files: namesOf(changed.files) });
    return { status: FormatGate.PASSED, files: changed.files, sha: targetSha };
  }

  record('FAILED', { files: namesOf(changed.files), reason: first.detail });
  const findings = [
    {
      id: 'FORMAT_CHECK_FAILED',
      status: 'open',
      summary:
        'prettier --check failed on ' +
        changed.files.length +
        ' changed file(s): ' +
        namesOf(changed.files).join(', '),
    },
  ];
  const repaired = await repair(findings, targetSha);
  const repairedSha = repaired && repaired.sha ? String(repaired.sha) : '';
  if (!SHA_40.test(repairedSha)) {
    const reason = 'FORMAT_CHECK_FAILED: the repair round produced no reviewable commit';
    record('REFUSED', { files: namesOf(changed.files), reason });
    return { status: FormatGate.REFUSED, reason, files: changed.files };
  }

  const again = changedPrettierFiles(workerRoot, baseSha, repairedSha);
  if (again.detail) {
    record('UNAVAILABLE', { files: namesOf(changed.files), reason: again.detail });
    return { status: FormatGate.UNAVAILABLE, reason: again.detail };
  }
  const second =
    again.files.length === 0 ? { status: 'PASSED', detail: null } : prettierCheck(again.files);
  if (second.status === 'UNAVAILABLE') {
    record('UNAVAILABLE', { files: namesOf(again.files), reason: second.detail });
    return { status: FormatGate.UNAVAILABLE, reason: second.detail };
  }
  if (second.status === 'PASSED') {
    record('PASSED', { files: namesOf(again.files), sha: repairedSha, repaired: true });
    return { status: FormatGate.PASSED, files: again.files, sha: repairedSha };
  }
  const reason =
    'FORMAT_CHECK_FAILED: prettier --check still fails after the repair round: ' +
    namesOf(again.files).join(', ');
  record('REFUSED', { files: namesOf(again.files), reason });
  return { status: FormatGate.REFUSED, reason, files: again.files, sha: repairedSha };
}

/** The review / repair stage for one completed session. */
async function reviewItem(
  o,
  item,
  session,
  log,
  logOpts,
  launcher,
  usageDir,
  now,
  candidates,
  evidenceData,
  registry,
  opts
) {
  const options = opts || {};
  const failedKeys =
    options.failedKeys ||
    (item && item.failedKeys) ||
    (session && session.failedKeys) ||
    (o && o.failedKeys) ||
    new Set();
  const failedKeySet =
    failedKeys instanceof Set ? failedKeys : new Set(Array.isArray(failedKeys) ? failedKeys : []);
  const excludedDomains =
    options.excludedDomains ||
    (item && item.excludedDomains) ||
    (session && session.excludedDomains) ||
    (o && o.excludedDomains) ||
    new Set();
  const excludedDomainSet =
    excludedDomains instanceof Set
      ? excludedDomains
      : new Set(Array.isArray(excludedDomains) ? excludedDomains : []);
  const domainAttemptsMap = resolveDomainAttempts(options, item, session, o);
  const triedKeys =
    options.triedKeys || (item && item.triedKeys) || (session && session.triedKeys) || new Set();
  const triedKeySet =
    triedKeys instanceof Set ? triedKeys : new Set(Array.isArray(triedKeys) ? triedKeys : []);
  if (item && !(item.triedKeys instanceof Set)) item.triedKeys = triedKeySet;
  if (item && !(item.failedKeys instanceof Set)) item.failedKeys = failedKeySet;
  if (item && !(item.excludedDomains instanceof Set)) item.excludedDomains = excludedDomainSet;
  const evidenceDir = resolveEvidenceDir(options, o);
  const hostWorktree = o.cwd || process.cwd();
  const isolatedWorkerRoot = o.isolatedWorker
    ? require('./isolation-launcher').workerRootFor(hostWorktree)
    : null;
  const workerRoot =
    (o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot) || session.worktree || null;
  // TASK-AI-117 (RS-R01): the review reads the commit the launch recorded —
  // the checkpoint's exact workerSha — and only falls back to the worktree head
  // when no such commit was ever recorded.
  const workerHead = (session && session.headSha) || (workerRoot && headShaOf(workerRoot)) || null;
  let targetSha =
    workerHead && SHA_40.test(workerHead)
      ? workerHead
      : o.sha && SHA_40.test(String(o.sha))
        ? o.sha
        : null;

  // AI-64-R07: a review is bound to an exact commit. A run that cannot name the
  // commit under review does not review it.
  if (!targetSha || !SHA_40.test(String(targetSha))) {
    return {
      status: ReviewStatus.BLOCKED,
      reason: 'REVIEW_SHA_UNPINNED: a 40-character commit under review is mandatory',
    };
  }

  // The one repair path: the injected repairer when a harness provides one,
  // otherwise the Controller's own bounded repair round. The format gate and the
  // review loop both use it, so a format finding is repaired exactly like any
  // other finding (DT-R02 "reuse the existing repair path").
  const repairWithFinding = async (findings, sha) => {
    if (typeof o.repairer === 'function') {
      const repaired = await o.repairer(findings, sha);
      if (typeof options.onCheckpoint === 'function') {
        options.onCheckpoint('repair_round_completed', {
          repair: { sha: (repaired && repaired.sha) || sha, injected: true },
        });
      }
      return repaired;
    }
    return repairRound(
      o,
      item,
      session,
      log,
      logOpts,
      launcher,
      usageDir,
      now,
      candidates,
      evidenceData,
      registry,
      {
        failedKeys: failedKeySet,
        excludedDomains: excludedDomainSet,
        domainAttempts: domainAttemptsMap,
        triedKeys: triedKeySet,
        evidenceDir: options.evidenceDir || evidenceDir,
        onCheckpoint: options.onCheckpoint,
      }
    )(findings, sha);
  };

  // DT-R02: after a worker commit and BEFORE review, the Controller runs a
  // host-side prettier --check over the worker's changed files only. An
  // unformatted commit is never reviewed and never published: the item takes
  // exactly one bounded repair round on a finding that names the files, and is
  // refused if it still does not format. A prettier the host cannot run is
  // recorded as FORMAT_CHECK_UNAVAILABLE and does not block.
  const formatBaseSha = (session && session.baseSha) || o.baseSha || null;
  if ((o.isolatedWorker || o.formatCheck === true) && workerRoot && formatBaseSha) {
    const gate = await runFormatGate({
      o,
      item,
      log,
      logOpts,
      workerRoot,
      baseSha: formatBaseSha,
      targetSha,
      repair: repairWithFinding,
    });
    if (gate.status === FormatGate.REFUSED) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: item.id,
          role: roleOf(item),
          chosen: (session && session.candidateKey) || null,
          branch: (session && session.branch) || null,
          sha: targetSha,
          detail: gate.reason,
          findings: [{ id: 'FORMAT_CHECK_FAILED', status: 'open', summary: gate.reason }],
        },
        logOpts
      );
      return { status: ItemStatus.REFUSED, reason: gate.reason, gate: 'FORMAT_CHECK_FAILED' };
    }
    if (gate.sha && SHA_40.test(String(gate.sha))) {
      // A repair round that did format the files produced the commit to review.
      targetSha = String(gate.sha);
    }
  }

  // TM-R03: after the format gate and before review, every tool gate the
  // manifest declares for this change runs host-side against the reviewed
  // SHA, exactly like the format gate. A failing gate takes one bounded
  // repair round carrying the tool output and is refused if it still fails;
  // an unavailable gate records TOOL_GATE_UNAVAILABLE and never blocks.
  if ((o.isolatedWorker || o.formatCheck === true) && workerRoot && formatBaseSha) {
    const toolGate = await runToolGates({
      o,
      item,
      log,
      logOpts,
      workerRoot,
      baseSha: formatBaseSha,
      targetSha,
      repair: repairWithFinding,
    });
    if (toolGate.status === ToolGate.REFUSED) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: item.id,
          role: roleOf(item),
          chosen: (session && session.candidateKey) || null,
          branch: (session && session.branch) || null,
          sha: toolGate.sha || targetSha,
          detail: toolGate.reason,
          findings: [{ id: 'TOOL_GATE_FAILED', status: 'open', summary: toolGate.reason }],
        },
        logOpts
      );
      return { status: ItemStatus.REFUSED, reason: toolGate.reason, gate: 'TOOL_GATE_FAILED' };
    }
    if (toolGate.sha && SHA_40.test(String(toolGate.sha))) {
      // A repair round that did clear the gate produced the commit to review.
      targetSha = String(toolGate.sha);
    }
  }

  const writerKey = (session && session.candidateKey) || null;
  const writerCandidate = (Array.isArray(candidates) ? candidates : []).find(
    (c) => candidateKey(c) === writerKey
  );
  let writerUpstream = writerCandidate && writerCandidate.upstream;
  let writerGateway = writerCandidate && writerCandidate.gateway;
  if ((!writerUpstream || !writerGateway) && writerKey) {
    const parsed = parseCandidateKey(writerKey);
    if (parsed) {
      if (!writerGateway) writerGateway = parsed.gateway;
      if (!writerUpstream) writerUpstream = parsed.upstream;
    }
  }
  // The failure domain is per gateway+upstream (Defect K / Defect T).
  // Only the writer's upstream (or gateway if no upstream) is forbidden,
  // allowing reviewer candidates on the same gateway with distinct upstreams
  // without forbidding the shared router account.
  const forbiddenDomains = [writerUpstream || writerGateway].filter(Boolean);
  const reviewerQualityFloor =
    item.qualityFloor !== null &&
    item.qualityFloor !== undefined &&
    Number.isFinite(Number(item.qualityFloor)) &&
    Number(item.qualityFloor) >= 0
      ? Number(item.qualityFloor)
      : 75;
  const reviewerAttempt =
    options.attempt !== undefined
      ? options.attempt
      : item && item.reviewerAttempt !== undefined
        ? item.reviewerAttempt
        : 1;
  const reviewerDecision = await selectCandidateForProfile(
    {
      id: item.id + '-review',
      roleRequirement: { role: 'reviewer' },
      complexity: item.complexity,
      qualityFloor: reviewerQualityFloor,
      writerCandidateKey: writerKey,
      failedKeys: failedKeySet,
      excludedDomains: excludedDomainSet,
      domainAttempts: domainAttemptsMap,
      attempt: reviewerAttempt,
      attemptNumber: reviewerAttempt,
    },
    candidates,
    forbiddenDomains,
    evidenceData,
    o,
    logOpts,
    now,
    {
      failedKeys: failedKeySet,
      excludedDomains: excludedDomainSet,
      domainAttempts: domainAttemptsMap,
      attempt: reviewerAttempt,
      attemptNumber: reviewerAttempt,
    }
  );
  if (reviewerDecision.chosen) {
    triedKeySet.add(reviewerDecision.chosen);
    if (item && item.triedKeys instanceof Set) item.triedKeys.add(reviewerDecision.chosen);
  }
  const configuredReviewer = o.reviewerIdentity || null;
  const configuredReviewerCandidate = configuredReviewer
    ? (Array.isArray(candidates) ? candidates : []).find(
        (c) => candidateKey(c) === configuredReviewer
      ) || parseCandidateKey(configuredReviewer)
    : null;
  const configuredReviewerDomain = configuredReviewerCandidate
    ? routing.canonicalFailureDomain(configuredReviewerCandidate)
    : configuredReviewer
      ? routing.canonicalFailureDomain(configuredReviewer)
      : null;
  // The Controller is the only selector: once it has judged at least one
  // candidate and refused them all, a configured reviewer must not override
  // that refusal. The configured reviewer is only a fallback when the
  // Controller had nothing to judge (for example a pinned reviewer with an
  // empty candidate pool), and it is compared by its canonical key.
  const configuredReviewerKey = configuredReviewerCandidate
    ? candidateKey(configuredReviewerCandidate) || configuredReviewer
    : configuredReviewer;
  const reviewerResult = (reviewerDecision && reviewerDecision.result) || {};
  const controllerJudgedCandidates =
    (Array.isArray(reviewerResult.rejected) && reviewerResult.rejected.length > 0) ||
    (Array.isArray(reviewerResult.ranking) && reviewerResult.ranking.length > 0);
  const configuredReviewerEligible = Boolean(
    configuredReviewer &&
    !controllerJudgedCandidates &&
    !failedKeySet.has(configuredReviewerKey) &&
    !failedKeySet.has(configuredReviewer) &&
    !excludedDomainSet.has(configuredReviewerDomain) &&
    (domainAttemptsMap.get(configuredReviewerDomain) || 0) < 2
  );
  // A configured reviewer that is the writer is passed through only so the
  // review lane refuses it with REVIEWER_EQUALS_WRITER; it is never launched.
  const configuredIsWriter = Boolean(
    configuredReviewerKey && session && session.candidateKey === configuredReviewerKey
  );
  const reviewerIdentity =
    reviewerDecision.chosen ||
    (configuredReviewerEligible || configuredIsWriter ? configuredReviewerKey : null);
  const reviewerTriedKeySet = new Set();
  if (reviewerIdentity) {
    triedKeySet.add(reviewerIdentity);
    if (item && item.triedKeys instanceof Set) item.triedKeys.add(reviewerIdentity);
  }

  let activeReviewerKey = reviewerIdentity;
  let activeReviewerAttempt = reviewerAttempt;

  const recordReviewerLaunchFailure = (res, candidate, attempt) => {
    const revKey = (candidate && candidateKey(candidate)) || activeReviewerKey || reviewerIdentity;
    if (!revKey) return;
    reviewerTriedKeySet.add(revKey);
    triedKeySet.add(revKey);
    if (item && item.triedKeys instanceof Set) item.triedKeys.add(revKey);
    if (options.triedKeys && options.triedKeys.add) options.triedKeys.add(revKey);

    const cand =
      candidate ||
      (Array.isArray(candidates) ? candidates : []).find((c) => candidateKey(c) === revKey) ||
      parseCandidateKey(revKey);
    if (!cand) return;

    const isLauncherTimedOut = Boolean(
      res &&
      (res.timedOut === true ||
        /\[ISOLATION_LAUNCHER\] worker timed out/i.test(res.stderr || '') ||
        /\[ISOLATION_LAUNCHER\] worker timed out/i.test(res.failureReason || ''))
    );
    const classification = classifyFailure({
      exitCode: res ? res.exitCode : 1,
      httpStatus: res ? res.httpStatus : undefined,
      body: res ? res.body || res.stderr || '' : '',
      stdout: res ? res.stdout : undefined,
      stderr: res ? res.stderr : '',
      accountId: cand.accountId,
      timedOut: isLauncherTimedOut,
    });

    // TASK-AI-121 LF-R01: a local launch infrastructure failure blames no
    // reviewer key, no failure domain and sets no evidence cooldown.
    const blaming = classification.scope !== 'local';
    if (blaming) {
      failedKeySet.add(revKey);
      if (item && item.failedKeys instanceof Set) item.failedKeys.add(revKey);
      if (session && session.failedKeys instanceof Set) session.failedKeys.add(revKey);
      if (options && options.failedKeys instanceof Set) options.failedKeys.add(revKey);
    }

    const candDomain = routing.canonicalFailureDomain(cand);
    const attemptsInDomain = domainAttemptsMap.get(candDomain) || 0;
    const domainExhausted = attemptsInDomain >= 2;
    const scopeExcludesDomain =
      classification.scope === 'upstream' || classification.scope === 'gateway';
    if (blaming && (scopeExcludesDomain || domainExhausted) && candDomain) {
      excludedDomainSet.add(candDomain);
      if (item && item.excludedDomains instanceof Set) item.excludedDomains.add(candDomain);
      if (session && session.excludedDomains instanceof Set)
        session.excludedDomains.add(candDomain);
      if (options && options.excludedDomains instanceof Set)
        options.excludedDomains.add(candDomain);
    }

    if (blaming && (evidenceDir || evidenceData)) {
      evidenceData = recordLaunchFailureEvidence(
        evidenceDir,
        evidenceData,
        cand,
        res,
        classification,
        now
      );
      if (log) log.evidenceData = evidenceData;
    }

    if (logOpts) {
      const allExcluded = new Set(Array.from(failedKeySet));
      for (const d of excludedDomainSet) allExcluded.add(d);
      for (const c of Array.isArray(candidates) ? candidates : []) {
        const k = candidateKey(c);
        const cDomain = routing.canonicalFailureDomain(c);
        if (excludedDomainSet.has(cDomain)) allExcluded.add(k);
      }
      const failAttempt =
        attempt !== undefined
          ? attempt
          : activeReviewerAttempt !== undefined
            ? activeReviewerAttempt
            : reviewerAttempt;
      decisions.recordDecision(
        {
          stage: decisions.Stage.FAILED,
          workItemId: (item ? item.id : 'item') + '-review',
          role: 'reviewer',
          attempt: failAttempt,
          attemptNumber: failAttempt,
          chosen: revKey,
          chosenKey: revKey,
          branch: (session && session.branch) || o.branch,
          failureScope: classification.scope,
          cause: classification.cause,
          // TASK-AI-121 LF-R01: the real launcher message survives a local
          // launch infrastructure failure.
          detail: failedDecisionDetail(classification, res),
          excluded: Array.from(allExcluded),
          excludedSet: Array.from(allExcluded),
          // RT-R01: record retryable and retryAfterMs from classification
          retryable: classification.retryable,
          retryAfterMs: classification.retryAfterMs,
          // RT-R03: the cooldown this failure actually sets.
          cooldownMs:
            classification.scope === 'local' ? 0 : evidence.effectiveCooldownMs(classification),
        },
        logOpts
      );
    }
    // TASK-AI-121 LF-R02: an unusable isolation verdict stops the whole run —
    // no reviewer would fail any differently.
    markIsolationVerdictStop(log, res, classification);
  };

  const budget = Number.isFinite(Number(o.reviewBudget))
    ? Number(o.reviewBudget)
    : DEFAULT_REVIEW_BUDGET;
  let lastTestResult = null;
  const runTestsForReview =
    typeof o.tests === 'function'
      ? o.tests
      : () =>
          runVerificationCommand(
            item,
            Object.assign({}, o, { workerRoot, baseSha: session.baseSha || o.baseSha })
          );
  const captureRunTests = () => {
    lastTestResult = runTestsForReview();
    return lastTestResult;
  };
  let roundCount = 0;
  let lastManifestResult = null;
  // TASK-AI-114 R02: an old checkpoint can carry a "review round" whose result
  // is a launch failure. A launch failure is not a verdict, so that round is
  // discarded here and the commit is reviewed again.
  const resumedReviewRounds = (options.resumedReviewRounds || []).filter(
    (round) => !(round && round.result && round.result.launchFailed === true)
  );
  // CK-R01 (P1-1): every completed review round accumulates here, so each
  // checkpoint write carries the whole history instead of only the resumed
  // rounds plus the current one. An interruption after round 2 keeps rounds 1
  // and 2 on disk; a replayed round rewrites no record and duplicates nothing.
  const recordedReviewRounds = resumedReviewRounds.slice();

  // TASK-AI-114 R01: when every reviewer candidate failed to launch there is no
  // verdict at all, and the item is blocked with REVIEWER_UNAVAILABLE.
  const reviewerUnavailableResult = () => ({
    pass: false,
    sha: null,
    cause: 'REVIEWER_UNAVAILABLE',
    verdict: 'REFUSED',
    findings: [
      {
        id: 'REVIEWER_UNAVAILABLE',
        open: true,
        detail: 'every reviewer candidate failed to launch; no verdict was produced',
      },
    ],
  });
  // The existing cause survives a launch failure: when the failed launches
  // exhausted a reviewer failure domain (its attempt cap is reached) and no
  // alternate domain remains, the item ends BLOCKED with
  // NO_ALTERNATE_FAILURE_DOMAIN. REVIEWER_UNAVAILABLE is only for the other
  // exhaustion, where candidates failed to launch without exhausting any
  // reviewer failure domain.
  const reviewerDomainAttempts = new Map();
  const noAlternateFailureDomainResult = () => ({
    pass: false,
    sha: null,
    cause: 'NO_ALTERNATE_FAILURE_DOMAIN',
    verdict: 'REFUSED',
    findings: [
      {
        id: 'NO_ALTERNATE_FAILURE_DOMAIN',
        open: true,
        detail: 'no eligible reviewer candidate remains outside exhausted failure domains',
      },
    ],
  });
  const reviewerExhaustionResult = () => {
    const domainCapExhausted = Array.from(reviewerDomainAttempts.values()).some((v) => v >= 2);
    if (!domainCapExhausted) {
      return reviewerUnavailableResult();
    }
    if (logOpts) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: (item ? item.id : 'item') + '-review',
          role: 'reviewer',
          attempt: activeReviewerAttempt,
          attemptNumber: activeReviewerAttempt,
          detail: 'NO_ALTERNATE_FAILURE_DOMAIN',
        },
        logOpts
      );
    }
    return noAlternateFailureDomainResult();
  };

  const reviewWithManifest = async (currentSha) => {
    roundCount += 1;
    activeReviewerAttempt = reviewerAttempt + roundCount - 1;

    let rev;
    const priorRound = resumedReviewRounds.find(
      (round) => round && round.sha === currentSha && round.result
    );
    if (priorRound) {
      rev = priorRound.result;
    } else if (typeof o.reviewer === 'function') {
      rev = await o.reviewer(currentSha);
    } else {
      // TASK-AI-114 R01: a reviewer launch failure is not a verdict. It is
      // kept as a classified failed reviewer attempt and the lane is retried
      // with the next reviewer; only a real parsed verdict becomes a review
      // round, and a launch failure never triggers a repair. When the retries
      // are exhausted the cause keeps the existing distinction: a failure
      // domain exhausted by the launches ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN,
      // otherwise the review is blocked with REVIEWER_UNAVAILABLE.
      let launchAttempt = 0;
      let launchFailures = 0;
      for (;;) {
        launchAttempt += 1;
        if (launchAttempt > 1) {
          activeReviewerAttempt += 1;
        }
        if (roundCount === 1 && launchAttempt === 1) {
          activeReviewerKey = reviewerIdentity;
        } else {
          const nextFailedKeys = new Set([...failedKeySet, ...reviewerTriedKeySet]);
          const nextDecision = await selectCandidateForProfile(
            {
              id: item.id + '-review',
              roleRequirement: { role: 'reviewer' },
              complexity: item.complexity,
              qualityFloor: reviewerQualityFloor,
              writerCandidateKey: writerKey,
              failedKeys: nextFailedKeys,
              excludedDomains: excludedDomainSet,
              domainAttempts: domainAttemptsMap,
              attempt: activeReviewerAttempt,
              attemptNumber: activeReviewerAttempt,
            },
            candidates,
            forbiddenDomains,
            evidenceData,
            o,
            logOpts,
            now,
            {
              failedKeys: nextFailedKeys,
              excludedDomains: excludedDomainSet,
              domainAttempts: domainAttemptsMap,
              attempt: activeReviewerAttempt,
              attemptNumber: activeReviewerAttempt,
            }
          );
          if (nextDecision.chosen) {
            activeReviewerKey = nextDecision.chosen;
            triedKeySet.add(activeReviewerKey);
            if (item && item.triedKeys instanceof Set) item.triedKeys.add(activeReviewerKey);
            if (options.triedKeys && options.triedKeys.add)
              options.triedKeys.add(activeReviewerKey);
          } else {
            // Same rule as the first selection: never override a Controller
            // refusal, and compare the configured reviewer by canonical key.
            const nextResult = (nextDecision && nextDecision.result) || {};
            const nextJudged =
              (Array.isArray(nextResult.rejected) && nextResult.rejected.length > 0) ||
              (Array.isArray(nextResult.ranking) && nextResult.ranking.length > 0);
            const configuredDomain = configuredReviewerDomain;
            const configuredStillEligible = Boolean(
              configuredReviewerKey &&
              configuredReviewerCandidate &&
              !nextJudged &&
              !nextFailedKeys.has(configuredReviewerKey) &&
              !nextFailedKeys.has(configuredReviewer) &&
              !failedKeySet.has(configuredReviewerKey) &&
              !excludedDomainSet.has(configuredDomain) &&
              (domainAttemptsMap.get(configuredDomain) || 0) < 2
            );
            activeReviewerKey = configuredStillEligible ? configuredReviewerKey : null;
          }
        }

        if (!activeReviewerKey) {
          if (launchFailures > 0) {
            return reviewerExhaustionResult();
          }
          const isCapExhausted =
            Array.from(domainAttemptsMap.values()).some((v) => v >= 2) ||
            excludedDomainSet.size > 0 ||
            failedKeySet.size > 0;
          const refusalReason = isCapExhausted
            ? 'NO_ALTERNATE_FAILURE_DOMAIN'
            : 'NO_REVIEWER_CANDIDATE';
          if (logOpts) {
            decisions.recordDecision(
              {
                stage: decisions.Stage.REFUSED,
                workItemId: (item ? item.id : 'item') + '-review',
                role: 'reviewer',
                attempt: activeReviewerAttempt,
                attemptNumber: activeReviewerAttempt,
                detail: refusalReason,
              },
              logOpts
            );
          }
          return {
            pass: false,
            sha: null,
            cause: refusalReason,
            verdict: 'REFUSED',
            findings: [
              {
                id: refusalReason,
                open: true,
                detail: 'no eligible reviewer candidate available outside writer failure domain',
              },
            ],
          };
        }

        const activeReviewerCandidate =
          (Array.isArray(candidates) ? candidates : []).find(
            (candidate) => candidateKey(candidate) === activeReviewerKey
          ) ||
          (configuredReviewerCandidate && activeReviewerKey === configuredReviewerKey
            ? configuredReviewerCandidate
            : parseCandidateKey(activeReviewerKey));
        const activeReviewerDomain = activeReviewerCandidate
          ? routing.canonicalFailureDomain(activeReviewerCandidate)
          : routing.canonicalFailureDomain(activeReviewerKey);
        if (
          failedKeySet.has(activeReviewerKey) ||
          reviewerTriedKeySet.has(activeReviewerKey) ||
          excludedDomainSet.has(activeReviewerDomain) ||
          (domainAttemptsMap.get(activeReviewerDomain) || 0) >= 2
        ) {
          activeReviewerKey = null;
          if (launchFailures > 0) {
            return reviewerExhaustionResult();
          }
          // sha: null makes the review loop stop BLOCKED with this cause
          // instead of treating the refusal as a failed review and repairing.
          return {
            pass: false,
            sha: null,
            cause: 'NO_ALTERNATE_FAILURE_DOMAIN',
            verdict: 'REFUSED',
            findings: [
              {
                id: 'NO_ALTERNATE_FAILURE_DOMAIN',
                open: true,
                detail: 'no eligible reviewer candidate remains outside excluded failure domains',
              },
            ],
          };
        }

        const laneFn = reviewLane(
          Object.assign({}, o, { reviewerIdentity: activeReviewerKey }),
          item,
          session,
          log,
          logOpts,
          launcher,
          usageDir,
          now,
          candidates,
          evidenceData,
          registry,
          {
            failedKeys: failedKeySet,
            excludedDomains: excludedDomainSet,
            domainAttempts: domainAttemptsMap,
            triedKeys: triedKeySet,
            evidenceDir,
            attempt: activeReviewerAttempt,
            onReviewerLaunch: (candidate) => {
              // Count against the same canonical domain the launch guard used,
              // even when the reviewer is not in the injected candidate pool.
              const reviewerDomain = routing.canonicalFailureDomain(
                candidate || activeReviewerCandidate
              );
              const attemptsInDomain = domainAttemptsMap.get(reviewerDomain) || 0;
              const attempts = attemptsInDomain + 1;
              domainAttemptsMap.set(reviewerDomain, attempts);
              reviewerDomainAttempts.set(
                reviewerDomain,
                (reviewerDomainAttempts.get(reviewerDomain) || 0) + 1
              );
              if (attempts >= 2) {
                excludedDomainSet.add(reviewerDomain);
                if (item && item.excludedDomains instanceof Set) {
                  item.excludedDomains.add(reviewerDomain);
                }
              }
              return true;
            },
            onReviewerLaunchFailure: (res, cand) =>
              recordReviewerLaunchFailure(res, cand, activeReviewerAttempt),
          }
        );
        rev = await laneFn(currentSha);
        // TASK-AI-121 LF-R02: the run is already stopping on an unusable
        // isolation verdict — no reviewer is tried again.
        if (log.isolationStop) {
          return {
            pass: false,
            sha: null,
            cause: log.isolationStop.reason,
            verdict: 'REFUSED',
            findings: [
              {
                id: log.isolationStop.reasonCode,
                open: true,
                detail: log.isolationStop.reason,
              },
            ],
          };
        }
        if (!rev || !rev.launchFailed) {
          break;
        }
        // The failure is already classified and recorded by
        // onReviewerLaunchFailure; retry with the next reviewer instead of
        // recording a round or repairing.
        launchFailures += 1;
        if (launchAttempt > (Array.isArray(candidates) ? candidates.length : 0) + 1) {
          return reviewerExhaustionResult();
        }
      }
    }
    // TASK-AI-114 R01: only a real parsed verdict creates a review round.
    if (!priorRound && !(rev && rev.launchFailed)) {
      recordedReviewRounds.push({
        round: recordedReviewRounds.length + 1,
        sha: currentSha,
        result: rev,
      });
      if (typeof options.onCheckpoint === 'function') {
        options.onCheckpoint('review_round_completed', {
          reviewRounds: recordedReviewRounds.slice(),
        });
      }
    }

    const repoCandidates = [workerRoot, session && session.worktree, o.cwd, process.cwd()].filter(
      Boolean
    );
    const { resolveCommit } = require('./review-manifest');
    const currentRepoCwd =
      repoCandidates.find((dir) => fs.existsSync(dir) && resolveCommit(dir, currentSha)) ||
      workerRoot ||
      o.cwd ||
      process.cwd();

    const currentBaseSha =
      (session && session.baseSha) ||
      o.baseSha ||
      resolveCommit(currentRepoCwd, currentSha + '^') ||
      currentSha;

    const currentTests = [];
    if (lastTestResult) {
      currentTests.push({
        command:
          lastTestResult.command || (item.verification && item.verification.command) || 'test',
        result:
          lastTestResult.pass !== false &&
          (lastTestResult.exitCode === 0 || lastTestResult.exitCode === undefined)
            ? 'pass'
            : 'fail',
        summary: String(
          lastTestResult.detail ||
            lastTestResult.summary ||
            lastTestResult.cause ||
            (lastTestResult.pass ? 'pass' : 'fail')
        ),
      });
    } else if (item.verification && item.verification.command) {
      currentTests.push({
        command: item.verification.command,
        result: 'pass',
        summary: 'pass',
      });
    } else {
      currentTests.push({
        command: 'verification',
        result: 'pass',
        summary: 'pass',
      });
    }

    const decisionDir = (logOpts && logOpts.dir) || o.decisionDir;
    lastManifestResult = writeReviewManifestAndArtifact({
      dir: decisionDir,
      repoCwd: currentRepoCwd,
      workItemId: item.id,
      baseSha: currentBaseSha,
      reviewedSha: currentSha,
      writerCandidateKey: (session && session.candidateKey) || o.writerCandidateKey,
      reviewerCandidateKey:
        (rev && rev.reviewer) || activeReviewerKey || reviewerIdentity || o.reviewerIdentity,
      verdict: (rev && rev.verdict) || (rev && rev.pass ? 'PASS' : 'CHANGES_REQUIRED'),
      findings: (rev && rev.findings) || [],
      tests: currentTests,
      roundNumber: roundCount,
    });

    return rev;
  };

  const review = await runReviewLoop(
    { sha: targetSha, budget },
    {
      runTests: captureRunTests,
      review: reviewWithManifest,
      repair: repairWithFinding,
    }
  );

  const effectiveReviewer =
    (review && review.reviewer) || activeReviewerKey || reviewerIdentity || null;

  const entry = {
    workItemId: item.id,
    sha: review.finalSha || targetSha,
    reviewerIdentity: effectiveReviewer,
    reviewer: effectiveReviewer,
    writerCandidateKey: session.candidateKey,
    workerRoot: workerRoot || (session && session.worktree) || null,
    publishCwd: publishCwdForReceipt(o, workerRoot || (session && session.worktree) || null),
    branch: (session && session.branch) || o.branch || null,
    baseSha: (session && session.baseSha) || o.baseSha || null,
    draftTitle: draftTitleForItem(item, o.goal),
    item,
    testResult: lastTestResult,
    failBefore: (session && session.failBefore) || null,
    review,
    reviewManifest: lastManifestResult ? lastManifestResult.manifestPath : null,
    reviewArtifact: lastManifestResult ? lastManifestResult.artifactPath : null,
    manifest: lastManifestResult ? lastManifestResult.manifest : null,
    manifestValidation: lastManifestResult ? lastManifestResult.validation : null,
  };
  if (!entry.reviewManifest) {
    const decisionDir = (logOpts && logOpts.dir) || o.decisionDir;
    if (decisionDir) {
      const finalSha = entry.sha;
      const { resolveCommit } = require('./review-manifest');
      const currentRepoCwd =
        [workerRoot, session && session.worktree, o.cwd, process.cwd()].find(
          (dir) => dir && fs.existsSync(dir) && resolveCommit(dir, finalSha)
        ) ||
        workerRoot ||
        o.cwd ||
        process.cwd();
      const currentBaseSha =
        (session && session.baseSha) ||
        o.baseSha ||
        resolveCommit(currentRepoCwd, finalSha + '^') ||
        finalSha;
      const currentTests = [];
      if (lastTestResult) {
        currentTests.push({
          command:
            lastTestResult.command || (item.verification && item.verification.command) || 'test',
          result:
            lastTestResult.pass !== false &&
            (lastTestResult.exitCode === 0 || lastTestResult.exitCode === undefined)
              ? 'pass'
              : 'fail',
          summary: String(
            lastTestResult.detail ||
              lastTestResult.summary ||
              lastTestResult.cause ||
              (lastTestResult.pass ? 'pass' : 'fail')
          ),
        });
      } else {
        currentTests.push({ command: 'test', result: 'pass', summary: 'pass' });
      }
      const roundManifest = writeReviewManifestAndArtifact({
        dir: decisionDir,
        repoCwd: currentRepoCwd,
        workItemId: item.id,
        baseSha: currentBaseSha,
        reviewedSha: finalSha,
        writerCandidateKey: (session && session.candidateKey) || o.writerCandidateKey,
        reviewerCandidateKey: reviewerIdentity || o.reviewerIdentity,
        verdict:
          review.verdict ||
          (review.status === ReviewStatus.COMPLETED ? 'PASS' : 'CHANGES_REQUIRED'),
        findings:
          (review.rounds &&
            review.rounds[review.rounds.length - 1] &&
            review.rounds[review.rounds.length - 1].findings) ||
          [],
        tests: currentTests,
        roundNumber: review.rounds ? review.rounds.length : 1,
      });
      if (roundManifest) {
        entry.reviewManifest = roundManifest.manifestPath;
        entry.reviewArtifact = roundManifest.artifactPath;
        entry.manifest = roundManifest.manifest;
        entry.manifestValidation = roundManifest.validation;
      }
    }
  }

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
        reviewer: round.reviewer || reviewerIdentity || null,
        findings: round.findings || [],
        sha: round.sha || null,
        tests: compactTestEvidence(lastTestResult, (session && session.failBefore) || null),
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
  const reviewStage =
    review.status === ReviewStatus.COMPLETED ? decisions.Stage.COMPLETED : decisions.Stage.FAILED;
  const reviewClassification =
    review.status === ReviewStatus.COMPLETED
      ? { retryable: true, retryAfterMs: null }
      : classifyFailure({
          exitCode: 1,
          body: 'REPAIR_BUDGET_EXHAUSTED: review failed and repair budget exhausted',
        });
  decisions.recordDecision(
    {
      stage: reviewStage,
      workItemId: item.id,
      role: roleOf(item),
      chosen: session.candidateKey,
      branch: session.branch,
      sessionId: session.sessionId,
      outcome: review.status === ReviewStatus.COMPLETED ? 'passed' : 'failed',
      detail: reason,
      reviewedSha: review.finalSha,
      verdict: review.verdict || null,
      reviewer: reviewerIdentity || null,
      tests: compactTestEvidence(lastTestResult, (session && session.failBefore) || null),
      reviewRounds: Array.isArray(review.rounds) ? review.rounds.length : null,
      repairCount: review.repairCount,
      retryable: reviewClassification.retryable,
      retryAfterMs: reviewClassification.retryAfterMs,
      // RT-R03: no cooldown for a passing review; a failed one carries the
      // longer of its default cooldown and retryAfterMs.
      cooldownMs: evidence.effectiveCooldownMs(reviewClassification),
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
function repairRound(
  o,
  item,
  session,
  log,
  logOpts,
  launcher,
  usageDir,
  now,
  candidates,
  evidenceData,
  registry,
  opts
) {
  const options = opts || {};
  const failedKeys =
    options.failedKeys ||
    (item && item.failedKeys) ||
    (session && session.failedKeys) ||
    (o && o.failedKeys) ||
    new Set();
  const failedKeySet =
    failedKeys instanceof Set ? failedKeys : new Set(Array.isArray(failedKeys) ? failedKeys : []);
  const excludedDomains =
    options.excludedDomains ||
    (item && item.excludedDomains) ||
    (session && session.excludedDomains) ||
    (o && o.excludedDomains) ||
    new Set();
  const excludedDomainSet =
    excludedDomains instanceof Set
      ? excludedDomains
      : new Set(Array.isArray(excludedDomains) ? excludedDomains : []);
  const domainAttemptsMap = resolveDomainAttempts(options, item, session, o);
  const triedKeys =
    options.triedKeys || (item && item.triedKeys) || (session && session.triedKeys) || new Set();
  const triedKeySet =
    triedKeys instanceof Set ? triedKeys : new Set(Array.isArray(triedKeys) ? triedKeys : []);
  if (item && !(item.triedKeys instanceof Set)) item.triedKeys = triedKeySet;
  if (item && !(item.failedKeys instanceof Set)) item.failedKeys = failedKeySet;
  if (item && !(item.excludedDomains instanceof Set)) item.excludedDomains = excludedDomainSet;
  const evidenceDir = resolveEvidenceDir(options, o);
  let repairAttemptCounter =
    log && log.review && log.review.review && Number.isFinite(Number(log.review.review.repairCount))
      ? Number(log.review.review.repairCount)
      : 0;

  return async (findings, sha) => {
    const hostWorktree = o.cwd || process.cwd();
    const isolatedWorkerRoot = o.isolatedWorker
      ? require('./isolation-launcher').workerRootFor(hostWorktree)
      : null;
    repairAttemptCounter += 1;
    const round =
      options.attempt !== undefined
        ? options.attempt
        : log &&
            log.review &&
            log.review.review &&
            Number.isFinite(Number(log.review.review.repairCount))
          ? Number(log.review.review.repairCount) + 1
          : repairAttemptCounter;
    const spec = repairSpec(item, findings, round);
    const replanned = planner.plan(log.goal, { specs: (o.specs || []).concat([spec]) });
    if (replanned.errors.length) {
      // AI-64-R09: refused at the planner, not downstream.
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: item.id,
          role: roleOf(item),
          attempt: round,
          attemptNumber: round,
          detail: 'REPAIR_REPLAN_REFUSED: ' + replanned.errors.join('; '),
        },
        logOpts
      );
      return { sha, repairRefused: replanned.errors };
    }
    const planned = replanned.workItems.find((w) => w.id === spec.id);
    if (!planned) return { sha };

    planned.failedKeys = failedKeySet;
    planned.excludedDomains = excludedDomainSet;
    planned.domainAttempts = domainAttemptsMap;
    planned.attempt = round;
    planned.attemptNumber = round;
    const decision = await selectCandidateForProfile(
      planned,
      candidates,
      [],
      evidenceData,
      o,
      logOpts,
      now,
      {
        failedKeys: failedKeySet,
        excludedDomains: excludedDomainSet,
        domainAttempts: domainAttemptsMap,
        attempt: round,
        attemptNumber: round,
      }
    );
    if (!decision.chosen) {
      if (
        failedKeySet.size > 0 ||
        excludedDomainSet.size > 0 ||
        Array.from(domainAttemptsMap.values()).some((v) => v >= 2)
      ) {
        if (item) item.blockedReason = 'NO_ALTERNATE_FAILURE_DOMAIN';
      }
      if (typeof options.onCheckpoint === 'function') {
        options.onCheckpoint('repair_round_completed', {
          repair: { round, sha, candidateKey: decision.chosen },
        });
      }
      return { sha };
    }
    const candidate = candidates.find((c) => candidateKey(c) === decision.chosen);
    triedKeySet.add(decision.chosen);
    if (options.triedKeys && options.triedKeys.add) options.triedKeys.add(decision.chosen);
    if (item && item.triedKeys && item.triedKeys.add) item.triedKeys.add(decision.chosen);
    const candDomain = routing.canonicalFailureDomain(candidate);
    domainAttemptsMap.set(candDomain, (domainAttemptsMap.get(candDomain) || 0) + 1);
    const route = resolveLaunchRoute(candidate, o, registry);
    if (!route) return { sha };
    const branch = o.branch || 'feat/' + String(item.id).toLowerCase();
    const usageFile = prepareUsageReport(usageDir, planned.id + '-' + now + '-repair' + round);
    const repairFindings = Array.isArray(findings) ? findings : [];
    const dirtyPaths = [
      ...new Set(
        repairFindings.flatMap((f) => (Array.isArray(f && f.dirtyPaths) ? f.dirtyPaths : []))
      ),
    ];
    const headSha =
      repairFindings.find((f) => f && f.headSha && typeof f.headSha === 'string')?.headSha || sha;
    const baseSha =
      repairFindings.find((f) => f && f.baseSha && typeof f.baseSha === 'string')?.baseSha ||
      o.baseSha;
    const prompt = compilePrompt(planned, {
      goal: log.goal,
      specText: o.specText,
      candidateKey: decision.chosen,
      branch,
      usageFile,
      dirtyPaths,
      headSha,
      baseSha,
      isolatedWorker: Boolean(o.isolatedWorker),
      logOpts,
    });
    const repairWorkerRoot = o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || o.cwd;
    const repairJob = {
      workItemId: planned.id,
      candidateKey: decision.chosen,
      harness: route.harnessName,
      provider: route.provider,
      model: route.model,
      accountId: normalizeAccount(candidate.accountId),
      gateway: candidate.gateway || '',
      upstream: candidate.upstream,
      quotaScope: candidate.quotaScope,
      prompt,
      branch,
      base: o.base || 'main',
      baseSha: sha || o.baseSha || null,
      retainWorkerHead: sha || null,
      hostWorktree: o.isolatedWorker ? hostWorktree : null,
      workerRoot: o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || null,
      cwd: repairWorkerRoot,
      isolatedWorker: Boolean(o.isolatedWorker),
      usageFile,
      decisionDir: o.decisionDir || null,
      checkpoint: o.checkpointFile || null,
      title: planned.id,
      labels: { workItem: planned.id, role: roleOf(planned), repairOf: item.id },
      workerTimeoutMs: o.workerTimeoutMs || null,
    };
    let res = null;
    try {
      res = await launcher(repairJob);
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
    }
    writeUsageReportFromHarnessResult(repairJob, res);
    if (!res || res.exitCode !== 0) {
      triedKeySet.add(decision.chosen);
      if (options.triedKeys && options.triedKeys.add) options.triedKeys.add(decision.chosen);
      if (item && item.triedKeys && item.triedKeys.add) item.triedKeys.add(decision.chosen);
      const classification = classifyFailure({
        exitCode: res ? res.exitCode : 1,
        httpStatus: res ? res.httpStatus : undefined,
        body: res ? res.body || res.stderr || '' : '',
        stderr: res ? res.stderr : '',
        accountId: candidate.accountId,
      });
      // TASK-AI-121 LF-R01: a local launch infrastructure failure blames no
      // key, no failure domain and sets no evidence cooldown.
      const blaming = classification.scope !== 'local';
      if (blaming) {
        failedKeySet.add(decision.chosen);
        if (item && item.failedKeys instanceof Set) item.failedKeys.add(decision.chosen);
      }
      const candDomain = routing.canonicalFailureDomain(candidate);
      const attemptsInDomain = domainAttemptsMap.get(candDomain) || 0;
      const domainExhausted = attemptsInDomain >= 2;
      const scopeExcludesDomain =
        classification.scope === 'upstream' || classification.scope === 'gateway';
      if (blaming && (scopeExcludesDomain || domainExhausted) && candDomain) {
        excludedDomainSet.add(candDomain);
        if (item && item.excludedDomains instanceof Set) item.excludedDomains.add(candDomain);
      }
      if (blaming && (evidenceDir || evidenceData)) {
        evidenceData = recordLaunchFailureEvidence(
          evidenceDir,
          evidenceData,
          candidate,
          res,
          classification,
          now
        );
        if (log) log.evidenceData = evidenceData;
      }
      if (logOpts) {
        const allExcluded = new Set(Array.from(failedKeySet));
        for (const d of excludedDomainSet) allExcluded.add(d);
        for (const c of Array.isArray(candidates) ? candidates : []) {
          const k = candidateKey(c);
          const cDomain = routing.canonicalFailureDomain(c);
          if (excludedDomainSet.has(cDomain)) allExcluded.add(k);
        }
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: planned.id,
            role: roleOf(planned),
            attempt: round,
            attemptNumber: round,
            chosen: decision.chosen,
            chosenKey: decision.chosen,
            branch: repairJob.branch,
            failureScope: classification.scope,
            cause: classification.cause,
            // TASK-AI-121 LF-R01: the real launcher message survives a local
            // launch infrastructure failure.
            detail: failedDecisionDetail(classification, res),
            excluded: Array.from(allExcluded),
            excludedSet: Array.from(allExcluded),
            // RT-R01: record retryable and retryAfterMs from classification
            retryable: classification.retryable,
            retryAfterMs: classification.retryAfterMs,
            // RT-R03: the cooldown this failure actually sets.
            cooldownMs:
              classification.scope === 'local' ? 0 : evidence.effectiveCooldownMs(classification),
          },
          logOpts
        );
      }
      // TASK-AI-121 LF-R02: an unusable isolation verdict stops the run.
      markIsolationVerdictStop(log, res, classification);
      return { sha };
    }

    const adapter = harnessFor({ harness: repairJob.harness });
    const handle = adapter ? require('./executor').readSessionId(adapter, repairJob, res).id : null;
    const nextSha = headShaOf(repairWorkerRoot);

    if (nextSha && nextSha !== sha) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.LAUNCHED,
          workItemId: planned.id,
          role: roleOf(planned),
          attempt: round,
          attemptNumber: round,
          chosen: decision.chosen,
          harness: repairJob.harness,
          branch: repairJob.branch,
          sessionId: handle,
          sha: nextSha,
          detail: 'REPAIR_ROUND: repairs ' + item.id,
          worktree: repairJob.cwd || null,
        },
        logOpts
      );
      if (typeof options.onCheckpoint === 'function') {
        options.onCheckpoint('repair_round_completed', {
          repair: { round, sha: nextSha, candidateKey: decision.chosen },
        });
      }
    }

    if (!handle || !nextSha || nextSha === sha || isTreeDirty(repairWorkerRoot)) return { sha };
    return { sha: nextSha };
  };
}

/** The approval ids a publication request carries (TASK-AI-122 PI-R02). */
function approvalIdsOf(request) {
  if (!request) return [];
  if (Array.isArray(request.approvalIds)) {
    return request.approvalIds.map((id) => String(id).trim()).filter(Boolean);
  }
  const single = request.approvalId;
  return typeof single === 'string' && single.trim() ? [single.trim()] : [];
}

/**
 * PI-R02: one approval per reviewed commit. The multi-approval request shape
 * (`--approval ID1,ID2`) is matched per item by the approval record's
 * reviewedSha; an item no supplied approval binds has no approval at all and is
 * reported NOT_REQUESTED (APPROVAL_NOT_SUPPLIED) — never an attempt, so the
 * replay guard stays clean for the items that do carry an approval. Ids that
 * resolve to no bound record keep the legacy seam: they are passed through and
 * the publisher's own binding gate decides.
 *
 * The legacy singular approvalId has no list to match across and is passed
 * through unchanged: a bound-but-wrong approval then refuses at the publisher
 * with the binding named, which is the diagnostic that shape has always had.
 */
function selectApprovalId(request, reviewedSha) {
  if (!Array.isArray(request.approvalIds)) {
    return { approvalId: request.approvalId || null };
  }
  const ids = approvalIdsOf(request);
  if (ids.length === 0) return { approvalId: null, missing: true };
  const approvals = require('./approval-registry');
  let registry = null;
  try {
    const regPath = approvals.registryPath(request.registryPath);
    registry = fs.existsSync(regPath) ? approvals.readRegistry(regPath) : null;
  } catch (err) {
    registry = null;
  }
  let sawBound = false;
  let unboundFallback = null;
  for (const id of ids) {
    const entry = registry ? approvals.approvalEntry(registry, id) : null;
    const bound = approvals.approvalReviewedSha(entry);
    if (bound) {
      sawBound = true;
      if (String(bound).toLowerCase() === String(reviewedSha).toLowerCase()) {
        return { approvalId: id };
      }
    } else if (unboundFallback === null) {
      unboundFallback = id;
    }
  }
  if (!sawBound && unboundFallback !== null) return { approvalId: unboundFallback };
  return { approvalId: null, missing: true };
}

/**
 * The publication stage for one reviewed work item.
 *
 * It runs operator-side, outside the worker, and only with an approval a named
 * human authority wrote and bound to the reviewed commit. The loop cannot mint
 * one, so a run with no approval records that fact and publishes nothing — which
 * is the correct outcome, not a fallback to an unapproved push.
 *
 * `publishGuard` is the run's replay state: once the publisher throws or its
 * promise rejects (a failed or timed-out attempt) the guard is marked here, and
 * the loop refuses the next attempt with PUBLISH_NOT_REPLAYABLE. It is marked
 * from this call rather than read from `entry.publication`, because the entry
 * carries every outcome — a refusal that never reached the publisher, a
 * not-requested run — while only an attempted publish can be unreplayable.
 *
 * `publishedByItem` is this run's publish outcome: workItemId -> published
 * branch. A dependent draft stacks its PR base on the dependency's published
 * branch (TASK-AI-122 PI-R03), and is not published at all without one.
 */
function publication(o, entry, publishGuard, publishedByItem) {
  const request = o.publication;
  const markAttemptFailed = (reason) => {
    if (publishGuard && !publishGuard.failed) {
      publishGuard.failed = { workItemId: entry.workItemId, reason };
    }
  };
  // Only a call that reached the publisher is an attempt. A manifest or import
  // refusal never touched the external effect, so it must not poison the guard.
  let attempted = false;
  if (entry && entry.checkpointReviewError) {
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry.workItemId,
      reason: entry.checkpointReviewError,
    };
  }
  if (!request) {
    const review = entry && entry.review;
    if (
      entry &&
      (!review ||
        review.status !== ReviewStatus.COMPLETED ||
        !ACCEPTED_VERDICTS.includes(review.verdict))
    ) {
      return {
        status: PublicationStatus.NOT_REQUESTED,
        workItemId: entry.workItemId,
        reason: 'NO_REVIEWED_COMMIT: the item did not reach a passing review',
      };
    }
    return {
      status: PublicationStatus.NOT_REQUESTED,
      reason: 'APPROVAL_NOT_SUPPLIED: the loop cannot mint the approval that authorises a publish',
    };
  }
  const review = entry && entry.review;
  // PI-R01: the review manifest and artifact are per Work Item. The per-item
  // files written at review time are this item's evidence; the legacy shared
  // review-manifest.json / review-artifact.md pair is read only when no
  // per-item file exists, because it is last-writer-wins across a multi-item
  // run. An explicit request pin stays authoritative for the caller that set it.
  const itemKey = (request && request.workItemId) || (entry && entry.workItemId);
  const itemDecisionDir =
    (entry && entry.decisionLog && entry.decisionLog.dir) || o.decisionDir || null;
  const itemManifestCandidate =
    itemDecisionDir && path.join(itemDecisionDir, 'review-manifest-' + itemKey + '.json');
  const itemArtifactCandidate =
    itemDecisionDir && path.join(itemDecisionDir, 'review-artifact-' + itemKey + '.md');
  const reviewManifest =
    (request && request.reviewManifest) ||
    (itemManifestCandidate && fs.existsSync(itemManifestCandidate)
      ? itemManifestCandidate
      : null) ||
    (entry && entry.reviewManifest) ||
    (entry &&
      entry.decisionLog &&
      entry.decisionLog.dir &&
      path.join(entry.decisionLog.dir, 'review-manifest.json')) ||
    (o.decisionDir && path.join(o.decisionDir, 'review-manifest.json')) ||
    null;
  const reviewArtifact =
    (request && request.reviewArtifact) ||
    (itemArtifactCandidate && fs.existsSync(itemArtifactCandidate)
      ? itemArtifactCandidate
      : null) ||
    (entry && entry.reviewArtifact) ||
    (entry &&
      entry.decisionLog &&
      entry.decisionLog.dir &&
      path.join(entry.decisionLog.dir, 'review-artifact.md')) ||
    (o.decisionDir && path.join(o.decisionDir, 'review-artifact.md')) ||
    null;

  if (
    !reviewManifest &&
    (!review ||
      review.status !== ReviewStatus.COMPLETED ||
      !ACCEPTED_VERDICTS.includes(review.verdict))
  ) {
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry && entry.workItemId,
      reason: 'NO_REVIEWED_COMMIT: the item did not reach a passing review',
    };
  }

  const reviewedSha = (entry && entry.sha) || (review && review.finalSha) || null;

  // PI-R02: an approval binds one reviewed commit. An item no supplied
  // approval binds is NOT_REQUESTED (APPROVAL_NOT_SUPPLIED) — not a refusal,
  // and never an attempt, so the replay guard stays clean for the items that
  // do carry an approval.
  const approval = selectApprovalId(request, reviewedSha);
  if (!approval.approvalId) {
    return {
      status: PublicationStatus.NOT_REQUESTED,
      workItemId: entry && entry.workItemId,
      reason:
        'APPROVAL_NOT_SUPPLIED: no supplied approval is bound to reviewed commit ' + reviewedSha,
    };
  }

  // PI-R03: one draft PR per Work Item. A dependent stacks its PR base on the
  // dependency's published branch, so its diff carries only its own commit(s);
  // without a published dependency there is no legal base and no publish.
  const specItem =
    (entry && entry.item) ||
    (o.specs || []).find((s) => s && s.id === (entry && entry.workItemId)) ||
    null;
  const dependencies = (
    specItem && Array.isArray(specItem.dependencies) ? specItem.dependencies : []
  ).filter(Boolean);
  let baseBranch = null;
  if (dependencies.length > 1) {
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry && entry.workItemId,
      reason:
        'MULTI_DEPENDENCY_BASE_UNSUPPORTED: a dependent draft PR stacks on exactly one dependency, got ' +
        dependencies.join(', '),
    };
  }
  if (dependencies.length === 1) {
    const dependencyBranch = publishedByItem && publishedByItem.get(dependencies[0]);
    if (!dependencyBranch) {
      return {
        status: PublicationStatus.REFUSED,
        workItemId: entry && entry.workItemId,
        reason: 'DEPENDENCY_NOT_PUBLISHED: ' + dependencies[0] + ' was not published in this run',
      };
    }
    baseBranch = dependencyBranch;
  }

  let imported = null;
  try {
    imported = importReviewedCommitForPublish(o, entry, request);

    let manifestValidation = null;
    if (reviewManifest) {
      const { validateManifestFile } = require('./review-manifest');
      manifestValidation = validateManifestFile(reviewManifest, {
        repoCwd: imported.cwd,
        expected: {
          workItemId: (request && request.workItemId) || (entry && entry.workItemId),
          commit: (entry && entry.sha) || (review && review.finalSha),
        },
        artifactPath: reviewArtifact,
      });
      if (!manifestValidation.ok) {
        throw new Error(
          'PUBLISH_REFUSED: ' +
            manifestValidation.code +
            (manifestValidation.reason ? ': ' + manifestValidation.reason : '')
        );
      }
      if (!ACCEPTED_VERDICTS.includes(manifestValidation.verdict)) {
        throw new Error(
          'PUBLISH_REFUSED: VERDICT_NOT_PASS: the review manifest verdict is ' +
            manifestValidation.verdict
        );
      }
    } else if (!request.testMode) {
      throw new Error(
        'PUBLISH_REFUSED: MANIFEST_REQUIRED: a review manifest must authorise the publish'
      );
    }

    const publishFn =
      typeof request.publish === 'function'
        ? request.publish
        : typeof o.publisher === 'function'
          ? o.publisher
          : require('./publisher').publish;
    attempted = true;
    // PI-R03: the publish branch is this item's own branch, and the approval is
    // the one bound to this item's reviewed commit (PI-R02).
    const publishBranch =
      (entry && entry.branch) || (request && request.branch) || (review && review.branch) || null;
    const result = publishFn(
      Object.assign({}, request, {
        // The publisher still owns the approval, destination and draft gates.
        // Its cwd is now an operator-side clone whose HEAD is the reviewed
        // worker commit, imported before this call without letting the worker
        // push or checking out inside the worker root.
        cwd: imported.cwd,
        reviewedSha: (entry && entry.sha) || (review && review.finalSha),
        verdict:
          (manifestValidation && manifestValidation.verdict) ||
          (review && review.verdict) ||
          'PASS',
        reviewer:
          entry.reviewerIdentity ||
          (review && review.reviewer) ||
          entry.reviewer ||
          request.reviewer ||
          null,
        branch: publishBranch,
        approvalId: approval.approvalId,
        reviewManifest,
        reviewArtifact,
        workItemId: (entry && entry.workItemId) || (request && request.workItemId),
        draft: (() => {
          if (!request.draft && !entry.draftTitle) return undefined;
          const manifest = manifestValidation && manifestValidation.manifest;
          const callerDraft = request.draft || {};
          // PI-R03: the title is "[<workItemId>] <outcome>" from that item's own
          // spec. A run-level draft title (the old specs[0] shape) names another
          // Work Item and must not label this one's Pull Request.
          const callerNamesThisItem =
            typeof callerDraft.workItemId === 'string' &&
            callerDraft.workItemId === String(entry.workItemId);
          const specOutcome = entry.draftTitle
            ? String(entry.draftTitle).replace(/^\[[^\]]+\]\s*/, '')
            : null;
          // DT-R01: whichever source names the outcome, the Pull Request title
          // and the body's outcome line are composed from this one normalized
          // string — exactly one Work Item ID, truncated to 72 characters.
          const outcome = draftTitleFor(
            entry.workItemId,
            (callerNamesThisItem && callerDraft.outcome) || specOutcome,
            'work item'
          ).replace(/^\[[^\]]+\]\s*/, '');
          return Object.assign(
            {
              workItemId: entry.workItemId,
              outcome,
              reviewer:
                entry.reviewerIdentity ||
                (review && review.reviewer) ||
                entry.reviewer ||
                request.reviewer ||
                null,
              writerCandidateKey: manifest && manifest.writerCandidateKey,
              reviewerCandidateKey: manifest && manifest.reviewerCandidateKey,
              verdict: manifest && manifest.verdict,
              findings: (manifest && manifest.findings) || [],
              tests: (manifest && manifest.tests) || [],
              reviewManifest,
              reviewArtifact,
              decisionEvidence:
                (entry.decisionLog && entry.decisionLog.dir) ||
                (typeof entry.decisionLog === 'string' ? entry.decisionLog : null) ||
                o.decisionDir ||
                callerDraft.decisionEvidence ||
                null,
              failBefore: entry.failBefore || {
                command: entry.tests && entry.tests.command,
                exitCode: entry.tests && entry.tests.baseExitCode,
              },
            },
            // PI-R03: a dependent draft PR stacks on the dependency's published
            // branch; an independent one has no base override.
            baseBranch ? { baseBranch } : {}
          );
        })(),
        log: typeof o.log === 'function' ? o.log : null,
      })
    );
    const record = {
      status: PublicationStatus.PUBLISHED_DRAFT,
      workItemId: entry.workItemId,
      branch: publishBranch,
      baseBranch,
      result,
      attempted,
    };
    if (result && typeof result.then === 'function') {
      // A rejected publish is a failed or timed-out attempt. The record stops
      // claiming a draft that never landed, and the run's guard is marked —
      // both before the loop can reach another entry.
      result.then(null, (err) => {
        const reason = String((err && err.message) || err);
        record.status = PublicationStatus.REFUSED;
        record.reason = reason;
        markAttemptFailed(reason);
      });
    }
    return record;
  } catch (err) {
    const reason = String((err && err.message) || err);
    if (attempted) markAttemptFailed(reason);
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry.workItemId,
      reason,
      attempted,
    };
  } finally {
    if (imported) imported.cleanup();
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
    // A format-gate refusal is a stop the next run re-attempts after the files
    // are formatted, so it is reported beside the blocks and never as deferred.
    else if (status === ItemStatus.BLOCKED || status === ItemStatus.REFUSED) blocked.push(item.id);
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
  } else if (
    publications.some((p) => p.status === PublicationStatus.REFUSED) ||
    (log.publication && log.publication.status === PublicationStatus.REFUSED)
  ) {
    log.status = RunStatus.REFUSED;
    const refusedPublication =
      publications.find((p) => p.status === PublicationStatus.REFUSED) ||
      (log.publication && log.publication.status === PublicationStatus.REFUSED
        ? log.publication
        : null);
    log.refusal = (refusedPublication && refusedPublication.reason) || 'PUBLICATION_REFUSED';
  } else if (
    publications.some((p) => p.status === PublicationStatus.PUBLISHED_DRAFT) ||
    (log.publication && log.publication.status === PublicationStatus.PUBLISHED_DRAFT)
  ) {
    log.status = RunStatus.PUBLISHED_DRAFT;
  } else if (blocked.length > 0) {
    log.status = RunStatus.BLOCKED;
  } else {
    log.status = RunStatus.COMPLETED;
  }

  const prior = ctx.checkpointOnDisk || {};
  const allCompleted = unique((prior.completed || []).concat(completed));
  const checkpointReviews = buildCheckpointReviews(log, prior, allCompleted, ctx.logOpts || {});
  const next = Object.assign({}, prior, {
    schemaVersion: 1,
    step: log.status === RunStatus.PUBLISHED_DRAFT ? 'live_published' : 'live_review',
    updatedAt: new Date(ctx.now).toISOString(),
    workItemIds: log.plan.workItems.map((i) => i.id),
    completed: allCompleted,
    blocked,
    deferred,
    sessions:
      log.sessions.length > 0
        ? log.sessions.map((s) => ({
            workItemId: s.workItemId,
            sessionId: s.sessionId,
            status: s.status,
            candidateKey: s.candidateKey,
          }))
        : prior.sessions || [],
    reviews: checkpointReviews,
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
  headShaOf,
  measureFailBefore,
  isTreeDirty,
  getTreeStatus,
  verifyWorkerCommit,
  writeUsageReportFromHarnessResult,
  materialiseExercise,
  captureFailBefore,
  buildTaskProfile,
  buildCandidates,
  selectCandidateForProfile,
  repairRound,
  reviewLane,
  reviewItem,
  draftTitleForItem,
  normalizeReviewForCheckpoint,
  provisionReviewRoot,
  publishCwdForReceipt,
  resolvePublishCwd,
  ItemStatus,
  RunStatus,
  PublicationStatus,
  effectiveCooldownMs: evidence.effectiveCooldownMs,
};
