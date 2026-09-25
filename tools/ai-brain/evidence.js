'use strict';

/**
 * Ship Dễ — Evidence Store (Slices B+C)
 *
 * Probe results, run outcomes, alias mappings and shared-quota records for
 * candidate combinations. Every candidate has a canonical seven-part identity:
 *
 *   (harness, accessPath, gateway, upstream, accountId, quotaScope, modelId)
 *
 * The store reads and writes `evidence.json` inside a configurable directory.
 * The shape mirrors the structure proven in the seed-evidence prototype but
 * is addressed through helpers so callers never manipulate the raw JSON.
 *
 * Schema version 2 tracks the complete seven-part candidate identity.
 * Legacy version 1 files containing only four fields are migrated FAIL-CLOSED:
 * versioned, not deleted, and never assigned a default account or quotaScope
 * and treated as verified. Old rows stay usable only as unverified history.
 */

const fs = require('fs');
const path = require('path');
const { classifyFailure, Scope, Cause, DEFAULT_COOLDOWNS } = require('./failure-classifier');

const SCHEMA_VERSION = 2;

/** Evidence levels — higher numbers are stronger evidence. */
const Level = { API: 1, HARNESS: 2, OUTCOME: 3 };
const Status = { PASSED: 'passed', FAILED: 'failed', UNKNOWN: 'unknown' };

const BLOCK_CODES = new Set([401, 402, 403, 404, 429, 503]);
const BLOCK_TTL_MS = 24 * 3600_000; // 24 hours default fallback

function evidencePath(dir) {
  return path.join(dir, 'evidence.json');
}

function empty() {
  return {
    version: SCHEMA_VERSION,
    combinations: [],
    aliases: [],
    sharedQuotas: [],
    upstreamStatus: {},
    cooldowns: {},
  };
}

/**
 * Migrate legacy evidence store to schema version 2 (fail-closed).
 * Legacy 4-field rows are retained as unverified history; they are never
 * given default accounts or treated as verified.
 */
function migrateEvidence(data) {
  if (!data) return empty();
  if (!data.version || data.version < SCHEMA_VERSION) {
    data.version = SCHEMA_VERSION;
    for (const combo of data.combinations || []) {
      if (!combo.accountId && !combo.quotaScope) {
        combo.legacy = true;
        combo.verified = false;
        combo.accountId = null;
        combo.quotaScope = null;
        combo.gateway = combo.gateway || '';
      }
    }
  }
  if (!data.combinations) data.combinations = [];
  if (!data.upstreamStatus) data.upstreamStatus = {};
  if (!data.cooldowns) data.cooldowns = {};
  if (!data.aliases) data.aliases = [];
  if (!data.sharedQuotas) data.sharedQuotas = [];
  return data;
}

/** Load or return empty skeleton. */
function loadEvidence(dir) {
  const fp = evidencePath(dir);
  try {
    const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    return migrateEvidence(data);
  } catch (err) {
    if (err && err.code === 'ENOENT') return empty();
    throw err;
  }
}

