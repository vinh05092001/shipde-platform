#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Read-only Run Recovery Status (TASK-AI-227 Pilot)
 *
 * Usage:
 *   node tools/ai-brain/resume-status.js --wi <ID> --checkpoint <PATH> --checkout <PATH> [--register <PATH>]
 *
 * Strictly read-only: never mutates checkpoint files (including sibling .tmp),
 * never writes state, never launches jobs, never invokes providers or network.
 */

const fs = require('node:fs');
const path = require('node:path');
const { extractCheckpointReview } = require('./orchestrate/checkpoint');
const { runHardenedGit } = require('./orchestrate/hardened-git');
const { SHA_40, ACCEPTED_VERDICTS } = require('./orchestrate/shared');
const { parseCsvRecords } = require('./reconcile');

const ALLOWED_FLAGS = new Set(['wi', 'checkpoint', 'checkout', 'register', 'json']);

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
    if (key === 'json') {
      out.json = true;
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

function readJsonReadOnly(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      error: { code: 'CHECKPOINT_NOT_FOUND', message: `Checkpoint not found: ${filePath}` },
    };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      error: {
        code: 'CHECKPOINT_READ_ERROR',
        message: `Unable to read checkpoint: ${err.message}`,
      },
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      error: {
        code: 'CHECKPOINT_MALFORMED_JSON',
        message: `Malformed checkpoint JSON: ${err.message}`,
      },
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      error: {
        code: 'CHECKPOINT_INVALID_ROOT',
        message: 'Checkpoint root must be a JSON object',
      },
    };
  }
  return {
    data: parsed,
    pendingTmpFile: fs.existsSync(filePath + '.tmp'),
  };
}

function inspectCheckout(checkoutPath) {
  const resolved = path.resolve(checkoutPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return {
      error: {
        code: 'CHECKOUT_NOT_FOUND',
        message: `Checkout directory not found: ${resolved}`,
      },
    };
  }
  const headRes = runHardenedGit(resolved, ['rev-parse', 'HEAD']);
  if (!headRes || headRes.status !== 0) {
    return {
      error: {
        code: 'CHECKOUT_NOT_GIT_REPO',
        message: `Checkout is not a readable git repository: ${resolved}`,
      },
    };
  }
  const branchRes = runHardenedGit(resolved, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const statusRes = runHardenedGit(resolved, ['--no-optional-locks', 'status', '--porcelain']);
  const observedHeadSha = String(headRes.stdout || '').trim();
  const observedBranch =
    branchRes && branchRes.status === 0 ? String(branchRes.stdout || '').trim() : null;
  const dirty =
    statusRes && statusRes.status === 0 ? String(statusRes.stdout || '').trim().length > 0 : null;
  return {
    observedHeadSha,
    observedBranch,
    dirty,
  };
}

function readRegisterStatus(registerPath, workItemId) {
  if (!registerPath) return { status: 'unknown' };
  if (!fs.existsSync(registerPath)) {
    return { status: 'missing_file', path: path.resolve(registerPath) };
  }
  const text = fs.readFileSync(registerPath, 'utf8');
  const records = parseCsvRecords(text);
  if (records.length < 2) return { status: 'malformed' };
  const headers = records[0].fields.map((h) => String(h || '').trim());
  const idIdx = headers.indexOf('work_item_id');
  const statusIdx = headers.indexOf('status');
  const branchIdx = headers.indexOf('branch');
  const prIdx = headers.indexOf('pr');
  const mergeIdx = headers.indexOf('merge_commit');
  if (idIdx < 0) return { status: 'malformed' };
  const matches = [];
  for (let i = 1; i < records.length; i += 1) {
    const f = records[i].fields;
    if (f[idIdx] === workItemId) {
      matches.push({
        status: statusIdx >= 0 ? String(f[statusIdx] || '').trim() : '',
        branch: branchIdx >= 0 ? String(f[branchIdx] || '').trim() : '',
        pr: prIdx >= 0 ? String(f[prIdx] || '').trim() : '',
        mergeCommit: mergeIdx >= 0 ? String(f[mergeIdx] || '').trim() : '',
      });
    }
  }
  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'duplicate_rows', count: matches.length };
  return { status: 'found', row: matches[0] };
}

function findItemRecord(checkpoint, workItemId) {
  const liveStep =
    checkpoint.liveSteps &&
    typeof checkpoint.liveSteps === 'object' &&
    checkpoint.liveSteps[workItemId] &&
    typeof checkpoint.liveSteps[workItemId] === 'object'
      ? checkpoint.liveSteps[workItemId]
      : null;

  let itemEntry = null;
  if (Array.isArray(checkpoint.items)) {
    itemEntry =
      checkpoint.items.find((it) => it && (it.workItemId === workItemId || it.id === workItemId)) ||
      null;
  } else if (checkpoint.items && typeof checkpoint.items === 'object') {
    itemEntry = checkpoint.items[workItemId] || null;
  }

  let worktreeEntry = null;
  if (Array.isArray(checkpoint.worktrees)) {
    worktreeEntry = checkpoint.worktrees.find((w) => w && w.workItemId === workItemId) || null;
  }

  const review = extractCheckpointReview(checkpoint, workItemId);
  return { liveStep, itemEntry, worktreeEntry, review };
}

