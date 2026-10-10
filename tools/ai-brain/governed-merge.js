'use strict';

/**
 * Ship Dễ — TASK-AI-133: Governed merge
 *
 * Implements governed exact-HEAD auto-merge without supervisor intervention
 * when an independent review manifest passes, CI checks succeed on the exact
 * commit, and zero open P0/P1 findings or unresolved threads remain.
 *
 *   GM-R01 Governed merge gates: exact-SHA validated review manifest (PASS,
 *          reviewer in different failure domain from writers), zero open P0/P1
 *          findings, all required checks SUCCESS on exact OID, zero unresolved
 *          threads, not draft, title carrying exactly the Work Item ID, not on
 *          never-merge list. Squash mutation with expectedHeadOid.
 *   GM-R02 Byte-identical merge commit of origin/main allowed; non-identical
 *          refuses with DELTA_REVIEW_REQUIRED.
 *   GM-R03 Fail-closed with named refusal code written to decision log; never
 *          retry in a loop.
 *   GM-R04 Standing authorization OPERATOR-STANDING-AUTHORIZATION-2026-10-04.
 *   GM-R05 Next-item loop calls merge after publish when eligible.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

const reviewManifest = require('./review-manifest');
const publisher = require('./publisher');
const decisions = require('./decisions');

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'data', 'merge-config.json');
const DEFAULT_DECISION_DIR = path.join(os.homedir(), '.shipde', 'decisions');
const SHA_40 = /^[0-9a-f]{40}$/i;

const RefusalCode = Object.freeze({
  CONFIG_INVALID: 'CONFIG_INVALID',
  NEVER_MERGE: 'NEVER_MERGE',
  MANIFEST_MISSING: 'MANIFEST_MISSING',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  VERDICT_NOT_PASS: 'VERDICT_NOT_PASS',
  OPEN_FINDINGS: 'OPEN_FINDINGS',
  REVIEWER_NOT_INDEPENDENT: 'REVIEWER_NOT_INDEPENDENT',
  REVIEWER_NOT_RECORDED: 'REVIEWER_NOT_RECORDED',
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  DRAFT: 'DRAFT',
  WORK_ITEM_MISMATCH: 'WORK_ITEM_MISMATCH',
  HEAD_MISMATCH: 'HEAD_MISMATCH',
  DELTA_REVIEW_REQUIRED: 'DELTA_REVIEW_REQUIRED',
  CHECK_NOT_SUCCESS: 'CHECK_NOT_SUCCESS',
  THREADS_UNRESOLVED: 'THREADS_UNRESOLVED',
  MERGE_FAILED: 'MERGE_FAILED',
});

function gitOut(repoCwd, args, input) {
  const res = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
    cwd: repoCwd,
    encoding: 'utf8',
    input,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

function isGitAncestor(commitSha, ref, gitCwd) {
  try {
    const res = gitOut(gitCwd, ['merge-base', '--is-ancestor', commitSha, ref]);
    return res.ok;
  } catch {
    return false;
  }
}

function loadMergeConfig(options) {
  const o = options || {};
  if (o.config && typeof o.config === 'object' && !Array.isArray(o.config)) {
    if (!Array.isArray(o.config.neverMerge) && !Array.isArray(o.config.never_merge)) {
      return { ok: false, reason: 'config missing neverMerge array', neverMerge: null };
    }
    if (!Array.isArray(o.config.requiredChecks) && !Array.isArray(o.config.required_checks)) {
      return { ok: false, reason: 'config missing requiredChecks array', neverMerge: null };
    }
    return Object.assign({}, o.config, { ok: true, config: o.config });
  }
  const configPath = o.configPath || DEFAULT_CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    return { ok: false, reason: `config file missing: ${configPath}`, neverMerge: null };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'config is not a valid JSON object', neverMerge: null };
    }
    if (!Array.isArray(parsed.neverMerge) && !Array.isArray(parsed.never_merge)) {
      return { ok: false, reason: 'config missing neverMerge array', neverMerge: null };
    }
    if (!Array.isArray(parsed.requiredChecks) && !Array.isArray(parsed.required_checks)) {
      return { ok: false, reason: 'config missing requiredChecks array', neverMerge: null };
    }
    return Object.assign({}, parsed, { ok: true, config: parsed });
  } catch (err) {
    return { ok: false, reason: `cannot read config: ${err.message}`, neverMerge: null };
  }
}

function findReviewManifest(workItemId, repoCwd, decisionDir, options) {
  const o = options || {};
  if (o.manifest && typeof o.manifest === 'object') {
    return { manifest: o.manifest, manifestPath: o.manifestPath || null };
  }

  const candidatePaths = [
    o.manifestPath,
    decisionDir && path.join(decisionDir, `review-manifest-${workItemId}.json`),
    repoCwd &&
      path.join(repoCwd, 'tools', 'ai-brain', 'data', `review-manifest-${workItemId}.json`),
    repoCwd && path.join(repoCwd, '.shipde', 'decisions', `review-manifest-${workItemId}.json`),
    repoCwd && path.join(repoCwd, `review-manifest-${workItemId}.json`),
    decisionDir && path.join(decisionDir, 'review-manifest.json'),
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
        const manifest = JSON.parse(raw);
        return { manifest, manifestPath: p };
      } catch {
        // Continue searching
      }
    }
  }
  return null;
}

function findReviewArtifact(workItemId, manifestPath, repoCwd, decisionDir, options) {
  const o = options || {};
  if (o.artifactPath && fs.existsSync(o.artifactPath)) {
    return o.artifactPath;
  }

  const candidatePaths = [
    manifestPath && path.join(path.dirname(manifestPath), `review-artifact-${workItemId}.md`),
    manifestPath && path.join(path.dirname(manifestPath), 'review-artifact.md'),
    decisionDir && path.join(decisionDir, `review-artifact-${workItemId}.md`),
    repoCwd && path.join(repoCwd, 'tools', 'ai-brain', 'data', `review-artifact-${workItemId}.md`),
    decisionDir && path.join(decisionDir, 'review-artifact.md'),
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/** Check for binary or mode changes in diff text. */
function hasBinaryOrModeChanges(diffText) {
  if (typeof diffText !== 'string' || !diffText.trim()) return false;
  if (/^Binary files .* differ/m.test(diffText)) return true;
  if (/^GIT binary patch/m.test(diffText)) return true;
  if (/^old mode \d+/m.test(diffText)) return true;
  if (/^new mode \d+/m.test(diffText)) return true;
  if (/^mode change /m.test(diffText)) return true;
  return false;
}

