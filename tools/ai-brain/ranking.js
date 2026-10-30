'use strict';

/**
 * Ship Dễ — Candidate Ranking (Slices B+C)
 *
 * Ranks seven-part candidates per AGENTS.md §7:
 *
 *   1. Filter  – credentials absent, upstream blocked, model not in catalogue,
 *                unresolved wildcard → out
 *   2. Narrow  – capability gate (proven-in, proven-out, unproven-with-budget)
 *   3. Score   – evidence, capability, headroom, spread, cost
 *   4. Spread  – penalise over-concentration on one upstream in the live load
 *                and in outstanding reservations
 *   5. Select  – winner or REFUSE (never guess)
 *
 * Rejects are named so the caller can act on the cause: MODEL_NOT_IN_CATALOG,
 * WILDCARD_UNRESOLVED, EXPLORATION_BUDGET_EXHAUSTED, no credential, upstream
 * blocked. A wildcard candidate that the caller cannot resolve to a concrete
 * model is refused, never passed through. A capability that was never proven
 * is never neutral — it is only selectable inside an explicit exploration
 * budget. Cost that is unknown is excluded from the total rather than scored
 * as neutral.
 *
 * The decision is recorded through decisions.js (the single writer for the
 * decision log) and never written directly.
 */

const sourcesApi = require('./sources');
const evidence = require('./evidence');
const decisions = require('./decisions');
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
 * Unproven selection is separately gated by the exploration budget in
 * rankAndRecord — this is the score, that is the gate.
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
function quotaFreshnessMs(ctx) {
  const config = sourcesApi.getDispatchConfig(ctx && ctx.registry, ctx || {});
  const value = Number(ctx?.dispatchConfig?.quotaReadingMaxAgeMs ?? config.quotaReadingMaxAgeMs);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('DISPATCH_CONFIG_INVALID: quotaReadingMaxAgeMs must be a positive integer');
  }
  return value;
}

/** Only a recent live probe bound to this complete candidate can prove availability. */
function quotaProbeEvidence(candidate, ctx, observedAt) {
  let proof = candidate.quotaProbe;
  if (!proof && ctx?.routeHealth) {
    const record = require('./route-evidence').routeRecord(candidate, ctx.routeHealth);
    if (record?.candidateKey === sevenWayKey(candidate)) {
      proof = {
        candidateKey: record.candidateKey,
        ok: record.status === 'AVAILABLE',
        httpStatus: record.probeResult?.status,
        observedAt: record.lastCheckedAt,
        quotaStatus: record.probeResult?.quota?.status,
        reasonCode: record.failureReason,
        source: 'route-health-probe',
      };
    }
  }
  if (!proof || proof.candidateKey !== sevenWayKey(candidate)) return null;
  const stamp = Date.parse(proof.observedAt);
  const now = ctx?.now ?? Date.now();
  const quotaStamp = Date.parse(observedAt);
  if (
    !Number.isFinite(stamp) ||
    stamp > now ||
    now - stamp > quotaFreshnessMs(ctx) ||
    (Number.isFinite(quotaStamp) && stamp < quotaStamp)
  ) return null;
  return {
    candidateKey: sevenWayKey(candidate),
    ok: proof.ok === true,
    httpStatus: Number(proof.httpStatus) || 0,
    observedAt: new Date(stamp).toISOString(),
    quotaStatus: proof.quotaStatus || 'unknown',
    reasonCode: proof.reasonCode || undefined,
    source: proof.source || 'live-route-probe',
  };
}

function hasLiveQuotaProbe(headroom) {
  const proof = headroom.quotaProbe;
  return Boolean(
    proof?.ok === true &&
    proof.httpStatus >= 200 &&
    proof.httpStatus < 300 &&
    proof.quotaStatus !== 'exhausted' &&
    proof.quotaStatus !== 'cooling'
  );
}

/**
 * Keep the ranking APIs synchronous. Async dispatch performs only the uncertain
 * candidates' bounded preflights, then records the final admission decision.
 */
