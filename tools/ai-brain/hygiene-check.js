#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Read-only Hygiene Preview / Ownership Manifest (TASK-AI-227 Pilot)
 *
 * Usage:
 *   node tools/ai-brain/hygiene-check.js --wi <ID> --checkpoint <PATH> --dry-run
 *        [--repo-root <PATH>] [--register <CSV_PATH>] [--main-ref <REF>]
 *
 * Strictly read-only and requires --dry-run. Never deletes, prunes, or stops
 * any resource. Never infers cleanup eligibility from directory/file names alone.
 */

const fs = require('node:fs');
const path = require('node:path');
const { extractCheckpointReview } = require('./orchestrate/checkpoint');
const { runHardenedGit } = require('./orchestrate/hardened-git');
const { SHA_40 } = require('./orchestrate/shared');
const { parseCsvRecords } = require('./reconcile');

const ALLOWED_FLAGS = new Set([
  'wi',
  'checkpoint',
  'repo-root',
  'register',
  'main-ref',
  'dry-run',
  'json',
]);

const ACTIVE_RUN_STATES = new Set(['RUNNING', 'IN_PROGRESS', 'ACTIVE', 'LAUNCHING']);

function parseCliArgs(argv) {
  const out = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      unknown.push(token);
      continue;
    }
    const key = token.slice(2);
    if (!ALLOWED_FLAGS.has(key)) {
      unknown.push(token);
      continue;
    }
    if (key === 'dry-run' || key === 'json') {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      return { error: { code: 'MISSING_FLAG_VALUE', message: `Missing value for --${key}` } };
    }
    out[key] = next;
    i += 1;
  }
  if (unknown.length > 0) {
    return {
      error: {
        code: 'UNKNOWN_ARGUMENTS',
        message: `Unknown CLI arguments: ${unknown.join(', ')}`,
      },
    };
  }
  return { args: out };
}