/** Extract file headers and added/removed change lines (+ / -), excluding diff metadata, @@ hunk headers and context lines. */
function extractChangeLines(diffText) {
  if (typeof diffText !== 'string' || !diffText.trim()) return '';
  return diffText
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith('diff --git ') ||
        line.startsWith('old mode ') ||
        line.startsWith('new mode ') ||
        line.startsWith('new file mode ') ||
        line.startsWith('deleted file mode ') ||
        line.startsWith('mode change ') ||
        (line.startsWith('+') && !line.startsWith('+++')) ||
        (line.startsWith('-') && !line.startsWith('---'))
    )
    .join('\n')
    .trim();
}

/** Normalize diff text, stripping volatile git index headers while preserving files, modes, binary markers, and all change lines. */
function normalizeDiff(diffText) {
  if (typeof diffText !== 'string' || !diffText.trim()) return '';
  return diffText
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('index '))
    .join('\n')
    .trim();
}

/**
 * GM-R02: when a merge commit of origin/main is needed (branch behind), it is
 * allowed only if the changes against main are byte-identical to the reviewed
 * SHA's changes against its independently derived base. Otherwise DELTA_REVIEW_REQUIRED.
 */
function checkByteIdenticalMerge(repoCwd, headSha, reviewedSha, manifestReviewedBase) {
  const revList = gitOut(repoCwd, ['rev-list', '--parents', '-n', '1', headSha]);
  if (!revList.ok || !revList.stdout) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }
  const parts = revList.stdout.split(/\s+/).filter(Boolean);
  // A merge commit must have at least 2 parents (parts[0] is headSha, parts[1..] are parents)
  if (parts.length < 3) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }

  const p1 = parts[1];
  const p2 = parts[2];

  let pBranch = null;
  let pMain = null;

  if (p1.toLowerCase() === reviewedSha.toLowerCase() || isGitAncestor(reviewedSha, p1, repoCwd)) {
    pBranch = p1;
    pMain = p2;
  } else if (
    p2.toLowerCase() === reviewedSha.toLowerCase() ||
    isGitAncestor(reviewedSha, p2, repoCwd)
  ) {
    pBranch = p2;
    pMain = p1;
  } else {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }

  // Derive base independently: merge-base between main parent and reviewedSha
  const mbResult = gitOut(repoCwd, ['merge-base', pMain, reviewedSha]);
  if (!mbResult.ok || !mbResult.stdout) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }
  const derivedBase = mbResult.stdout.trim().toLowerCase();

  // If manifest claimed a reviewedBase, it must match derivedBase
  if (manifestReviewedBase && manifestReviewedBase.trim().toLowerCase() !== derivedBase) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }

  const effectiveBase = derivedBase;

  // 1. Reviewed SHA against independently derived base
  const diffReviewed = gitOut(repoCwd, ['diff', '--binary', `${effectiveBase}..${reviewedSha}`]);
  if (!diffReviewed.ok) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }

  // 2. Head merge commit against main parent
  const diffMerge = gitOut(repoCwd, ['diff', '--binary', `${pMain}..${headSha}`]);
  if (!diffMerge.ok) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }

  // P1: Refuse binary or mode changes on the merge-from-main path
  if (hasBinaryOrModeChanges(diffReviewed.stdout) || hasBinaryOrModeChanges(diffMerge.stdout)) {
    return {
      ok: false,
      reason: RefusalCode.DELTA_REVIEW_REQUIRED,
      detail: 'binary or mode changes are not allowed on the merge-from-main path',
    };
  }

  const changeLinesReviewed = extractChangeLines(diffReviewed.stdout);
  const changeLinesMerge = extractChangeLines(diffMerge.stdout);

  if (!changeLinesReviewed || !changeLinesMerge) {
    return { ok: false, reason: RefusalCode.DELTA_REVIEW_REQUIRED };
  }

  if (changeLinesReviewed === changeLinesMerge) {
    return { ok: true, isMergeFromMain: true, headSha };
  }

  return { ok: false, reason: RefusalCode.DELTA_REVIEW_REQUIRED };
}

function parseGhJson(output) {
  try {
    return JSON.parse(output || '{}');
  } catch {
    return null;
  }
}

