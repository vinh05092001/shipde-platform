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
 *   W-R03 the markdown review is the artifact the manifest binds: it must exist, name the
 *         reviewed sha on line 1 and carry exactly 'Review verdict: PASS' on line 2, else
 *         REVIEW_NOT_PASS (or REVIEW_SHA_MISMATCH when line 1 lacks the sha).
 *   W-R04/M-R08 merge binding: the reviewed sha must be reachable from the main ref AND a main
 *         commit whose message contains [<work-item>] must carry the reviewed patch (patch-id of
 *         mergeCommit^..mergeCommit equals reviewedPatchId) — 'ancestor'; the same patch equality
 *         proves a squash when the reviewed commit is not an ancestor — 'squash'. A [<work-item>]
 *         message whose patch differs is SQUASH_PATCH_MISMATCH; a commit message alone is never enough.
 *   W-R05 reviewer must be non-empty and must not equal the writer key, nor share its upstream segment or modelId,
 *         else REVIEWER_NOT_INDEPENDENT.
 *   W-R06 on success call evidence.recordProbe(dir, candidate, {level: 3 (OUTCOME), proofLevel:'WORK_ITEM_PASS',
 *         status:'passed', source:'import-work', workItem, sha, reviewer, reviewFile, mergeProof})
 *         so routing proofObserved reports WORK_ITEM_PASS for that exact candidate key and no other.
 *   W-R07 idempotent: importing the same sha+writer twice adds no second item (returns ALREADY_RECORDED).
 *   W-R08 every refusal writes nothing to the evidence store; exit code 0 on success/ALREADY_RECORDED,
 *         1 on refusal, 2 on bad argv.
 *
 * TASK-AI-77 (Gate B) adds the structured review manifest, which becomes the
 * only source of the verdict, the reviewed tree, the reviewed patch and the
 * reviewer identity — the markdown is no longer evidence on its own:
 *   M-R07 --manifest is required; a markdown review alone is MANIFEST_REQUIRED.
 *   M-R08 the merge must carry the reviewed patch; --pr-head must be the reviewed commit.
 *   M-R09 the recorded item names workItemId, reviewedCommit, reviewedTree,
 *         reviewedPatchId, mergeCommit and the manifest's sha256, written through
 *         evidence.recordProbe into the one existing evidence store.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const evidence = require('./evidence');
const reviewManifest = require('./review-manifest');
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

/**
 * M-R08: every commit on `ref` whose message carries `[<work-item>]`, newest first.
 * A message is a candidate, never the proof: each candidate still has to carry
 * the reviewed patch.
 */
