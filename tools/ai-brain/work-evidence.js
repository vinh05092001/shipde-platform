'use strict';

/**
 * Ship Dễ — TASK-AI-75: Work-evidence importer
 *
 * Imports real merged, independently reviewed work items into the evidence
 * store as WORK_ITEM_PASS evidence. Never fabricates.
 *
 * Rules:
 *   W-R01 sha must be exactly 40 lowercase hex, else refuse SHA_INVALID.
 *   W-R02 writer must parse as a 7-part candidate key with non-empty parts, else WRITER_KEY_INVALID.
 *   W-R03 review file must exist; line 1 must contain the full sha; line 2 must be exactly
 *         'Review verdict: PASS'; else REVIEW_NOT_PASS (or REVIEW_SHA_MISMATCH when line 1 lacks the sha).
 *   W-R04 sha must be an ancestor of (or equal to) the main ref (git merge-base --is-ancestor),
 *         else NOT_MERGED. Squash merges: also accept when the review file names the sha and the
 *         main-ref history contains a commit whose message contains '[<work-item>]' — record which path proved it (ancestor|squash).
 *   W-R05 reviewer must be non-empty and must not equal the writer key, nor share its upstream segment or modelId,
 *         else REVIEWER_NOT_INDEPENDENT.
 *   W-R06 on success call evidence.recordProbe(dir, candidate, {level: 3 (OUTCOME), proofLevel:'WORK_ITEM_PASS',
 *         status:'passed', source:'import-work', workItem, sha, reviewer, reviewFile, mergeProof})
 *         so routing proofObserved reports WORK_ITEM_PASS for that exact candidate key and no other.
 *   W-R07 idempotent: importing the same sha+writer twice adds no second item (returns ALREADY_RECORDED).
 *   W-R08 every refusal writes nothing to the evidence store; exit code 0 on success/ALREADY_RECORDED,
 *         1 on refusal, 2 on bad argv.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const evidence = require('./evidence');
const { candidateKey, parseCandidateKey } = require('./discovery/identity');

/** Check if commitSha is an ancestor of ref via git merge-base --is-ancestor */
function isGitAncestor(commitSha, ref, gitCwd) {
  try {
    const res = cp.spawnSync(
      'git',
      ['-c', 'safe.directory=*', 'merge-base', '--is-ancestor', commitSha, ref],
      {
        cwd: gitCwd,
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    return res.status === 0;
  } catch {
    return false;
  }
}

/** Check if main-ref history contains a commit whose message contains [<work-item>] */
function findSquashCommit(wId, ref, gitCwd) {
  if (!wId) return false;
  try {
    const needle = `[${wId}]`;
    const res = cp.spawnSync(
      'git',
      ['-c', 'safe.directory=*', 'log', ref, '-F', `--grep=${needle}`, '-n', '1', '--format=%H'],
      {
        cwd: gitCwd,
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    if (res.status === 0 && res.stdout && res.stdout.trim().length > 0) {
      return true;
    }
    const resCi = cp.spawnSync(
      'git',
      [
        '-c',
        'safe.directory=*',
        'log',
        ref,
        '-i',
        '-F',
        `--grep=${needle}`,
        '-n',
        '1',
        '--format=%H',
      ],
      {
        cwd: gitCwd,
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    return resCi.status === 0 && resCi.stdout && resCi.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check reviewer independence from writer.
 * reviewer must be non-empty and must not equal writer key,
 * nor share its upstream segment or modelId.
 */
function checkReviewerIndependence(reviewer, writerParts) {
  if (!reviewer || typeof reviewer !== 'string') {
    return { independent: false, reason: 'reviewer must be a non-empty string' };
  }
  const revTrim = reviewer.trim();
  if (!revTrim) {
    return { independent: false, reason: 'reviewer must be non-empty' };
  }

  const writerKey = writerParts.join('::');
  if (revTrim === writerKey) {
    return { independent: false, reason: 'reviewer must not equal writer key' };
  }

  const writerUpstream = writerParts[3].toLowerCase();
  const writerModelId = writerParts[6].toLowerCase();

  // If reviewer is a 7-part candidate key
  const revParts = revTrim.includes('::') ? revTrim.split('::') : revTrim.split('\u241f');
  if (revParts.length === 7) {
    const revUpstream = revParts[3].trim().toLowerCase();
    const revModelId = revParts[6].trim().toLowerCase();
    if (revUpstream === writerUpstream || revModelId === writerModelId) {
      return {
        independent: false,
        reason: 'reviewer shares upstream segment or modelId with writer',
      };
    }
  } else {
    const parsedRev = parseCandidateKey(revTrim);
    if (parsedRev) {
      if (parsedRev.upstream && parsedRev.upstream.trim().toLowerCase() === writerUpstream) {
        return { independent: false, reason: 'reviewer shares upstream segment with writer' };
      }
      if (parsedRev.modelId && parsedRev.modelId.trim().toLowerCase() === writerModelId) {
        return { independent: false, reason: 'reviewer shares modelId with writer' };
      }
    }
  }

  // Token / segment check
  const tokens = revTrim
    .split(/[/:]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes(writerUpstream) || tokens.includes(writerModelId)) {
    return {
      independent: false,
      reason: 'reviewer shares upstream segment or modelId with writer',
    };
  }

  if (revTrim.toLowerCase() === writerUpstream || revTrim.toLowerCase() === writerModelId) {
    return { independent: false, reason: 'reviewer equals writer upstream segment or modelId' };
  }

  return { independent: true };
}

/**
 * Import a work item pass into the evidence store.
 *
 * @param {object} opts
 * @param {string} opts.sha 40-hex commit sha
 * @param {string} opts.writer 7-part candidateKey
 * @param {string} opts.review path to review md
 * @param {string} opts.reviewer reviewer identity string
 * @param {string} opts.workItem work item id
 * @param {string} [opts.mainRef='origin/main'] git ref for main
 * @param {string} [opts.evidenceDir] path to evidence store directory
 * @param {string} [opts.cwd] current working directory for git / relative paths
 * @returns {object} result { ok: boolean, status: string, code?: string, reason?: string, ... }
 */
function importWorkItemPass(opts) {
  const options = opts || {};
  const cwd = options.cwd || process.cwd();

  // W-R01: sha must be exactly 40 lowercase hex, else refuse SHA_INVALID
  const sha = options.sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    return {
      ok: false,
      code: 'SHA_INVALID',
      reason: 'sha must be exactly 40 lowercase hex',
    };
  }

  // W-R02: writer must parse as a 7-part candidate key with non-empty parts, else WRITER_KEY_INVALID
  const writer = options.writer;
  if (typeof writer !== 'string') {
    return {
      ok: false,
      code: 'WRITER_KEY_INVALID',
      reason: 'writer must parse as a 7-part candidate key with non-empty parts',
    };
  }
  const writerParts = writer.includes('::') ? writer.split('::') : writer.split('\u241f');
  if (
    writerParts.length !== 7 ||
    writerParts.some((p) => typeof p !== 'string' || p.trim() === '')
  ) {
    return {
      ok: false,
      code: 'WRITER_KEY_INVALID',
      reason: 'writer must parse as a 7-part candidate key with non-empty parts',
    };
  }

  // Candidate representation for evidence store
  const candidate = {
    harness: writerParts[0],
    accessPath: writerParts[1],
    gateway: writerParts[2],
    upstream: writerParts[3],
    account: writerParts[4],
    accountId: writerParts[4],
    quotaScope: writerParts[5],
    model: writerParts[6],
    modelId: writerParts[6],
  };
  const normalizedWriterKey = candidateKey(candidate);

  // W-R03: review file must exist; line 1 must contain full sha; line 2 must be exactly 'Review verdict: PASS'
  const reviewFile = options.review || options.reviewFile || options['review-file'];
  if (!reviewFile || typeof reviewFile !== 'string') {
    return {
      ok: false,
      code: 'REVIEW_NOT_PASS',
      reason: 'review file path must be specified',
    };
  }

  const reviewPath = path.isAbsolute(reviewFile) ? reviewFile : path.resolve(cwd, reviewFile);
  if (!fs.existsSync(reviewPath) || !fs.statSync(reviewPath).isFile()) {
    return {
      ok: false,
      code: 'REVIEW_NOT_PASS',
      reason: 'review file does not exist: ' + reviewPath,
    };
  }

  let reviewContent;
  try {
    reviewContent = fs.readFileSync(reviewPath, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return {
      ok: false,
      code: 'REVIEW_NOT_PASS',
      reason: 'review file cannot be read: ' + reviewPath,
    };
  }

  const lines = reviewContent.split(/\r?\n/);
  const line1 = lines[0] !== undefined ? lines[0] : '';
  const line2 = lines[1] !== undefined ? lines[1] : '';

  if (!line1.includes(sha)) {
    return {
      ok: false,
      code: 'REVIEW_SHA_MISMATCH',
      reason: 'review file line 1 does not contain full sha',
    };
  }

  if (line2 !== 'Review verdict: PASS') {
    return {
      ok: false,
      code: 'REVIEW_NOT_PASS',
      reason: 'review file line 2 must be exactly "Review verdict: PASS"',
    };
  }

  // Work item ID
  const workItem = options.workItem || options['work-item'];
  if (!workItem || typeof workItem !== 'string' || workItem.trim() === '') {
    return {
      ok: false,
      code: 'WORK_ITEM_INVALID',
      reason: 'work-item id must be a non-empty string',
    };
  }

  // W-R04: sha must be ancestor of main ref, or squash merge where review file names sha and main has [<work-item>]
  const mainRef = options.mainRef || options['main-ref'] || 'origin/main';
  let mergeProof = null;
  if (isGitAncestor(sha, mainRef, cwd)) {
    mergeProof = 'ancestor';
  } else if (reviewContent.includes(sha) && findSquashCommit(workItem, mainRef, cwd)) {
    mergeProof = 'squash';
  } else {
    return {
      ok: false,
      code: 'NOT_MERGED',
      reason: `commit ${sha} is not merged into ${mainRef} (not an ancestor and no squash commit matching [${workItem}])`,
    };
  }

  // W-R05: reviewer must be non-empty and must not equal writer key, nor share upstream segment or modelId
  const reviewer = options.reviewer;
  const reviewerCheck = checkReviewerIndependence(reviewer, writerParts);
  if (!reviewerCheck.independent) {
    return {
      ok: false,
      code: 'REVIEWER_NOT_INDEPENDENT',
      reason: reviewerCheck.reason,
    };
  }

  // Evidence directory
  const evidenceDir =
    options.evidenceDir || options['evidence-dir'] || path.join(__dirname, 'data', 'evidence');
  const resolvedEvidenceDir = path.isAbsolute(evidenceDir)
    ? evidenceDir
    : path.resolve(cwd, evidenceDir);

  // W-R07: idempotent: importing the same sha+writer twice adds no second item (returns ALREADY_RECORDED)
  const currentEvidence = evidence.loadEvidence(resolvedEvidenceDir);
  const existingItems = evidence.getEvidence(currentEvidence, candidate);
  const alreadyRecorded = existingItems.find((e) => e.sha === sha);
  if (alreadyRecorded) {
    return {
      ok: true,
      status: 'ALREADY_RECORDED',
      code: 'ALREADY_RECORDED',
      candidateKey: normalizedWriterKey,
      sha,
      workItem,
      reviewer,
      mergeProof: alreadyRecorded.mergeProof || mergeProof,
    };
  }

  // W-R06: on success call evidence.recordProbe
  const probeItem = {
    level: 3,
    proofLevel: 'WORK_ITEM_PASS',
    status: 'passed',
    source: 'import-work',
    workItem,
    sha,
    reviewer,
    reviewFile,
    mergeProof,
  };

  evidence.recordProbe(resolvedEvidenceDir, candidate, probeItem);

  return {
    ok: true,
    status: 'IMPORTED',
    candidateKey: normalizedWriterKey,
    sha,
    workItem,
    reviewer,
    reviewFile,
    mergeProof,
  };
}

module.exports = {
  importWorkItemPass,
  isGitAncestor,
  findSquashCommit,
  checkReviewerIndependence,
};