function runGh(args, cwd, ghRunner, input) {
  if (typeof ghRunner === 'function') {
    return ghRunner(args, cwd, input);
  }
  const res = cp.spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
    input,
    windowsHide: true,
  });
  return {
    exitCode: res.status === null ? -1 : res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

/** Check if the PR title carries exactly the Work Item ID. */
function validatePrTitle(title, workItemId) {
  if (typeof title !== 'string' || !title.trim()) return false;
  const targetId = String(workItemId).trim().toUpperCase();

  // Extract all Work Item IDs in bracket format: e.g. [TASK-AI-133], [FEAT-AUTH-01]
  const matches = [...title.matchAll(/\[([A-Za-z0-9-]+)\]/g)].map((m) => m[1].toUpperCase());
  if (matches.length !== 1 || matches[0] !== targetId) {
    return false;
  }
  return true;
}

/** Check whether check status/conclusion is SUCCESS. */
function isCheckSuccess(chk) {
  if (!chk || typeof chk !== 'object') return false;
  const conclusion = String(chk.conclusion || '')
    .trim()
    .toUpperCase();
  const state = String(chk.state || '')
    .trim()
    .toUpperCase();
  const status = String(chk.status || '')
    .trim()
    .toUpperCase();

  if (conclusion === 'SUCCESS' || state === 'SUCCESS') return true;
  if (status === 'COMPLETED' && conclusion === 'SUCCESS') return true;
  return false;
}

/** Check reviewer independence across candidate keys and failure domains. */
function verifyReviewerIndependence(manifest, writersList) {
  const reviewerKey = String(manifest.reviewerCandidateKey || '').trim();
  if (!reviewerKey) {
    return { ok: false, reason: 'manifest missing reviewerCandidateKey' };
  }
  const reviewerDomain =
    manifest.reviewerFailureDomain || publisher.failureDomainFromCandidateKey(reviewerKey);

  const writers = Array.isArray(writersList) ? writersList.slice() : [];
  if (manifest.writerCandidateKey) {
    writers.push(String(manifest.writerCandidateKey).trim());
  }

  for (const writerKey of writers) {
    if (!writerKey) continue;
    if (reviewerKey.toLowerCase() === writerKey.toLowerCase()) {
      return { ok: false, reason: `reviewer key equals writer key (${writerKey})` };
    }
    const writerDomain = publisher.failureDomainFromCandidateKey(writerKey);
    if (
      reviewerDomain &&
      writerDomain &&
      reviewerDomain.toLowerCase() === writerDomain.toLowerCase()
    ) {
      return { ok: false, reason: `reviewer shares writer failure domain (${writerDomain})` };
    }
    const rParts = reviewManifest.candidateKeyParts(reviewerKey);
    const wParts = reviewManifest.candidateKeyParts(writerKey);
    if (rParts && wParts) {
      if (rParts[3].toLowerCase() === wParts[3].toLowerCase()) {
        return { ok: false, reason: `reviewer shares writer upstream segment (${rParts[3]})` };
      }
      if (rParts[6].toLowerCase() === wParts[6].toLowerCase()) {
        return { ok: false, reason: `reviewer shares writer modelId (${rParts[6]})` };
      }
    }
  }

  if (
    manifest.writerFailureDomain &&
    manifest.reviewerFailureDomain &&
    manifest.writerFailureDomain.trim().toLowerCase() ===
      manifest.reviewerFailureDomain.trim().toLowerCase()
  ) {
    return { ok: false, reason: 'reviewer declares writer failure domain' };
  }

  return { ok: true };
}

function isOpenFinding(f) {
  if (!f || typeof f !== 'object') return false;
  const status = String(f.status || '')
    .trim()
    .toLowerCase();
  const openVal = f.open;
  const resolvedVal = f.resolved !== undefined ? f.resolved : f.isResolved;

  if (['open', 'unresolved', 'active', 'pending'].includes(status)) {
    return true;
  }
  if (openVal === true || String(openVal).trim().toLowerCase() === 'true') {
    return true;
  }
  if (resolvedVal === false || String(resolvedVal).trim().toLowerCase() === 'false') {
    return true;
  }
  if (status === 'closed' || status === 'resolved' || status === 'fixed') {
    return false;
  }
  return false;
}

function isP0P1Severity(f) {
  if (!f || typeof f !== 'object') return false;
  const sev = String(f.severity || f.level || f.Severity || '')
    .trim()
    .toLowerCase();
  return /^(p?[01]|p[-_]?[01])$/.test(sev);
}

/** Check for open P0/P1 findings in the manifest (robust). */
function hasOpenP0P1Findings(findings) {
  if (!Array.isArray(findings)) return false;
  return findings.some((f) => isOpenFinding(f) && isP0P1Severity(f));
}

function getWritersFromDecisionLog(workItemId, decisionDir) {
  const normId = String(workItemId).trim().toUpperCase();
  const detail = decisions.readDecisionsDetailed({ dir: decisionDir });
  if (!detail.readable) {
    const err = new Error('decision log unreadable: ' + (detail.damaged || []).join('; '));
    err.code = 'DECISION_LOG_UNREADABLE';
    throw err;
  }
  const writers = new Set();
  for (const r of detail.records) {
    if (!r || !r.workItemId) continue;
    if (String(r.workItemId).trim().toUpperCase() !== normId) continue;
    if (
      r.role === 'reviewer' ||
      r.stage === 'reviewer-selection' ||
      r.stage === 'review' ||
      r.stage === 'refused'
    ) {
      continue;
    }
    const cand =
      r.chosen || r.chosenKey || r.writerCandidateKey || r.candidateKey || r.offeringId || r.writer;
    if (cand && typeof cand === 'string' && cand.trim()) {
      writers.add(cand.trim());
    }
  }
  return Array.from(writers);
}

function getControllerSigningKeyPath(options) {
  const o = options || {};
  if (o.signingKeyPath && typeof o.signingKeyPath === 'string' && o.signingKeyPath.trim()) {
    return o.signingKeyPath.trim();
  }
  if (o.keyPath && typeof o.keyPath === 'string' && o.keyPath.trim()) {
    return o.keyPath.trim();
  }
  if (process.env.CONTROLLER_SIGNING_KEY_PATH && process.env.CONTROLLER_SIGNING_KEY_PATH.trim()) {
    return process.env.CONTROLLER_SIGNING_KEY_PATH.trim();
  }
  if (process.env.SHIPDE_SIGNING_KEY_PATH && process.env.SHIPDE_SIGNING_KEY_PATH.trim()) {
    return process.env.SHIPDE_SIGNING_KEY_PATH.trim();
  }
  if (
    o.decisionDir &&
    typeof o.decisionDir === 'string' &&
    fs.existsSync(path.join(o.decisionDir, 'controller-signing.key'))
  ) {
    return path.join(o.decisionDir, 'controller-signing.key');
  }
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share'));
  return path.join(localAppData, 'ShipDe', 'controller-signing.key');
}

function getSigningKey(options) {
  const keyPath = getControllerSigningKeyPath(options);
  if (!fs.existsSync(keyPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(keyPath);
    if (!raw || raw.length === 0) return null;
    return raw;
  } catch {
    return null;
  }
}

function getOrCreateSigningKey(options) {
  const keyPath = getControllerSigningKeyPath(options);
  if (!fs.existsSync(keyPath)) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key);
    return key;
  }
  try {
    const raw = fs.readFileSync(keyPath);
    if (!raw || raw.length === 0) {
      const key = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, key);
      return key;
    }
    return raw;
  } catch {
    return null;
  }
}

function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function canonicalReviewLaunchPayload({ workItemId, sha, reviewerKey, sessionId, stage, at }) {
  return JSON.stringify({
    workItemId: String(workItemId || ''),
    sha: String(sha || '').toLowerCase(),
    reviewerKey: String(reviewerKey || ''),
    sessionId: String(sessionId || ''),
    stage: String(stage || ''),
    at: String(at || ''),
  });
}

