'use strict';

/**
 * Ship Dễ — candidate score parts.
 *
 * The weighted score of one seven-part candidate (evidence, capability,
 * headroom, spread, cost) and the headroom and reservation reads it needs.
 * routing.scoreForProfile uses scoreCandidate when it is given neither
 * weights nor a profile; selection itself is the Controller's (candidate-select
 * and routing.rankForProfile). Cost that is unknown is excluded from the total
 * rather than scored as neutral.
 */

const evidence = require('./evidence');
const { candidateKey: sevenWayKey } = require('./candidates');
const quota = require('./quota');
const quotaStore = require('./quota-store');
const { readIdentity } = require('./agy-identity');

/**
 * Scoring weights. Sub-scores are 0–100; unknown sub-scores (cost) are
 * excluded and the total is renormalised over the weights that are present.
 */
const WEIGHTS = {
  evidence: 30,
  capability: 25,
  headroom: 20,
  spread: 15,
  cost: 10,
};

/** Map evidence status to a sub-score. */
function evidenceScore(candidate) {
  const ev = candidate.evidence || [];
  if (ev.length === 0) return 0; // untested stays unscored
  let best = 0;
  for (const e of ev) {
    if (e.status === 'passed') {
      const level = e.level || evidence.Level.API;
      best = Math.max(
        best,
        level === evidence.Level.OUTCOME ? 100 : level === evidence.Level.HARNESS ? 80 : 60
      );
    }
  }
  if (best > 0) return best;
  // All evidence is failed.
  return 0;
}

/**
 * Capability sub-score. A capability that the candidate is qualified for
 * scores high; a role it is explicitly not qualified for scores zero; a role
 * with no qualification data at all is unproven and scores low (never 50).
 * This is only the score; it gates nothing.
 */
function capabilityScore(candidate, workKind) {
  try {
    const caps = require('./capabilities');
    const role = caps.getRole(workKind);
    if (role && Array.isArray(candidate.qualifiedRoles)) {
      if (candidate.qualifiedRoles.includes(workKind)) return 90;
      return 0;
    }
    return 10; // unproven
  } catch {
    return 10; // unproven
  }
}

const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Read active reservations from context or from quota-store.
 */
function getActiveReservations(ctx) {
  if (ctx && Array.isArray(ctx.reservations)) {
    return ctx.reservations;
  }
  if (ctx && Array.isArray(ctx._cachedReservations)) {
    return ctx._cachedReservations;
  }
  try {
    const lockOpts = {
      home: ctx && ctx.home,
      path: ctx && (ctx.storePath || ctx.quotaFile),
      now: ctx && ctx.now,
    };
    const resMap = quotaStore.getReservations(lockOpts);
    const now = lockOpts.now || Date.now();
    const resList = Object.values(resMap || {}).filter((r) => {
      const at = typeof r.at === 'number' ? r.at : Date.parse(r.at);
      const isExpired =
        !Number.isFinite(at) || now - at > RESERVATION_TTL_MS || at > now + 60 * 1000;
      return !isExpired;
    });
    if (ctx) ctx._cachedReservations = resList;
    return resList;
  } catch {
    return [];
  }
}

/**
 * Filter reservations that apply to a candidate.
 */
function reservationsForCandidate(candidate, reservations) {
  const key = sevenWayKey(candidate);
  const out = [];
  for (const r of reservations || []) {
    if (r.offeringId && r.offeringId === key) {
      out.push(r);
    }
  }
  return out;
}

/**
 * Resolve quota remaining, cooldown, and reservations for a candidate.
 * Reads from real quota modules: quota.js accountHeadroom, quota-store.js
 * usableReadings, evidence.js isCandidateBlocked, and held reservations.
 */