async function rankWithQuotaProbe(candidates, context, rank = rankAndRecord) {
  const original = context || {};
  const ctx = { ...original, dryRun: true };
  let decision = rank(candidates, ctx);
  const pending = new Set((decision.needsQuotaProbe || []).map((c) => c.candidateKey || c.offeringId));
  if (pending.size) {
    const config = sourcesApi.getDispatchConfig(ctx.registry, ctx);
    if (!(config.probeBudgetMs > 0) || !(config.probeTimeoutMs > 0)) {
      throw new Error('DISPATCH_CONFIG_INVALID: positive probe budget and timeout are required');
    }
    const started = Date.now();
    const deadline = started + config.probeBudgetMs;
    const profile = ctx.taskProfile || { role: String(ctx.role || '').startsWith('reviewer') ? 'reviewer' : 'writer' };
    const ordered = require('./capability-probe').orderCandidatesForProbe(
      candidates.filter((c) => pending.has(sevenWayKey(c))), profile, ctx
    );
    const probeApi = require('./route-probe');
    for (const candidate of ordered) {
      let result;
      let localReason;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        localReason = 'PROBE_BUDGET_EXHAUSTED';
      } else {
        let route;
        try {
          route = typeof ctx.httpRoute === 'function'
            ? ctx.httpRoute(candidate)
            : require('./orchestrate/route-probe').routeProbeCandidate(
                candidate, { model: candidate.modelId }, ctx.registry || { sources: [] }, false
              );
        } catch {
          localReason = 'QUOTA_PROBE_ROUTE_UNAVAILABLE';
        }
        if (!localReason && (!route || !/^https?:\/\//i.test(String(route.accessPath || '')))) {
          localReason = 'QUOTA_PROBE_ROUTE_UNAVAILABLE';
        }
        if (
          !localReason &&
          ctx.allowNetwork === false &&
          typeof ctx.routeProbe !== 'function' &&
          typeof ctx.fetch !== 'function'
        ) localReason = 'QUOTA_PROBE_TRANSPORT_UNAVAILABLE';
        if (!localReason) {
          result = await probeApi.boundedProbe(
            ctx.routeProbe || probeApi.probeRoute,
            { ...route, maxOutputTokens: route.maxOutputTokens ?? config.fullRouteScan.maxTokens },
            route.apiKeyEnv,
            { ...process.env, ...ctx.env },
            { timeoutMs: Math.min(config.probeTimeoutMs, remainingMs), fetch: ctx.fetch, signal: ctx.signal }
          );
        }
      }
      const now = (original.now ?? started) + (Date.now() - started);
      ctx.now = now;
      const httpStatus = Number(result?.status) || 0;
      const ok = result?.ok === true && httpStatus >= 200 && httpStatus < 300;
      const reasonCode = localReason || (!ok
        ? probeApi.failureReason(probeApi.classifyProbeFailure({ status: httpStatus, body: result?.body }))
        : result?.quota?.status === 'exhausted' ? 'QUOTA_EXHAUSTED' : undefined);
      candidate.quotaProbe = {
        candidateKey: sevenWayKey(candidate),
        ok,
        httpStatus,
        observedAt: new Date(now).toISOString(),
        quotaStatus: result?.quota?.status || 'unknown',
        reasonCode,
        source: 'live-route-probe',
      };
      decision = rank(candidates, ctx);
      if (ok && !['exhausted', 'cooling'].includes(candidate.quotaProbe.quotaStatus)) break;
    }
  }
  return original.dryRun === true ? decision : rank(candidates, { ...ctx, dryRun: false });
}