function signReviewLaunchPayload(payload, key) {
  if (!key) throw new Error('signing key required');
  const canonical = canonicalReviewLaunchPayload(payload);
  return crypto.createHmac('sha256', key).update(canonical).digest('hex');
}

function verifyReviewLaunchSignature(payload, expectedSig, key) {
  if (!expectedSig || typeof expectedSig !== 'string' || !key) return false;
  const canonical = canonicalReviewLaunchPayload(payload);
  const actualSig = crypto.createHmac('sha256', key).update(canonical).digest('hex');
  return timingSafeCompare(actualSig, expectedSig.trim());
}

function verifyRecordSignature(r, key, normId, targetSha) {
  const sig = r.signature || r.sig || r.launchSignature;
  if (!sig || typeof sig !== 'string' || !sig.trim()) {
    return false;
  }
  const revKey = String(
    r.reviewerKey ||
      r.chosen ||
      r.chosenKey ||
      r.reviewerCandidateKey ||
      r.candidateKey ||
      r.reviewer ||
      ''
  ).trim();
  const sha = String(r.reviewedSha || r.sha || r.targetSha || targetSha || '')
    .trim()
    .toLowerCase();
  const sessionId = String(r.sessionId || '').trim();
  const stage = String(r.stage || '').trim();
  const at = String(r.at || '').trim();

  if (!revKey || !sha || !sessionId || !stage || !at) {
    return false;
  }

  const rId = String(r.workItemId || '').trim();
  const rOf = String((r.labels && r.labels.reviewOf) || r.reviewOf || '').trim();
  const candidateIds = new Set(
    [
      normId,
      rId,
      rOf,
      rId.replace(/-review$/i, ''),
      normId.toLowerCase(),
      rId.toLowerCase(),
    ].filter(Boolean)
  );

  for (const candId of candidateIds) {
    const payload = {
      workItemId: candId,
      sha,
      reviewerKey: revKey,
      sessionId,
      stage,
      at,
    };
    if (verifyReviewLaunchSignature(payload, sig.trim(), key)) {
      return true;
    }
  }
  return false;
}

function getReviewersFromDecisionLog(workItemId, reviewedSha, decisionDir, options) {
  const normId = String(workItemId).trim().toUpperCase();
  const targetSha = String(reviewedSha || '')
    .trim()
    .toLowerCase();
  const detail = decisions.readDecisionsDetailed({ dir: decisionDir });
  if (!detail.readable) {
    const err = new Error('decision log unreadable: ' + (detail.damaged || []).join('; '));
    err.code = 'DECISION_LOG_UNREADABLE';
    throw err;
  }
  const key = getSigningKey(Object.assign({}, options, { decisionDir }));
  if (!key) {
    return [];
  }
  const reviewers = new Set();
  for (const r of detail.records) {
    if (!r) continue;
    const rId = r.workItemId ? String(r.workItemId).trim().toUpperCase() : '';
    const rOf = (r.labels && r.labels.reviewOf) || r.reviewOf;
    const normOf = rOf ? String(rOf).trim().toUpperCase() : '';
    const matchesItem = rId === normId || rId === `${normId}-REVIEW` || normOf === normId;
    if (!matchesItem) continue;

    // (b) Only accept a review-launch record written by orchestrate with stage 'review-launch' plus sessionId
    const stage = String(r.stage || '').toLowerCase();
    if (stage !== 'review-launch') continue;

    const sessionId = typeof r.sessionId === 'string' ? r.sessionId.trim() : '';
    if (!sessionId) continue;

    const rSha = String(
      r.reviewedSha || r.sha || r.targetSha || r.headSha || r.commit || r.commitSha || ''
    )
      .trim()
      .toLowerCase();
    const detailText = typeof r.detail === 'string' ? r.detail.toLowerCase() : '';
    const shaMatches =
      (targetSha && rSha === targetSha) || (targetSha && detailText.includes(targetSha));

    if (!shaMatches) continue;

    const cand =
      r.reviewerKey ||
      r.chosen ||
      r.chosenKey ||
      r.reviewerCandidateKey ||
      r.candidateKey ||
      r.offeringId ||
      r.reviewer;
    if (!cand || typeof cand !== 'string' || !cand.trim()) {
      continue;
    }

    if (!verifyRecordSignature(r, key, normId, targetSha)) {
      continue;
    }

    reviewers.add(cand.trim());
  }
  return Array.from(reviewers);
}