function findWorkItemCommits(wId, ref, gitCwd) {
  if (!wId) return [];
  try {
    const res = cp.spawnSync(
      'git',
      ['-c', 'safe.directory=*', 'log', ref, '-F', `--grep=[${wId}]`, '--format=%H'],
      {
        cwd: gitCwd,
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    if (res.status !== 0 || !res.stdout) return [];
    return res.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[0-9a-f]{40}$/i.test(line));
  } catch {
    return [];
  }
}

/**
 * M-R08 merge binding. Proof that the reviewed change is what actually landed:
 *
 *   ancestor — the reviewed commit is reachable from the main ref AND a main
 *              commit titled `[<work-item>]` carries exactly the reviewed patch.
 *   squash   — same patch equality, but the reviewed commit is not an ancestor
 *              because the branch was squashed.
 *
 * A `[<work-item>]` message whose patch-id differs from the reviewed one is
 * SQUASH_PATCH_MISMATCH: the title alone never promotes anything.
 */
function bindMergeProof(options) {
  const { sha, workItem, mainRef, cwd, reviewedPatchId } = options;
  const candidates = findWorkItemCommits(workItem, mainRef, cwd);
  const matching = candidates.filter((c) => {
    const patchId = reviewManifest.commitPatchId(cwd, c);
    return Boolean(patchId) && patchId === String(reviewedPatchId || '').toLowerCase();
  });
  const ancestor = isGitAncestor(sha, mainRef, cwd);
  if (matching.length > 0) {
    return {
      ok: true,
      mergeProof: ancestor ? 'ancestor' : 'squash',
      mergeCommit: matching[0],
    };
  }
  if (candidates.length > 0) {
    return {
      ok: false,
      code: 'SQUASH_PATCH_MISMATCH',
      reason:
        'a [' +
        workItem +
        '] commit exists on ' +
        mainRef +
        ' but it does not carry the reviewed patch-id ' +
        reviewedPatchId,
    };
  }
  return {
    ok: false,
    code: 'NOT_MERGED',
    reason: `commit ${sha} is not merged into ${mainRef} (no [${workItem}] commit carries the reviewed patch)`,
  };
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
 * @param {string} opts.manifest path to the structured review manifest (M-R07)
 * @param {string} opts.sha 40-hex commit sha
 * @param {string} opts.writer 7-part candidateKey
 * @param {string} opts.review path to the markdown review the manifest binds
 * @param {string} opts.reviewer reviewer identity string
 * @param {string} opts.workItem work item id
 * @param {string} [opts.prHead] PR head sha; must equal the reviewed commit (M-R08)
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

  // M-R07: the verdict, the reviewed tree, the reviewed patch and the reviewer
  // identity all come from the manifest. A markdown review on its own is prose,
  // and prose is refused rather than promoted.
  const manifestArg =
    options.manifest || options['manifest-path'] || options['review-manifest'] || null;
  if (!manifestArg) {
    return {
      ok: false,
      code: 'MANIFEST_REQUIRED',
      reason:
        'a structured review manifest is required: the markdown review alone is not review evidence',
    };
  }
  const manifestPath = path.isAbsolute(manifestArg) ? manifestArg : path.resolve(cwd, manifestArg);
  const loaded = reviewManifest.readManifest(manifestPath);
  if (!loaded.ok) return loaded;
  const manifest = loaded.manifest;
  const manifestSha256 = reviewManifest.sha256File(manifestPath);

  // W-R03: the markdown review is the artifact the manifest binds — it must
  // exist, name the reviewed commit and still be the PASS-shaped review
  // document. It is no longer where the verdict is read from.
  const reviewFile =
    options.review ||
    options.reviewFile ||
    options['review-file'] ||
    options.artifact ||
    options['artifact-path'] ||
    null;
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

  // M-R01..M-R05: the manifest must be well formed, bound to this work item and
  // to this exact commit, tree and patch, independently reviewed, and bound to
  // this markdown by sha256. Anything else is refused with the manifest's code.
  const checked = reviewManifest.validateManifest(manifest, {
    repoCwd: cwd,
    expected: { workItemId: workItem, commit: sha },
    artifactPath: reviewPath,
  });
  if (!checked.ok) return checked;
  if (checked.verdict !== 'PASS') {
    return {
      ok: false,
      code: 'VERDICT_NOT_PASS',
      reason: 'the review manifest verdict is ' + checked.verdict + ', not PASS',
    };
  }

  // M-R08: an optional PR head that is not the reviewed commit means the Pull
  // Request moved; refuse before it can be read as evidence.
  const prHead = options.prHead || options['pr-head'] || null;
  if (prHead && String(prHead).trim().toLowerCase() !== checked.reviewedCommit) {
    return {
      ok: false,
      code: 'PR_HEAD_MISMATCH',
      reason: `Pull Request head ${prHead} is not the reviewed commit ${checked.reviewedCommit}`,
    };
  }

  // W-R04 / M-R08: the merge must carry the reviewed patch.
  const mainRef = options.mainRef || options['main-ref'] || 'origin/main';
  const binding = bindMergeProof({
    sha,
    workItem,
    mainRef,
    cwd,
    reviewedPatchId: checked.reviewedPatchId,
  });
  if (!binding.ok) return { ok: false, code: binding.code, reason: binding.reason };
  const mergeProof = binding.mergeProof;

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

  // W-R06 / M-R09: on success call evidence.recordProbe in the one existing
  // store. The item carries the whole binding, so the promotion can be re-checked
  // against git later without re-reading prose.
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
    workItemId: manifest.workItemId,
    reviewedCommit: checked.reviewedCommit,
    reviewedTree: checked.reviewedTree,
    reviewedPatchId: checked.reviewedPatchId,
    mergeCommit: binding.mergeCommit,
    manifestSha256,
    reviewerCandidateKey: manifest.reviewerCandidateKey,
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
    mergeCommit: binding.mergeCommit,
    reviewedPatchId: checked.reviewedPatchId,
    manifestSha256,
  };
}

module.exports = {
  importWorkItemPass,
  isGitAncestor,
  findWorkItemCommits,
  bindMergeProof,
  checkReviewerIndependence,
};
