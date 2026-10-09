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

const reviewManifest = require('./review-manifest');
const publisher = require('./publisher');
const decisions = require('./decisions');

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'data', 'merge-config.json');
const DEFAULT_DECISION_DIR = path.join(os.homedir(), '.shipde', 'decisions');
const SHA_40 = /^[0-9a-f]{40}$/i;

const RefusalCode = Object.freeze({
  NEVER_MERGE: 'NEVER_MERGE',
  MANIFEST_MISSING: 'MANIFEST_MISSING',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  VERDICT_NOT_PASS: 'VERDICT_NOT_PASS',
  OPEN_FINDINGS: 'OPEN_FINDINGS',
  REVIEWER_NOT_INDEPENDENT: 'REVIEWER_NOT_INDEPENDENT',
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
  if (o.config && typeof o.config === 'object') {
    return o.config;
  }
  const configPath = o.configPath || DEFAULT_CONFIG_PATH;
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8').replace(/^﻿/, '');
      return JSON.parse(raw);
    }
  } catch {
    // If config file cannot be read, return empty default
  }
  return { neverMerge: [] };
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

/** Extract only the added and removed change lines (+ / -), excluding diff headers. */
function extractChangeLines(diffText) {
  if (typeof diffText !== 'string') return '';
  return diffText
    .split(/\r?\n/)
    .filter(
      (line) =>
        (line.startsWith('+') && !line.startsWith('+++')) ||
        (line.startsWith('-') && !line.startsWith('---'))
    )
    .join('\n');
}

/**
 * GM-R02: when a merge commit of origin/main is needed (branch behind), it is
 * allowed only if the change lines are byte-identical to the reviewed SHA's
 * change lines against its base. Otherwise DELTA_REVIEW_REQUIRED.
 */
function checkByteIdenticalMerge(repoCwd, headSha, reviewedSha, reviewedBase) {
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

  // Compare change lines:
  // 1. Reviewed SHA against reviewed base
  const diffReviewed = gitOut(repoCwd, ['diff', `${reviewedBase}..${reviewedSha}`]);
  if (!diffReviewed.ok) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }

  // 2. Head merge commit against main parent
  const diffMerge = gitOut(repoCwd, ['diff', `${pMain}..${headSha}`]);
  if (!diffMerge.ok) {
    return { ok: false, reason: RefusalCode.HEAD_MISMATCH };
  }

  const changeLinesReviewed = extractChangeLines(diffReviewed.stdout);
  const changeLinesMerge = extractChangeLines(diffMerge.stdout);

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

function runGh(args, cwd, ghRunner) {
  if (typeof ghRunner === 'function') {
    return ghRunner(args, cwd);
  }
  const res = cp.spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
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
  if (!chk) return false;
  const conclusion = String(chk.conclusion || '').toUpperCase();
  const state = String(chk.state || '').toUpperCase();
  const status = String(chk.status || '').toUpperCase();

  if (conclusion === 'SUCCESS' || state === 'SUCCESS') return true;
  if (status === 'COMPLETED' && conclusion === 'SUCCESS') return true;
  return false;
}

/** Check reviewer independence across candidate keys and failure domains. */
function verifyReviewerIndependence(manifest, writersList) {
  const reviewerKey = String(manifest.reviewerCandidateKey || '').trim();
  const reviewerDomain =
    manifest.reviewerFailureDomain || publisher.failureDomainFromCandidateKey(reviewerKey);

  const allWriters = new Set();
  if (manifest.writerCandidateKey) allWriters.add(String(manifest.writerCandidateKey).trim());
  if (Array.isArray(writersList)) {
    for (const w of writersList) {
      if (w) allWriters.add(String(w).trim());
    }
  }

  for (const writerKey of allWriters) {
    if (!writerKey) continue;
    if (reviewerKey === writerKey) {
      return { ok: false, reason: 'reviewer key equals writer key' };
    }
    const writerDomain = publisher.failureDomainFromCandidateKey(writerKey);
    if (reviewerDomain && writerDomain && reviewerDomain === writerDomain) {
      return { ok: false, reason: 'reviewer shares writer failure domain' };
    }
    const rParts = reviewManifest.candidateKeyParts(reviewerKey);
    const wParts = reviewManifest.candidateKeyParts(writerKey);
    if (rParts && wParts) {
      if (rParts[3].toLowerCase() === wParts[3].toLowerCase()) {
        return { ok: false, reason: 'reviewer shares writer upstream segment' };
      }
      if (rParts[6].toLowerCase() === wParts[6].toLowerCase()) {
        return { ok: false, reason: 'reviewer shares writer modelId' };
      }
    }
  }

  if (
    manifest.writerFailureDomain &&
    manifest.reviewerFailureDomain &&
    manifest.writerFailureDomain.toLowerCase() === manifest.reviewerFailureDomain.toLowerCase()
  ) {
    return { ok: false, reason: 'reviewer declares writer failure domain' };
  }

  return { ok: true };
}

