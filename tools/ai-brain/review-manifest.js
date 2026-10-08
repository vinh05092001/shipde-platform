'use strict';

/**
 * Ship Dễ — TASK-AI-77 (Gate B): structured review manifest.
 *
 * A reviewed work item is promoted on one JSON document bound to the exact
 * thing it reviewed, not on prose: workItemId, reviewedBase, reviewedCommit,
 * reviewedTree, reviewedPatchId, reviewerCandidateKey, writerCandidateKey,
 * reviewer/writerFailureDomain, verdict, findings, tests, artifactSha256,
 * createdAt. Nothing here writes, pushes or approves.
 *
 *   M-R01 validateManifest answers {ok:true} or {ok:false, code}; malformed is SCHEMA_INVALID.
 *   M-R02 tree and patch are RECOMPUTED from git in repoCwd, never read from the manifest.
 *   M-R03 PASS with any finding left `open` is PASS_WITH_OPEN_FINDINGS.
 *   M-R04 the reviewer is independent: never the writer key, never the writer failure domain,
 *          never the same upstream or modelId — the domain rule is reused from publisher.js.
 *   M-R05 artifactSha256 must equal the sha256 of the markdown review the manifest accompanies;
 *          the review is not optional — a manifest with no artifactPath is ARTIFACT_REQUIRED, never
 *          an unchecked manifest.
 */

const crypto = require('crypto');
const fs = require('fs');
const cp = require('child_process');

const SCHEMA_VERSION = 1;
const SHA_40 = /^[0-9a-f]{40}$/i;
const PATCH_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{40})$/i; // git patch-id width differs by build
const SHA_256 = /^[0-9a-f]{64}$/i;
const REVIEW_VERDICTS = Object.freeze(['PASS', 'CHANGES_REQUIRED', 'BLOCKED']);
const FINDING_STATUSES = Object.freeze(['open', 'resolved']);
const TEST_RESULTS = Object.freeze(['pass', 'fail']);
const REFUSAL_CODES = Object.freeze([
  'SCHEMA_INVALID',
  'WORK_ITEM_MISMATCH',
  'SHA_MISMATCH',
  'TREE_MISMATCH',
  'PATCH_MISMATCH',
  'PASS_WITH_OPEN_FINDINGS',
  'REVIEWER_NOT_INDEPENDENT',
  'ARTIFACT_HASH_MISMATCH',
  'ARTIFACT_REQUIRED',
]);

const refusal = (code, reason) => ({ ok: false, code, reason });
const text = (value) => typeof value === 'string' && value.trim() !== '';
const norm = (value) =>
  String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase();

function gitOut(repoCwd, args, input) {
  const res = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
    cwd: repoCwd,
    encoding: 'utf8',
    input,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { ok: res.status === 0, stdout: (res.stdout || '').trim() };
}

/** sha256 of a file, or null when it cannot be read (M-R05). */
function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function resolveCommit(repoCwd, rev) {
  const res = gitOut(repoCwd, ['rev-parse', '--verify', String(rev) + '^{commit}']);
  return res.ok && SHA_40.test(res.stdout) ? res.stdout.toLowerCase() : null;
}

/** git rev-parse <commit>^{tree}: the tree the reviewed commit actually has. */
function computeReviewedTree(repoCwd, commit) {
  const res = gitOut(repoCwd, ['rev-parse', '--verify', String(commit) + '^{tree}']);
  return res.ok && SHA_40.test(res.stdout) ? res.stdout.toLowerCase() : null;
}

/**
 * `git diff <base>..<commit> | git patch-id --stable`, first field: the identity
 * of the reviewed CHANGE, which survives a rebase, a merge and a squash.
 */
function computePatchId(repoCwd, base, commit) {
  const diff = gitOut(repoCwd, ['diff', String(base) + '..' + String(commit)]);
  if (!diff.ok || !diff.stdout) return null;
  const id = gitOut(repoCwd, ['patch-id', '--stable'], diff.stdout + '\n');
  const first = id.ok ? id.stdout.split(/\s+/)[0] || '' : '';
  return PATCH_ID.test(first) ? first.toLowerCase() : null;
}

/** patch-id of the tree diff one commit brings (commit^..commit). */
function commitPatchId(repoCwd, commit) {
  const resolved = resolveCommit(repoCwd, commit);
  if (!resolved) return null;
  const line = gitOut(repoCwd, ['rev-list', '--parents', '-n', '1', resolved]);
  const parts = line.ok ? line.stdout.split(/\s+/) : [];
  return parts.length < 2 ? null : computePatchId(repoCwd, parts[1], resolved);
}