function normPath(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInsideRoot(targetPath, rootPath) {
  const rel = path.relative(normPath(rootPath), normPath(targetPath));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readRegisterRow(registerPath, workItemId) {
  if (!registerPath || !fs.existsSync(registerPath)) return null;
  const text = fs.readFileSync(registerPath, 'utf8');
  const records = parseCsvRecords(text);
  if (records.length < 2) return null;
  const headers = records[0].fields.map((h) => String(h || '').trim());
  const idIdx = headers.indexOf('work_item_id');
  const statusIdx = headers.indexOf('status');
  const prIdx = headers.indexOf('pr');
  const mergeIdx = headers.indexOf('merge_commit');
  if (idIdx < 0) return null;
  const matches = [];
  for (let i = 1; i < records.length; i += 1) {
    const f = records[i].fields;
    if (f[idIdx] === workItemId) {
      matches.push({
        status: statusIdx >= 0 ? String(f[statusIdx] || '').trim() : '',
        pr: prIdx >= 0 ? String(f[prIdx] || '').trim() : '',
        mergeCommit: mergeIdx >= 0 ? String(f[mergeIdx] || '').trim() : '',
      });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function hasPositiveInactiveProof({ checkpoint, liveStep, wt }) {
  const cpStatus = String((checkpoint && checkpoint.status) || '').toUpperCase();
  const stepStatus = String((liveStep && liveStep.status) || '').toUpperCase();
  if (ACTIVE_RUN_STATES.has(cpStatus) || ACTIVE_RUN_STATES.has(stepStatus)) {
    return { inactive: false, reason: 'RUN_ACTIVE' };
  }
  if (wt && (wt.active === true || wt.leaseActive === true)) {
    return { inactive: false, reason: 'RUN_ACTIVE' };
  }
  // Pilot fail-closed boundary: no live lease/activity producer exists yet in the
  // repository, so self-declared or historical checkpoint fields never establish
  // current inactivity for a checkout root. Always retain with ACTIVITY_UNOBSERVED.
  return { inactive: false, reason: 'ACTIVITY_UNOBSERVED' };
}

function collectBoundWorktrees(checkpoint, workItemId) {
  const byPath = new Map();
  const addBinding = (entry) => {
    if (!entry || typeof entry !== 'object' || !entry.path) return;
    const key = normPath(entry.path);
    if (!byPath.has(key)) {
      byPath.set(key, {
        path: path.resolve(entry.path),
        owner: entry.owner || null,
        branch: entry.branch || null,
        headSha: entry.headSha || null,
        active: entry.active === true ? true : entry.active === false ? false : null,
        leaseActive: entry.leaseActive === true ? true : entry.leaseActive === false ? false : null,
        activityObservedAt:
          typeof entry.activityObservedAt === 'string' && entry.activityObservedAt.trim()
            ? entry.activityObservedAt.trim()
            : null,
      });
    }
  };

  if (Array.isArray(checkpoint.worktrees)) {
    for (const wt of checkpoint.worktrees) {
      if (wt && wt.workItemId === workItemId) addBinding(wt);
    }
  }
  const liveStep =
    checkpoint.liveSteps &&
    typeof checkpoint.liveSteps === 'object' &&
    checkpoint.liveSteps[workItemId];
  if (liveStep && typeof liveStep === 'object' && (liveStep.workerRoot || liveStep.worktree)) {
    addBinding({
      path: liveStep.workerRoot || liveStep.worktree,
      owner: liveStep.owner || liveStep.writer || checkpoint.owner || null,
      branch: liveStep.branch || null,
      headSha: liveStep.headSha || liveStep.sha || null,
      active: ACTIVE_RUN_STATES.has(String(liveStep.status || '').toUpperCase()),
      leaseActive: Boolean(liveStep.leaseActive),
    });
  }
  const review = extractCheckpointReview(checkpoint, workItemId);
  if (review && review.workerRoot) {
    addBinding({
      path: review.workerRoot,
      owner: review.writerCandidateKey || checkpoint.owner || null,
      branch: review.branch || null,
      headSha: review.sha || null,
      active: false,
      leaseActive: false,
    });
  }
  return {
    worktrees: Array.from(byPath.values()),
    liveStep: liveStep || null,
    review: review || null,
  };
}

function findJunctionOrSymlinkInTree(wtPath) {
  try {
    if (fs.lstatSync(wtPath).isSymbolicLink()) return wtPath;
  } catch (_) {
    return wtPath;
  }
  const stack = [wtPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return current;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return full;
      try {
        const lst = fs.lstatSync(full);
        if (lst.isSymbolicLink()) return full;
        if (lst.isDirectory()) stack.push(full);
      } catch (_) {
        return full;
      }
    }
  }
  return null;
}

function verifyShippedEvidence({ repoRoot, mainRef, registerRow, observedHeadSha, checkpoint }) {
  const ref = mainRef || 'origin/main';
  const mergeSha =
    (registerRow && registerRow.status === 'MERGED' && registerRow.mergeCommit) ||
    (checkpoint && checkpoint.mergeCommit) ||
    null;

  if (!mergeSha || !SHA_40.test(String(mergeSha))) {
    return { proven: false, reason: 'LACKING_SHIPPED_EVIDENCE' };
  }
  if (!repoRoot || !fs.existsSync(repoRoot)) {
    return { proven: false, reason: 'SHIPPED_VERIFICATION_UNOBSERVED' };
  }
  // Check merge commit exists and is an ancestor of mainRef
  const mergeAnc = runHardenedGit(repoRoot, ['merge-base', '--is-ancestor', mergeSha, ref]);
  if (!mergeAnc || mergeAnc.status !== 0) {
    return { proven: false, reason: 'MERGE_COMMIT_NOT_IN_MAIN' };
  }
  // Check observed checkout head is either ancestor of mainRef or has identical tree to mergeSha
  if (observedHeadSha && SHA_40.test(observedHeadSha)) {
    const headAnc = runHardenedGit(repoRoot, ['merge-base', '--is-ancestor', observedHeadSha, ref]);
    if (headAnc && headAnc.status === 0) {
      return { proven: true, mergeCommit: mergeSha, proof: 'ANCESTOR_OF_MAIN' };
    }
    const headTree = runHardenedGit(repoRoot, ['rev-parse', `${observedHeadSha}^{tree}`]);
    const mergeTree = runHardenedGit(repoRoot, ['rev-parse', `${mergeSha}^{tree}`]);
    if (
      headTree &&
      headTree.status === 0 &&
      mergeTree &&
      mergeTree.status === 0 &&
      headTree.stdout.trim() === mergeTree.stdout.trim()
    ) {
      return { proven: true, mergeCommit: mergeSha, proof: 'TREE_EQUALS_MERGE' };
    }
    return { proven: false, reason: 'HEAD_NOT_PROVEN_SHIPPED' };
  }
  return { proven: false, reason: 'LACKING_SHIPPED_EVIDENCE' };
}

function buildHygienePreview({ workItemId, checkpointPath, repoRoot, registerPath, mainRef }) {
  if (!fs.existsSync(checkpointPath)) {
    return {
      ok: false,
      code: 'CHECKPOINT_NOT_FOUND',
      message: `Checkpoint not found: ${checkpointPath}`,
    };
  }
  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      code: 'CHECKPOINT_MALFORMED_JSON',
      message: `Malformed checkpoint JSON: ${err.message}`,
    };
  }
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    return {
      ok: false,
      code: 'CHECKPOINT_INVALID_ROOT',
      message: 'Checkpoint root must be a JSON object',
    };
  }

  const registerRow = readRegisterRow(registerPath, workItemId);
  const {
    worktrees: boundWorktrees,
    liveStep,
    review,
  } = collectBoundWorktrees(checkpoint, workItemId);
  const boundPathSet = new Set(boundWorktrees.map((w) => normPath(w.path)));

  const candidates = [];
  const retained = [];
  const unknowns = [];

  for (const wt of boundWorktrees) {
    const reasons = [];
    if (!wt.owner) reasons.push('MISSING_OWNER_BINDING');
    if (repoRoot && !isInsideRoot(wt.path, repoRoot)) reasons.push('OUTSIDE_EXPECTED_ROOT');

    const inactivity = hasPositiveInactiveProof({ checkpoint, liveStep, review, wt });
    if (!inactivity.inactive) {
      reasons.push(inactivity.reason);
    }

    if (!fs.existsSync(wt.path)) {
      unknowns.push({
        type: 'worktree',
        path: wt.path,
        owner: wt.owner,
        reasons: ['MISSING_ON_DISK'],
      });
      continue;
    }

    const junctionPath = findJunctionOrSymlinkInTree(wt.path);
    if (junctionPath) {
      reasons.push('JUNCTION_AMBIGUOUS');
    }

    const extraSafe = repoRoot ? [repoRoot] : undefined;
    const headRes = runHardenedGit(wt.path, ['rev-parse', 'HEAD'], extraSafe);
    const branchRes = runHardenedGit(wt.path, ['rev-parse', '--abbrev-ref', 'HEAD'], extraSafe);
    const statusRes = runHardenedGit(
      wt.path,
      ['--no-optional-locks', 'status', '--porcelain'],
      extraSafe
    );
    const ignoredRes = runHardenedGit(
      wt.path,
      ['--no-optional-locks', 'status', '--porcelain', '--ignored=matching'],
      extraSafe
    );

    if (!headRes || headRes.status !== 0) {
      reasons.push('NOT_READABLE_GIT_CHECKOUT');
    }
    const observedHead = headRes && headRes.status === 0 ? headRes.stdout.trim() : null;
    const observedBranch = branchRes && branchRes.status === 0 ? branchRes.stdout.trim() : null;
    const dirty = statusRes && statusRes.status === 0 ? statusRes.stdout.trim().length > 0 : true;
    const ignoredLines =
      ignoredRes && ignoredRes.status === 0
        ? ignoredRes.stdout.split(/\r?\n/).filter((line) => line.startsWith('!! '))
        : [];

    if (dirty) reasons.push('WORKTREE_DIRTY');
    if (wt.branch && observedBranch && wt.branch !== observedBranch) {
      reasons.push('BRANCH_MISMATCH');
    }
    if (wt.headSha && observedHead && wt.headSha.toLowerCase() !== observedHead.toLowerCase()) {
      reasons.push('HEAD_MISMATCH');
    }

    const shipped = verifyShippedEvidence({
      repoRoot: repoRoot || null,
      mainRef: mainRef || 'origin/main',
      registerRow,
      observedHeadSha: observedHead,
      checkpoint,
    });
    if (!shipped.proven) {
      reasons.push(shipped.reason);
    }

    const record = {
      type: 'worktree',
      path: wt.path,
      owner: wt.owner,
      branch: observedBranch,
      headSha: observedHead,
      inactivityProof: inactivity.inactive ? inactivity.proof : null,
      shippedProof: shipped.proven ? shipped.proof : null,
      ...(junctionPath ? { junctionPath } : {}),
      hasIgnoredLocalFiles: ignoredLines.length > 0,
      ignoredFilesCount: ignoredLines.length,
      reasons,
    };

    if (reasons.length === 0) {
      candidates.push(record);
    } else {
      retained.push(record);
    }
  }

  // Scan repoRoot/.worktrees only to surface unbound/foreign worktrees as retained (NEVER candidates)
  if (repoRoot) {
    const wtDir = path.join(path.resolve(repoRoot), '.worktrees');
    if (fs.existsSync(wtDir) && fs.statSync(wtDir).isDirectory()) {
      for (const entry of fs.readdirSync(wtDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const full = path.join(wtDir, entry.name);
        if (boundPathSet.has(normPath(full))) continue;
        retained.push({
          type: 'worktree',
          path: full,
          owner: null,
          reasons: ['UNBOUND_FOREIGN_WORKTREE'],
        });
      }
    }
  }

  // Inventory other resource types ONLY when checkpoint provides explicit bindings
  if (Array.isArray(checkpoint.resources)) {
    for (const res of checkpoint.resources) {
      if (!res || typeof res !== 'object') continue;
      if (res.workItemId && res.workItemId !== workItemId) continue;
      const hasBinding = Boolean(res.owner && (res.pid || res.id || res.path));
      if (!hasBinding) {
        unknowns.push({
          type: res.type || 'unknown',
          id: res.id || res.pid || res.path || null,
          reasons: ['INSUFFICIENT_OWNERSHIP_BINDING'],
        });
      } else {
        // Without live runtime observation proving safe disposal, hold as unknown/retained
        unknowns.push({
          type: res.type || 'resource',
          id: res.id || res.pid || res.path || null,
          owner: res.owner,
          reasons: ['LIVE_OBSERVATION_UNAVAILABLE'],
        });
      }
    }
  }

  return {
    ok: true,
    dryRun: true,
    workItemId,
    runId: checkpoint.runId || checkpoint.id || null,
    candidates,
    retained,
    unknowns,
  };
}

function main(argv) {
  const parsed = parseCliArgs(argv);
  if (parsed.error) {
    process.stdout.write(JSON.stringify({ ok: false, ...parsed.error }, null, 2) + '\n');
    return 1;
  }
  const args = parsed.args;
  if (!args['dry-run']) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          code: 'DRY_RUN_REQUIRED',
          message: 'hygiene-check is preview-only and requires --dry-run',
        },
        null,
        2
      ) + '\n'
    );
    return 1;
  }
  if (!args.wi || !args.checkpoint) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          code: 'MISSING_REQUIRED_ARGS',
          message: 'Required flags: --wi <ID> --checkpoint <PATH> --dry-run',
        },
        null,
        2
      ) + '\n'
    );
    return 1;
  }

  const report = buildHygienePreview({
    workItemId: args.wi.trim(),
    checkpointPath: args.checkpoint,
    repoRoot: args['repo-root'] || null,
    registerPath: args.register || null,
    mainRef: args['main-ref'] || null,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildHygienePreview, parseCliArgs, main };
