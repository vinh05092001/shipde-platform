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
const { compilePrompt, compileReviewPrompt } = require('./prompt-compiler');
const { classifySession, Status: SessionStatus, progressFromWorkerRoot } = require('./supervisor');
const { runReviewLoop, Status: ReviewStatus } = require('./review-loop');
const ranking = require('./ranking');
const routing = require('./routing');
const evidence = require('./evidence');
const candidatesApi = require('./candidates');
const decisions = require('./decisions');
const { candidateKey } = require('./candidates');
const { classifyFailure } = require('./failure-classifier');
const { materialiseExercise, captureFailBefore } = require('./isolation-launcher');

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
  registry
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
      candidatesApi.parseCandidateKey(reviewerIdentity);
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
        ? path.win32.join(
            path.win32.dirname(isolatedWorkerRoot),
            path.win32.basename(isolatedWorkerRoot) + '-review'
          )
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
    });

    const reviewJob = {
      workItemId: (item ? item.id : 'item') + '-review',
      candidateKey: reviewerIdentity,
      harness: route.harnessName,
      provider: route.provider,
      model: route.model,
      accountId: candidate.accountId,
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
      checkpoint: o.checkpointFile || null,
      title: (item ? item.id : 'item') + '-review',
      labels: {
        workItem: (item ? item.id : 'item') + '-review',
        role: 'reviewer',
        reviewOf: item ? item.id : undefined,
      },
      exercise: o.exercise || null,
    };

    let res = null;
    try {
      res = await launcher(reviewJob);
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
    }

    writeUsageReportFromHarnessResult(reviewJob, res);

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

function buildProfile(item, o, forbiddenFailureDomains) {
  return {
    taskId: item.id,
    role: roleOf(item),
    complexity: item.complexity || 'standard',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    contextSize: 4000,
    expectedDuration: 30000,
    latencyPriority: 'normal',
    qualityFloor: 10,
    costCeiling: 1000,
    requiredHarness: null,
    forbiddenFailureDomains: forbiddenFailureDomains || [],
    resourceCeiling: 100,
    currentWorkload: 0,
  };
}