/** A 7-part candidate key (harness::access::gateway::upstream::account::scope::model). */
function candidateKeyParts(key) {
  const parts = String(key === undefined || key === null ? '' : key).split('::');
  return parts.length === 7 && parts.every((p) => text(p)) ? parts : null;
}

/**
 * M-R04. The failure-domain rule is not restated: publisher.js owns it (it
 * already refuses on it) and is the single definition. The DECLARED domains are
 * checked too, so a manifest cannot launder a shared domain by declaring two
 * different ones.
 */
function independenceRefusal(manifest) {
  const { failureDomainFromCandidateKey } = require('./publisher');
  const writer = String(manifest.writerCandidateKey).trim();
  const reviewer = String(manifest.reviewerCandidateKey).trim();
  if (writer === reviewer) {
    return refusal('REVIEWER_NOT_INDEPENDENT', 'reviewer key is the writer key');
  }
  const declared = [norm(manifest.writerFailureDomain), norm(manifest.reviewerFailureDomain)];
  if (declared[0] && declared[0] === declared[1]) {
    return refusal('REVIEWER_NOT_INDEPENDENT', 'reviewer declares the writer failure domain');
  }
  const writerDomain = failureDomainFromCandidateKey(writer);
  const reviewerDomain = failureDomainFromCandidateKey(reviewer);
  if (writerDomain && writerDomain === reviewerDomain) {
    return refusal('REVIEWER_NOT_INDEPENDENT', 'reviewer shares the writer failure domain');
  }
  const parts = [candidateKeyParts(writer), candidateKeyParts(reviewer)];
  if (parts[0] && parts[1]) {
    if (norm(parts[0][3]) === norm(parts[1][3])) {
      return refusal('REVIEWER_NOT_INDEPENDENT', 'reviewer shares the writer upstream segment');
    }
    if (norm(parts[0][6]) === norm(parts[1][6])) {
      return refusal('REVIEWER_NOT_INDEPENDENT', 'reviewer shares the writer modelId');
    }
  }
  return null;
}

/** M-R01: shape only, checked before any git command runs. */
function schemaRefusal(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return refusal('SCHEMA_INVALID', 'manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    return refusal('SCHEMA_INVALID', 'schemaVersion must be ' + SCHEMA_VERSION);
  }
  const hex = (name, pattern) =>
    text(manifest[name]) && pattern.test(String(manifest[name]).trim());
  if (!text(manifest.workItemId)) return refusal('SCHEMA_INVALID', 'workItemId is required');
  if (!hex('reviewedCommit', SHA_40) || !hex('reviewedBase', SHA_40)) {
    return refusal(
      'SCHEMA_INVALID',
      'reviewedCommit and reviewedBase must be 40-character commits'
    );
  }
  if (!hex('reviewedTree', SHA_40)) return refusal('SCHEMA_INVALID', 'reviewedTree must be a tree');
  if (!hex('reviewedPatchId', PATCH_ID)) {
    return refusal('SCHEMA_INVALID', 'reviewedPatchId must be a git patch-id');
  }
  if (!hex('artifactSha256', SHA_256)) {
    return refusal('SCHEMA_INVALID', 'artifactSha256 must be a sha256 digest');
  }
  if (!candidateKeyParts(manifest.writerCandidateKey)) {
    return refusal('SCHEMA_INVALID', 'writerCandidateKey must be a 7-part candidate key');
  }
  if (!candidateKeyParts(manifest.reviewerCandidateKey)) {
    return refusal('SCHEMA_INVALID', 'reviewerCandidateKey must be a 7-part candidate key');
  }
  if (!text(manifest.writerFailureDomain) || !text(manifest.reviewerFailureDomain)) {
    return refusal('SCHEMA_INVALID', 'writer and reviewer failure domains are required');
  }
  if (!REVIEW_VERDICTS.includes(manifest.verdict)) {
    return refusal('SCHEMA_INVALID', 'verdict must be one of ' + REVIEW_VERDICTS.join(', '));
  }
  if (!Array.isArray(manifest.findings))
    return refusal('SCHEMA_INVALID', 'findings must be an array');
  for (const finding of manifest.findings) {
    if (
      !finding ||
      typeof finding.id !== 'string' ||
      !text(finding.id) ||
      !text(finding.severity) ||
      !FINDING_STATUSES.includes(finding.status) ||
      typeof finding.summary !== 'string'
    ) {
      return refusal('SCHEMA_INVALID', 'each finding is {id, severity, status, summary}');
    }
  }
  if (!Array.isArray(manifest.tests)) return refusal('SCHEMA_INVALID', 'tests must be an array');
  for (const test of manifest.tests) {
    if (
      !test ||
      !text(test.command) ||
      !TEST_RESULTS.includes(test.result) ||
      typeof test.summary !== 'string'
    ) {
      return refusal('SCHEMA_INVALID', 'each test is {command, result pass|fail, summary}');
    }
  }
  if (!text(manifest.createdAt) || !Number.isFinite(Date.parse(manifest.createdAt))) {
    return refusal('SCHEMA_INVALID', 'createdAt must be an ISO timestamp');
  }
  return null;
}

