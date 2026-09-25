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
  if (ev.length === 0) return 30; // unknown → mid-range, not zero
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

/**
 * Quota headroom sub-score, read from the real headroom readings passed in
 * context (quota.js accountHeadroom / quota-store). Lookup order:
 * accountId, then quotaScope, then sevenWayKey, then unknown. Higher = more room.
 * Safely unpacks object readings (reading.status) or string primitives.
 */
function headroomScore(candidate, ctx) {
  if (candidate.blocked) return 0;
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
  let status = 'unknown';
  if (typeof reading === 'string') {
    status = reading;
  } else if (reading && typeof reading === 'object' && reading.status) {
    status = reading.status;
  }
  candidate.headroomStatus = status;
  const map = { open: 90, unknown: 30, tight: 40, exhausted: 0, cooling: 0 };
  return map[status] !== undefined ? map[status] : 30;
}

/**
 * Count how much live load and how many outstanding reservations already sit
 * on the same upstream (per quota scope) as the candidate.
 */
function countSpread(candidate, ctx) {
  let count = 0;
  for (const e of (ctx && ctx.load) || []) {
    if (
      e.upstream === candidate.upstream &&
      (!e.quotaScope || e.quotaScope === candidate.quotaScope)
    )
      count += 1;
  }
  for (const r of (ctx && ctx.reservations) || []) {
    if (
      r.modelId &&
      r.modelId === candidate.modelId &&
      r.upstream &&
      r.upstream === candidate.upstream
    ) {
      count += 1;
    } else if (r.offeringId && r.offeringId === sevenWayKey(candidate)) {
      count += 1;
    }
  }
  return count;
}

/** Spread penalty: fewer active sessions/reservations on this upstream → 100. */
function spreadPenalty(candidate, ctx) {
  const count = countSpread(candidate, ctx);
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
    spread: spreadPenalty(candidate, ctx),
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

  const rejected = [];
  const eligible = [];

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
      if (!catalogue.has(c.modelId)) {
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

    eligible.push(c);
  }

  // ── 2. Score ───────────────────────────────────────────────────
  for (const c of eligible) {
    const { total, breakdown } = scoreCandidate(c, eligible, kind, ctx);
    c.score = total;
    c.scoreBreakdown = breakdown;
    c.scoreSource = 'evidence+capability+headroom+spread+cost';
  }

  // ── 3. Sort by score (descending) ──────────────────────────────
  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.upstream.localeCompare(b.upstream);
  });

  // ── 4. Capability gate via exploration budget ──────────────────
  // Unproven capability (qualifiedRoles absent) only gets selected inside an
  // explicit budget. Each prior unproven selection (priorUntested) counts
  // against it. Proving is the escape hatch, not the default.
  let winner = eligible.length > 0 ? eligible[0] : null;
  if (winner) {
    const proven =
      Array.isArray(winner.qualifiedRoles) &&
      winner.qualifiedRoles.some((r) => r === kind || r === '*');
    if (!proven) {
      const prior = Number.isFinite(Number(ctx.priorUntested)) ? Number(ctx.priorUntested) : 0;
      if (prior + 1 > explorationBudget) {
        winner = null;
        rejected.push({
          offeringId: sevenWayKey(eligible[0]),
          reason: 'EXPLORATION_BUDGET_EXHAUSTED',
          scope: 'capability',
          upstream: eligible[0].upstream,
          modelId: eligible[0].modelId,
          accountId: eligible[0].accountId || '*',
        });
      }
    }
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
    stage: decisions.Stage.SELECTED,
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
      sharedQuota: c.sharedQuota || 'unknown',
    })),
    rejected,
    chosen,
    harness: winner ? winner.harness : null,
    sessionId: null,
    branch: null,
    reason,
  };

  // Write through decisions.js — the single writer for the log.
  if (!ctx.dryRun && chosen) {
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
  extractBaseName,
  buildCatalogueSet,
};