function hasReviewProofForSha(
  workItemId,
  reviewedSha,
  manifestPath,
  repoCwd,
  decisionDir,
  options,
  reviewerKey
) {
  const normId = String(workItemId || '')
    .trim()
    .toUpperCase();
  const targetSha = String(reviewedSha || '')
    .trim()
    .toLowerCase();
  const o = options || {};
  const targetReviewer = String(reviewerKey || o.reviewerCandidateKey || o.reviewerKey || '')
    .trim()
    .toLowerCase();
  if (!targetSha || !normId) return false;

  // 1. Review file for that SHA bound to workItemId and reviewer key
  const artifactPath = findReviewArtifact(workItemId, manifestPath, repoCwd, decisionDir, o);
  const potentialReviewFiles = [
    artifactPath,
    o.reviewFile,
    o.artifactPath,
    manifestPath && path.join(path.dirname(manifestPath), `review-artifact-${workItemId}.md`),
    manifestPath && path.join(path.dirname(manifestPath), 'review-artifact.md'),
    decisionDir && path.join(decisionDir, `review-artifact-${workItemId}.md`),
    decisionDir && path.join(decisionDir, 'review-artifact.md'),
    repoCwd && path.join(repoCwd, `review-artifact-${workItemId}.md`),
    repoCwd && path.join(repoCwd, 'docs', 'reviews', `review-${workItemId}.md`),
    repoCwd && path.join(repoCwd, 'docs', 'product-spec', 'work-items', `${workItemId}.md`),
  ].filter(Boolean);

  for (const rf of potentialReviewFiles) {
    if (fs.existsSync(rf)) {
      try {
        const text = fs.readFileSync(rf, 'utf8').toLowerCase();
        if (text.includes(targetSha)) {
          const itemMatches = text.includes(normId.toLowerCase());
          const reviewerMatches = targetReviewer ? text.includes(targetReviewer) : true;
          if (itemMatches && reviewerMatches) {
            return true;
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }

  // Helper to match imported evidence
  function evidenceMatches(ev, combo) {
    const evSha = String(ev.sha || ev.commitSha || ev.reviewedSha || '')
      .trim()
      .toLowerCase();
    if (evSha !== targetSha) return false;

    // Check workItemId binding
    const evWorkItem = String(ev.workItem || ev.workItemId || ev.item || '')
      .trim()
      .toUpperCase();
    if (evWorkItem && evWorkItem !== normId) return false;
    if (!evWorkItem) {
      const detailText = String(ev.detail || ev.summary || '').toUpperCase();
      if (!detailText.includes(normId)) return false;
    }

    // Check reviewer binding
    if (targetReviewer) {
      const evReviewer = String(ev.reviewer || ev.reviewerCandidateKey || ev.candidateKey || '')
        .trim()
        .toLowerCase();
      const comboCandidate = combo
        ? String(combo.candidateKey || combo.reviewerCandidateKey || '')
            .trim()
            .toLowerCase()
        : '';
      const revMatches =
        (evReviewer && evReviewer === targetReviewer) ||
        (comboCandidate && comboCandidate === targetReviewer);
      if (!revMatches) return false;
    }

    return true;
  }

  // 2. Imported review evidence entry for that SHA
  if (o.evidence && typeof o.evidence === 'object') {
    const combos = Array.isArray(o.evidence.combinations) ? o.evidence.combinations : [];
    for (const combo of combos) {
      for (const ev of combo.evidence || []) {
        if (evidenceMatches(ev, combo)) {
          return true;
        }
      }
    }
  }

  const evidenceDirCandidates = [
    o.evidenceDir,
    repoCwd && path.join(repoCwd, 'tools', 'ai-brain', 'data', 'evidence'),
    path.join(__dirname, 'data', 'evidence'),
  ].filter(Boolean);

  for (const ed of evidenceDirCandidates) {
    const evFile = path.join(ed, 'evidence.json');
    if (fs.existsSync(evFile)) {
      try {
        const raw = fs.readFileSync(evFile, 'utf8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        const combos = Array.isArray(data.combinations) ? data.combinations : [];
        for (const combo of combos) {
          for (const ev of combo.evidence || []) {
            if (evidenceMatches(ev, combo)) {
              return true;
            }
          }
        }
      } catch {
        // ignore read/parse errors
      }
    }
  }

  return false;
}

/**
 * Main governed merge entrypoint.
 *
 * @param {object} options
 * @param {string} options.workItemId Work Item ID (e.g. TASK-AI-133)
 * @param {string} [options.repoCwd] Local repository worktree directory
 * @param {string} [options.decisionDir] Decision logs directory
 * @param {object} [options.config] In-memory config with neverMerge array
 * @param {string} [options.configPath] Path to merge-config.json
 * @param {object} [options.manifest] In-memory review manifest
 * @param {string} [options.manifestPath] Path to review-manifest.json
 * @param {string} [options.artifactPath] Path to review-artifact.md
 * @param {object} [options.ghClient] Injected GitHub client for tests
 * @param {function} [options.graphqlInvoker] Injected GraphQL runner
 * @param {function} [options.ghRunner] Injected gh CLI runner
 * @param {string} [options.repo] owner/repo
 * @returns {Promise<object>} { ok: true, status: 'merged', ... } or { ok: false, refusal: '...' }
 */
async function governedMerge(options) {
  const o = options || {};
  const workItemId = String(o.workItemId || '').trim();
  if (!workItemId) {
    throw new Error('governedMerge requires workItemId');
  }

  const repoCwd = o.repoCwd || process.cwd();
  const decisionDir = o.decisionDir || DEFAULT_DECISION_DIR;
  const now = o.now || Date.now();
  const decisionOpts = { dir: decisionDir, now };

  function refuse(refusalCode, reason, extra) {
    const fullReason = reason ? `${refusalCode}: ${reason}` : refusalCode;
    decisions.recordDecision(
      Object.assign(
        {
          stage: decisions.Stage.REFUSED,
          workItemId,
          status: 'refused',
          detail: 'GOVERNED_MERGE_REFUSED',
          reason: fullReason,
          refusalCode,
        },
        extra || {}
      ),
      decisionOpts
    );
    return { ok: false, refusal: refusalCode, reason: fullReason };
  }

  // 1. Config check: never-merge list (live-proof drafts)
  const cfgRes = loadMergeConfig(o);
  if (!cfgRes.ok) {
    return refuse(
      RefusalCode.CONFIG_INVALID,
      `merge config missing or unparsable: failing closed (${cfgRes.reason})`
    );
  }
  const config = cfgRes.config;
  const neverMergeRaw = Array.isArray(config.neverMerge)
    ? config.neverMerge
    : Array.isArray(config.never_merge)
      ? config.never_merge
      : null;

  if (!neverMergeRaw) {
    return refuse(
      RefusalCode.CONFIG_INVALID,
      'merge config missing neverMerge list: failing closed'
    );
  }

  const reqChecksRaw = Array.isArray(config.requiredChecks)
    ? config.requiredChecks
    : Array.isArray(config.required_checks)
      ? config.required_checks
      : null;

  if (!reqChecksRaw) {
    return refuse(
      RefusalCode.CONFIG_INVALID,
      'merge config missing requiredChecks list: failing closed'
    );
  }

  const neverMerge = neverMergeRaw.map((id) => String(id).trim().toUpperCase());
  if (neverMerge.includes(workItemId.toUpperCase())) {
    return refuse(RefusalCode.NEVER_MERGE, 'work item is on the never-merge list');
  }

  // 2. Review manifest check & validation
  const foundManifest = findReviewManifest(workItemId, repoCwd, decisionDir, o);
  if (!foundManifest || !foundManifest.manifest) {
    return refuse(RefusalCode.MANIFEST_MISSING, 'review manifest not found');
  }
  const manifest = foundManifest.manifest;
  const manifestPath = foundManifest.manifestPath;
  const artifactPath = findReviewArtifact(workItemId, manifestPath, repoCwd, decisionDir, o);

  // Validate manifest structure and git tree/patch binding
  const validation = reviewManifest.validateManifest(manifest, {
    repoCwd,
    expected: { workItemId },
    artifactPath,
  });
  if (!validation.ok) {
    // Map validation error code
    if (validation.code === 'REVIEWER_NOT_INDEPENDENT') {
      return refuse(RefusalCode.REVIEWER_NOT_INDEPENDENT, validation.reason);
    }
    if (validation.code === 'PASS_WITH_OPEN_FINDINGS') {
      return refuse(RefusalCode.OPEN_FINDINGS, validation.reason);
    }
    return refuse(validation.code || RefusalCode.SCHEMA_INVALID, validation.reason);
  }

  // Verdict must be PASS
  if (manifest.verdict !== 'PASS') {
    return refuse(
      RefusalCode.VERDICT_NOT_PASS,
      `review manifest verdict is ${manifest.verdict}, expected PASS`
    );
  }

  const reviewedSha = String(manifest.reviewedCommit || '')
    .trim()
    .toLowerCase();

  // Check host signing key fail-closed
  const signingKey = getSigningKey(Object.assign({}, o, { decisionDir }));
  if (!signingKey) {
    return refuse(
      RefusalCode.REVIEWER_NOT_RECORDED,
      'controller signing key is missing or unreadable'
    );
  }

  // Reviewer independence against all writers from decision log, options, and manifest
  let logWriters = [];
  let logReviewers = [];
  try {
    logWriters = getWritersFromDecisionLog(workItemId, decisionDir);
    logReviewers = getReviewersFromDecisionLog(workItemId, reviewedSha, decisionDir, o);
  } catch (err) {
    return refuse(
      RefusalCode.REVIEWER_NOT_INDEPENDENT,
      `cannot determine writers/reviewers from decision log: ${err.message}`
    );
  }

  // (d) Must be matched by an imported review evidence entry or review file for that SHA bound to workItemId and reviewer
  const hasProof = hasReviewProofForSha(
    workItemId,
    reviewedSha,
    manifestPath,
    repoCwd,
    decisionDir,
    o,
    manifest.reviewerCandidateKey
  );
  if (!hasProof) {
    return refuse(
      RefusalCode.REVIEWER_NOT_RECORDED,
      `no review file or imported review evidence entry matches reviewed commit SHA ${reviewedSha} bound to work item ${workItemId} and reviewer ${manifest.reviewerCandidateKey}`
    );
  }

  if (
    !manifest.reviewerCandidateKey ||
    logReviewers.length === 0 ||
    !logReviewers.includes(manifest.reviewerCandidateKey.trim())
  ) {
    return refuse(
      RefusalCode.REVIEWER_NOT_RECORDED,
      `manifest reviewer candidate key was not recorded in the decision log for this work item and commit SHA with a valid signature`
    );
  }

  const allWriters = new Set(logWriters);
  if (Array.isArray(o.writers)) {
    for (const w of o.writers) if (w) allWriters.add(String(w).trim());
  }
  if (o.checkpoint && Array.isArray(o.checkpoint.writers)) {
    for (const w of o.checkpoint.writers) if (w) allWriters.add(String(w).trim());
  }
  if (manifest.writerCandidateKey) {
    allWriters.add(String(manifest.writerCandidateKey).trim());
  }

  const indep = verifyReviewerIndependence(manifest, Array.from(allWriters));
  if (!indep.ok) {
    return refuse(RefusalCode.REVIEWER_NOT_INDEPENDENT, indep.reason);
  }

  // Zero open P0/P1 findings
  if (hasOpenP0P1Findings(manifest.findings)) {
    return refuse(RefusalCode.OPEN_FINDINGS, 'manifest carries open P0 or P1 findings');
  }

  // 3. GitHub PR lookup and preflight checks
  let pr = null;
  if (o.ghClient && typeof o.ghClient.getPullRequest === 'function') {
    pr = await o.ghClient.getPullRequest(workItemId, o);
  } else {
    // Default lookup via gh CLI
    const repoArg = o.repo ? ['--repo', o.repo] : [];
    const searchRes = runGh(
      [
        'pr',
        'list',
        '--search',
        `${workItemId} in:title`,
        '--json',
        'id,number,title,isDraft,headRefOid,statusCheckRollup',
      ].concat(repoArg),
      repoCwd,
      o.ghRunner
    );
    if (searchRes.exitCode === 0 && searchRes.stdout) {
      const list = parseGhJson(searchRes.stdout);
      if (Array.isArray(list) && list.length > 0) {
        pr = list.find((p) => p && validatePrTitle(p.title, workItemId)) || list[0];
      }
    }
  }

  if (!pr) {
    return refuse(RefusalCode.PR_NOT_FOUND, `no Pull Request found for ${workItemId}`);
  }

  // Not a draft (must be explicitly false)
  if (pr.isDraft !== false) {
    return refuse(RefusalCode.DRAFT, 'Pull Request is a draft or draft status is unknown');
  }

  // Title carries exactly that Work Item ID
  if (!validatePrTitle(pr.title, workItemId)) {
    return refuse(
      RefusalCode.WORK_ITEM_MISMATCH,
      `PR title "${pr.title}" does not carry exactly work item ${workItemId}`
    );
  }

  // 4. PR head OID vs reviewed commit / GM-R02 byte-identical merge
  const headSha = String(pr.headRefOid || '')
    .trim()
    .toLowerCase();
  const reviewedBase = String(manifest.reviewedBase || '')
    .trim()
    .toLowerCase();

  let targetHeadOid = headSha;

  if (headSha !== reviewedSha) {
    // Check GM-R02: merge commit of origin/main
    const mergeCheck = checkByteIdenticalMerge(repoCwd, headSha, reviewedSha, reviewedBase);
    if (!mergeCheck.ok) {
      return refuse(
        mergeCheck.reason || RefusalCode.HEAD_MISMATCH,
        `PR head ${headSha} does not match reviewed SHA ${reviewedSha}`
      );
    }
    targetHeadOid = mergeCheck.headSha;
  }

  // 5. GitHub Required Checks: SUCCESS on exact OID
  const requiredChecksList =
    o.requiredChecks || (config && (config.requiredChecks || config.required_checks)) || null;

  let rollup = pr.statusCheckRollup;
  if (o.ghClient && typeof o.ghClient.getStatusChecks === 'function') {
    rollup = await o.ghClient.getStatusChecks(pr.number, targetHeadOid, o);
  }

  if (!Array.isArray(rollup) || rollup.length === 0) {
    return refuse(
      RefusalCode.CHECK_NOT_SUCCESS,
      `no required GitHub checks found for exact OID ${targetHeadOid}`
    );
  }

  // Verify each repository required check is present in rollup if configured
  if (Array.isArray(requiredChecksList) && requiredChecksList.length > 0) {
    for (const reqName of requiredChecksList) {
      const matching = rollup.filter((chk) => {
        const name = String(chk.name || chk.context || '').trim();
        return name.toLowerCase() === String(reqName).trim().toLowerCase();
      });
      if (matching.length === 0) {
        return refuse(
          RefusalCode.CHECK_NOT_SUCCESS,
          `required check "${reqName}" has not reported for exact OID ${targetHeadOid}`
        );
      }
    }
  }

  for (const chk of rollup) {
    if (!isCheckSuccess(chk)) {
      return refuse(
        RefusalCode.CHECK_NOT_SUCCESS,
        `check "${chk.name || chk.context}" conclusion is not SUCCESS`
      );
    }
    // Verify checks are on exact head OID if check names an OID
    const chkHead = chk.headSha || (chk.commit && chk.commit.oid);
    if (chkHead && chkHead.toLowerCase() !== targetHeadOid.toLowerCase()) {
      return refuse(
        RefusalCode.CHECK_NOT_SUCCESS,
        `check "${chk.name || chk.context}" head ${chkHead} does not match exact OID ${targetHeadOid}`
      );
    }
  }

  // 6. Zero unresolved review threads (FAIL-CLOSED)
  let unresolvedThreads = null;
  if (o.ghClient && typeof o.ghClient.getReviewThreads === 'function') {
    try {
      const threadData = await o.ghClient.getReviewThreads(pr.number, o);
      if (threadData === null || threadData === undefined) {
        return refuse(
          RefusalCode.THREADS_UNRESOLVED,
          'cannot read review threads: client returned null'
        );
      }
      if (typeof threadData.unresolvedCount === 'number') {
        if (Number.isNaN(threadData.unresolvedCount) || threadData.unresolvedCount < 0) {
          return refuse(
            RefusalCode.THREADS_UNRESOLVED,
            'cannot read review threads: unresolvedCount is invalid (NaN or negative)'
          );
        }
        unresolvedThreads = threadData.unresolvedCount;
      } else if (Array.isArray(threadData.nodes)) {
        unresolvedThreads = threadData.nodes.filter((n) => n && !n.isResolved).length;
      } else {
        return refuse(
          RefusalCode.THREADS_UNRESOLVED,
          'cannot read review threads: invalid thread data format'
        );
      }
    } catch (err) {
      return refuse(RefusalCode.THREADS_UNRESOLVED, `cannot read review threads: ${err.message}`);
    }
  } else if (pr.unresolvedThreadsCount !== undefined) {
    if (
      typeof pr.unresolvedThreadsCount === 'number' &&
      !Number.isNaN(pr.unresolvedThreadsCount) &&
      pr.unresolvedThreadsCount >= 0
    ) {
      unresolvedThreads = pr.unresolvedThreadsCount;
    } else {
      return refuse(
        RefusalCode.THREADS_UNRESOLVED,
        'cannot read review threads: unresolvedThreadsCount is invalid'
      );
    }
  } else {
    // Fail-closed default query via GraphQL
    try {
      let repoOwnerAndName = o.repo;
      if (!repoOwnerAndName) {
        const rem = gitOut(repoCwd, ['remote', 'get-url', 'origin']);
        if (rem.ok && rem.stdout) {
          const m = rem.stdout.match(/[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
          if (m) repoOwnerAndName = m[1];
        }
      }
      if (!repoOwnerAndName || !repoOwnerAndName.includes('/')) {
        return refuse(
          RefusalCode.THREADS_UNRESOLVED,
          'cannot read review threads: repository owner/name unknown'
        );
      }
      const [owner, name] = repoOwnerAndName.split('/');
      const threadsQuery = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) { reviewThreads(first: 100) { nodes { id isResolved } } } } }`;
      let gqlRes;
      if (typeof o.graphqlInvoker === 'function') {
        gqlRes = await o.graphqlInvoker(threadsQuery, { owner, name, pr: pr.number });
      } else {
        const payload = JSON.stringify({
          query: threadsQuery,
          variables: { owner, name, pr: pr.number },
        });
        const ghRes = runGh(['api', 'graphql', '--input', '-'], repoCwd, o.ghRunner, payload);
        if (ghRes.exitCode !== 0) {
          return refuse(
            RefusalCode.THREADS_UNRESOLVED,
            `GraphQL query for review threads failed: ${ghRes.stderr}`
          );
        }
        gqlRes = parseGhJson(ghRes.stdout);
      }
      const prNode =
        gqlRes && gqlRes.data && gqlRes.data.repository && gqlRes.data.repository.pullRequest;
      if (!prNode || !prNode.reviewThreads || !Array.isArray(prNode.reviewThreads.nodes)) {
        return refuse(
          RefusalCode.THREADS_UNRESOLVED,
          'cannot read review threads: GraphQL returned missing or invalid reviewThreads'
        );
      }
      unresolvedThreads = prNode.reviewThreads.nodes.filter((n) => n && !n.isResolved).length;
    } catch (err) {
      return refuse(RefusalCode.THREADS_UNRESOLVED, `cannot read review threads: ${err.message}`);
    }
  }

  if (
    unresolvedThreads === null ||
    unresolvedThreads === undefined ||
    Number.isNaN(unresolvedThreads) ||
    unresolvedThreads < 0
  ) {
    return refuse(
      RefusalCode.THREADS_UNRESOLVED,
      'review threads count cannot be determined: failing closed'
    );
  }

  if (unresolvedThreads > 0) {
    return refuse(
      RefusalCode.THREADS_UNRESOLVED,
      `Pull Request has ${unresolvedThreads} unresolved review thread(s)`
    );
  }

  // 7. Squash mutation with expectedHeadOid
  const pullRequestId = pr.id || String(pr.number);
  let mutationResult = null;

  if (o.ghClient && typeof o.ghClient.mergePullRequest === 'function') {
    try {
      mutationResult = await o.ghClient.mergePullRequest(pullRequestId, targetHeadOid, 'SQUASH', o);
    } catch (err) {
      if (/expectedHeadOid|head commit.*not.*expected|head.*changed/i.test(err.message)) {
        return refuse(RefusalCode.HEAD_MISMATCH, `GitHub rejected expectedHeadOid: ${err.message}`);
      }
      return refuse(RefusalCode.MERGE_FAILED, `merge mutation threw: ${err.message}`);
    }
  } else if (typeof o.graphqlInvoker === 'function') {
    const mutation = `mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { pullRequest { state merged mergedAt mergeCommit { oid } } } }`;
    const vars = {
      input: {
        pullRequestId,
        expectedHeadOid: targetHeadOid,
        mergeMethod: 'SQUASH',
      },
    };
    try {
      mutationResult = await o.graphqlInvoker(mutation, vars);
    } catch (err) {
      if (/expectedHeadOid|head commit.*not.*expected|head.*changed/i.test(err.message)) {
        return refuse(RefusalCode.HEAD_MISMATCH, `GitHub rejected expectedHeadOid: ${err.message}`);
      }
      return refuse(RefusalCode.MERGE_FAILED, `merge mutation threw: ${err.message}`);
    }
  } else {
    // Default gh api graphql
    const mutation = `mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { pullRequest { state merged mergedAt mergeCommit { oid } } } }`;
    const payload = JSON.stringify({
      query: mutation,
      variables: {
        input: {
          pullRequestId,
          expectedHeadOid: targetHeadOid,
          mergeMethod: 'SQUASH',
        },
      },
    });
    const ghRes = runGh(['api', 'graphql', '--input', '-'], repoCwd, o.ghRunner, payload);
    if (ghRes.exitCode !== 0) {
      if (/expectedHeadOid|head commit.*not.*expected|head.*changed/i.test(ghRes.stderr)) {
        return refuse(RefusalCode.HEAD_MISMATCH, 'GitHub rejected expectedHeadOid (head changed)');
      }
      return refuse(RefusalCode.MERGE_FAILED, ghRes.stderr || 'GraphQL merge mutation failed');
    }
    mutationResult = parseGhJson(ghRes.stdout);
  }

  // Check mutation outcome
  const prNode =
    mutationResult &&
    mutationResult.data &&
    mutationResult.data.mergePullRequest &&
    mutationResult.data.mergePullRequest.pullRequest;
  const isMerged = prNode
    ? prNode.merged === true || prNode.state === 'MERGED'
    : mutationResult && mutationResult.merged === true;

  if (!isMerged) {
    const errMsg =
      (mutationResult &&
        (mutationResult.error || mutationResult.reason || mutationResult.message)) ||
      'merge mutation did not confirm merged state';
    if (/expectedHeadOid|head commit.*not.*expected|head.*changed/i.test(errMsg)) {
      return refuse(RefusalCode.HEAD_MISMATCH, `GitHub rejected expectedHeadOid: ${errMsg}`);
    }
    return refuse(RefusalCode.MERGE_FAILED, errMsg);
  }

  const mergeCommitOid =
    (prNode && prNode.mergeCommit && prNode.mergeCommit.oid) ||
    (mutationResult && mutationResult.mergeCommitOid) ||
    null;

  // 8. Record success in decision log
  decisions.recordDecision(
    {
      stage: decisions.Stage.COMPLETED,
      workItemId,
      status: 'merged',
      detail: 'GOVERNED_MERGE_SUCCESS',
      headSha: targetHeadOid,
      mergeCommitOid,
    },
    decisionOpts
  );

  return {
    ok: true,
    status: 'merged',
    workItemId,
    headSha: targetHeadOid,
    mergeCommitOid,
  };
}

/**
 * GM-R05: check if an item published in orchestrate loop is eligible for auto-merge.
 */
function isEligibleForMerge(entry, published, options) {
  if (!entry || !entry.workItemId) return false;
  const pubStatus = published && published.status;
  if (pubStatus !== 'published_draft' && pubStatus !== 'published') return false;

  const review = entry.review || {};
  const verdict = entry.verdict || review.verdict;
  if (verdict !== 'PASS') return false;

  const findings = entry.findings || review.findings || [];
  if (hasOpenP0P1Findings(findings)) return false;

  const cfgRes = loadMergeConfig(options);
  if (!cfgRes.ok) return false;
  const config = cfgRes.config;
  const neverMergeRaw = Array.isArray(config.neverMerge)
    ? config.neverMerge
    : Array.isArray(config.never_merge)
      ? config.never_merge
      : null;
  if (!neverMergeRaw) return false;
  const neverMerge = neverMergeRaw.map((id) => String(id).trim().toUpperCase());
  if (neverMerge.includes(entry.workItemId.trim().toUpperCase())) return false;

  return true;
}

module.exports = {
  RefusalCode,
  loadMergeConfig,
  findReviewManifest,
  findReviewArtifact,
  extractChangeLines,
  hasBinaryOrModeChanges,
  normalizeDiff,
  checkByteIdenticalMerge,
  validatePrTitle,
  isCheckSuccess,
  verifyReviewerIndependence,
  hasOpenP0P1Findings,
  getWritersFromDecisionLog,
  getReviewersFromDecisionLog,
  hasReviewProofForSha,
  governedMerge,
  isEligibleForMerge,
  getControllerSigningKeyPath,
  getSigningKey,
  getOrCreateSigningKey,
  timingSafeCompare,
  canonicalReviewLaunchPayload,
  signReviewLaunchPayload,
  verifyReviewLaunchSignature,
};
