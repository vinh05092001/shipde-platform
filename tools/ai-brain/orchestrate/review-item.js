'use strict';

const fs = require('fs');
const path = require('path');
const { runReviewLoop, Status: ReviewStatus } = require('../review-loop');
const ciGate = require('../ci-gate');
const ranking = require('../ranking');
const routing = require('../routing');
const evidence = require('../evidence');
const { candidateKey } = require('../candidates');
const { parseCandidateKey } = require('../discovery/identity');
const decisions = require('../decisions');
const { classifyFailure, Cause, Scope } = require('../failure-classifier');
const { failedDecisionDetail, markIsolationVerdictStop } = require('./decisions-log');
const { FormatGate, ToolGate, runToolGates, runFormatGate } = require('./gates');
const { draftTitleForItem, publishCwdForReceipt } = require('./publication');
const { compactTestEvidence, normalizeAccount, explicitQualityFloor } = require('./checkpoint');
const { runVerificationCommand, headShaOf, resolveIsolatedWorkerRoot } = require('./writer-loop');
const {
  recordLaunchFailureEvidence,
  resolveDomainAttempts,
  resolveEvidenceDir,
  selectCandidateForProfile,
} = require('./candidate-select');
const {
  reviewLane,
  formatFindingDetail,
  repairSpec,
  isComboReviewerKey,
} = require('./review-lane');
const { repairRound } = require('./repair-round');
const {
  exhaustedAccountKey,
  ItemStatus,
  DEFAULT_REVIEW_BUDGET,
  SHA_40,
  ACCEPTED_VERDICTS,
  roleOf,
} = require('./shared');

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

  const { buildManifest, validateManifest } = require('../review-manifest');
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
  // One run registry for the whole review: selection and reviewLane read
  // o.registry, so a registry passed positionally is carried on o (#605, F5).
  if (registry && o && !o.registry) o = Object.assign({}, o, { registry });
  // The single configured combo is its own failover domain: the writer and the
  // first reviewer launch already spend its two domain attempts, so the review
  // of a repaired SHA must not be refused on the domain cap (#605, F4). Real
  // failures still refuse it through failedKeySet / reviewerTriedKeySet.
  const isRunCombo = (key, launched) =>
    isComboReviewerKey(key, candidates, registry || (o && o.registry), launched);
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
  const isolatedWorkerRoot = resolveIsolatedWorkerRoot(o, hostWorktree);
  const workerRoot =
    (o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot) || session.worktree || null;
  // TASK-AI-117 (RS-R01): the review reads the commit the launch recorded —
  // the checkpoint's exact workerSha — and only falls back to the worktree head
  // when no such commit was ever recorded.
  const observedWorkerHead = workerRoot && headShaOf(workerRoot);
  const workerHead =
    (session && session.headSha) ||
    (observedWorkerHead && SHA_40.test(observedWorkerHead) ? observedWorkerHead : null) ||
    null;
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
      session,
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
  const reviewerQualityFloor = explicitQualityFloor(item);
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
    (isRunCombo(configuredReviewerKey) ||
      (!excludedDomainSet.has(configuredReviewerDomain) &&
        (domainAttemptsMap.get(configuredReviewerDomain) || 0) < 2))
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
      harness: cand.harness,
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
      if (
        classification.scope === 'account' ||
        classification.cause === 'account_quota_exhausted' ||
        classification.cause === 'QUOTA_EXHAUSTED' ||
        classification.cause === 'account_exhausted'
      ) {
        const accMark = exhaustedAccountKey(cand);
        if (accMark) {
          failedKeySet.add(accMark);
          if (item && item.failedKeys instanceof Set) item.failedKeys.add(accMark);
          else if (item && Array.isArray(item.failedKeys) && !item.failedKeys.includes(accMark))
            item.failedKeys.push(accMark);
          if (session && session.failedKeys instanceof Set) session.failedKeys.add(accMark);
          if (options && options.failedKeys instanceof Set) options.failedKeys.add(accMark);
          else if (
            options &&
            Array.isArray(options.failedKeys) &&
            !options.failedKeys.includes(accMark)
          )
            options.failedKeys.push(accMark);
        }
      }
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
      : () => {
          // A CI failure recorded for exactly this head SHA is fed to the repair
          // loop before anything else: green local checks do not override red CI.
          const ciDir = (logOpts && logOpts.dir) || o.decisionDir;
          const head = workerRoot ? headShaOf(workerRoot) : null;
          const ciFindings = head ? ciGate.ciFindingsFor(ciDir, item.id, head) : [];
          if (ciFindings.length) {
            return { pass: false, cause: 'CI_FAILED', findings: ciFindings, detail: 'CI_FAILED' };
          }
          return runVerificationCommand(
            item,
            Object.assign({}, o, { workerRoot, baseSha: session.baseSha || o.baseSha })
          );
        };
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
          (!isRunCombo(activeReviewerKey) &&
            (excludedDomainSet.has(activeReviewerDomain) ||
              (domainAttemptsMap.get(activeReviewerDomain) || 0) >= 2))
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
              if (attempts >= 2 && !isRunCombo(activeReviewerKey, candidate)) {
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
    const { resolveCommit } = require('../review-manifest');
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
      const { resolveCommit } = require('../review-manifest');
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
module.exports = {
  writeReviewManifestAndArtifact,
  reviewItem,
};
