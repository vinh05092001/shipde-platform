'use strict';

/**
 * Ship Dễ — Publish approval registry (TASK-AI-64, publisher gate P2)
 *
 * The publisher reads an approval registry that nothing else in the repository
 * wrote (ai64 gap audit section 10, Gap B), so a live publish was impossible by
 * construction. This module is the producer, and its whole purpose is to make
 * that construction explicit rather than convenient.
 *
 * An approval is a **human** decision, so this module never mints one on its own:
 * it writes what a named authority already decided, it refuses to write it from
 * inside the worker boundary, and it binds the approval to the exact commit the
 * reviewer read. An approval that is not bound to a reviewed SHA is the old
 * flat registry entry, and the publisher keeps accepting it for the records
 * that predate this module; a new approval written here is always bound.
 *
 * The registry lives on the operator side. The worker cannot reach it (OS
 * boundary, TASK-AI-61), and the write refuses a path inside the worker root
 * even if a caller tries to point it there.
 *
 * Entry shape (the one the publisher validates against):
 *
 *   { approvalId, state, reviewedSha, verdict, reviewer, issuedAt, expiry }
 *
 * `state` is APPROVED | PENDING | REJECTED, `reviewedSha` is the exact 40-hex
 * commit the reviewer read, `reviewer` names who reviewed it (AI-SUP-21: a
 * verdict that names nobody is not a verdict) and `expiry` bounds how long the
 * approval authorises a push.
 */

const fs = require('fs');
const path = require('path');
const { isWorkerPath } = require('./isolation-launcher');

const State = Object.freeze({
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
});

const Verdict = Object.freeze({
  PASS: 'PASS',
  FALLBACK_PASS: 'FALLBACK_PASS',
});

const SHA_40 = /^[0-9a-f]{40}$/i;

/** The operator-side registry the publisher reads. Never inside the worker. */
function registryPath(override) {
  return override || path.join(process.env.LOCALAPPDATA || 'C:\\temp', 'ShipDe', 'approvals.json');
}

/**
 * The registry as an object. An absent file is an empty registry, which the
 * publisher refuses unless the caller injected its explicit test mode; a
 * damaged file is a refusal rather than a silent empty read, because an
 * approval that cannot be read has not been withdrawn.
 */
function readRegistry(override) {
  const file = registryPath(override);
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('APPROVAL_REGISTRY_INVALID: ' + file + ' is not an approval registry');
  }
  return parsed;
}

/**
 * The raw entry for an id, in either the historical flat form ('APPROVED') or
 * the bound form (an object). null when the id is not registered at all.
 */
function approvalEntry(registry, approvalId) {
  if (!registry || !approvalId) return null;
  const entry = registry[approvalId];
  return entry === undefined || entry === null ? null : entry;
}

/** APPROVED / PENDING / REJECTED, or null when the entry names no state. */
function approvalState(entry) {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return entry.state || null;
  return null;
}

/** The commit the approval was given for, or null for an unbound legacy entry. */
function approvalReviewedSha(entry) {
  if (entry && typeof entry === 'object' && typeof entry.reviewedSha === 'string') {
    return entry.reviewedSha;
  }
  return null;
}

function approvalVerdict(entry) {
  return entry && typeof entry === 'object' && typeof entry.verdict === 'string'
    ? entry.verdict
    : null;
}

function approvalReviewer(entry) {
  return entry && typeof entry === 'object' && typeof entry.reviewer === 'string'
    ? entry.reviewer
    : null;
}

/** The approval's own expiry in epoch ms, or null when it states none. */
function approvalExpiry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.expiry) return null;
  const parsed = Date.parse(entry.expiry);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Writes one approval. Refuses, in order: a path inside the worker boundary, a
 * missing id, a state outside the enum, a reviewed commit that is not a
 * 40-character SHA, a verdict outside the enum, a reviewer that names nobody, a
 * missing or past expiry, and a second write to an id that already exists —
 * an approval is a human decision taken once, and a loop that can re-approve
 * itself has proved nothing.
 *
 * Returns the entry as written.
 */
function recordApproval(approval, options) {
  const o = options || {};
  const file = registryPath(o.registryPath);

  if (isWorkerPath(file)) {
    throw new Error(
      'APPROVAL_REFUSED: the approval registry must live operator-side, not inside the worker root'
    );
  }
  const id = approval && approval.approvalId;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('APPROVAL_REFUSED: missing approvalId');
  }
  const state = approvalState(approval);
  if (!Object.values(State).includes(state)) {
    throw new Error('APPROVAL_REFUSED: state must be one of ' + Object.values(State).join(', '));
  }
  const reviewedSha = approvalReviewedSha(approval);
  if (!reviewedSha || !SHA_40.test(reviewedSha)) {
    throw new Error('APPROVAL_REFUSED: reviewedSha must be the exact 40-character commit reviewed');
  }
  const verdict = approvalVerdict(approval);
  if (!verdict || !Object.values(Verdict).includes(verdict)) {
    throw new Error(
      'APPROVAL_REFUSED: verdict must be one of ' + Object.values(Verdict).join(', ')
    );
  }
  if (!approvalReviewer(approval)) {
    throw new Error('APPROVAL_REFUSED: reviewer must name who reviewed the commit');
  }
  const expiry = approvalExpiry(approval);
  if (expiry === null) {
    throw new Error('APPROVAL_REFUSED: expiry is required and must be a date');
  }
  if (expiry <= (o.now || Date.now())) {
    throw new Error('APPROVAL_REFUSED: expiry is in the past');
  }

  const existing = readRegistry(o.registryPath);
  if (approvalEntry(existing, id) !== null) {
    throw new Error('APPROVAL_REFUSED: ' + id + ' is already registered');
  }

  const entry = {
    approvalId: id,
    state,
    reviewedSha,
    verdict,
    reviewer: approval.reviewer,
    issuedAt: approval.issuedAt || new Date(o.now || Date.now()).toISOString(),
    expiry: approval.expiry,
  };

  const next = Object.assign({}, existing);
  next[id] = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Same atomic tmp+rename the dispatch checkpoint uses: an approval that is
  // half-written is an approval the publisher cannot read.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return entry;
}

module.exports = {
  State,
  Verdict,
  SHA_40,
  registryPath,
  readRegistry,
  approvalEntry,
  approvalState,
  approvalReviewedSha,
  approvalVerdict,
  approvalReviewer,
  approvalExpiry,
  recordApproval,
};
