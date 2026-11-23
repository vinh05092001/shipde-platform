'use strict';

const fs = require('fs');
const path = require('path');
const planner = require('../planner');
const { compilePrompt } = require('../prompt-compiler');
const { classifySession, Status: SessionStatus } = require('../supervisor');
const routing = require('../failure-domain');
const evidence = require('../evidence');
const { candidateKey } = require('../candidates');
const decisions = require('../decisions');
const { classifyFailure, Cause, Scope, isReplayable } = require('../failure-classifier');
const {
  failureMessageOf,
  failedDecisionDetail,
  markIsolationVerdictStop,
} = require('./decisions-log');
const { resolveLaunchRoute } = require('./route-probe');
const { exhaustedAccountKey, SHA_40, roleOf } = require('./shared');
const { normalizeAccount } = require('./checkpoint');
const {
  harnessFor,
  recordWriterResult,
  headShaOf,
  resolveIsolatedWorkerRoot,
  isTreeDirty,
  prepareUsageReport,
  writeUsageReportFromHarnessResult,
} = require('./writer-loop');
const {
  recordLaunchFailureEvidence,
  resolveDomainAttempts,
  resolveEvidenceDir,
  selectCandidateForProfile,
} = require('./candidate-select');
const { repairSpec } = require('./review-lane');

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
    const isolatedWorkerRoot = resolveIsolatedWorkerRoot(o, hostWorktree);
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
    if (!planned) return { sha, repairNotAttempted: 'NO_REPAIR_PLAN' };

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
      return { sha, repairNotAttempted: 'NO_REPAIR_CANDIDATE' };
    }
    const candidate = candidates.find((c) => candidateKey(c) === decision.chosen);
    triedKeySet.add(decision.chosen);
    if (options.triedKeys && options.triedKeys.add) options.triedKeys.add(decision.chosen);
    if (item && item.triedKeys && item.triedKeys.add) item.triedKeys.add(decision.chosen);
    const candDomain = routing.canonicalFailureDomain(candidate);
    domainAttemptsMap.set(candDomain, (domainAttemptsMap.get(candDomain) || 0) + 1);
    const route = resolveLaunchRoute(candidate, o, registry);
    if (!route) return { sha, repairNotAttempted: 'NO_REPAIR_ROUTE' };
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
      // TASK-AI-188: the launcher adopts a dirty retained root only when a
      // writer record of this run owns it, so the repair job names its run.
      runId: (logOpts && logOpts.runId) || o.runId || null,
      allowedPaths: Array.isArray(item && item.allowedPaths)
        ? require('../writer-scope').effectiveWriterScope(item)
        : null,
      contextWindow: candidate && candidate.contextWindow ? candidate.contextWindow : null,
      maxOutputTokens: candidate && candidate.maxOutputTokens ? candidate.maxOutputTokens : null,
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
    try {
      writeUsageReportFromHarnessResult(repairJob, res);
    } finally {
      recordWriterResult(repairJob, res, 'review-repair', logOpts, o.env);
    }
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
        if (
          classification.scope === 'account' ||
          classification.cause === 'account_quota_exhausted' ||
          classification.cause === 'QUOTA_EXHAUSTED' ||
          classification.cause === 'account_exhausted'
        ) {
          const accMark = exhaustedAccountKey(candidate);
          if (accMark) {
            failedKeySet.add(accMark);
            if (item && item.failedKeys instanceof Set) item.failedKeys.add(accMark);
          }
        }
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
      return { sha, repairNotAttempted: 'REPAIR_LAUNCH_FAILED' };
    }

    const adapter = harnessFor({ harness: repairJob.harness });
    const handle = adapter
      ? require('../executor').readSessionId(adapter, repairJob, res).id
      : null;
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

module.exports = {
  repairRound,
};
