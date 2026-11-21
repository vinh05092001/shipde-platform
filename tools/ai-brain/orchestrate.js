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
const ciGate = require('./ci-gate');
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
  Cause,
  Scope,
  isReplayable,
  isolationVerdictBlockReason,
  ISOLATION_VERDICT_HUMAN_ACTION,
} = require('./failure-classifier');
const { materialiseExercise, captureFailBefore } = require('./isolation-launcher');
const {
  launchFailureText,
  failureMessageOf,
  failedDecisionDetail,
  markIsolationVerdictStop,
} = require('./orchestrate/decisions-log');
const {
  PROBE_BUDGET_MS,
  resolveLaunchRoute,
  stripOpencodeProviderPrefix,
  routeProbeCandidate,
} = require('./orchestrate/route-probe');
const {
  baseGateCache,
  runHostBrainGate,
  formatHostGateDiagnostics,
} = require('./orchestrate/host-gate');
const {
  hardenedGitEnv,
  hardenedGitArgs,
  runHardenedGit,
  assertGitOk,
} = require('./orchestrate/hardened-git');
const {
  FormatGate,
  ToolGate,
  runToolGates,
  runFormatGate,
  runFormatGateForTest,
} = require('./orchestrate/gates');
const {
  draftTitleFor,
  draftTitleForItem,
  publishCwdForReceipt,
  resolvePublishCwd,
  reviewedPublishBranch,
  importReviewedCommitForPublish,
  approvalIdsOf,
  selectApprovalId,
  publication,
} = require('./orchestrate/publication');
const {
  receiptCount,
  extractCheckpointReview,
  stableJson,
  sha256Text,
  digestObject,
  receiptIntegrityPayload,
  attachReceiptIntegrity,
  countOpenFindings,
  compactTestEvidence,
  normalizedReceiptTests,
  receiptFailureDomain,
  normalizeAccount,
  decisionLogEvidenceFor,
  verifyReceiptIntegrity,
  verifyReceiptCommit,
  verifyReceiptTests,
  verifyReceiptReviewerSeparation,
  verifyReceiptDecisionLog,
  validateCheckpointReceipt,
  normalizeReviewForCheckpoint,
  buildCheckpointReviews,
  explicitQualityFloor,
} = require('./orchestrate/checkpoint');
const {
  resolveLauncher,
  harnessFor,
  recordWriterResult,
  runVerificationCommand,
  headShaOf,
  verifyCommitSha,
  resolveIsolatedWorkerRoot,
  isTestFilePath,
  measureFailBefore,
  getTreeStatus,
  isTreeDirty,
  verifyWorkerCommit,
  writeUsageReportFromHarnessResult,
  readUsageReport,
  progressOf,
  prepareUsageReport,
  unique,
} = require('./orchestrate/writer-loop');
const {
  buildProfile,
  buildTaskProfile,
  rtkPolicyForItem,
  expandForbiddenDomains,
  hasQuotaAccountReadings,
  mergeEvidenceAccounts,
  buildCandidates,
  recordLaunchFailureEvidence,
  resolveDomainAttempts,
  resolveEvidenceDir,
  selectCandidateForProfile,
  orderDependenciesFirst,
} = require('./orchestrate/candidate-select');
const {
  provisionReviewRoot,
  reviewLane,
  formatFindingDetail,
  repairSpec,
} = require('./orchestrate/review-lane');
const { repairRound } = require('./orchestrate/repair-round');
const { writeReviewManifestAndArtifact, reviewItem } = require('./orchestrate/review-item');