function resolveCandidateHeadroom(candidate, ctx) {
  if (candidate.blocked) {
    const isExhausted = candidate.blockReason === 'QUOTA_EXHAUSTED';
    return {
      status: isExhausted ? 'exhausted' : 'cooling',
      reason: candidate.blockReason || 'upstream/candidate blocked',
      worstRatio: 1,
      reservationsHeld: 0,
    };
  }

  const readings = (ctx && ctx.headrooms) || {};
  let reading = undefined;
  if (candidate.accountId && readings[candidate.accountId] !== undefined) {
    reading = readings[candidate.accountId];
  } else if (candidate.quotaScope && readings[candidate.quotaScope] !== undefined) {
    reading = readings[candidate.quotaScope];
  }
  const key = sevenWayKey(candidate);
  if (reading === undefined && readings[key] !== undefined) {
    reading = readings[key];
  }

  const allReservations = getActiveReservations(ctx);
  const candReservations = reservationsForCandidate(candidate, allReservations);

  // If reading not in headrooms, check ctx.accounts to compute headroom from quota module
  if (reading === undefined && ctx && Array.isArray(ctx.accounts)) {
    const acc = ctx.accounts.find(
      (a) => a.id === candidate.accountId || a.id === candidate.quotaScope
    );
    if (acc) {
      const events = (ctx.eventsByAccount && ctx.eventsByAccount[acc.id]) || [];
      reading = quota.accountHeadroom(acc, events, {
        now: (ctx && ctx.now) || Date.now(),
        warnAt: ctx && ctx.warnAt,
        reservations: candReservations,
      });
    }
  }

  // If still not resolved, check cached reported readings from quota-store
  if (reading === undefined) {
    let reported = ctx && ctx.reported;
    if (!reported && (!ctx || ctx.useStoredQuota !== false)) {
      try {
        const idRes = readIdentity({ home: ctx && ctx.home });
        reported = quotaStore.usableReadings(idRes, {
          home: ctx && ctx.home,
          path: ctx && (ctx.storePath || ctx.quotaFile),
          now: (ctx && ctx.now) || Date.now(),
        }).reported;
        if (ctx) ctx.reported = reported || {};
      } catch {
        if (ctx) ctx.reported = {};
      }
    }
    if (reported) {
      if (candidate.accountId && reported[candidate.accountId] !== undefined) {
        reading = reported[candidate.accountId];
      } else if (candidate.quotaScope && reported[candidate.quotaScope] !== undefined) {
        reading = reported[candidate.quotaScope];
      }
    }
  }
  const now = (ctx && ctx.now) || Date.now();

  // Live Codex quota source for native CLI login when no cached reading exists
  if (
    reading === undefined &&
    (!ctx || ctx.useStoredQuota !== false) &&
    candidate.binding === 'cli-login' &&
    (candidate.harness === 'codex' ||
      candidate.sourceId === 'codex' ||
      candidate.source === 'codex' ||
      candidate.accountId === 'codex-cli') &&
    (!candidate.accountId || readings[candidate.accountId] === undefined) &&
    (!candidate.quotaScope || readings[candidate.quotaScope] === undefined)
  ) {
    try {
      const { readCodexSessionQuota } = require('./codex-quota');
      const codexOpts = (ctx && ctx.codexOpts) || {
        homeDir:
          (ctx && ctx.home) ||
          process.env.USERPROFILE ||
          process.env.HOME ||
          require('os').homedir(),
      };
      const sessionQuota = readCodexSessionQuota(codexOpts, {
        now,
        fs: (ctx && ctx.fs) || (codexOpts && codexOpts.fs),
      });
      if (sessionQuota && sessionQuota.status && sessionQuota.status !== 'unknown') {
        reading = sessionQuota;
      }
    } catch {}
  }

  // Active cooldown check from evidence store if present
  if (ctx && ctx.evidenceData) {
    try {
      const block = evidence.isCandidateBlocked(ctx.evidenceData, candidate, {
        now,
        quotaStateFile: ctx.quotaStateFile,
        ...(ctx.quotaState !== undefined ? { quotaState: ctx.quotaState } : {}),
        useStoredQuota: ctx.useStoredQuota,
        loadQuotaState: ctx.loadQuotaState,
      });
      if (block && block.blocked) {
        return {
          status: 'cooling',
          reason: block.reason || 'provider cooldown in effect',
          worstRatio: 1,
          reservationsHeld: candReservations.length,
        };
      }
    } catch {}
  }

  // Active cooldown on candidate or account
  if (candidate.cooldownUntil && Date.parse(candidate.cooldownUntil) > now) {
    return {
      status: 'cooling',
      reason: 'Nhà cung cấp vừa từ chối; đang chờ hết thời gian nguội',
      worstRatio: 1,
      reservationsHeld: candReservations.length,
    };
  }

  // Native login is not quota evidence. Reuse the quota store's age policy
  // even for normalized status readings, which otherwise bypass freshness.
  if (candidate.binding === 'cli-login') {
    const stamp =
      reading &&
      typeof reading === 'object' &&
      Date.parse(reading.observedAt || reading.updatedAt || reading.cachedAt || '');
    const maxAge = (reading && reading.maxAgeMs) || quotaStore.DEFAULT_MAX_AGE_MS;
    if (!Number.isFinite(stamp) || now < stamp || now - stamp > maxAge) {
      reading = undefined;
    }
  }
  let status = 'unknown';
  let worstRatio = null;
  let reason = 'chưa khai hạn mức token';
  let cooldownUntil =
    reading && typeof reading === 'object' ? reading.cooldownUntil || reading.resetsAt : undefined;
  if (typeof reading === 'string') {
    status = reading;
  } else if (reading && typeof reading === 'object') {
    if (reading.status) {
      status = reading.status;
      if (reading.worstRatio !== undefined) worstRatio = reading.worstRatio;
      if (reading.reason) reason = reading.reason;
    } else if (Array.isArray(reading.rows)) {
      const agyQuota = require('./agy-quota');
      const hr = agyQuota.headroomFor(reading, candidate.modelId);
      status = agyQuota.statusFrom(hr, ctx);
      reason = hr.reason;
    }
  }

  return {
    status,
    worstRatio,
    reason,
    reservationsHeld: candReservations.length,
    cooldownUntil: cooldownUntil || undefined,
  };
}