function saveEvidence(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  if (!data.version) data.version = SCHEMA_VERSION;
  fs.writeFileSync(evidencePath(dir), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Canonical seven-part identity for a candidate. */
function candidateKey(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  return [
    c.harness || '',
    c.accessPath || '',
    c.gateway || '',
    c.upstream || '',
    c.accountId || '*',
    c.quotaScope || '',
    c.modelId || c.model || '',
  ].join('::');
}

function findCombo(data, c) {
  if (!data || !data.combinations || !c) return null;
  const targetKey = candidateKey(c);
  return data.combinations.find((x) => {
    if (x.legacy) {
      // Legacy unverified row only matches if target is explicitly querying legacy (no account)
      return !c.accountId && candidateKey(x) === targetKey;
    }
    return candidateKey(x) === targetKey;
  });
}

/** Record a probe or outcome against a candidate. */
function recordProbe(dir, candidate, item) {
  const data = loadEvidence(dir);
  let combo = findCombo(data, candidate);
  if (!combo) {
    combo = {
      harness: candidate.harness,
      accessPath: candidate.accessPath,
      gateway: candidate.gateway || '',
      upstream: candidate.upstream,
      accountId: candidate.accountId || '*',
      quotaScope: candidate.quotaScope || '',
      model: candidate.modelId || candidate.model,
      evidence: [],
    };
    data.combinations.push(combo);
  }

  // A failure with no HTTP response carries no httpStatus; a process exit is recorded as a process exit
  const evItem = Object.assign({ ts: new Date().toISOString() }, item);
  if (evItem.httpStatus === undefined || evItem.httpStatus === null) {
    delete evItem.httpStatus;
  }
  if (item.exitCode !== undefined && item.exitCode !== null) {
    evItem.exitCode = item.exitCode;
  }
  combo.evidence.push(evItem);

  const isFailure =
    item.status === 'failed' ||
    item.status === Status.FAILED ||
    (typeof item.httpStatus === 'number' && item.httpStatus >= 400) ||
    (typeof item.exitCode === 'number' && item.exitCode !== 0);

  if (isFailure) {
    const classification = classifyFailure({
      exitCode: item.exitCode,
      httpStatus: item.httpStatus,
      body:
        item.body ||
        item.cause ||
        (typeof item.error === 'string' ? item.error : '') ||
        item.message ||
        '',
      stderr: item.stderr || '',
      accountId: candidate.accountId,
    });

    const key = candidateKey(candidate);
    const nowIso = new Date().toISOString();
    if (!data.cooldowns) data.cooldowns = {};
    if (!data.cooldowns[key]) {
      data.cooldowns[key] = { lastStatus: 'unknown', failCount: 0 };
    }
    const cd = data.cooldowns[key];
    cd.lastStatus = 'blocked';
    cd.failCount += 1;
    cd.blockedAt = nowIso;
    cd.blockReason =
      classification.cause +
      (classification.evidence && classification.evidence.httpStatus
        ? ' (HTTP ' + classification.evidence.httpStatus + ')'
        : item.exitCode !== undefined
          ? ' (exit ' + item.exitCode + ')'
          : '');
    cd.cause = classification.cause;
    cd.scope = classification.scope;
    cd.cooldownMs = classification.cooldownMs;
    cd.resetTime = classification.resetTime;
    cd.humanAction = classification.humanAction;
    cd.offeringId = key;
    cd.harness = candidate.harness;
    cd.accessPath = candidate.accessPath;
    cd.gateway = candidate.gateway || '';
    cd.upstream = candidate.upstream;
    cd.accountId = candidate.accountId || '*';
    cd.quotaScope = candidate.quotaScope || '';
    cd.modelId = candidate.modelId || candidate.model;

    // Apply the scope the classifier returns:
    // model, upstream, account, access path, gateway or harness - and nothing wider.
    // UNKNOWN cools down exactly the one candidate that produced it - never a harness, never a gateway.
    if (classification.scope === Scope.UPSTREAM || classification.scope === 'upstream') {
      const uKey = candidate.upstream;
      if (!data.upstreamStatus) data.upstreamStatus = {};
      if (!data.upstreamStatus[uKey]) {
        data.upstreamStatus[uKey] = { lastStatus: 'unknown', failCount: 0 };
      }
      const us = data.upstreamStatus[uKey];
      us.lastStatus = 'blocked';
      us.failCount += 1;
      us.blockedAt = nowIso;
      us.blockReason = cd.blockReason;
      us.cause = classification.cause;
      us.scope = 'upstream';
      us.cooldownMs = classification.cooldownMs;
      us.resetTime = classification.resetTime;
    }
  }

  saveEvidence(dir, data);
  return combo;
}

/** Get evidence items for a candidate. */
function getEvidence(data, candidate) {
  const combo = findCombo(data, candidate);
  if (!combo || combo.legacy || combo.verified === false) return [];
  return combo.evidence || [];
}

function isCooldownActive(record, now) {
  if (!record || record.lastStatus !== 'blocked') return false;
  const blockedAt = new Date(record.blockedAt).getTime();
  if (isNaN(blockedAt)) return false;
  if (record.resetTime) {
    const resetAt =
      typeof record.resetTime === 'number'
        ? record.resetTime
        : new Date(record.resetTime).getTime();
    if (!isNaN(resetAt)) {
      return now < resetAt;
    }
  }
  if (record.cooldownMs === null) {
    return true; // Never recovers on time alone
  }
  const ttl = typeof record.cooldownMs === 'number' ? record.cooldownMs : BLOCK_TTL_MS;
  return now - blockedAt < ttl;
}

/** Is a candidate currently blocked by account/candidate cooldown or upstream outage? */
function isCandidateBlocked(data, candidate, opts) {
  if (!candidate || !data) return { blocked: false, status: 'unknown' };
  const now = (opts && opts.now) || Date.now();

  let candObj = candidate;
  let cKey = candidate;
  if (typeof candidate === 'string') {
    cKey = candidate;
    const parts = candidate.split('::');
    candObj = {
      harness: parts[0] || '',
      accessPath: parts[1] || '',
      gateway: parts[2] || '',
      upstream: parts[3] || '',
      accountId: parts[4] || '*',
      quotaScope: parts[5] || '',
      modelId: parts[6] || '',
    };
  } else {
    cKey = candidateKey(candidate);
  }
  const candModel = candObj.modelId || candObj.model || '';

  // 1. Candidate-level cooldown (exact 7-part key)
  if (data.cooldowns && data.cooldowns[cKey]) {
    const cd = data.cooldowns[cKey];
    if (isCooldownActive(cd, now)) {
      return {
        blocked: true,
        reason: cd.blockReason,
        since: cd.blockedAt,
        scope: cd.scope || 'candidate',
      };
    }
  }

  // 2. Scoped cooldowns in data.cooldowns
  if (data.cooldowns) {
    for (const [key, cd] of Object.entries(data.cooldowns)) {
      if (!isCooldownActive(cd, now)) continue;

      // Account scope: only candidates on the same upstream and same account
      if (cd.scope === Scope.ACCOUNT || cd.scope === 'account') {
        const cdAccount = cd.accountId || key.split('::')[4];
        const cdUpstream = cd.upstream || key.split('::')[3];
        if (
          candObj.accountId &&
          candObj.accountId !== '*' &&
          candObj.accountId === cdAccount &&
          candObj.upstream === cdUpstream
        ) {
          return {
            blocked: true,
            reason: cd.blockReason,
            since: cd.blockedAt,
            scope: 'account',
          };
        }
      }

      // Access path scope: "a 404 excludes that model on that access path only"
      if (cd.scope === Scope.ACCESS_PATH || cd.scope === 'access_path') {
        const cdAccessPath = cd.accessPath || key.split('::')[1];
        const cdModel = cd.modelId || key.split('::')[6];
        if (candObj.accessPath === cdAccessPath && candModel === cdModel) {
          return {
            blocked: true,
            reason: cd.blockReason,
            since: cd.blockedAt,
            scope: 'access_path',
          };
        }
      }

      // Model scope
      if (cd.scope === Scope.MODEL || cd.scope === 'model') {
        const cdModel = cd.modelId || key.split('::')[6];
        const cdUpstream = cd.upstream || key.split('::')[3];
        if (candModel === cdModel && (!cdUpstream || candObj.upstream === cdUpstream)) {
          return {
            blocked: true,
            reason: cd.blockReason,
            since: cd.blockedAt,
            scope: 'model',
          };
        }
      }

      // Gateway scope
      if (cd.scope === Scope.GATEWAY || cd.scope === 'gateway') {
        const cdGateway = cd.gateway || key.split('::')[2];
        if (candObj.gateway && candObj.gateway === cdGateway) {
          return {
            blocked: true,
            reason: cd.blockReason,
            since: cd.blockedAt,
            scope: 'gateway',
          };
        }
      }

      // Harness scope
      if (cd.scope === Scope.HARNESS || cd.scope === 'harness') {
        const cdHarness = cd.harness || key.split('::')[0];
        if (candObj.harness && candObj.harness === cdHarness) {
          return {
            blocked: true,
            reason: cd.blockReason,
            since: cd.blockedAt,
            scope: 'harness',
          };
        }
      }
    }
  }

  // 3. Upstream-level block (e.g. 503 outage or shared upstream block)
  const upstream = candObj.upstream;
  if (upstream && data.upstreamStatus && data.upstreamStatus[upstream]) {
    const us = data.upstreamStatus[upstream];
    if (isCooldownActive(us, now)) {
      return {
        blocked: true,
        reason: us.blockReason,
        since: us.blockedAt,
        scope: 'upstream',
      };
    }
  }

  return { blocked: false, status: 'unknown' };
}

/** Is an upstream or candidate currently blocked? Accepts candidate object, 7-part key, or upstream name. */
function isUpstreamBlocked(data, target, opts) {
  if (typeof target === 'object' && target !== null) {
    return isCandidateBlocked(data, target, opts);
  }
  const str = String(target || '');
  if (str.includes('::')) {
    return isCandidateBlocked(data, str, opts);
  }
  const us = data && data.upstreamStatus && data.upstreamStatus[str];
  if (!us || us.lastStatus !== 'blocked')
    return { blocked: false, status: us ? us.lastStatus : 'unknown' };
  const now = (opts && opts.now) || Date.now();
  if (!isCooldownActive(us, now)) return { blocked: false, status: 'expired' };
  return { blocked: true, reason: us.blockReason, since: us.blockedAt, scope: 'upstream' };
}

/** Overall status for a candidate: passed / failed / unknown. */
function candidateStatus(data, candidate) {
  const combo = findCombo(data, candidate);
  if (!combo || combo.legacy || combo.verified === false) return 'unknown';
  const ev = combo.evidence || [];
  if (ev.length === 0) return 'unknown';
  // Latest evidence wins.
  const last = ev[ev.length - 1];
  return last.status || 'unknown';
}

/** Record an alias mapping using seven-part identity dimensions. */
function recordAlias(dir, upstreamOrCandidate, canonical, harness, alias, verified, note, extra) {
  const data = loadEvidence(dir);
  let record;
  if (typeof upstreamOrCandidate === 'object' && upstreamOrCandidate !== null) {
    const c = upstreamOrCandidate;
    record = {
      harness: c.harness,
      accessPath: c.accessPath || '',
      gateway: c.gateway || '',
      upstream: c.upstream,
      accountId: c.accountId || '*',
      quotaScope: c.quotaScope || '',
      canonical,
      alias,
      verified: Boolean(verified),
      note: note || null,
    };
  } else {
    const opts = (typeof extra === 'object' && extra) || {};
    record = {
      harness,
      accessPath: opts.accessPath || '',
      gateway: opts.gateway || '',
      upstream: upstreamOrCandidate,
      accountId: opts.accountId || '*',
      quotaScope: opts.quotaScope || '',
      canonical,
      alias,
      verified: Boolean(verified),
      note: note || null,
    };
  }
  const existing = data.aliases.find(
    (a) =>
      a.harness === record.harness &&
      (a.accessPath || '') === record.accessPath &&
      (a.gateway || '') === record.gateway &&
      a.upstream === record.upstream &&
      (a.accountId || '*') === record.accountId &&
      (a.quotaScope || '') === record.quotaScope &&
      a.canonical === record.canonical &&
      a.alias === record.alias
  );
  if (existing) {
    existing.verified = Boolean(verified);
    if (note) existing.note = note;
  } else {
    data.aliases.push(record);
  }
  saveEvidence(dir, data);
}

function normQuotaPath(p) {
  if (!p) return '';
  if (typeof p === 'object') return candidateKey(p);
  return String(p);
}

/** Record shared-quota relationship. Defaults to unknown until verified. */
function recordSharedQuota(dir, pathA, pathB, status, verified, reason) {
  const data = loadEvidence(dir);
  const kA = normQuotaPath(pathA);
  const kB = normQuotaPath(pathB);
  const existing = data.sharedQuotas.find(
    (sq) =>
      (normQuotaPath(sq.pathA) === kA && normQuotaPath(sq.pathB) === kB) ||
      (normQuotaPath(sq.pathA) === kB && normQuotaPath(sq.pathB) === kA)
  );
  if (existing) {
    existing.status = status;
    existing.verified = Boolean(verified);
    existing.reason = reason;
  } else {
    data.sharedQuotas.push({
      pathA: kA,
      pathB: kB,
      status: status || 'unknown',
      verified: Boolean(verified),
      reason: reason || null,
    });
  }
  saveEvidence(dir, data);
}

/** Shared-quota status between two paths/candidates. Default: unknown. */
function sharedQuotaStatus(data, pathA, pathB) {
  const kA = normQuotaPath(pathA);
  const kB = normQuotaPath(pathB);
  const sq = (data.sharedQuotas || []).find(
    (s) =>
      (normQuotaPath(s.pathA) === kA && normQuotaPath(s.pathB) === kB) ||
      (normQuotaPath(s.pathA) === kB && normQuotaPath(s.pathB) === kA)
  );
  return sq || { status: 'unknown', verified: false };
}

module.exports = {
  SCHEMA_VERSION,
  Level,
  Status,
  BLOCK_CODES,
  BLOCK_TTL_MS,
  loadEvidence,
  saveEvidence,
  migrateEvidence,
  candidateKey,
  recordProbe,
  recordOutcome: recordProbe,
  getEvidence,
  isCandidateBlocked,
  isUpstreamBlocked,
  candidateStatus,
  recordAlias,
  recordSharedQuota,
  sharedQuotaStatus,
};