function buildResumeStatus({ workItemId, checkpointPath, checkoutPath, registerPath }) {
  const cpResult = readJsonReadOnly(checkpointPath);
  if (cpResult.error) return { ok: false, ...cpResult.error };

  const gitObs = inspectCheckout(checkoutPath);
  if (gitObs.error) return { ok: false, ...gitObs.error };

  const checkpoint = cpResult.data;
  const { liveStep, itemEntry, worktreeEntry, review } = findItemRecord(checkpoint, workItemId);
  const registerObs = readRegisterStatus(registerPath, workItemId);

  const hasAnyRecord = Boolean(liveStep || itemEntry || worktreeEntry || review);

  const recordedBaseSha =
    (review && review.baseSha) ||
    (liveStep && liveStep.baseSha) ||
    (itemEntry && itemEntry.baseSha) ||
    checkpoint.baseSha ||
    null;

  const recordedHeadSha =
    (review && review.sha) ||
    (liveStep && (liveStep.headSha || liveStep.sha)) ||
    (worktreeEntry && worktreeEntry.headSha) ||
    (itemEntry && (itemEntry.headSha || itemEntry.sha)) ||
    null;

  const recordedBranch =
    (review && review.branch) ||
    (liveStep && liveStep.branch) ||
    (worktreeEntry && worktreeEntry.branch) ||
    (itemEntry && itemEntry.branch) ||
    null;

  const headMatchesRecorded =
    recordedHeadSha && SHA_40.test(String(recordedHeadSha))
      ? gitObs.observedHeadSha.toLowerCase() === String(recordedHeadSha).toLowerCase()
      : null;

  const owner = {
    writer:
      (review && review.writerCandidateKey) ||
      (liveStep && liveStep.writer) ||
      (itemEntry && itemEntry.writer) ||
      null,
    reviewer: (review && review.reviewer) || (liveStep && liveStep.reviewer) || null,
    activeOwner:
      (liveStep && liveStep.owner) ||
      (worktreeEntry && worktreeEntry.owner) ||
      (itemEntry && itemEntry.owner) ||
      checkpoint.owner ||
      null,
  };

  const reviewState = review
    ? {
        verdict: review.verdict || 'unknown',
        reviewedSha: review.sha || null,
        reviewer: review.reviewer || null,
        reviewRounds: review.reviewRounds !== undefined ? review.reviewRounds : null,
        openFindings: review.openFindings !== undefined ? review.openFindings : null,
        repairCount: review.repairCount !== undefined ? review.repairCount : null,
      }
    : {
        verdict: 'unknown',
        reviewedSha: null,
        reviewer: null,
        reviewRounds: null,
        openFindings: null,
        repairCount: null,
      };

  // Missing PR / CI / worker observations always stay "unknown" — never promoted to PASS.
  const observations = {
    pr:
      (liveStep && liveStep.prObservation) ||
      (checkpoint.observations && checkpoint.observations.pr) ||
      'unknown',
    ci:
      (liveStep && liveStep.ciObservation) ||
      (checkpoint.observations && checkpoint.observations.ci) ||
      'unknown',
    worker:
      (liveStep && liveStep.workerObservation) ||
      (checkpoint.observations && checkpoint.observations.worker) ||
      'unknown',
    register: registerObs,
    pendingTmpFile: cpResult.pendingTmpFile,
  };

  const reasons = [];
  if (!hasAnyRecord) {
    reasons.push('WORK_ITEM_NOT_IN_CHECKPOINT');
  }
  if (headMatchesRecorded === false) {
    reasons.push('HEAD_MISMATCH');
  }
  if (recordedBranch && gitObs.observedBranch && recordedBranch !== gitObs.observedBranch) {
    reasons.push('BRANCH_MISMATCH');
  }

  const reconciliationNeeded = reasons.length > 0;
  let nextAction;
  if (reasons.includes('HEAD_MISMATCH')) {
    nextAction = 'RECONCILE_HEAD_MISMATCH';
  } else if (reasons.includes('WORK_ITEM_NOT_IN_CHECKPOINT')) {
    nextAction = 'RECONCILE_MISSING_RECORD';
  } else if (reconciliationNeeded) {
    nextAction = 'RECONCILE_STATE_DRIFT';
  } else if (reviewState.verdict === 'CHANGES_REQUIRED') {
    nextAction = 'CHECK_REVIEW_FINDINGS_BEFORE_REPAIR';
  } else if (ACCEPTED_VERDICTS.includes(reviewState.verdict)) {
    nextAction = 'VERIFY_PR_AND_CI_OBSERVATIONS';
  } else {
    nextAction = 'CHECK_PENDING_REVIEW_STATUS';
  }

  return {
    ok: true,
    workItemId,
    runId: checkpoint.runId || checkpoint.id || null,
    phase: (liveStep && liveStep.phase) || checkpoint.phase || checkpoint.status || 'unknown',
    owner,
    git: {
      checkoutPath: path.resolve(checkoutPath),
      recordedBaseSha,
      recordedHeadSha,
      recordedBranch,
      observedHeadSha: gitObs.observedHeadSha,
      observedBranch: gitObs.observedBranch,
      dirty: gitObs.dirty,
      headMatchesRecorded,
    },
    review: reviewState,
    observations,
    reconciliation: {
      needed: reconciliationNeeded,
      reasons,
    },
    nextAction,
  };
}

function main(argv) {
  const parsed = parseCliArgs(argv);
  if (parsed.error) {
    process.stdout.write(JSON.stringify({ ok: false, ...parsed.error }, null, 2) + '\n');
    return 1;
  }
  const { wi, checkpoint, checkout, register } = parsed.args;
  if (!wi || !checkpoint || !checkout) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          code: 'MISSING_REQUIRED_ARGS',
          message: 'Required flags: --wi <ID> --checkpoint <PATH> --checkout <PATH>',
        },
        null,
        2
      ) + '\n'
    );
    return 1;
  }

  const report = buildResumeStatus({
    workItemId: wi.trim(),
    checkpointPath: checkpoint,
    checkoutPath: checkout,
    registerPath: register || null,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildResumeStatus, parseCliArgs, main };