async function selectCandidateForProfile(
  item,
  annotatedCandidates,
  forbiddenDomains,
  evidenceData,
  o,
  logOpts,
  now
) {
  const profile = buildProfile(item, o, forbiddenDomains);

  // The weighting assessment is the Controller's own, obtained through the real
  // JEV path — routing.assessTask -> jev.adviseOrReason — and never hand-built
  // here. `o.jevAsk` is the only injection point and is undefined by default, so
  // a live run with no advisory is UNDECIDED/UNREACHABLE and the Controller's
  // deterministic per-role fallback decides (AI-64-P01). The ask is asked about
  // weighting profiles only, never a model, provider or account.
  const assessment = await routing.assessTask(profile, { ask: o.jevAsk });

  const rankCtx = {
    now,
    taskId: profile.taskId,
    evidenceData,
    headrooms: o.ranking && o.ranking.headrooms,
    reservations: o.ranking && o.ranking.reservations,
    accounts: o.ranking && o.ranking.accounts,
    useStoredQuota: false,
    home: o.ranking && o.ranking.home,
    storePath: o.ranking && o.ranking.storePath,
  };

  const result = routing.rankForProfile(annotatedCandidates, profile, assessment, rankCtx);

  const decisionRecorded = {
    stage: decisions.Stage.SELECTED,
    workItemId: profile.taskId,
    role: profile.role,
    taskProfile: profile,
    jev: assessment,
    ranking: result.ranking.map((c) => ({
      candidateKey: c.candidateKey,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      headroom: c.headroomStatus || 'unknown',
      failureDomain: routing.failureDomainOf(c),
      reservationsHeld: c.reservationsHeld || 0,
    })),
    rejected: result.rejected.slice(0, 50),
    rejectedCount: result.rejected.length,
    chosen: result.chosen,
    reason: result.reason,
  };
  decisions.recordDecision(decisionRecorded, logOpts);

  return {
    chosen: result.chosen,
    reason: result.reason,
    result,
  };
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
  const rawCandidates = Array.isArray(o.candidates) ? o.candidates : [];
  const evidenceDir = o.evidenceDir || path.join(__dirname, 'data', 'evidence');
  const evidenceData = evidence.loadEvidence(evidenceDir);
  const candidates = candidatesApi.annotateCandidates(
    rawCandidates.map((c) => Object.assign({}, c)),
    evidenceData,
    { now }
  );

  const registry = o.registry || { sources: [] };

  const outcome = (item, status, reason, extra) => {
    statusOf.set(item.id, status);
    const entry = Object.assign({ workItemId: item.id, status, reason: reason || null }, extra);
    log.outcomes.push(entry);
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
    const forbiddenDomains = [];
    let blockedReason = null;
    let session = null;

    for (let attempt = 1; attempt <= candidates.length + 1; attempt += 1) {
      // 5. The Controller chooses every candidate (AI-64-P01). This is a live
      //    decision, not a dry run: it is written to the decision log before the
      //    launch, with the ranking inputs it was made from (AI-64-R03).
      const decision = await selectCandidateForProfile(
        item,
        candidates,
        forbiddenDomains,
        evidenceData,
        o,
        logOpts,
        now
      );

      log.selections.push({ workItemId: item.id, attempt, decision });
      if (!decision.chosen) {
        blockedReason = 'NO_ELIGIBLE_CANDIDATE: ' + (decision.reason || 'no candidate qualifies');
        break;
      }
      const candidate = candidates.find((c) => candidateKey(c) === decision.chosen);
      if (launch.firstChoice === null) launch.firstChoice = decision.chosen;
      launch.selected = decision.chosen;

      const branch = o.branch || 'feat/' + String(item.id).toLowerCase();
      const usageFile = prepareUsageReport(usageDir, String(item.id) + '-' + now + '-a' + attempt);

      // The prompt carries the pinned key the Controller chose (AI-64-R02), so it
      // is compiled per attempt rather than once before any selection.
      const prompt = compilePrompt(item, {
        goal,
        specText: o.specText,
        candidateKey: decision.chosen,
        branch,
        usageFile,
      });
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
        accountId: candidate.accountId,
        gateway: candidate.gateway || '',
        upstream: candidate.upstream,
        quotaScope: candidate.quotaScope,
        prompt,
        branch,
        base: o.base || 'main',
        baseSha: o.baseSha || null,
        hostWorktree: o.isolatedWorker ? hostWorktree : null,
        workerRoot: o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || null,
        cwd: o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || o.cwd,
        isolatedWorker: Boolean(o.isolatedWorker),
        usageFile,
        checkpoint: checkpointFile,
        title: String(item.id),
        labels: { workItem: String(item.id), role: roleOf(item) },
        exercise: o.exercise || null,
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

      let res = null;
      try {
        res = launcher(job);
      } catch (err) {
        res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
      }

      writeUsageReportFromHarnessResult(job, res);

      if (res && res.exercise) {
        job.exercise = res.exercise;
      }
      if (res && res.failBefore) {
        job.failBefore = res.failBefore;
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
        const classification = classifyFailure({
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
      outcome(
        item,
        ItemStatus.BLOCKED,
        blockedReason || 'NO_LIVE_SESSION',
        launch.cause ? { cause: launch.cause } : undefined
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
        },
        logOpts
      );
      outcome(
        item,
        ItemStatus.BLOCKED,
        blockedReason,
        launch.cause ? { cause: launch.cause } : undefined
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
      registry
    );
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
  registry
) {
  const hostWorktree = o.cwd || process.cwd();
  const isolatedWorkerRoot = o.isolatedWorker
    ? require('./isolation-launcher').workerRootFor(hostWorktree)
    : null;
  const workerRoot =
    (o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot) || session.worktree || null;
  const workerHead = (workerRoot && headShaOf(workerRoot)) || session.headSha || null;
  const targetSha =
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

  const writerCandidate = candidates.find((c) => candidateKey(c) === session.candidateKey);
  let writerUpstream = writerCandidate && writerCandidate.upstream;
  let writerAccount = writerCandidate && writerCandidate.accountId;
  let writerGateway = writerCandidate && writerCandidate.gateway;
  if (!writerCandidate && session && session.candidateKey) {
    const parts = session.candidateKey.split('::');
    if (parts.length >= 7) {
      writerGateway = parts[2];
      writerUpstream = parts[3];
      writerAccount = parts[4];
    }
  }
  // The failure domain is per gateway+upstream (each upstream is an independent
  // failure domain). Only the writer's upstream (or gateway if no upstream) and
  // account are forbidden, allowing reviewer candidates on the same gateway
  // with distinct upstreams.
  const forbiddenDomains = [writerUpstream || writerGateway, writerAccount].filter(Boolean);
  const reviewerDecision = await selectCandidateForProfile(
    { id: item.id + '-review', roleRequirement: { role: 'reviewer' }, complexity: item.complexity },
    candidates,
    forbiddenDomains,
    evidenceData,
    o,
    logOpts,
    now
  );
  const reviewerIdentity = reviewerDecision.chosen || o.reviewerIdentity;

  const budget = Number.isFinite(Number(o.reviewBudget))
    ? Number(o.reviewBudget)
    : DEFAULT_REVIEW_BUDGET;
  const review = await runReviewLoop(
    { sha: targetSha, budget },
    {
      runTests:
        typeof o.tests === 'function'
          ? o.tests
          : () =>
              runVerificationCommand(
                item,
                Object.assign({}, o, { workerRoot, baseSha: session.baseSha || o.baseSha })
              ),
      review:
        typeof o.reviewer === 'function'
          ? o.reviewer
          : reviewLane(
              Object.assign({}, o, { reviewerIdentity }),
              item,
              session,
              log,
              logOpts,
              launcher,
              usageDir,
              now,
              candidates,
              evidenceData,
              registry
            ),
      repair:
        typeof o.repairer === 'function'
          ? o.repairer
          : repairRound(
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
              registry
            ),
    }
  );

  const entry = {
    workItemId: item.id,
    sha: review.finalSha || targetSha,
    reviewerIdentity: reviewerIdentity || null,
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
        reviewer: round.reviewer || reviewerIdentity || null,
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
  registry
) {
  return async (findings, sha) => {
    const hostWorktree = o.cwd || process.cwd();
    const isolatedWorkerRoot = o.isolatedWorker
      ? require('./isolation-launcher').workerRootFor(hostWorktree)
      : null;
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

    const decision = await selectCandidateForProfile(
      planned,
      candidates,
      [],
      evidenceData,
      o,
      logOpts,
      now
    );
    if (!decision.chosen) return { sha };
    const candidate = candidates.find((c) => candidateKey(c) === decision.chosen);
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
    });
    const repairWorkerRoot = o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot || o.cwd;
    const repairJob = {
      workItemId: planned.id,
      candidateKey: decision.chosen,
      harness: route.harnessName,
      provider: route.provider,
      model: route.model,
      accountId: candidate.accountId,
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
      checkpoint: o.checkpointFile || null,
      title: planned.id,
      labels: { workItem: planned.id, role: roleOf(planned), repairOf: item.id },
    };
    let res = null;
    try {
      res = await launcher(repairJob);
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
    }
    writeUsageReportFromHarnessResult(repairJob, res);
    if (!res || res.exitCode !== 0) return { sha };

    const adapter = harnessFor({ harness: repairJob.harness });
    const handle = adapter ? require('./executor').readSessionId(adapter, repairJob, res).id : null;
    const nextSha = headShaOf(repairWorkerRoot);
    if (!handle || !nextSha || nextSha === sha || isTreeDirty(repairWorkerRoot)) return { sha };
    decisions.recordDecision(
      {
        stage: decisions.Stage.LAUNCHED,
        workItemId: planned.id,
        role: roleOf(planned),
        chosen: decision.chosen,
        harness: repairJob.harness,
        branch: repairJob.branch,
        sessionId: handle,
        detail: 'REPAIR_ROUND: repairs ' + item.id,
        worktree: repairJob.cwd || null,
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
  headShaOf,
  isTreeDirty,
  getTreeStatus,
  verifyWorkerCommit,
  writeUsageReportFromHarnessResult,
  materialiseExercise,
  captureFailBefore,
  selectCandidateForProfile,
  repairRound,
  reviewLane,
  provisionReviewRoot,
  ItemStatus,
  RunStatus,
  PublicationStatus,
};
