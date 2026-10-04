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

function draftTitleForItem(item) {
  const outcome =
    (item && (item.businessOutcome || item.outcome || item.title || item.name)) ||
    (item && Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria[0]) ||
    (item && item.verification && item.verification.expect) ||
    null;
  const clean = outcome ? String(outcome).trim() : '';
  return '[' + String((item && item.id) || 'WORK-ITEM') + '] ' + (clean || 'verified work item');
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
    draftTitle: entry.draftTitle || draftTitleForItem(entry.item || { id: workItemId }),
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
  const evCandidates =
    evData && Array.isArray(evData.combinations)
      ? candidatesApi.candidatesFromEvidence(evData).filter((c) => !c.legacy)
      : [];
  return candidatesApi.mergeCandidates(baseCandidates, evCandidates);
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
    const evCandidates = candidatesApi.candidatesFromEvidence(evData).filter((c) => !c.legacy);
    candidates = candidatesApi.mergeCandidates(candidates, evCandidates);
    candidates = candidatesApi.annotateCandidates(
      candidates.map((c) => Object.assign({}, c)),
      evData,
      { now }
    );
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

  const decisionRecorded = {
    stage,
    workItemId: profile.taskId,
    role: roleOf(item),
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
  const testsInjectedCandidates = Array.isArray(o.candidates);
  const evidenceDir =
    o.evidenceDir || (testsInjectedCandidates ? null : path.join(__dirname, 'data', 'evidence'));
  const evidenceData =
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
      log.reviews.push(reviewEntry);
      log.review = reviewEntry;
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
        accountId: normalizeAccount(candidate.accountId),
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
    status: o.publication ? PublicationStatus.REFUSED : PublicationStatus.NOT_REQUESTED,
    reason: 'NO_REVIEWED_COMMIT: nothing to publish',
  };

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
    artifactPath,
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
    artifactPath,
  });

  return {
    manifestPath,
    artifactPath,
    manifest,
    validation,
  };
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

  const writerKey = (session && session.candidateKey) || null;
  const writerCandidate = (Array.isArray(candidates) ? candidates : []).find(
    (c) => candidateKey(c) === writerKey
  );
  let writerUpstream = writerCandidate && writerCandidate.upstream;
  let writerGateway = writerCandidate && writerCandidate.gateway;
  if ((!writerUpstream || !writerGateway) && writerKey) {
    const parsed = candidatesApi.parseCandidateKey(writerKey);
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
  const reviewerDecision = await selectCandidateForProfile(
    {
      id: item.id + '-review',
      roleRequirement: { role: 'reviewer' },
      complexity: item.complexity,
      writerCandidateKey: writerKey,
    },
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

  const baseReviewFn =
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
        );

  const reviewWithManifest = async (currentSha) => {
    roundCount += 1;
    const rev = await baseReviewFn(currentSha);

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
      reviewerCandidateKey: (rev && rev.reviewer) || reviewerIdentity || o.reviewerIdentity,
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
    reviewer: reviewerIdentity || null,
    writerCandidateKey: session.candidateKey,
    workerRoot: workerRoot || (session && session.worktree) || null,
    publishCwd: publishCwdForReceipt(o, workerRoot || (session && session.worktree) || null),
    branch: (session && session.branch) || o.branch || null,
    baseSha: (session && session.baseSha) || o.baseSha || null,
    draftTitle: draftTitleForItem(item),
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
      verdict: review.verdict || null,
      reviewer: reviewerIdentity || null,
      tests: compactTestEvidence(lastTestResult, (session && session.failBefore) || null),
      reviewRounds: Array.isArray(review.rounds) ? review.rounds.length : null,
      repairCount: review.repairCount,
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
  const request = o.publication;
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
  const reviewManifest =
    (request && request.reviewManifest) ||
    (entry && entry.reviewManifest) ||
    (entry &&
      entry.decisionLog &&
      entry.decisionLog.dir &&
      path.join(entry.decisionLog.dir, 'review-manifest.json')) ||
    (o.decisionDir && path.join(o.decisionDir, 'review-manifest.json')) ||
    null;
  const reviewArtifact =
    (request && request.reviewArtifact) ||
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
        branch: request.branch || entry.branch || (review && review.branch) || null,
        reviewManifest,
        reviewArtifact,
        workItemId: (request && request.workItemId) || (entry && entry.workItemId),
        draft:
          request.draft ||
          (entry.draftTitle
            ? {
                workItemId: entry.workItemId,
                outcome: String(entry.draftTitle).replace(/^\[[^\]]+\]\s*/, '') || 'work item',
                reviewer:
                  entry.reviewerIdentity ||
                  (review && review.reviewer) ||
                  entry.reviewer ||
                  request.reviewer ||
                  null,
                decisionEvidence:
                  entry.decisionLog && entry.decisionLog.dir
                    ? entry.decisionLog.dir
                    : entry.decisionLog || null,
              }
            : undefined),
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
  provisionReviewRoot,
  publishCwdForReceipt,
  resolvePublishCwd,
  ItemStatus,
  RunStatus,
  PublicationStatus,
};