/**
 * Quota headroom sub-score, read from the real headroom readings passed in
 * context (quota.js accountHeadroom / quota-store). Lookup order:
 * accountId, then quotaScope, then sevenWayKey, then unknown. Higher = more room.
 * Safely unpacks object readings (reading.status) or string primitives.
 * A held reservation lowers the candidate's headroom.
 */
function headroomScore(candidate, ctx) {
  if (candidate.blocked) return 0;
  const headroom = resolveCandidateHeadroom(candidate, ctx);
  candidate.headroomStatus = headroom.status;
  candidate.headroomReason = headroom.reason;

  if (headroom.status === 'exhausted' || headroom.status === 'cooling') {
    return 0;
  }

  const map = { open: 90, unknown: 30, tight: 40, exhausted: 0, cooling: 0 };
  let score = map[headroom.status] !== undefined ? map[headroom.status] : 30;

  // A held reservation lowers the candidate's headroom
  if (headroom.reservationsHeld > 0) {
    const penalty = headroom.reservationsHeld * 20;
    score = Math.max(10, score - penalty);
  }

  return score;
}

/**
 * Count how much live load and how many outstanding reservations already sit
 * on the same upstream (per quota scope) as the candidate.
 * Load counts live sessions (running/load) and reservations, NOT catalogue entries.
 */
function countSpread(candidate, ctx, allCandidates) {
  let count = 0;
  const liveSessions = (ctx && (ctx.load || ctx.running)) || [];
  for (const e of liveSessions) {
    if (
      e.upstream === candidate.upstream &&
      (!e.quotaScope || e.quotaScope === candidate.quotaScope)
    ) {
      count += 1;
    }
  }
  const reservations = getActiveReservations(ctx);
  for (const r of reservations) {
    if (
      r.modelId &&
      r.modelId === candidate.modelId &&
      r.upstream &&
      r.upstream === candidate.upstream
    ) {
      count += 1;
    } else if (r.offeringId && r.offeringId === sevenWayKey(candidate)) {
      count += 1;
    } else if (
      r.accountId &&
      candidate.accountId &&
      r.accountId !== '*' &&
      r.accountId === candidate.accountId
    ) {
      count += 1;
    } else if (r.quotaScope && candidate.quotaScope && r.quotaScope === candidate.quotaScope) {
      count += 1;
    }
  }
  return count;
}