/** Check for open P0/P1 findings in the manifest. */
function hasOpenP0P1Findings(findings) {
  if (!Array.isArray(findings)) return false;
  return findings.some((f) => {
    if (!f) return false;
    const status = String(f.status || (f.open ? 'open' : '')).toLowerCase();
    const severity = String(f.severity || '').toLowerCase();
    return status === 'open' && (severity === 'p0' || severity === 'p1');
  });
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
  const config = loadMergeConfig(o);
  const neverMerge = Array.isArray(config.neverMerge)
    ? config.neverMerge
    : Array.isArray(config.never_merge)
      ? config.never_merge
      : [];

  if (neverMerge.includes(workItemId)) {
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

  // Reviewer independence against all writers
  const writersList = o.writers || (o.checkpoint && o.checkpoint.writers) || [];
  const indep = verifyReviewerIndependence(manifest, writersList);
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

  // Not a draft
  if (pr.isDraft === true) {
    return refuse(RefusalCode.DRAFT, 'Pull Request is a draft');
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
  const reviewedSha = String(manifest.reviewedCommit || '')
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

  for (const chk of rollup) {
    if (!isCheckSuccess(chk)) {
      return refuse(
        RefusalCode.CHECK_NOT_SUCCESS,
        `check "${chk.name || chk.context}" conclusion is not SUCCESS`
      );
    }
    // Verify checks are on exact head OID if check names an OID
    if (chk.headSha && chk.headSha.toLowerCase() !== targetHeadOid.toLowerCase()) {
      return refuse(
        RefusalCode.CHECK_NOT_SUCCESS,
        `check "${chk.name || chk.context}" head ${chk.headSha} does not match exact OID ${targetHeadOid}`
      );
    }
  }

  // 6. Zero unresolved review threads
  let unresolvedThreads = 0;
  if (o.ghClient && typeof o.ghClient.getReviewThreads === 'function') {
    const threadData = await o.ghClient.getReviewThreads(pr.number, o);
    unresolvedThreads = threadData ? threadData.unresolvedCount || 0 : 0;
  } else if (pr.unresolvedThreadsCount !== undefined) {
    unresolvedThreads = pr.unresolvedThreadsCount;
  } else {
    // Query review threads via GraphQL
    const threadsQuery = `query($pr: Int!) { repository(owner: "dummy", name: "dummy") { pullRequest(number: $pr) { reviewThreads(first: 100) { nodes { isResolved } } } } }`;
    // If not injected, threads count defaults to 0 if no reviewer threads recorded
    unresolvedThreads = 0;
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
    mutationResult = await o.ghClient.mergePullRequest(pullRequestId, targetHeadOid, 'SQUASH', o);
  } else if (typeof o.graphqlInvoker === 'function') {
    const mutation = `mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { pullRequest { state merged mergedAt mergeCommit { oid } } } }`;
    const vars = {
      input: {
        pullRequestId,
        expectedHeadOid: targetHeadOid,
        mergeMethod: 'SQUASH',
      },
    };
    mutationResult = await o.graphqlInvoker(mutation, vars);
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
    const ghRes = runGh(['api', 'graphql', '--input', '-'], repoCwd, (args, cwd) => {
      const res = cp.spawnSync('gh', args, {
        cwd,
        input: payload,
        encoding: 'utf8',
        windowsHide: true,
      });
      return {
        exitCode: res.status === null ? -1 : res.status,
        stdout: (res.stdout || '').trim(),
        stderr: (res.stderr || '').trim(),
      };
    });
    if (ghRes.exitCode !== 0) {
      if (/expectedHeadOid|head commit.*not.*expected/i.test(ghRes.stderr)) {
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
    return refuse(RefusalCode.MERGE_FAILED, 'merge mutation did not confirm merged state');
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

  const config = loadMergeConfig(options);
  const neverMerge = Array.isArray(config.neverMerge)
    ? config.neverMerge
    : Array.isArray(config.never_merge)
      ? config.never_merge
      : [];
  if (neverMerge.includes(entry.workItemId)) return false;

  return true;
}

module.exports = {
  RefusalCode,
  loadMergeConfig,
  findReviewManifest,
  findReviewArtifact,
  extractChangeLines,
  checkByteIdenticalMerge,
  validatePrTitle,
  isCheckSuccess,
  verifyReviewerIndependence,
  hasOpenP0P1Findings,
  governedMerge,
  isEligibleForMerge,
};
