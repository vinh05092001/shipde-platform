'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const routing = require('../failure-domain');
const decisions = require('../decisions');
const { parseCandidateKey } = require('../discovery/identity');
const { Status: ReviewStatus } = require('../review-loop');
const { hasCommit } = require('../passed-commit');
const { draftTitleForItem, resolvePublishCwd, publishCwdForReceipt } = require('./publication');
const { runHardenedGit } = require('./hardened-git');
const { PublicationStatus, SHA_40, ACCEPTED_VERDICTS } = require('./shared');

function receiptCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

/**
 * Extracts and normalizes the recorded review result for one work item from a checkpoint.
 * Supports checkpoint.reviews as array or object, as well as completedReviews/reviewResults.
 */
function extractCheckpointReview(checkpoint, workItemId, logOpts) {
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
  if (!raw && checkpoint.liveSteps && checkpoint.liveSteps[workItemId]) {
    const liveStep = checkpoint.liveSteps[workItemId];
    if (liveStep && liveStep.review) {
      if (liveStep.review.receipt) {
        raw = liveStep.review.receipt;
      } else if (liveStep.review.entry && logOpts) {
        raw = normalizeReviewForCheckpoint(liveStep.review.entry, workItemId, logOpts);
      } else if (liveStep.review.entry) {
        raw = liveStep.review.entry;
      }
    }
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
    // Verbatim: the integrity digest covers the stored title, and a title cut at
    // the 72-character limit can end in a space. Trimming here made the digest
    // of an untampered receipt differ from the one written with it.
    draftTitle: typeof draftTitle === 'string' ? draftTitle : null,
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
    ...(result && Array.isArray(result.deferredToCi) && result.deferredToCi.length
      ? { deferredToCi: result.deferredToCi }
      : {}),
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

function verifyReceiptCommit(rec, publishCwd, resume) {
  // The publish cwd is rebuilt from the receipt, so it has to be present and it
  // has to be a directory the publisher may run from: an isolated run's worker
  // root sits inside the worker boundary and `publisher.js` refuses it. The
  // worker root stays where the commit is verified — that is its own role.
  if (!rec || !rec.publishCwd) return 'PUBLISH_REFUSED: receipt missing publish cwd';
  const { isWorkerPath } = require('../isolation-launcher');
  if (isWorkerPath(rec.publishCwd)) {
    return (
      'PUBLISH_REFUSED: receipt publish cwd is inside the worker root (' +
      String(rec.publishCwd) +
      '); the publisher runs operator-side only'
    );
  }
  let workerRoot = rec && rec.workerRoot;
  if (!workerRoot) return 'PUBLISH_REFUSED: receipt missing workerRoot';
  if (!fs.existsSync(workerRoot) || !fs.existsSync(path.join(workerRoot, '.git'))) {
    // A completed worker may have been retired after its reviewed commit was
    // imported. Trust only the exact namespaced ref in the explicit host repo,
    // then perform the same commit and ancestry checks there.
    const expectedRef = 'refs/shipde/passed/' + rec.workItemId + '/' + rec.sha;
    if (!resume || !resume.hostCwd || resume.passedRef !== expectedRef) {
      return 'PUBLISH_REFUSED: receipt workerRoot is not a git repository: ' + String(workerRoot);
    }
    const imported = runHardenedGit(resume.hostCwd, ['rev-parse', expectedRef + '^{commit}']);
    if (!imported || imported.status !== 0 || String(imported.stdout).trim() !== rec.sha) {
      return 'PUBLISH_REFUSED: recorded passed ref does not confirm reviewed commit';
    }
    workerRoot = resume.hostCwd;
  }
  if (!publishCwd) return 'PUBLISH_REFUSED: missing publish cwd for receipt check';
  if (path.resolve(publishCwd) !== path.resolve(rec.publishCwd)) {
    return 'PUBLISH_REFUSED: receipt publish cwd does not match publish cwd';
  }
  const { withCleanGitEnv, safeGit } = require('../supervisor');
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
    // reviewLane accepts reviewer == writer only for the single configured combo
    // (operator decision 2026-11-19); the receipt carries the same exception so
    // a completed combo review is not refused on publish or resume (#605, F3).
    const comboApi = require('../combo');
    if (rec.writerCandidateKey === rec.reviewer && comboApi.isComboIdentity(rec.reviewer)) {
      return null;
    }
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

function validateCheckpointReceipt(rec, item, o, resume) {
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
    verifyReceiptCommit(rec, resolvePublishCwd(o, rec), resume) ||
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
  const priorReviewIds = new Set(
    prior && Array.isArray(prior.reviews)
      ? prior.reviews.map((r) => r && (r.workItemId || r.id)).filter(Boolean)
      : []
  );
  const publishedIds = new Set(
    (log && Array.isArray(log.publications) ? log.publications : [])
      .filter((p) => p && p.status === PublicationStatus.PUBLISHED_DRAFT)
      .map((p) => p.workItemId)
      .filter(Boolean)
  );
  const result = [];
  for (const [id, rec] of map.entries()) {
    if (completedSet.has(id) || priorReviewIds.has(id) || publishedIds.has(id)) {
      result.push(rec);
    }
  }
  return result;
}

function explicitQualityFloor(item) {
  const value = item && item.qualityFloor;
  if (value === undefined || value === null) return null;
  const numericInput =
    typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  return numericInput && Number.isFinite(Number(value)) ? Number(value) : value;
}

module.exports = {
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
};
