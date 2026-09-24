'use strict';

/**
 * Ship Dễ — Evidence Store (Slices B+C)
 *
 * Probe results, run outcomes, alias mappings and shared-quota records for
 * candidate combinations.  Every candidate is a four-part tuple:
 *
 *   (harness, accessPath, upstream, modelId)
 *
 * The store reads and writes `evidence.json` inside a configurable directory.
 * The shape mirrors the structure proven in the seed-evidence prototype but
 * is addressed through helpers so callers never manipulate the raw JSON.
 */

const fs = require('fs');
const path = require('path');

/** Evidence levels — higher numbers are stronger evidence. */
const Level = { API: 1, HARNESS: 2, OUTCOME: 3 };
const Status = { PASSED: 'passed', FAILED: 'failed', UNKNOWN: 'unknown' };

const BLOCK_CODES = new Set([401, 402, 403, 503]);
const BLOCK_TTL_MS = 3600_000; // 1 hour

function evidencePath(dir) {
  return path.join(dir, 'evidence.json');
}

function empty() {
  return { combinations: [], aliases: [], sharedQuotas: [], upstreamStatus: {} };
}

/** Load or return empty skeleton. */
function loadEvidence(dir) {
  const fp = evidencePath(dir);
  try {
    const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (!data.upstreamStatus) data.upstreamStatus = {};
    if (!data.aliases) data.aliases = [];
    if (!data.sharedQuotas) data.sharedQuotas = [];
    return data;
  } catch (err) {
    if (err && err.code === 'ENOENT') return empty();
    throw err;
  }
}

function saveEvidence(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(evidencePath(dir), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Canonical key for a four-part candidate. */
function candidateKey(c) {
  return [c.harness, c.accessPath, c.upstream, c.modelId].join('::');
}

function findCombo(data, c) {
  return data.combinations.find(
    (x) =>
      x.harness === c.harness &&
      x.accessPath === c.accessPath &&
      x.upstream === c.upstream &&
      x.model === c.modelId
  );
}

/** Record a probe or outcome against a candidate. */
function recordProbe(dir, candidate, item) {
  const data = loadEvidence(dir);
  let combo = findCombo(data, candidate);
  if (!combo) {
    combo = {
      harness: candidate.harness,
      accessPath: candidate.accessPath,
      upstream: candidate.upstream,
      model: candidate.modelId,
      evidence: [],
    };
    data.combinations.push(combo);
  }
  combo.evidence.push(Object.assign({ ts: new Date().toISOString() }, item));

  // Update upstream status on blocking errors.
  if (item.httpStatus && BLOCK_CODES.has(item.httpStatus)) {
    const key = candidate.upstream;
    if (!data.upstreamStatus[key]) {
      data.upstreamStatus[key] = { lastStatus: 'unknown', failCount: 0 };
    }
    const us = data.upstreamStatus[key];
    us.lastStatus = 'blocked';
    us.failCount += 1;
    us.blockedAt = new Date().toISOString();
    us.blockReason = 'HTTP ' + item.httpStatus;
    us.scope = 'upstream';
  }

  saveEvidence(dir, data);
  return combo;
}

/** Get evidence items for a candidate. */
function getEvidence(data, candidate) {
  const combo = findCombo(data, candidate);
  return combo ? combo.evidence : [];
}

/** Is an upstream currently blocked?  Scope is always the upstream, never the gateway. */
function isUpstreamBlocked(data, upstream, opts) {
  const us = data.upstreamStatus[upstream];
  if (!us || us.lastStatus !== 'blocked') return { blocked: false, status: us ? us.lastStatus : 'unknown' };
  const now = (opts && opts.now) || Date.now();
  const age = now - new Date(us.blockedAt).getTime();
  if (age >= BLOCK_TTL_MS) return { blocked: false, status: 'expired' };
  return { blocked: true, reason: us.blockReason, since: us.blockedAt, scope: 'upstream' };
}

/** Overall status for a candidate: passed / failed / unknown. */
function candidateStatus(data, candidate) {
  const ev = getEvidence(data, candidate);
  if (ev.length === 0) return 'unknown';
  // Latest evidence wins.
  const last = ev[ev.length - 1];
  return last.status || 'unknown';
}

/** Record an alias mapping. An alias counts only after verified by a successful run. */
function recordAlias(dir, upstream, canonical, harness, alias, verified, note) {
  const data = loadEvidence(dir);
  const existing = data.aliases.find(
    (a) => a.upstream === upstream && a.canonical === canonical && a.harness === harness && a.alias === alias
  );
  if (existing) {
    existing.verified = Boolean(verified);
    if (note) existing.note = note;
  } else {
    data.aliases.push({ upstream, canonical, harness, alias, verified: Boolean(verified), note: note || null });
  }
  saveEvidence(dir, data);
}

/** Record shared-quota relationship.  Defaults to unknown until verified. */
function recordSharedQuota(dir, pathA, pathB, status, verified, reason) {
  const data = loadEvidence(dir);
  const existing = data.sharedQuotas.find((sq) => sq.pathA === pathA && sq.pathB === pathB);
  if (existing) {
    existing.status = status;
    existing.verified = Boolean(verified);
    existing.reason = reason;
  } else {
    data.sharedQuotas.push({
      pathA,
      pathB,
      status: status || 'unknown',
      verified: Boolean(verified),
      reason: reason || null,
    });
  }
  saveEvidence(dir, data);
}

/** Shared-quota status between two paths.  Default: unknown. */
function sharedQuotaStatus(data, pathA, pathB) {
  const sq = data.sharedQuotas.find(
    (s) => (s.pathA === pathA && s.pathB === pathB) || (s.pathA === pathB && s.pathB === pathA)
  );
  return sq || { status: 'unknown', verified: false };
}

module.exports = {
  Level,
  Status,
  BLOCK_CODES,
  BLOCK_TTL_MS,
  loadEvidence,
  saveEvidence,
  candidateKey,
  recordProbe,
  getEvidence,
  isUpstreamBlocked,
  candidateStatus,
  recordAlias,
  recordSharedQuota,
  sharedQuotaStatus,
};