/**
 * M-R01, M-R02, M-R03, M-R04, M-R05.
 *
 * @param {object} manifest the parsed manifest document
 * @param {object} [options]
 * @param {string} options.repoCwd repository the commit is recomputed in (M-R02)
 * @param {object} [options.expected] {workItemId, commit} the caller's binding
 * @param {string} options.artifactPath markdown review the manifest accompanies (M-R05)
 * @returns {object} {ok:true,...} or {ok:false, code, reason}
 */
function validateManifest(manifest, options) {
  const o = options || {};
  const expected = o.expected || {};
  const invalid = schemaRefusal(manifest);
  if (invalid) return invalid;
  if (typeof o.repoCwd !== 'string' || o.repoCwd.trim() === '') {
    return refusal('SCHEMA_INVALID', 'repoCwd is required: tree and patch are recomputed from git');
  }
  // M-R05: the markdown review is part of the evidence, not an optional extra.
  // Skipping the hash comparison would let any manifest be honoured unchecked,
  // so a missing artifact is refused before any git work happens.
  if (!text(o.artifactPath)) {
    return refusal('ARTIFACT_REQUIRED', 'artifactPath is required: the review must be named');
  }
  if (expected.workItemId && norm(expected.workItemId) !== norm(manifest.workItemId)) {
    return refusal('WORK_ITEM_MISMATCH', 'manifest reviews ' + manifest.workItemId);
  }
  const claimed = norm(manifest.reviewedCommit);
  if (expected.commit && norm(expected.commit) !== claimed) {
    return refusal('SHA_MISMATCH', 'manifest reviews ' + claimed);
  }

  // M-R02: git is the authority for what was reviewed.
  const resolved = resolveCommit(o.repoCwd, claimed);
  if (!resolved) return refusal('SHA_MISMATCH', 'reviewed commit is not in ' + o.repoCwd);
  const tree = computeReviewedTree(o.repoCwd, resolved);
  if (!tree || tree !== norm(manifest.reviewedTree)) {
    return refusal('TREE_MISMATCH', 'reviewed tree is not the tree git has for ' + resolved);
  }
  const patchId = computePatchId(o.repoCwd, manifest.reviewedBase, resolved);
  if (!patchId || patchId !== norm(manifest.reviewedPatchId)) {
    return refusal('PATCH_MISMATCH', 'reviewed patch-id is not the patch git has for ' + resolved);
  }

  // M-R03: a PASS is only a PASS when nothing is left open.
  const open = manifest.findings.filter((f) => f.status === 'open');
  if (manifest.verdict === 'PASS' && open.length > 0) {
    return refusal('PASS_WITH_OPEN_FINDINGS', open.map((f) => f.id).join(', '));
  }
  const notIndependent = independenceRefusal(manifest);
  if (notIndependent) return notIndependent;

  // M-R05: the manifest is bound to the exact human-readable review.
  const digest = sha256File(o.artifactPath);
  if (!digest || digest !== norm(manifest.artifactSha256)) {
    return refusal('ARTIFACT_HASH_MISMATCH', 'artifact sha256 is not ' + o.artifactPath);
  }
  return {
    ok: true,
    workItemId: manifest.workItemId,
    reviewedCommit: claimed,
    reviewedTree: tree,
    reviewedPatchId: patchId,
    verdict: manifest.verdict,
    openFindings: open.length,
  };
}

/** Read a manifest document; unreadable or non-JSON is SCHEMA_INVALID. */
function readManifest(manifestPath) {
  if (!text(manifestPath)) return refusal('SCHEMA_INVALID', 'manifest path must be a string');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    return refusal('SCHEMA_INVALID', 'manifest cannot be read: ' + err.message);
  }
  return { ok: true, manifest: parsed };
}

/** readManifest + validateManifest in one call. */
function validateManifestFile(manifestPath, options) {
  const loaded = readManifest(manifestPath);
  if (!loaded.ok) return loaded;
  const result = validateManifest(loaded.manifest, options);
  return result.ok ? Object.assign({}, result, { manifest: loaded.manifest }) : result;
}