const {
  exhaustedAccountKey,
  ItemStatus,
  RunStatus,
  PublicationStatus,
  DEFAULT_REVIEW_BUDGET,
  SHA_40,
  ACCEPTED_VERDICTS,
  roleOf,
  routingRoleOf,
} = require('./orchestrate/shared');

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
    tokenBudgets: null,
    // TASK-AI-121 LF-R02: set when a stale/missing isolation verdict stopped
    // the run — the reason and the operator action that clears it.
    isolationStop: null,
    status: null,
    refusal: null,
    warnings: [],
    discoveryWarning: null,
  };
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
async function runOrchestration(goal, opts) {
  const o = Object.assign({ goal }, opts || {});
  const now = o.now || Date.now();
  if (!o.routeHealthFile && (o.cwd || o.root))
    o.routeHealthFile = path.join(
      o.cwd || o.root,
      'tools',
      'ai-brain',
      'data',
      'model-route-health.json'
    );
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
  // A fixed o.now keeps tests deterministic; a live run stamps each decision
  // with its own time instead of the run start (TASK-AI-188).
  const logOpts = {
    dir: decisionDir,
    ...(o.now !== undefined ? { now: o.now } : {}),
    goal: o.goal,
    runId: o.runId || `${now}-${process.pid}`,
  };
  const checkpointFile =
    o.checkpointFile || (typeof o.checkpoint === 'string' ? o.checkpoint : null);
  const usageDir = o.usageDir || path.join(os.tmpdir(), 'shipde-usage');

  // The trace is not optional (AI-64-R14): a run that cannot say where its
  // decisions are written is refused rather than quietly writing nothing.
  if (!decisionDir) {
    return refuseRun(log, 'DECISION_LOG_DIR_MISSING: a live run must be able to write its trace');
  }

  if (log.plan.errors.length > 0) {
    const reason = 'PLANNER_REFUSED: ' + log.plan.errors.join('; ');
    log.publication = { status: PublicationStatus.REFUSED, reason };
    for (const error of log.plan.errors) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: (error.match(/^[A-Z_]+: ([^ ]+)/) || [])[1] || null,
          detail: error,
          reason: error,
        },
        logOpts
      );
    }
    return refuseRun(log, reason);
  }

  // TASK-AI-121 LF-R03: the worker timeout every launch (writer, reviewer and
  // repair) starts with, in milliseconds. The CLI flag's unit is minutes
  // (--worker-timeout-min, 1..240, default 30); this is its run-log form.
  o.workerTimeoutMs =
    Number.isFinite(Number(o.workerTimeoutMs)) && Number(o.workerTimeoutMs) > 0
      ? Number(o.workerTimeoutMs)
      : 30 * 60 * 1000;
  log.workerTimeoutMs = o.workerTimeoutMs;
  const budgetConfig = o.tokenBudgets || {};
  const budgetForItem = (item) => {
    // Precedence per field: default, then the complexity budget, then the
    // explicit role budget. The role is the more specific rule, so it wins for
    // every field it sets; complexity applies to fields the role leaves unset.
    // The legacy budgetConfig[role] form has the same role precedence.
    const limits = [
      budgetConfig.byComplexity?.[item.complexity],
      budgetConfig.byRole?.[roleOf(item)],
      budgetConfig[roleOf(item)],
    ].filter(Boolean);
    const budget = Object.assign({}, budgetConfig.default || {}, ...limits);
    return budget;
  };
  const budgetProgressMs =
    Number(
      (o.specs || [])
        .map((item) => budgetForItem(item).noProgressMinutes)
        .find((n) => Number(n) > 0) ||
        budgetConfig.default?.noProgressMinutes ||
        0
    ) *
    60 *
    1000;
  o.progressTimeoutMs =
    Number(o.progressTimeoutMs) > 0 ? Number(o.progressTimeoutMs) : budgetProgressMs;
  const controllerGate =
    o.hostGate ||
    (o.isolatedWorker && !o.injectedRun && typeof o.run !== 'function'
      ? (job) => runHostBrainGate(job, { hostCwd, baseSha: o.baseSha, base: o.base })
      : null);
  const quotaFailures = new Map();
  const riskDomainsByItem = new Map(
    (o.specs || []).map((item) => [
      item.id,
      Array.isArray(item.riskDomains) ? item.riskDomains : [],
    ])
  );
  log.rtk = { requested: Boolean(o.rtk), perWorkItem: {} };
  log.rtkPerWorkItem = log.rtk.perWorkItem;
  let contextPack = null;
  if (o.enableContextPack || o.contextManifest) {
    try {
      const packer = require('./context-pack');
      contextPack = await packer.createContextPackAsync(o.specs || [], {
        root: hostCwd,
        outputDir: o.contextPackDir,
        sources: o.contextSources,
      });
      const contextTokens = require('./repo-map').estimateTokens(contextPack.content);
      log.contextPack = {
        path: contextPack.path,
        files: contextPack.files.length,
        bytes: Buffer.byteLength(contextPack.content),
        tokens: contextTokens,
      };
      // The pack is the content actually attached to every item, including on resume.
      // An explicit item context requirement may request more, never less than this pack.
      for (const item of log.plan.workItems || []) {
        item.contextSize = Math.max(Number(item.contextSize) || 0, contextTokens);
      }
      if (typeof o.contextManifest === 'string' && o.contextManifest) {
        fs.mkdirSync(path.dirname(o.contextManifest), { recursive: true });
        fs.writeFileSync(
          o.contextManifest,
          JSON.stringify({ ...log.contextPack, files: contextPack.files }, null, 2) + '\n',
          'utf8'
        );
      }
    } catch (err) {
      log.warnings.push('CONTEXT_PACK_UNAVAILABLE: ' + String(err.message || err));
      return refuseRun(log, 'CONTEXT_PACK_UNAVAILABLE');
    }
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
  const isolatedWorkerRoot = resolveIsolatedWorkerRoot(o, hostWorktree);
  const launchWorker = resolveLauncher(o, isolatedLauncher);
  const launcher =
    launchWorker &&
    ((job) => {
      const remainingMs = (o.itemDeadline || Infinity) - Date.now();
      if (remainingMs <= 0) {
        return {
          exitCode: 1,
          failureReason: 'ITEM_DURATION_LIMIT_EXCEEDED',
          stderr: 'Item deadline exhausted before worker launch',
        };
      }
      job.workerTimeoutMs = Math.min(
        job.workerTimeoutMs || o.workerTimeoutMs || Infinity,
        remainingMs
      );
      return launchWorker(job);
    });
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
  // Combo-only (TASK-AI-171): 9router owns the combo's member list, failover
  // and health, so the Controller has no writer models to refresh, regenerate
  // or rank. The candidate is always the single combo (buildCandidates); the
  // old generateCandidates pool is never merged on top of it.
  const rawCandidates = buildCandidates(o, evidenceData);
  const candidates = candidatesApi.annotateCandidates(
    rawCandidates.map((c) => Object.assign({}, c)),
    evidenceData,
    { now }
  );

  const externalWorkersList =
    typeof o.externalWorkers === 'string'
      ? o.externalWorkers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : Array.isArray(o.externalWorkers)
        ? o.externalWorkers
        : [];
  const poolEnabled =
    externalWorkersList.includes('agy-pool') ||
    o.discoverPool === true ||
    Boolean(o.fakeRunsDir || o.runsDir || o.poolRuntimeDir);
  const pool = require('./agy-pool-runtime');
  const discoveryWarning = poolEnabled ? pool.getLastDiscoveryWarning() : null;
  if (discoveryWarning) {
    if (!log.warnings) log.warnings = [];
    log.warnings.push(discoveryWarning);
    log.discoveryWarning = discoveryWarning;
    if (decisionDir) {
      try {
        fs.appendFileSync(
          path.join(decisionDir, 'warnings.log'),
          `[${new Date(now).toISOString()}] [DISCOVERY] ${discoveryWarning}\n`,
          'utf8'
        );
      } catch {}
    }
  }

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

  const itemDispatchConfig = sourcesApi.getDispatchConfig(registry, o);
  for (const item of orderDependenciesFirst(log.plan.workItems)) {
    const itemStartedAt = Date.now();
    o.itemDeadline = itemStartedAt + itemDispatchConfig.maxItemDurationMs;
    if (log.plan.errors.length > 0) {
      // AI-64-R01: nothing is deferred silently; the errors travel in the run's
      // own outcome record and every item is reported as deferred.
      outcome(item, ItemStatus.DEFERRED, log.plan.errors.join('; '));
      continue;
    }
    if (completedBefore.has(item.id) || publishedBefore.has(item.id)) {
      log.resumed = {
        stage: 'resumed',
        workItemId: item.id,
        from: checkpointOnDisk.step || 'completed',
      };
      const savedStep = liveSteps[item.id];
      const rec = extractCheckpointReview(checkpointOnDisk, item.id, logOpts);
      const checkpointReviewError = validateCheckpointReceipt(rec, item, o, {
        hostCwd,
        passedRef: recordedPassedRefOf(savedStep, savedStep && savedStep.review?.entry),
      });
      const checkpointSha = rec && rec.sha ? rec.sha : null;
      const ciConfig = ciGate.ciGateConfig(o.dispatch || o.registry?.dispatch);
      const isCiDisabled = o.ciGate === false || !ciConfig.enabled;
      if (completedBefore.has(item.id) && (!checkpointSha || checkpointReviewError)) {
        outcome(item, ItemStatus.BLOCKED, checkpointReviewError || 'NO_REVIEWED_COMMIT', {
          reasonCode: 'CHECKPOINT_RECEIPT_INVALID',
        });
      } else if (completedBefore.has(item.id)) {
        outcome(item, ItemStatus.COMPLETED, 'CHECKPOINT_COMPLETED');
      } else if (publishedBefore.has(item.id) && isCiDisabled) {
        outcome(
          item,
          ItemStatus.BLOCKED,
          'CI_GATE_DISABLED: verification disabled but required for completion',
          {
            reasonCode: 'CI_GATE_DISABLED',
          }
        );
      } else if (!checkpointSha || checkpointReviewError) {
        outcome(item, ItemStatus.BLOCKED, checkpointReviewError || 'NO_REVIEWED_COMMIT', {
          reasonCode: 'CHECKPOINT_RECEIPT_INVALID',
        });
      } else {
        outcome(item, ItemStatus.COMPLETED, 'CHECKPOINT_COMPLETED');
      }
      const anchoredEvidence =
        !checkpointReviewError && rec && rec.decisionLog && rec.decisionLog.dir
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
        sha: checkpointSha,
        reviewedSha: checkpointSha,
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
                rounds: (anchoredEvidence && anchoredEvidence.rounds) || null,
                repairCount:
                  anchoredEvidence && Number.isFinite(anchoredEvidence.repairCount)
                    ? anchoredEvidence.repairCount
                    : rec && Number.isFinite(rec.repairCount)
                      ? rec.repairCount
                      : null,
              }
            : null,
      };
      // TASK-AI-120 RI-R01 (finding 6): an item completed before this run may
      // still be missing its passed ref — the interrupt that created this
      // checkpoint could land after the outcome and before the import. Import
      // now, before anything depends on the commit.
      const completedPassedRef = !checkpointReviewError
        ? importPassedRefFor(item.id, reviewEntry, savedStep)
        : null;
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
    const itemRiskDomains = riskDomainsByItem.get(item.id) || item.riskDomains || [];
    const itemRtkDecision = rtkPolicyForItem(o.rtk, itemRiskDomains, o.injectedRun);
    const itemRtkPermitted = itemRtkDecision.enabled;
    log.rtk.perWorkItem[item.id] = itemRtkDecision;
    if (o.rtk) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.WARNING,
          workItemId: item.id,
          warning: 'RTK_POLICY',
          detail: itemRtkDecision.reason,
          enabled: itemRtkPermitted,
        },
        logOpts
      );
    }
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
    const localCandidateFailures = new Map();
    let maxLocalWriterFallbacks = require('./sources.json').dispatch.maxLocalWriterFallbacks;
    try {
      const configuredLocalFallbacks = Number(
        registry?.dispatch?.maxLocalWriterFallbacks ??
          require('./sources.json').dispatch.maxLocalWriterFallbacks
      );
      if (Number.isSafeInteger(configuredLocalFallbacks) && configuredLocalFallbacks >= 0) {
        maxLocalWriterFallbacks = configuredLocalFallbacks;
      }
    } catch {}
    const skipLocalCandidate = (key, cause, refundDomainAttempt = false) => {
      localCandidateFailures.set(key, cause);
      if (refundDomainAttempt) {
        const candidate = candidates.find((c) => candidateKey(c) === key);
        const domain = routing.canonicalFailureDomain(candidate);
        domainAttempts.set(domain, Math.max(0, (domainAttempts.get(domain) || 0) - 1));
      }
      if (localCandidateFailures.size > maxLocalWriterFallbacks) {
        blockedReason =
          'LOCAL_WRITER_FALLBACK_LIMIT: ' +
          JSON.stringify(
            Array.from(localCandidateFailures, ([candidateKey, cause]) => ({ candidateKey, cause }))
          );
        launch.fallbackReason = blockedReason;
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: item.id,
            chosen: key,
            failureScope: 'local',
            cause: 'LOCAL_WRITER_FALLBACK_LIMIT',
            detail: blockedReason,
            retryable: false,
          },
          logOpts
        );
        return false;
      }
      return true;
    };

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
    const recordedWriterFailures = new Set();
    const localLaunchFailures = new Set();
    const routeRefusalStates = new Map();

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
    if (recordedLaunch && recordedLaunch.hostGatePass === false) {
      outcome(item, ItemStatus.BLOCKED, 'HOST_GATE_FAILED');
      continue;
    }

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

    const recordWriterFailure = (key, reason, cause, scope = 'local') => {
      const step = liveSteps[item.id] || {};
      persistStep(item.id, 'writer_post_selection_failed', {
        reason,
        failures: [
          ...(step.failures || []),
          {
            failedCandidateKey: key,
            reason,
            cause,
            failureScope: scope,
          },
        ],
      });
      recordedWriterFailures.add(key);
      const selectedDecision = log.selections
        .slice()
        .reverse()
        .find((entry) => entry.workItemId === item.id && entry.decision?.chosen === key);
      decisions.recordDecision(
        {
          stage: decisions.Stage.FAILED,
          workItemId: item.id,
          role: roleOf(item),
          chosen: key,
          ranking: (selectedDecision && selectedDecision.decision?.decisionRecorded?.ranking) || [],
          cause,
          failureScope: scope,
          detail: reason,
        },
        logOpts
      );
      launch.fallbackReason = reason;
      launch.cause = cause;
      launch.scope = scope;
    };

    let lastWriterFailureReason = null;
    const itemLimitReason = (code, rounds) => {
      const reasons = {};
      const add = (reason) => {
        if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
      };
      for (const entry of log.selections.filter((entry) => entry.workItemId === item.id)) {
        for (const rejected of entry.decision.result?.rejected || entry.decision.rejected || []) {
          add(rejected.reason);
        }
      }
      for (const failure of liveSteps[item.id]?.failures || [])
        add(failure.cause || failure.reason);
      add(launch.cause);
      return (
        code +
        ': ' +
        JSON.stringify({
          rounds,
          maxWriterSelectionRounds: itemDispatchConfig.maxWriterSelectionRounds,
          elapsedMs: Date.now() - itemStartedAt,
          maxItemDurationMs: itemDispatchConfig.maxItemDurationMs,
          rejectionReasons: reasons,
        })
      );
    };
    const reachedItemLimit = (rounds) => {
      const code =
        Date.now() >= o.itemDeadline
          ? 'ITEM_DURATION_LIMIT_EXCEEDED'
          : rounds >= itemDispatchConfig.maxWriterSelectionRounds
            ? 'WRITER_SELECTION_LIMIT_EXCEEDED'
            : null;
      if (!code) return false;
      blockedReason = itemLimitReason(code, rounds);
      launch.fallbackReason = blockedReason;
      return true;
    };
    let writerLaunches = 0;
    for (let attempt = 1; !session && attempt <= candidates.length + 1; attempt += 1) {
      if (reachedItemLimit(attempt - 1)) break;
      // 5. The Controller chooses every candidate (AI-64-P01). This is a live
      //    decision, not a dry run: it is written to the decision log before the
      //    launch, with the ranking inputs it was made from (AI-64-R03).
      const currentItemStep = liveSteps[item.id] || savedStep;
      const failedForSelection = new Set([...failedKeys, ...localCandidateFailures.keys()]);
      const routeRefusals = candidates.map((offered) => {
        const key = candidateKey(offered);
        const reason = null;
        if (reason) failedForSelection.add(key);
        return { candidateKey: key, reason };
      });
      decisions.recordRouteRefusals(
        routeRefusals,
        routeRefusalStates,
        { workItemId: item.id, attempt },
        logOpts
      );
      const excludedForSelection = new Set(excludedDomains);
      const selectedCheckpoint =
        attempt === 1 &&
        currentItemStep &&
        currentItemStep.selection &&
        !(currentItemStep.failures || []).some(
          (failure) => failure.failedCandidateKey === currentItemStep.selection.candidateKey
        ) &&
        !failedForSelection.has(currentItemStep.selection.candidateKey)
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
      if (Date.now() >= o.itemDeadline && reachedItemLimit(attempt)) break;
      if (!decision.chosen) {
        if (localCandidateFailures.size > 0) {
          // Exhausting this invocation's alternatives must retain the real
          // harness/session cause, not replace it with a generic rank refusal.
          blockedReason = launch.cause || Array.from(localCandidateFailures.values()).at(-1);
        } else if (failedKeys.size > 0) {
          blockedReason =
            'NO_ALTERNATE_FAILURE_DOMAIN' +
            (launch.fallbackReason
              ? ': ' + launch.fallbackReason
              : launch.scope && launch.cause
                ? ': ' + launch.scope + ' (' + launch.cause + ')'
                : '');
        } else {
          blockedReason = 'NO_ELIGIBLE_CANDIDATE: ' + (decision.reason || 'no candidate qualifies');
        }
        break;
      }
      if (item.hostGateFailures && item.hostGateFailures.length) {
        log.prompts.push({
          workItemId: item.id,
          attempt,
          candidateKey: decision.chosen,
          prompt: compilePrompt(item, {
            goal,
            specText: o.specText,
            candidateKey: decision.chosen,
            branch: o.branch || 'feat/' + String(item.id).toLowerCase(),
            focusedTestsOnly: true,
            contextPack: contextPack && contextPack.path,
            hostGateFailures: item.hostGateFailures,
          }),
        });
      }
      const candidate = candidates.find((c) => candidateKey(c) === decision.chosen);
      // maxTurns bounds real writer launches for this item; selection rounds that
      // only refuse or probe candidates are not launches (counted where the job starts).
      if (writerLaunches >= Number(budgetForItem(item).maxTurns || Infinity)) {
        launch.fallbackReason = 'TURN_BUDGET_EXCEEDED';
        break;
      }
      if (launch.firstChoice === null) launch.firstChoice = decision.chosen;
      launch.selected = decision.chosen;
      triedKeys.add(decision.chosen);
      if (!selectedCheckpoint) {
        const currentStep = liveSteps[item.id] || savedStep;
        persistStep(item.id, 'candidate_selected', {
          selection: { candidateKey: decision.chosen, decision },
          failures: (currentStep && currentStep.failures) || [],
        });
      }

      const recordPostSelectFailure = (reason, cause, scope = 'local') =>
        recordWriterFailure(decision.chosen, reason, cause, scope);

      const branch = o.branch || 'feat/' + String(item.id).toLowerCase();
      const usageFile = prepareUsageReport(usageDir, String(item.id) + '-' + now + '-a' + attempt);

      // The prompt carries the pinned key the Controller chose (AI-64-R02), so it
      // is compiled per attempt rather than once before any selection.
      let compiledPrompt;
      try {
        compiledPrompt = compilePrompt(item, {
          goal,
          specText: o.specText,
          candidateKey: decision.chosen,
          branch,
          usageFile,
          isolatedWorker: Boolean(o.isolatedWorker),
          recordTools: false,
          returnTools: true,
          focusedTestsOnly: true,
          contextPack: contextPack && contextPack.path,
          hostGateFailures: item.hostGateFailures || [],
        });
      } catch (error) {
        blockedReason =
          'POST_SELECTION_ERROR: prompt compilation ' +
          decisions.scrubText(String((error && error.message) || 'unknown error')).slice(0, 300);
        recordPostSelectFailure(blockedReason, 'POST_SELECTION_ERROR');
        break;
      }
      let prompt = compiledPrompt.prompt;
      if (item.hostGateFailures && item.hostGateFailures.length) delete item.hostGateFailures;
      const promptToolIds = compiledPrompt.tools;
      if (Array.isArray(promptToolIds) && promptToolIds.length > 0) {
        decisions.recordDecision(
          {
            stage: decisions.Stage.PROMPT_TOOLS,
            workItemId: item.id,
            role: roleOf(item),
            tools: promptToolIds,
            chosen: decision.chosen,
            ranking: (decision.decisionRecorded && decision.decisionRecorded.ranking) || [],
          },
          logOpts
        );
      }
      log.prompts.push({ workItemId: item.id, attempt, candidateKey: decision.chosen, prompt });

      const previousLaunch = currentItemStep && currentItemStep.launch;
      const replayedLaunch = Boolean(
        previousLaunch && previousLaunch.candidateKey === decision.chosen
      );
      let route;
      try {
        route = resolveLaunchRoute(candidate, o, registry);
      } catch (error) {
        blockedReason =
          'POST_SELECTION_ERROR: route resolution ' +
          decisions.scrubText(String((error && error.message) || 'unknown error')).slice(0, 300);
        recordPostSelectFailure(blockedReason, 'POST_SELECTION_ERROR');
        break;
      }
      if (!route) {
        blockedReason = 'HARNESS_UNKNOWN: no dispatch route for ' + String(decision.chosen);
        recordPostSelectFailure(blockedReason, 'HARNESS_UNKNOWN');
        break;
      }
      const candDomain = routing.canonicalFailureDomain(candidate);
      domainAttempts.set(candDomain, (domainAttempts.get(candDomain) || 0) + 1);
      writerLaunches += 1;
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
        workerTimeoutMs: Math.min(o.workerTimeoutMs || Infinity, o.itemDeadline - Date.now()),
        rtk: {
          enabled: itemRtkPermitted,
          sourcePath: o.rtk && typeof o.rtk === 'object' ? o.rtk.sourcePath : undefined,
        },
        lowRisk: itemRtkPermitted,
        riskDomains: itemRiskDomains,
        tokenBudgetConfig: budgetConfig,
        tokenBudget: budgetForItem(item),
        maxTurns: budgetForItem(item).maxTurns || null,
        maxQuotaFailures: budgetForItem(item).repeatedQuotaFailures || 3,
        progressTimeoutMs:
          (Number(budgetForItem(item).noProgressMinutes) || 0) * 60 * 1000 ||
          o.progressTimeoutMs ||
          null,
        hostGate: Boolean(controllerGate),
        decisionDir: o.decisionDir || null,
        workItemId: item.id,
      };

      // The exercise runner exists in the worker's own tree before the agent
      // starts, so the fail-before at the pinned base SHA is a real captured run
      // and the pass-after at the worker's head SHA is the same command.
      // For isolated worker launches, the runner is materialised inside the
      // isolated launcher AFTER the worker root is provisioned so git clone does
      // not overwrite it. For non-isolated or injected runners, materialise here.
      const exerciseRoot =
        o.isolatedWorker && typeof o.run === 'function' ? isolatedWorkerRoot : job.cwd;
      if (o.exercise && exerciseRoot && (!o.isolatedWorker || typeof o.run === 'function')) {
        job.exercise = materialiseExercise(exerciseRoot, o);
        if (job.exercise && job.exercise.failBefore) {
          job.failBefore = job.exercise.failBefore;
        }
      }

      // TASK-AI-120 RI-R03: the blame decision must use the classification this
      // attempt earned. A replayed launch carries its recorded classification;
      // a fresh failure is classified from its own signals below.
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
        if (res && res.failureReason === 'TOKEN_BUDGET_EXCEEDED') {
          res = Object.assign({}, res, { exitCode: 1 });
        }
        try {
          writeUsageReportFromHarnessResult(job, res);
        } finally {
          recordWriterResult(job, res, 'writer', logOpts, o.env);
        }
        if (res && res.budgetWarning === 'TOKEN_BUDGET_UNVERIFIED') {
          decisions.recordDecision(
            {
              stage: decisions.Stage.WARNING,
              warning: 'TOKEN_BUDGET_UNVERIFIED',
              workItemId: item.id,
              role: roleOf(item),
              model: job.model,
              detail:
                'run outcome preserved; token usage was unavailable, so the configured budget could not be verified',
            },
            logOpts
          );
        }
        const adapter = harnessFor({ harness: job.harness });
        const launchHandle = require('./executor').readSessionId(adapter, job, res).id;
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
          if (res && res.failureReason === 'TOKEN_BUDGET_EXCEEDED') {
            launchClassification.scope = 'local';
            launchClassification.cause = res.failureReason;
            launch.fallbackReason = res.failureReason;
            launch.cause = 'TOKEN_BUDGET_EXCEEDED';
          } else if (res && res.failureReason === 'STALLED_NO_PROGRESS') {
            launchClassification.scope = 'local';
            launchClassification.cause = 'STALLED_NO_PROGRESS';
            launch.fallbackReason = 'STALLED_NO_PROGRESS';
            launch.cause = 'STALLED_NO_PROGRESS';
          } else if (res && res.failureReason === 'REQUEST_TOO_LARGE') {
            launchClassification.scope = 'model';
            launchClassification.cause = 'REQUEST_TOO_LARGE';
            launch.fallbackReason = 'REQUEST_TOO_LARGE';
            launch.cause = 'REQUEST_TOO_LARGE';
          }
          if (res && Array.isArray(res.hostGateFailures)) {
            launchClassification.scope = 'local';
            launchClassification.cause = 'HOST_GATE_FAILED';
            launch.fallbackReason = 'HOST_GATE_FAILED';
            launch.cause = 'HOST_GATE_FAILED';
          }
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
        const isIsolated = Boolean(
          o.isolatedWorker || (job && job.isolatedWorker) || (res && res.isolatedWorker)
        );
        const workerClone = isIsolated
          ? isolatedWorkerRoot || (res && (res.workerRoot || res.retainedWorkerRoot)) || null
          : job.cwd;

        let verifiedWorkerSha = null;
        let workerShaUnverified = false;
        if (isIsolated) {
          const candidateSha = workerClone ? headShaOf(workerClone) : null;
          if (workerClone && candidateSha && verifyCommitSha(workerClone, candidateSha)) {
            verifiedWorkerSha = candidateSha;
          } else if (workerClone) {
            const cloneHead = headShaOf(workerClone);
            if (cloneHead && verifyCommitSha(workerClone, cloneHead)) {
              verifiedWorkerSha = cloneHead;
            } else {
              workerShaUnverified = true;
            }
          } else {
            workerShaUnverified = true;
          }
        } else {
          verifiedWorkerSha = headShaOf(job.cwd) || o.sha || null;
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
            workerSha: verifiedWorkerSha || null,
            ...(workerShaUnverified
              ? { reason: 'WORKER_SHA_UNVERIFIED', workerShaReason: 'WORKER_SHA_UNVERIFIED' }
              : {}),
            failBefore: null,
            // TASK-AI-114 R03: the commit this launch starts from and where it
            // came from: the dependency id for a dependent, the global
            // --base-sha otherwise.
            baseSha: job.baseSha || null,
            baseFrom: dependencyBase ? dependencyBase.baseFrom : null,
          },
        });
        if (workerShaUnverified) {
          decisions.recordDecision(
            {
              stage: decisions.Stage.WARNING,
              warning: 'WORKER_SHA_UNVERIFIED',
              workItemId: item.id,
              role: roleOf(item),
              detail: 'worker SHA could not be verified in worker clone: ' + workerClone,
            },
            logOpts
          );
        }
      }
      if (job.usageFile && !o.injectedRun) {
        const report = readUsageReport(job.usageFile);
        if (report) {
          const usage = report.usage || report;
          decisions.recordDecision(
            {
              stage: decisions.Stage.WARNING,
              warning: 'TOKEN_USAGE',
              workItemId: item.id,
              role: roleOf(item),
              model: job.model,
              tokenUsage: {
                input: Number(usage.input_tokens ?? usage.input ?? 0) || 0,
                cacheRead:
                  Number(usage.cache_read_tokens ?? usage.cacheRead ?? usage.cache_read ?? 0) || 0,
                output: Number(usage.output_tokens ?? usage.output ?? 0) || 0,
                total: Number(usage.total_tokens ?? usage.total ?? 0) || 0,
              },
            },
            logOpts
          );
        }
      }
      if (controllerGate && res && res.exitCode === 0) {
        const gate = await controllerGate(job);
        log.hostGate = gate;
        if (!gate.pass) {
          if (gate.failures && gate.failures.length && typeof o.hostGateRepair === 'function') {
            const repair = candidates.find(
              (candidate) => candidateKey(candidate) !== decision.chosen
            );
            if (repair) {
              await o.hostGateRepair({ job, failures: gate.failures, candidate: repair });
            }
          }
          const gateFailures = gate.failures || [];
          item.hostGateFailures = gateFailures;
          res = Object.assign({}, res, {
            exitCode: 1,
            hostGateFailures: gateFailures,
            hostGateSummary: gate.summary,
            hostGateOutput: gate.output,
            hostGateCommand: gate.command,
            needsHostGateRepair: true,
          });
        }
      }

      if (res && Array.isArray(res.hostGateFailures) && res.needsHostGateRepair) {
        item.hostGateFailures = res.hostGateFailures;
        const isolatedRepair = Boolean(
          o.isolatedWorker || job.isolatedWorker || res.isolatedWorker
        );
        const retainedRoot = isolatedRepair ? job.workerRoot : job.workerRoot || job.cwd;
        const retainedHead = retainedRoot ? headShaOf(retainedRoot) : null;
        if (isolatedRepair && (!retainedHead || !verifyCommitSha(retainedRoot, retainedHead))) {
          blockedReason = 'WORKER_SHA_UNVERIFIED';
          launch.cause = blockedReason;
          launch.fallbackReason = blockedReason;
          launch.outcome = 'failed';
          log.launches.push(launch);
          const step = liveSteps[item.id] || {};
          persistStep(item.id, 'worker_sha_unverified', {
            reason: blockedReason,
            launch: Object.assign({}, step.launch, {
              workerSha: null,
              reason: blockedReason,
              workerShaReason: blockedReason,
            }),
          });
          decisions.recordDecision(
            {
              stage: decisions.Stage.FAILED,
              workItemId: item.id,
              role: roleOf(item),
              chosen: decision.chosen,
              failureScope: 'local',
              cause: blockedReason,
              reason: blockedReason,
            },
            logOpts
          );
          break;
        }
        // Keep the completed run's report path intact while the repair writes
        // its own report. Only a successful repair replaces the active job.
        const repairJob = Object.assign({}, job);
        if (repairJob.usageFile) {
          repairJob.usageFile = prepareUsageReport(
            path.dirname(repairJob.usageFile),
            path.basename(repairJob.usageFile, '.json') + '-host-gate-repair'
          );
        }
        repairJob.prompt = compilePrompt(item, {
          goal,
          specText: o.specText,
          candidateKey: decision.chosen,
          branch,
          usageFile: repairJob.usageFile,
          isolatedWorker: Boolean(o.isolatedWorker),
          focusedTestsOnly: true,
          contextPack: contextPack && contextPack.path,
          hostGateFailures: res.hostGateFailures,
          hostGateOutput: res.hostGateOutput,
          hostGateSummary: res.hostGateSummary,
          hostGateCommand: res.hostGateCommand,
          maxPromptCommandOutputChars: itemDispatchConfig.maxPromptCommandOutputChars,
        });
        prompt = repairJob.prompt;
        const promptRecord = log.prompts.find(
          (entry) => entry.workItemId === item.id && entry.attempt === attempt
        );
        if (promptRecord) promptRecord.prompt = repairJob.prompt;
        log.prompts.push({
          workItemId: item.id,
          attempt,
          candidateKey: decision.chosen,
          prompt: repairJob.prompt,
        });
        // Repair the completed run in place. A fresh provision here discards
        // its commit while the checkpoint still names that deleted object.
        repairJob.retainWorkerHead = retainedHead;
        // TASK-AI-188 (#610 review, R3): the host-gate repair also names its
        // run and the item's allowed paths, so it can adopt the writer's work.
        repairJob.runId = logOpts.runId;
        if (Array.isArray(item && item.allowedPaths)) repairJob.allowedPaths = item.allowedPaths;
        let gateRepairResult;
        try {
          gateRepairResult = launcher(repairJob);
        } catch (err) {
          gateRepairResult = { exitCode: -1, stderr: String((err && err.message) || err) };
        }
        try {
          writeUsageReportFromHarnessResult(repairJob, gateRepairResult);
        } finally {
          recordWriterResult(repairJob, gateRepairResult, 'host-gate-repair', logOpts, o.env);
        }
        const isRepairRequestTooLarge = Boolean(
          gateRepairResult &&
          (gateRepairResult.reason === 'REQUEST_TOO_LARGE' ||
            /REQUEST_TOO_LARGE/i.test(gateRepairResult.stderr || ''))
        );
        if (!gateRepairResult || gateRepairResult.exitCode !== 0) {
          item.hostGateFailures = res.hostGateFailures;
          // The repair refusal cannot erase the successful writer session.
          // Its original report remains the evidence; the host gate still blocks review.
          res = Object.assign({}, res, {
            exitCode: 0,
            hostGateRepairRequestTooLarge: isRepairRequestTooLarge,
          });
          log.hostGate.repairFailure = failureMessageOf(gateRepairResult);
        } else {
          Object.assign(job, repairJob);
          res = gateRepairResult;
          const repairedGate = await controllerGate(repairJob);
          log.hostGate = repairedGate;
          if (!repairedGate.pass) {
            item.hostGateFailures = repairedGate.failures || [];
            res = Object.assign({}, res, {
              hostGateFailures: item.hostGateFailures,
              hostGateSummary: repairedGate.summary,
              hostGateOutput: repairedGate.output,
              hostGateCommand: repairedGate.command,
            });
          } else {
            delete item.hostGateFailures;
            delete res.hostGateFailures;
          }
        }
        log.prompts.push({
          workItemId: item.id,
          attempt: attempt + 1,
          candidateKey: decision.chosen,
          prompt: repairJob.prompt,
        });
      }

      if (res && Array.isArray(res.hostGateFailures) && res.exitCode !== 0) {
        recordedWriterFailures.add(decision.chosen);
        const { failedChecks, shortSummary, detailMessage } = formatHostGateDiagnostics({
          failures: res.hostGateFailures,
          summary: res.hostGateSummary,
          output: res.hostGateOutput,
          maxSummaryChars: itemDispatchConfig.maxHostGateSummaryChars,
        });
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: item.id,
            role: roleOf(item),
            chosen: decision.chosen,
            failureScope: 'local',
            cause: 'HOST_GATE_FAILED',
            detail: detailMessage,
            failures: failedChecks,
            failedChecks,
            summary: shortSummary,
          },
          logOpts
        );
        launch.scope = 'local';
        launch.cause = 'HOST_GATE_FAILED';
        launch.fallbackReason = 'HOST_GATE_FAILED';
        launch.outcome = 'failed';
        log.launches.push(launch);
        blockedReason = 'HOST_GATE_FAILED';
        continue;
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
      const progressSnapshot = res && !exited ? progressOf(o, res, now) : null;
      const effectiveStallMs = Number(o.stallMs || o.progressTimeoutMs || 0);
      const progressStalled = Boolean(
        progressSnapshot &&
        effectiveStallMs > 0 &&
        classifySession(Object.assign({}, res, { progress: progressSnapshot }), {
          now: Date.now(),
          stallMs: effectiveStallMs,
        }) === SessionStatus.STALLED
      );
      const budgetFailure = Boolean(res && res.failureReason === 'TOKEN_BUDGET_EXCEEDED');
      const launcherStalled = Boolean(res && res.failureReason === 'STALLED_NO_PROGRESS');
      if (budgetFailure) {
        launch.fallbackReason = res.failureReason;
      }
      if (progressStalled) launch.fallbackReason = 'STALLED_NO_PROGRESS';
      if (launcherStalled) launch.fallbackReason = 'STALLED_NO_PROGRESS';
      if (budgetFailure || launcherStalled) res = Object.assign({}, res, { exitCode: 1 });
      if (progressStalled || budgetFailure || launcherStalled) {
        launch.scope = 'local';
        launch.cause =
          progressStalled || launcherStalled
            ? 'STALLED_NO_PROGRESS'
            : res.failureReason || 'TOKEN_BUDGET_EXCEEDED';
        launch.outcome = 'failed';
      }
      if (budgetFailure) {
        failedKeys.add(decision.chosen);
        const currentStep = liveSteps[item.id] || {};
        const failureList = (currentStep.failures || []).slice();
        if (!failureList.some((failure) => failure.failedCandidateKey === decision.chosen)) {
          failureList.push({
            failedCandidateKey: decision.chosen,
            failureScope: 'local',
            failureDomain: null,
            forbiddenDomain: null,
            cause: res.failureReason,
          });
        }
        persistStep(item.id, 'worker_launch_failed', { failures: failureList });
        recordedWriterFailures.add(decision.chosen);
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: item.id,
            chosen: decision.chosen,
            failureScope: 'local',
            cause: res.failureReason,
            detail: 'worker exceeded configured token budget; stopping session',
          },
          logOpts
        );
      }
      if (
        !res ||
        (exited && res.exitCode !== 0) ||
        progressStalled ||
        budgetFailure ||
        launcherStalled
      ) {
        if (progressStalled || budgetFailure || launcherStalled)
          res = Object.assign({}, res || {}, { exitCode: 1 });
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
        const quotaLike = /quota_exhausted|\b429\b|rate limit/i.test(
          String((res && res.stderr) || '') + ' ' + String((res && res.stdout) || '')
        );
        if (res && res.failureReason === 'TOKEN_BUDGET_EXCEEDED') {
          classification.scope = 'local';
          classification.cause = res.failureReason;
          launch.fallbackReason = res.failureReason;
        }
        if (res && res.failureReason === 'STALLED_NO_PROGRESS') {
          classification.scope = 'local';
          classification.cause = 'STALLED_NO_PROGRESS';
          launch.fallbackReason = 'STALLED_NO_PROGRESS';
        }
        if (res && res.failureReason === 'REQUEST_TOO_LARGE') {
          classification.scope = 'model';
          classification.cause = 'REQUEST_TOO_LARGE';
          launch.fallbackReason = 'REQUEST_TOO_LARGE';
        }
        if (progressStalled) {
          classification.scope = 'local';
          classification.cause = 'STALLED_NO_PROGRESS';
        }
        if (launcherStalled) {
          classification.scope = 'local';
          classification.cause = 'STALLED_NO_PROGRESS';
        }
        if (quotaLike) {
          const domain = routing.canonicalFailureDomain(candidate);
          const count = (quotaFailures.get(domain) || 0) + 1;
          quotaFailures.set(domain, count);
          if (count >= Number(job.maxQuotaFailures || 3)) {
            classification.cause = 'QUOTA_REPEATED';
            launch.fallbackReason = 'QUOTA_REPEATED';
            failedKeys.add(decision.chosen);
          }
        }
        if (res && Array.isArray(res.hostGateFailures)) {
          classification.scope = 'local';
          classification.cause = 'HOST_GATE_FAILED';
          launch.fallbackReason = 'HOST_GATE_FAILED';
          launch.cause = 'HOST_GATE_FAILED';
        }
        launch.scope = classification.scope;
        launch.cause = classification.cause;
        lastWriterFailureReason = classification.cause;
        launch.outcome = 'failed';
        if (
          classification.cause === 'TOKEN_BUDGET_EXCEEDED' ||
          classification.cause === 'STALLED_NO_PROGRESS' ||
          classification.cause === 'REQUEST_TOO_LARGE'
        ) {
          launch.fallbackReason = classification.cause;
        }
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
          if (
            classification.scope === 'account' ||
            classification.cause === 'account_quota_exhausted' ||
            classification.cause === 'QUOTA_EXHAUSTED' ||
            classification.cause === 'account_exhausted'
          ) {
            const accMark = exhaustedAccountKey(candidate);
            if (accMark) {
              failedKeys.add(accMark);
              if (item && item.failedKeys instanceof Set) item.failedKeys.add(accMark);
            }
          }
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
          if (
            classification.cause === 'TOKEN_BUDGET_EXCEEDED' ||
            classification.cause === 'STALLED_NO_PROGRESS'
          ) {
            failedKeys.add(decision.chosen);
          }
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

        require('./route-health').rememberLaunchTpm(candidate, launchFailureText(res), o);
        require('./route-health').rememberLaunchContextOverflow(
          candidate,
          launchFailureText(res),
          o
        );
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
        recordedWriterFailures.add(decision.chosen);
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
        if (classification.scope === Scope.LOCAL && classification.cause === Cause.LAUNCH_CONFIG) {
          // Item-local identity deliberately excludes the selected route/model.
          const detail = decisions.scrubText(launchFailureText(res)).replace(/\s+/g, ' ').trim();
          const identity = JSON.stringify([classification.cause, detail]);
          if (localLaunchFailures.has(identity)) {
            blockedReason = detail;
            launch.fallbackReason = detail;
            break;
          }
          localLaunchFailures.add(identity);
        }
        if (
          classification.scope === Scope.LOCAL &&
          classification.cause !== Cause.LAUNCH_CONFIG &&
          classification.cause !== 'HOST_GATE_FAILED'
        ) {
          const rankedCandidates =
            decision?.decisionRecorded?.ranking || decision?.result?.ranking || [];
          const hasAlternate = rankedCandidates.some((r) => {
            const k = r.candidateKey || (typeof r === 'string' ? r : null);
            return (
              k && k !== decision.chosen && !failedKeys.has(k) && !localCandidateFailures.has(k)
            );
          });
          if (hasAlternate) {
            if (!skipLocalCandidate(decision.chosen, classification.cause)) break;
          }
        }
        const alternate = candidates.find((c) => {
          const k = candidateKey(c);
          if (failedKeys.has(k) || localCandidateFailures.has(k)) return false;
          if (c.blocked) return false;
          const cDomain = routing.canonicalFailureDomain(c);
          if (excludedDomains.has(cDomain)) return false;
          if ((domainAttempts.get(cDomain) || 0) >= 2) return false;
          if (routing.isForbiddenCandidate && routing.isForbiddenCandidate(c, forbiddenDomains))
            return false;
          return true;
        });
        if (
          classification.cause === 'QUOTA_REPEATED' ||
          classification.cause === 'HOST_GATE_FAILED'
        ) {
          blockedReason = classification.cause;
          break;
        }
        if (!alternate) {
          blockedReason =
            'NO_ALTERNATE_FAILURE_DOMAIN: ' +
            classification.scope +
            ' (' +
            classification.cause +
            ')';
          break;
        }
        if (!launch.fallbackReason) {
          launch.fallbackReason =
            'FIRST_CANDIDATE_FAILED: ' + classification.scope + ' (' + classification.cause + ')';
        }
        launch.scope = classification.scope;
        launch.cause = classification.cause;
        launch.outcome = 'failed';
        log.launches.push(launch);
        continue;
      }

      // The durable handle, read from the report this launch was given. An absent
      // or unparsable report means this was not a live run and nothing is recorded
      // as launched (AI-64-R04, AI-64-P08).
      const adapter = harnessFor({ harness: job.harness });
      const reported = require('./executor').readSessionId(adapter, job, res);
      if (!reported.id) {
        launch.outcome = 'not_a_live_run';
        blockedReason = reported.cause || 'HARNESS_NO_SESSION_ID';
        launch.fallbackReason = blockedReason;
        launch.cause = blockedReason;
        launch.scope = 'local';
        recordPostSelectFailure(blockedReason, blockedReason);
        log.launches.push({ ...launch });
        const rankedCandidates =
          decision?.decisionRecorded?.ranking || decision?.result?.ranking || [];
        const hasAlternate =
          !log.hostGate?.pass &&
          rankedCandidates.some((r) => {
            const k = r.candidateKey || (typeof r === 'string' ? r : null);
            return (
              k && k !== decision.chosen && !failedKeys.has(k) && !localCandidateFailures.has(k)
            );
          });
        if (
          hasAlternate &&
          skipLocalCandidate(decision.chosen, reported.cause || 'HARNESS_NO_SESSION_ID', true)
        ) {
          blockedReason = null;
          continue;
        }
        break;
      }

      // The supervisor decides what the session actually was (AI-64-R05).
      const status = classifySession(
        Object.assign({}, res, { progress: progressOf(o, res, now) }),
        {
          now: Date.now(),
          stallMs: o.stallMs || o.progressTimeoutMs,
        }
      );
      const isIsolated = Boolean(
        o.isolatedWorker || (job && job.isolatedWorker) || (res && res.isolatedWorker)
      );
      const workerClone = isIsolated
        ? isolatedWorkerRoot || (res && (res.workerRoot || res.retainedWorkerRoot)) || null
        : job.cwd;
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
        worktree: isIsolated ? workerClone : job.cwd || null,
      };
      const candidateWorkerHead = isIsolated
        ? workerClone
          ? headShaOf(workerClone)
          : null
        : headShaOf(job.cwd);
      const workerHead = isIsolated
        ? workerClone && candidateWorkerHead && verifyCommitSha(workerClone, candidateWorkerHead)
          ? candidateWorkerHead
          : null
        : candidateWorkerHead;
      if (workerHead) {
        session.headSha = workerHead;
        const step = liveSteps[item.id] || {};
        persistStep(item.id, step.stage || 'worker_launch_finished', {
          launch: Object.assign({}, step.launch, {
            sessionId: reported.id,
            workerSha: workerHead,
          }),
        });
      } else if (isIsolated) {
        session.workerShaReason = 'WORKER_SHA_UNVERIFIED';
        launch.workerShaReason = 'WORKER_SHA_UNVERIFIED';
      }
      log.sessions.push(session);
      log.launches.push(launch);
      log.exercise = session.exercise;
      log.failBefore = session.failBefore;
      launch.outcome = 'launched';

      // Preserve a successful worker's real session even when the independent
      // host gate rejects it. Review remains blocked by the gate.
      if (Array.isArray(res.hostGateFailures)) {
        blockedReason = 'HOST_GATE_FAILED';
        launch.cause = blockedReason;
        launch.outcome = 'failed';
        const step = liveSteps[item.id] || {};
        const { failedChecks, shortSummary, detailMessage } = formatHostGateDiagnostics({
          failures: res.hostGateFailures,
          summary: res.hostGateSummary,
          output: res.hostGateOutput,
          maxSummaryChars: itemDispatchConfig.maxHostGateSummaryChars,
          defaultDetail: blockedReason,
        });

        const isRequestTooLargeRepair = Boolean(res.hostGateRepairRequestTooLarge);
        const remainingCandidates = candidates.filter(
          (c) => candidateKey(c) !== decision.chosen && !failedKeys.has(candidateKey(c))
        );
        const isRetryable = isRequestTooLargeRepair && remainingCandidates.length > 0;

        session.hostGateFailures = failedChecks;
        session.hostGateSummary = shortSummary;
        session.hostGateDetail = detailMessage;
        session.isRetryable = isRetryable;

        persistStep(item.id, 'host_gate_failed', {
          reason: blockedReason,
          detail: detailMessage,
          failures: failedChecks,
          failedChecks,
          summary: shortSummary,
          retryable: isRetryable,
          launch: Object.assign({}, step.launch, {
            hostGatePass: false,
            hostGateFailures: failedChecks,
          }),
        });
        break;
      }

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
          runId: logOpts.runId,
          worktree: isIsolated ? workerClone : job.cwd || null,
          sha: session.headSha || null,
          ...(session.headSha
            ? {}
            : isIsolated
              ? { reason: 'WORKER_SHA_UNVERIFIED', workerShaReason: 'WORKER_SHA_UNVERIFIED' }
              : {}),
          // TASK-AI-114 R03: the handoff commit, with the dependency it came
          // from when this work item is a dependent.
          baseSha: job.baseSha || null,
          baseFrom: dependencyBase ? dependencyBase.baseFrom : null,
        },
        logOpts
      );

      if (isIsolated && !workerHead) {
        launch.outcome = 'failed';
        launch.cause = 'WORKER_SHA_UNVERIFIED';
        launch.fallbackReason = 'WORKER_SHA_UNVERIFIED';
        failedKeys.add(decision.chosen);
        blockedReason = 'WORKER_SHA_UNVERIFIED';
        break;
      }

      if (status !== SessionStatus.COMPLETED_WITH_ARTIFACT) {
        if (status === SessionStatus.STALLED) {
          const failureCause = 'STALLED_NO_PROGRESS';
          launch.fallbackReason = failureCause;
          launch.scope = 'local';
          launch.cause = failureCause;
          launch.outcome = 'failed';
          failedKeys.add(decision.chosen);
          recordedWriterFailures.add(decision.chosen);
          decisions.recordDecision(
            {
              stage: decisions.Stage.FAILED,
              workItemId: item.id,
              chosen: decision.chosen,
              failureScope: 'local',
              cause: failureCause,
              detail:
                failureCause === 'STALLED_NO_PROGRESS'
                  ? 'worker exceeded progress timeout without progress'
                  : 'session exceeded configured token budget',
            },
            logOpts
          );
          log.launches[log.launches.length - 1] = launch;
          blockedReason = failureCause;
          break;
        }
        if (budgetFailure) {
          launch.fallbackReason = res.failureReason;
          launch.scope = 'local';
          launch.cause = res.failureReason;
          launch.outcome = 'failed';
          failedKeys.add(decision.chosen);
          log.launches[log.launches.length - 1] = launch;
          blockedReason = res.failureReason;
          outcome(item, ItemStatus.BLOCKED, blockedReason, {
            cause: res.failureReason,
            reasonCode: res.failureReason,
          });
          break;
        }
        // COMPLETED_EMPTY, STALLED and FAILED all stop here: the run does not
        // review and does not publish, and the checkpoint is written for a human.
        blockedReason = status;
        break;
      }
      break;
    }

    if (statusOf.get(item.id) === ItemStatus.BLOCKED) {
      continue;
    }
    if (!session) {
      const terminalReason =
        lastWriterFailureReason && blockedReason?.startsWith('PROBE_BUDGET_EXHAUSTED')
          ? lastWriterFailureReason
          : blockedReason || launch.fallbackReason || 'NO_LIVE_SESSION';
      const step = liveSteps[item.id] || {};
      const targetFailedKey =
        launch.selected ||
        Array.from(localCandidateFailures.keys()).at(-1) ||
        log.selections
          .slice()
          .reverse()
          .find((entry) => entry.workItemId === item.id && entry.decision?.chosen)?.decision
          ?.chosen ||
        null;
      persistStep(item.id, 'writer_post_selection_failed', {
        reason: terminalReason,
        failures: (step.failures || []).length
          ? step.failures
          : [
              {
                failedCandidateKey: targetFailedKey,
                reason: terminalReason,
                cause: launch.cause || terminalReason,
                failureScope: launch.scope || 'local',
              },
            ],
      });
      // Existing launch failures already carry the scrubbed launcher detail and
      // classification. Keep that record while wrapping its checkpoint reason.
      if (!recordedWriterFailures.has(targetFailedKey) && targetFailedKey) {
        const selectedDecision = log.selections
          .slice()
          .reverse()
          .find(
            (entry) => entry.workItemId === item.id && entry.decision?.chosen === targetFailedKey
          );
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: item.id,
            chosen: targetFailedKey,
            ranking:
              (selectedDecision && selectedDecision.decision.decisionRecorded?.ranking) || [],
            detail: terminalReason,
            cause: launch.cause || terminalReason,
            failureScope: launch.scope || 'local',
            retryable: false,
            retryAfterMs: null,
          },
          logOpts
        );
      }
      const isNoAlt =
        failedKeys.size > 0 ||
        triedKeys.size > 0 ||
        Boolean(blockedReason && blockedReason.startsWith('NO_ALTERNATE_FAILURE_DOMAIN'));
      const verdictStop = log.isolationStop || null;
      outcome(
        item,
        ItemStatus.BLOCKED,
        (verdictStop && verdictStop.reason) || terminalReason,
        Object.assign(
          {
            reasonCode: blockedReason?.startsWith('LOCAL_WRITER_FALLBACK_LIMIT')
              ? 'LOCAL_WRITER_FALLBACK_LIMIT'
              : /^WRITER_SELECTION_LIMIT_EXCEEDED|^ITEM_DURATION_LIMIT_EXCEEDED/.test(
                    blockedReason || ''
                  )
                ? blockedReason.split(':')[0]
                : blockedReason === 'TOKEN_BUDGET_EXCEEDED'
                  ? 'TOKEN_BUDGET_EXCEEDED'
                  : launch.cause === 'STALLED_NO_PROGRESS'
                    ? 'STALLED_NO_PROGRESS'
                    : verdictStop
                      ? verdictStop.reasonCode
                      : isNoAlt
                        ? 'NO_ALTERNATE_FAILURE_DOMAIN'
                        : undefined,
            triedKeys: Array.from(triedKeys),
            tried: Array.from(triedKeys),
            cause: launch.cause || undefined,
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
      const isHostGateFailed = blockedReason === 'HOST_GATE_FAILED';
      decisions.recordDecision(
        {
          stage: decisions.Stage.FAILED,
          workItemId: item.id,
          role: roleOf(item),
          chosen: session.candidateKey,
          branch: session.branch,
          sessionId: session.sessionId,
          detail:
            isHostGateFailed && session.hostGateDetail ? session.hostGateDetail : blockedReason,
          ...(isHostGateFailed
            ? {
                failures: session.hostGateFailures || [],
                failedChecks: session.hostGateFailures || [],
                summary: session.hostGateSummary || '',
              }
            : {}),
          // RT-R01: retryable is false for terminal session failures (no classification available),
          // except when host gate repair was killed by REQUEST_TOO_LARGE and other candidates remain.
          retryable: isHostGateFailed ? Boolean(session.isRetryable) : false,
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
            cause: launch.cause || undefined,
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
      const receipt = normalizeReviewForCheckpoint(reviewEntry, item.id, logOpts);
      persistStep(item.id, 'review_completed', {
        review: { status: reviewed.status, entry: reviewEntry, receipt },
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
        const receipt = normalizeReviewForCheckpoint(reviewEntry, item.id, logOpts);
        persistStep(item.id, 'review_completed', {
          review: {
            status: reviewed.status,
            entry: reviewEntry,
            receipt,
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
          cause: launch.cause || undefined,
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
    if (!entry.sha) {
      if (publishedBefore.has(entry.workItemId) || o.publication) {
        const refused = {
          status: PublicationStatus.REFUSED,
          workItemId: entry.workItemId,
          reason:
            entry.checkpointReviewError ||
            'NO_REVIEWED_COMMIT: missing review record in checkpoint for ' + entry.workItemId,
        };
        log.publications.push(refused);
        entry.publication = refused;
        if (liveSteps[entry.workItemId]) {
          liveSteps[entry.workItemId].publication = refused;
        }
        recordPublishDecision(entry, refused);
      }
      continue;
    }
    const itemStep = liveSteps[entry.workItemId] || {};
    // CK-R03 (P1-2): a draft publication already recorded in the checkpoint is
    // returned exactly as it was written — including a run cut between the
    // publication persist and finish(). Never a second publish, never a rebuilt
    // receipt, whatever the rebuilt review record for this resume looks like.
    const recordedPublication =
      itemStep.publication && itemStep.publication.status === PublicationStatus.PUBLISHED_DRAFT
        ? itemStep.publication
        : null;
    let published;
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
      published = recordedPublication;
      entry.publication = recordedPublication;
    } else {
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

      published = publication(o, entry, publishGuard, publishedByItem);
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

    // CI is the final verification: the item is complete only when CI is green on
    // the exact reviewed head SHA. Review PASS alone never completes or merges it.
    entry.ci = null;
    if (published && published.status === PublicationStatus.PUBLISHED_DRAFT) {
      const ciConfig = ciGate.ciGateConfig(o.dispatch || o.registry?.dispatch);
      const isCiDisabled = o.ciGate === false || !ciConfig.enabled;
      if (isCiDisabled) {
        const failure = {
          exitCode: 1,
          stderr: 'CI_GATE_DISABLED: verification disabled but required for completion',
          failureReason: 'CI_GATE_DISABLED',
        };
        const itemRole = roleOf(entry.item || entry);
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: entry.workItemId,
            role: itemRole,
            detail: failure.stderr,
          },
          logOpts
        );
        persistStep(entry.workItemId, 'ci_gate_failed', { failure, ci: null });
        for (let i = log.outcomes.length - 1; i >= 0; i -= 1) {
          if (log.outcomes[i].workItemId === entry.workItemId) {
            log.outcomes.splice(i, 1);
          }
        }
        log.outcomes.push({
          workItemId: entry.workItemId,
          status: ItemStatus.BLOCKED,
          reason: failure.stderr,
          reasonCode: 'CI_GATE_DISABLED',
        });
        statusOf.set(entry.workItemId, ItemStatus.BLOCKED);
        break;
      }
      const draft = (published.result && (published.result.draft || published.result)) || {};
      const ci = await ciGate.awaitCi({
        sha: entry.sha,
        prNumber: draft.number,
        branch: published.branch || entry.branch,
        repo: o.repo,
        cwd: o.repoCwd || o.cwd,
        ghRunner: o.ghRunner,
        sleep: o.ciSleep,
        pollIntervalMs: o.ciPollIntervalMs,
        timeoutMs: o.ciTimeoutMs,
      });
      entry.ci = {
        state: ci.state,
        sha: ci.sha,
        failed: ci.failed || [],
        reason: ci.reason || null,
      };
      let failureFile = null;
      if (ci.state === 'FAIL') {
        failureFile = ciGate.writeCiFailure(
          (logOpts && logOpts.dir) || o.decisionDir,
          entry.workItemId,
          ci
        );
      }
      if (logOpts) {
        decisions.recordDecision(
          {
            stage: decisions.Stage.CI_GATE,
            workItemId: entry.workItemId,
            sha: entry.sha,
            ciState: ci.state,
            failed: ci.failed || [],
            failureFile,
          },
          logOpts
        );
      }
      if (ci.state !== 'PASS') {
        const failure = {
          exitCode: 1,
          stderr:
            'CI_GATE_FAILED (' +
            ci.state +
            ') on ' +
            entry.sha +
            ': ' +
            (ci.failed || []).join(', '),
          failureReason: 'CI_GATE_FAILED',
        };
        const itemRole = roleOf(entry.item || entry);
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: entry.workItemId,
            role: itemRole,
            detail: failure.stderr,
          },
          logOpts
        );
        persistStep(entry.workItemId, 'ci_gate_failed', { failure, ci });
        for (let i = log.outcomes.length - 1; i >= 0; i -= 1) {
          if (log.outcomes[i].workItemId === entry.workItemId) {
            log.outcomes.splice(i, 1);
          }
        }
        log.outcomes.push({
          workItemId: entry.workItemId,
          status: ItemStatus.BLOCKED,
          reason: failure.stderr,
          reasonCode: 'CI_GATE_FAILED',
        });
        statusOf.set(entry.workItemId, ItemStatus.BLOCKED);
        break;
      } else {
        persistStep(entry.workItemId, 'ci_gate_passed', { ci });
      }
    }

    if (entry.checkpointReviewError) {
      for (let i = log.outcomes.length - 1; i >= 0; i -= 1) {
        if (log.outcomes[i].workItemId === entry.workItemId) {
          log.outcomes.splice(i, 1);
        }
      }
      log.outcomes.push({
        workItemId: entry.workItemId,
        status: ItemStatus.BLOCKED,
        reason: entry.checkpointReviewError,
        reasonCode: 'CHECKPOINT_RECEIPT_INVALID',
      });
      statusOf.set(entry.workItemId, ItemStatus.BLOCKED);
      break;
    }

    // GM-R05 (TASK-AI-133): the next-item loop calls merge after publish when the item is eligible.
    if (o.mergeAfterPublish || o.autoMerge || o.merge) {
      const { governedMerge, isEligibleForMerge } = require('./governed-merge');
      if (entry.ci && entry.ci.state === 'PASS' && isEligibleForMerge(entry, published, o)) {
        log.merges = log.merges || [];
        const mergeResult = await governedMerge({
          workItemId: entry.workItemId,
          repoCwd: o.repoCwd || o.cwd,
          decisionDir: o.decisionDir || (logOpts && logOpts.dir),
          config: o.mergeConfig || o.config,
          configPath: o.mergeConfigPath || o.configPath,
          ghClient: o.ghClient,
          graphqlInvoker: o.graphqlInvoker,
          ghRunner: o.ghRunner,
        });
        log.merges.push(mergeResult);
        entry.merge = mergeResult;
      }
    }
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
    else if (
      status === ItemStatus.BLOCKED ||
      status === ItemStatus.BLOCKED_NO_ROUTE ||
      status === ItemStatus.REFUSED
    )
      blocked.push(item.id);
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
  } else if (blocked.length > 0) {
    log.status = RunStatus.BLOCKED;
  } else if (
    publications.some((p) => p.status === PublicationStatus.PUBLISHED_DRAFT) ||
    (log.publication && log.publication.status === PublicationStatus.PUBLISHED_DRAFT)
  ) {
    log.status = RunStatus.PUBLISHED_DRAFT;
  } else if (blocked.length > 0) {
    const hasBlockedNoRoute = (log.outcomes || []).some(
      (o) => o.status === ItemStatus.BLOCKED_NO_ROUTE || o.reasonCode === 'BLOCKED_NO_ROUTE'
    );
    log.status = hasBlockedNoRoute ? RunStatus.BLOCKED_NO_ROUTE : RunStatus.BLOCKED;
  } else {
    log.status = RunStatus.COMPLETED;
  }

  const prior = ctx.checkpointOnDisk || {};
  const ciBlocked = new Set(
    log.outcomes
      .filter(
        (entry) => entry.reasonCode === 'CI_GATE_FAILED' || entry.reasonCode === 'CI_GATE_DISABLED'
      )
      .map((entry) => entry.workItemId)
  );
  const allCompleted = unique((prior.completed || []).concat(completed)).filter(
    (id) => !ciBlocked.has(id)
  );
  const checkpointReviews = buildCheckpointReviews(log, prior, allCompleted, ctx.logOpts || {});
  const next = Object.assign({}, prior, {
    schemaVersion: 1,
    step: log.status === RunStatus.PUBLISHED_DRAFT ? 'live_published' : 'live_review',
    updatedAt: new Date(ctx.now).toISOString(),
    workItemIds: log.plan.workItems.map((i) => i.id),
    completed: allCompleted,
    blocked,
    deferred,
    outcomes: log.outcomes.map((entry) => ({
      ...decisions.scrub(entry),
      reason: entry.reason ? decisions.scrubText(entry.reason) : entry.reason,
    })),
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
  PROBE_BUDGET_MS,
  routeProbeCandidate,
  baseGateCache,
  runHostBrainGate,
  runOrchestration,
  runVerificationCommand,
  runFormatGateForTest,
  repairSpec,
  resolveLauncher,
  resolveIsolatedWorkerRoot,
  headShaOf,
  verifyCommitSha,
  measureFailBefore,
  isTreeDirty,
  getTreeStatus,
  verifyWorkerCommit,
  writeUsageReportFromHarnessResult,
  materialiseExercise,
  captureFailBefore,
  buildTaskProfile,
  rtkPolicyForItem,
  buildCandidates,
  selectCandidateForProfile,
  verifyReceiptReviewerSeparation,
  repairRound,
  reviewLane,
  reviewItem,
  draftTitleForItem,
  normalizeReviewForCheckpoint,
  extractCheckpointReview,
  verifyReceiptIntegrity,
  attachReceiptIntegrity,
  provisionReviewRoot,
  publishCwdForReceipt,
  resolvePublishCwd,
  ItemStatus,
  RunStatus,
  PublicationStatus,
  effectiveCooldownMs: evidence.effectiveCooldownMs,
  buildDefaults,
  formatHostGateDiagnostics,
};