function resolveCandidateHeadroom(candidate, ctx) {
  const now = ctx?.now ?? Date.now();
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
      reading = {
        ...quota.accountHeadroom(acc, events, {
          now,
          warnAt: ctx && ctx.warnAt,
          reservations: candReservations,
        }),
        observedAt: new Date(now).toISOString(),
      };
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

  const maxAgeMs = quotaFreshnessMs(ctx);
  let status = 'unknown';
  let worstRatio = null;
  let reason = 'QUOTA_UNKNOWN';
  let reasonCode = 'QUOTA_UNKNOWN';
  const observedAt = reading && typeof reading === 'object'
    ? reading.observedAt || reading.updatedAt || reading.cachedAt
    : undefined;
  const stamp = Date.parse(observedAt);
  const cooldownUntil = reading && typeof reading === 'object'
    ? reading.cooldownUntil || reading.resetsAt
    : undefined;
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
  const activeReset = Date.parse(cooldownUntil) > now &&
    (reading?.cooldownUntil || status === 'exhausted' || status === 'cooling');
  const ageMs = Number.isFinite(stamp) ? now - stamp : null;
  const readingLimit = Number(reading?.maxAgeMs);
  const effectiveMaxAgeMs = Number.isFinite(readingLimit) && readingLimit > 0
    ? Math.min(maxAgeMs, readingLimit)
    : maxAgeMs;
  const fresh = ageMs !== null && ageMs >= 0 && ageMs <= effectiveMaxAgeMs;
  const explicitRefusal = !observedAt && ['exhausted', 'cooling'].includes(status);
  if (activeReset) {
    status = status === 'exhausted' ? 'exhausted' : 'cooling';
    reasonCode = status === 'exhausted' ? 'QUOTA_EXHAUSTED' : 'COOLDOWN_ACTIVE';
  } else if (!fresh && !explicitRefusal) {
    status = 'unknown';
    worstRatio = null;
    reasonCode = ageMs === null ? 'QUOTA_TIMESTAMP_MISSING'
      : ageMs < 0 ? 'QUOTA_TIMESTAMP_INVALID' : 'QUOTA_STALE';
    reason = reasonCode;
  } else {
    reasonCode = status === 'exhausted' ? 'QUOTA_EXHAUSTED'
      : status === 'cooling' ? 'COOLDOWN_ACTIVE'
      : status === 'unknown' ? 'QUOTA_UNKNOWN' : 'QUOTA_FRESH';
  }
  const quotaEvidence = {
    status,
    observedAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
    ageMs,
    maxAgeMs: effectiveMaxAgeMs,
    fresh,
    reasonCode,
    ...(activeReset ? { cooldownUntil } : {}),
  };
  const quotaProbe = quotaProbeEvidence(candidate, ctx, observedAt);
  if (!['exhausted', 'cooling'].includes(status) && quotaProbe) {
    if (['exhausted', 'cooling'].includes(quotaProbe.quotaStatus)) {
      status = quotaProbe.quotaStatus;
      reasonCode = status === 'exhausted' ? 'QUOTA_EXHAUSTED' : 'COOLDOWN_ACTIVE';
      reason = reasonCode;
    } else if (!quotaProbe.ok) {
      reasonCode = quotaProbe.reasonCode || 'QUOTA_PROBE_FAILED';
      status = ['RATE_LIMITED', 'UPSTREAM_CREDIT_OR_QUOTA'].includes(reasonCode) ? 'cooling' : 'unknown';
      reason = reasonCode;
    } else if (status === 'unknown' && ['open', 'tight'].includes(quotaProbe.quotaStatus)) {
      status = quotaProbe.quotaStatus;
      reasonCode = 'LIVE_QUOTA_PROBE';
      reason = reasonCode;
    }
  }
  return {
    status,
    worstRatio,
    reason,
    reasonCode,
    reservationsHeld: candReservations.length,
    cooldownUntil: cooldownUntil || undefined,
    quotaEvidence,
    quotaProbe,
    requiresLiveProbe: status === 'unknown' && !quotaProbe,
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

  const norm = weightSum > 0 ? Math.round(total / weightSum) : 0;
  return { total: norm, breakdown: scores };
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
 * Rank candidates for a work item and record the decision.
 *
 * @param {object[]} candidates – annotated candidates (from annotateCandidates)
 * @param {object} context
 * @param {string} context.workItemId
 * @param {string} context.role – AGENTS.md role id
 * @param {string} [context.kind] – work-item kind for capability filter
 * @param {object} [context.registry] – source registry
 * @param {object} [context.evidenceData]
 * @param {object} [context.decisionOpts] – { dir, now } for decisions.js
 * @param {boolean} [context.dryRun] – if true, do not write decision log
 * @param {object} [context.headrooms] – real quota status readings,
 * keyed by accountId / quotaScope / candidateKey
 * @param {object[]} [context.load] – active sessions:
 * { upstream, accountId, quotaScope }
 * @param {object[]} [context.reservations] – outstanding fair reservations
 * @param {object} [context.cataloguesByPath] – accessPath → catalogue map
 * @param {number} [context.explorationBudget] – how many unproven picks allowed
 * @returns {object} decision record
 */
function rankAndRecord(candidates, context) {
  const ctx = context || {};
  const workItemId = ctx.workItemId || 'unassigned';
  const role = ctx.role || 'author.foundation';
  const kind = ctx.kind || role;
  const registry = ctx.registry;
  const explorationBudget = Number.isFinite(Number(ctx.explorationBudget))
    ? Number(ctx.explorationBudget)
    : 0;

  if (ctx && ctx.reported === undefined && ctx.useStoredQuota !== false) {
    try {
      const idRes = readIdentity({ home: ctx.home });
      ctx.reported = quotaStore.usableReadings(idRes, {
        home: ctx.home,
        path: ctx.storePath || ctx.quotaFile,
        now: ctx.now || Date.now(),
      }).reported;
    } catch {
      ctx.reported = {};
    }
  }

  const rejected = [];
  const eligible = [];
  const needsQuotaProbe = [];

  // ── 1. Filter ───────────────────────────────────────────────────
  for (const c of candidates) {
    // Legacy unverified evidence without concrete account cannot be dispatched.
    if (c.legacy) {
      rejected.push({
        offeringId: sevenWayKey(c),
        reason: 'UNVERIFIED_LEGACY_EVIDENCE',
        scope: 'candidate',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: c.accountId || '*',
      });
      continue;
    }

    // Blocked upstream/candidate → reject.
    if (c.blocked) {
      rejected.push({
        offeringId: sevenWayKey(c),
        reason: c.blockReason || 'upstream blocked',
        scope: c.blockScope || 'upstream',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: c.accountId || '*',
      });
      continue;
    }

    // No credential check: if the source requires a credential and it is
    // known absent, reject.
    if (registry) {
      const src = sourcesApi.getSource(c.source, registry);
      if (src) {
        const cred = sourcesApi.credentialPresence(src, ctx.credentialOpts);
        if (cred.required && cred.present === false) {
          rejected.push({
            offeringId: sevenWayKey(c),
            reason: 'no credential: ' + cred.how,
            scope: 'source',
            upstream: c.upstream,
            modelId: c.modelId,
            accountId: c.accountId || '*',
          });
          continue;
        }
      }
    }

    // Wildcard model placeholder: must be resolved to a concrete model by the
    // caller (e.g. from the live `opencode models` list). An unresolved
    // wildcard is a named rejection, never a silent pass-through.
    if (c.modelId === '*') {
      if (!c.resolvedModel) {
        rejected.push({
          offeringId: sevenWayKey(c),
          reason: 'WILDCARD_UNRESOLVED',
          scope: 'model',
          upstream: c.upstream,
          modelId: c.modelId,
          accountId: c.accountId || '*',
        });
        continue;
      }
      c.modelId = c.resolvedModel;
    }

    // Catalogue validation: before dispatch, the chosen model id must exist
    // in the current catalogue FOR THAT ACCESS PATH (and account, when the
    // catalogue is per-account). A model that has left the catalogue is not
    // silently substituted — it is rejected with a named cause.
    const catalogue = resolveCatalogue(c, ctx.cataloguesByPath);
    if (catalogue) {
      const inCatalogue =
        catalogue.has(c.modelId) ||
        (c.upstream &&
          c.modelId.startsWith(c.upstream + '/') &&
          catalogue.has(c.modelId.slice(c.upstream.length + 1)));
      if (!inCatalogue) {
        rejected.push({
          offeringId: sevenWayKey(c),
          reason: 'MODEL_NOT_IN_CATALOG',
          scope: 'model',
          upstream: c.upstream,
          modelId: c.modelId,
          accountId: c.accountId || '*',
        });
        continue;
      }
    } else {
      // No enumerable catalogue for this access path (like cli) → the
      // candidate's presence cannot be verified here; keep it, marked unknown.
      if (!c.status || c.status === 'passed') c.status = 'unknown';
    }

    // Quota headroom & cooldown check:
    // Read quota remaining for candidate's account and quotaScope, and active cooldown
    const headroom = resolveCandidateHeadroom(c, ctx);
    c.headroomStatus = headroom.status;
    c.headroomReason = headroom.reason;
    c.quotaEvidence = headroom.quotaEvidence;
    c.quotaProbe = headroom.quotaProbe || undefined;

    if (headroom.status === 'exhausted') {
      rejected.push({
        offeringId: sevenWayKey(c),
        reason: headroom.reason || 'QUOTA_EXHAUSTED',
        reasonCode: 'QUOTA_EXHAUSTED',
        quotaEvidence: headroom.quotaEvidence,
        quotaProbe: headroom.quotaProbe,
        scope:
          c.accountId && c.accountId !== '*'
            ? 'account'
            : c.quotaScope
              ? 'quotaScope'
              : 'candidate',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: c.accountId || '*',
      });
      continue;
    }

    if (headroom.status === 'cooling') {
      rejected.push({
        offeringId: sevenWayKey(c),
        reason: headroom.reason || 'COOLDOWN_ACTIVE',
        reasonCode: 'COOLDOWN_ACTIVE',
        quotaEvidence: headroom.quotaEvidence,
        quotaProbe: headroom.quotaProbe,
        scope:
          c.accountId && c.accountId !== '*'
            ? 'account'
            : c.quotaScope
              ? 'quotaScope'
              : 'candidate',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: c.accountId || '*',
      });
      continue;
    }

    if (!c.accountId || c.accountId === '*') {
      rejected.push({
        offeringId: sevenWayKey(c),
        reason: 'WILDCARD_ACCOUNT',
        scope: 'account',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: '*',
      });
      continue;
    }

    if (headroom.status === 'unknown' && !hasLiveQuotaProbe(headroom)) {
      const refusal = {
        offeringId: sevenWayKey(c),
        reason: headroom.quotaProbe?.reasonCode || 'QUOTA_UNKNOWN_REQUIRES_LIVE_PROBE',
        reasonCode: headroom.quotaProbe?.reasonCode || 'QUOTA_UNKNOWN_REQUIRES_LIVE_PROBE',
        scope: 'quotaScope',
        upstream: c.upstream,
        modelId: c.modelId,
        accountId: c.accountId,
        quotaEvidence: headroom.quotaEvidence,
        quotaProbe: headroom.quotaProbe,
      };
      rejected.push(refusal);
      if (headroom.requiresLiveProbe) needsQuotaProbe.push(refusal);
      continue;
    }
    eligible.push(c);
  }

  // ── 2. Score ───────────────────────────────────────────────────
  for (const c of eligible) {
    if (!Number.isFinite(c.quality) && c.quality !== 0) {
      c.qualityLabel = 'QUALITY_UNKNOWN';
    } else {
      delete c.qualityLabel;
    }
    const { total, breakdown } = scoreCandidate(c, eligible, kind, ctx);
    c.score = total;
    c.scoreBreakdown = breakdown;
    if (c.qualityLabel) {
      c.scoreBreakdown.qualityLabel = c.qualityLabel;
    } else if (c.scoreBreakdown && c.scoreBreakdown.qualityLabel) {
      delete c.scoreBreakdown.qualityLabel;
    }
    c.scoreSource = 'evidence+capability+headroom+spread+cost';
  }

  // ── 3. Sort by score (descending), scored models before unscored ──
  eligible.sort((a, b) => {
    const aKnown = a.qualityLabel !== 'QUALITY_UNKNOWN' && Number.isFinite(a.quality);
    const bKnown = b.qualityLabel !== 'QUALITY_UNKNOWN' && Number.isFinite(b.quality);
    if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
    if (b.score !== a.score) return b.score - a.score;
    return a.upstream.localeCompare(b.upstream);
  });

  // ── 4. Capability gate via exploration budget ──────────────────
  // Unproven capability (qualifiedRoles absent) only gets selected inside an
  // explicit budget. Each prior unproven selection (priorUntested) counts
  // against it. Proving is the escape hatch, not the default.
  let winner = null;
  for (const cand of eligible) {
    const proven =
      Array.isArray(cand.qualifiedRoles) &&
      cand.qualifiedRoles.some((r) => r === kind || r === '*');
    if (!proven) {
      const prior = Number.isFinite(Number(ctx.priorUntested)) ? Number(ctx.priorUntested) : 0;
      if (prior + 1 > explorationBudget) {
        rejected.push({
          offeringId: sevenWayKey(cand),
          reason: 'EXPLORATION_BUDGET_EXHAUSTED',
          scope: 'capability',
          upstream: cand.upstream,
          modelId: cand.modelId,
          accountId: cand.accountId || '*',
        });
        continue;
      }
    }
    winner = cand;
    break;
  }

  const chosen = winner ? sevenWayKey(winner) : null;
  const reason = winner
    ? 'Score ' +
      winner.score +
      ' (evidence=' +
      winner.scoreBreakdown.evidence +
      ', capability=' +
      winner.scoreBreakdown.capability +
      ', headroom=' +
      winner.scoreBreakdown.headroom +
      ', spread=' +
      winner.scoreBreakdown.spread +
      ', cost=' +
      winner.scoreBreakdown.cost +
      ')'
    : 'REFUSED: no candidate qualifies';

  const decisionEntry = {
    stage: winner ? decisions.Stage.SELECTED : decisions.Stage.REFUSED,
    outcome: winner ? 'SELECTED' : 'NO_ELIGIBLE_CANDIDATE',
    workItemId,
    role,
    candidates: eligible.map((c) => ({
      offeringId: sevenWayKey(c),
      harness: c.harness,
      accessPath: c.accessPath,
      gateway: c.gateway || '',
      upstream: c.upstream,
      accountId: c.accountId || '*',
      quotaScope: c.quotaScope || '',
      modelId: c.modelId,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      evidence: (c.evidence || []).length,
      headroom: c.headroomStatus || 'unknown',
      quotaEvidence: c.quotaEvidence,
      quotaProbe: c.quotaProbe,
      sharedQuota: c.sharedQuota || 'unknown',
    })),
    rejected,
    needsQuotaProbe,
    chosen,
    harness: winner ? winner.harness : null,
    sessionId: null,
    branch: null,
    reason,
  };

  // Write through decisions.js — the single writer for the log.
  if (!ctx.dryRun) {
    try {
      decisions.recordDecision(decisionEntry, ctx.decisionOpts);
    } catch (err) {
      // An unwritable log is noted, not swallowed.
      decisionEntry.logError = err.message;
    }
  }

  return decisionEntry;
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
  rankAndRecord,
  rankWithQuotaProbe,
  hasLiveQuotaProbe,
  extractBaseName,
  buildCatalogueSet,
  getActiveReservations,
  reservationsForCandidate,
  resolveCandidateHeadroom,
};