function normalizeFinding(f, idx) {
  if (!f || typeof f !== 'object') {
    return {
      id: 'FINDING_' + (idx + 1),
      severity: 'medium',
      status: 'open',
      summary: typeof f === 'string' ? f : 'open finding',
    };
  }
  const id =
    f.id !== undefined ? (typeof f.id === 'string' ? f.id : String(f.id)) : 'FINDING_' + (idx + 1);
  const severity =
    f.severity !== undefined
      ? typeof f.severity === 'string'
        ? f.severity
        : String(f.severity)
      : 'medium';
  let status = f.status;
  if (status === undefined) {
    status = f.open === false || f.closed === true ? 'resolved' : 'open';
  }
  const summary =
    f.summary !== undefined
      ? typeof f.summary === 'string'
        ? f.summary
        : String(f.summary)
      : f.detail !== undefined
        ? typeof f.detail === 'string'
          ? f.detail
          : String(f.detail)
        : '';
  return { id, severity, status, summary };
}

function normalizeTest(t, idx) {
  if (!t || typeof t !== 'object') {
    return { command: 'test', result: 'pass', summary: String(t || '') };
  }
  const command =
    t.command !== undefined
      ? typeof t.command === 'string'
        ? t.command
        : String(t.command)
      : 'test';
  let result = t.result;
  if (result === undefined) {
    result = t.pass === false || (t.exitCode !== 0 && t.exitCode !== undefined) ? 'fail' : 'pass';
  }
  const summary =
    t.summary !== undefined
      ? typeof t.summary === 'string'
        ? t.summary
        : String(t.summary)
      : t.detail !== undefined
        ? typeof t.detail === 'string'
          ? t.detail
          : String(t.detail)
        : '';
  return { command, result, summary };
}

/**
 * L-R01 (TASK-AI-83): buildManifest fills schema v1 using git and failure domains.
 * It never invents a verdict or findings: they come only from the reviewer's structured outcome.
 */
function buildManifest(options) {
  const o = options || {};
  const { failureDomainFromCandidateKey } = require('./publisher');
  const repoCwd = o.repoCwd;
  const baseSha = o.baseSha;
  const reviewedSha = o.reviewedSha;
  const writerCandidateKey = o.writerCandidateKey;
  const reviewerCandidateKey = o.reviewerCandidateKey;
  const artifactPath = o.artifactPath;

  const reviewedTree =
    o.reviewedTree !== undefined
      ? o.reviewedTree
      : repoCwd && reviewedSha
        ? computeReviewedTree(repoCwd, reviewedSha)
        : null;
  const reviewedPatchId =
    o.reviewedPatchId !== undefined
      ? o.reviewedPatchId
      : repoCwd && baseSha && reviewedSha
        ? computePatchId(repoCwd, baseSha, reviewedSha)
        : null;
  const artifactSha256 =
    o.artifactSha256 !== undefined
      ? o.artifactSha256
      : artifactPath
        ? sha256File(artifactPath)
        : null;

  const writerFailureDomain =
    o.writerFailureDomain !== undefined
      ? o.writerFailureDomain
      : writerCandidateKey
        ? failureDomainFromCandidateKey(writerCandidateKey)
        : null;
  const reviewerFailureDomain =
    o.reviewerFailureDomain !== undefined
      ? o.reviewerFailureDomain
      : reviewerCandidateKey
        ? failureDomainFromCandidateKey(reviewerCandidateKey)
        : null;

  const manifest = {
    schemaVersion: o.schemaVersion !== undefined ? o.schemaVersion : SCHEMA_VERSION,
    workItemId: o.workItemId,
    reviewedCommit: reviewedSha,
    reviewedBase: baseSha,
    reviewedTree,
    reviewedPatchId,
    reviewerCandidateKey,
    writerCandidateKey,
    writerFailureDomain,
    reviewerFailureDomain,
    verdict: o.verdict,
    findings: Array.isArray(o.findings) ? o.findings.map(normalizeFinding) : o.findings,
    tests: Array.isArray(o.tests)
      ? o.tests.map(normalizeTest)
      : o.tests !== undefined
        ? o.tests
        : [],
    artifactSha256,
    createdAt: o.createdAt || new Date().toISOString(),
  };

  return manifest;
}

module.exports = {
  SCHEMA_VERSION,
  REVIEW_VERDICTS,
  REFUSAL_CODES,
  buildManifest,
  candidateKeyParts,
  commitPatchId,
  computePatchId,
  computeReviewedTree,
  readManifest,
  resolveCommit,
  sha256File,
  validateManifest,
  validateManifestFile,
};