/** Spread penalty: fewer active sessions/reservations on this upstream → 100. */
function spreadPenalty(candidate, ctx, allCandidates) {
  const count = countSpread(candidate, ctx, allCandidates);
  if (count <= 0) return 100;
  if (count <= 1) return 70;
  if (count <= 3) return 50;
  if (count <= 5) return 30;
  return 10;
}

/** Cost sub-score. Unknown cost → null (excluded from the total, never 50). */
function costScore(candidate) {
  const cost = candidate.cost;
  if (cost === undefined || cost === null || !Number.isFinite(Number(cost))) return null;
  const c = Number(cost);
  if (c <= 0) return 100;
  const score = 100 * Math.max(0, 1 - Math.log10(1 + c) / Math.log10(1 + 1000000));
  return Math.round(score);
}

/** Extract the base model name, stripping upstream prefix. */
function extractBaseName(modelId) {
  if (!modelId) return '';
  const idx = modelId.lastIndexOf('/');
  return idx >= 0 ? modelId.slice(idx + 1) : modelId;
}

/**
 * Compute the weighted score for a candidate. Unknown sub-scores are
 * excluded and the total is renormalised over the weights that are present.
 */
function scoreCandidate(candidate, allCandidates, workKind, ctx) {
  const scores = {
    evidence: evidenceScore(candidate),
    capability: capabilityScore(candidate, workKind),
    headroom: headroomScore(candidate, ctx),
    spread: spreadPenalty(candidate, ctx, allCandidates),
    cost: costScore(candidate),
  };
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const value = scores[key];
    if (value === undefined || value === null) continue;
    total += value * weight;
    weightSum += weight;
  }
  const parts = {
    ...scores,
    quality: Number.isFinite(candidate.quality) ? candidate.quality : null,
  };
  return {
    total: weightSum > 0 ? Math.round(total / weightSum) : 0,
    breakdown: {
      ...parts,
      sources: Object.fromEntries(Object.keys(parts).map((key) => [key, 'unsourced'])),
    },
  };
}

/**
 * Resolve the catalogue(s) for a candidate's access path into the candidate's
 * account, falling back to the shared '*' entry, then to a plain Set.
 * Also checks candidateKey entry. Returns null when there is no enumerable
 * catalogue for the access path.
 */
function resolveCatalogue(candidate, cataloguesByPath) {
  const byPath = cataloguesByPath || {};
  const entry = byPath[candidate.accessPath] || byPath[sevenWayKey(candidate)];
  if (!entry) return null;
  if (entry instanceof Set) return entry;
  const key = sevenWayKey(candidate);
  if (entry.get && entry.get(key)) return entry.get(key);
  if (candidate.accountId && entry.get && entry.get(candidate.accountId)) {
    return entry.get(candidate.accountId);
  }
  return entry.get && entry.get('*') ? entry.get('*') : null;
}

/**
 * Build a Set of model ids from an array, normalising each id by trimming
 * whitespace and stripping trailing carriage returns.
 *
 * Ids parsed from Windows command output (`opencode models --json`, PowerShell
 * Invoke-RestMethod) carry a trailing \r; without stripping it, the same model
 * appears under two keys and catalogue validation fails on an id that is
 * visually present.
 */
function buildCatalogueSet(ids) {
  const set = new Set();
  for (const id of ids || []) {
    set.add(String(id).replace(/\r$/, '').trim());
  }
  return set;
}

module.exports = {
  WEIGHTS,
  evidenceScore,
  capabilityScore,
  headroomScore,
  countSpread,
  spreadPenalty,
  costScore,
  resolveCatalogue,
  scoreCandidate,
  extractBaseName,
  buildCatalogueSet,
  getActiveReservations,
  reservationsForCandidate,
  resolveCandidateHeadroom,
};
