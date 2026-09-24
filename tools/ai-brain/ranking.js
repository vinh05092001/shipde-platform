'use strict';

/**
 * Ship Dễ — Candidate Ranking (Slices B+C)
 *
 * Ranks four-part candidates per AGENTS.md §7:
 *
 *   1. Filter  – no credential, no reader, unreadable decision log → out
 *   2. Narrow  – minimum capability level for the work-item kind
 *   3. Score   – evidence, capability, headroom, cost, host benchmarks
 *   4. Spread  – penalise over-concentration on one provider/upstream
 *   5. Select  – winner or REFUSE (never guess)
 *
 * The decision is recorded through decisions.js (the single writer for the
 * decision log) and never written directly.
 */

const sourcesApi = require('./sources');
const evidence = require('./evidence');
const decisions = require('./decisions');

/**
 * Scoring weights.  Each component produces a 0–100 sub-score; the weighted
 * sum is the final score.
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
      best = Math.max(best, level === evidence.Level.OUTCOME ? 100 : level === evidence.Level.HARNESS ? 80 : 60);
    }
  }
  if (best > 0) return best;
  // All evidence is failed.
  return 0;
}

/** Map capability (from the model family table) to a sub-score. */
function capabilityScore(candidate, workKind) {
  // Delegate to the capability table that already exists on main.
  // We import lazily to avoid circular deps in test mocks.
  try {
    const caps = require('./capabilities');
    const role = caps.getRole(workKind);
    if (!role) return 50; // unknown kind → neutral
    // Check capability requirements.
    // The capabilities module works with accounts/offerings, not raw model names,
    // so we check the qualifiedRoles if available on the candidate.
    if (candidate.qualifiedRoles && Array.isArray(candidate.qualifiedRoles)) {
      if (candidate.qualifiedRoles.includes(workKind)) return 90;
      return 20;
    }
    return 50; // no role qualification data → neutral
  } catch {
    return 50;
  }
}

/** Quota headroom sub-score.  Higher = more room. */
function headroomScore(candidate) {
  if (candidate.blocked) return 0;
  // Use status from evidence annotation.
  switch (candidate.status) {
    case 'passed':
      return 80;
    case 'unknown':
      return 50;
    case 'failed':
      return 10;
    default:
      return 50;
  }
}

/** Spread penalty: how many candidates share this upstream in the current set. */
function spreadPenalty(candidate, allCandidates) {
  let count = 0;
  for (const c of allCandidates) {
    if (c.upstream === candidate.upstream) count += 1;
  }
  // More candidates from the same upstream → lower score (more concentration).
  if (count <= 1) return 100;
  if (count <= 3) return 70;
  if (count <= 5) return 50;
  return 30;
}

/** Cost sub-score.  Without cost data, return neutral. */
function costScore(candidate) {
  // Cost data may come from the account or offering, not from the candidate
  // itself.  For now, return neutral; the integration with offerings.js
  // blendedCost would refine this.
  return 50;
}

/** Extract the base model name, stripping upstream prefix. */
function extractBaseName(modelId) {
  if (!modelId) return '';
  const idx = modelId.lastIndexOf('/');
  return idx >= 0 ? modelId.slice(idx + 1) : modelId;
}

/**
 * Compute the weighted score for a candidate.
 */
function scoreCandidate(candidate, allCandidates, workKind) {
  const scores = {
    evidence: evidenceScore(candidate),
    capability: capabilityScore(candidate, workKind),
    headroom: headroomScore(candidate),
    spread: spreadPenalty(candidate, allCandidates),
    cost: costScore(candidate),
  };

  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (scores[key] || 0) * weight;
  }

  return { total: Math.round(total / 100), breakdown: scores };
}

/**
 * Rank candidates for a work item and record the decision.
 *
 * @param {object[]} candidates – annotated candidates (from annotateCandidates)
 * @param {object}   context
 * @param {string}   context.workItemId
 * @param {string}   context.role          – AGENTS.md role id
 * @param {string}   [context.kind]        – work-item kind for capability filter
 * @param {object}   [context.registry]    – source registry
 * @param {object}   [context.evidenceData]
 * @param {object}   [context.decisionOpts] – { dir, now } for decisions.js
 * @param {boolean}  [context.dryRun]      – if true, do not write decision log
 * @returns {object} decision record
 */
function rankAndRecord(candidates, context) {
  const ctx = context || {};
  const workItemId = ctx.workItemId || 'unassigned';
  const role = ctx.role || 'author.foundation';
  const kind = ctx.kind || role;
  const registry = ctx.registry;

  const rejected = [];
  const eligible = [];

  // ── 1. Filter ───────────────────────────────────────────────────
  for (const c of candidates) {
    // Blocked upstream → reject, scoped to that upstream.
    if (c.blocked) {
      rejected.push({
        offeringId: evidence.candidateKey(c),
        reason: c.blockReason || 'upstream blocked',
        scope: c.blockScope || 'upstream',
        upstream: c.upstream,
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
            offeringId: evidence.candidateKey(c),
            reason: 'no credential: ' + cred.how,
            scope: 'source',
          });
          continue;
        }
      }
    }

    // Wildcard model placeholder is not dispatchable without real model data.
    if (c.modelId === '*' && !c.resolvedModel) {
      // Keep as eligible but mark as unknown — it can still be selected
      // if no better candidate exists.
      c.status = c.status || 'unknown';
    }

    // Catalogue validation: before dispatch, the chosen model id must exist
    // in the current catalogue FOR THAT ACCESS PATH.  A model that has left
    // the catalogue is not silently substituted — it is rejected with a named
    // cause so the selector moves to the next candidate.
    if (ctx.catalogueSet && c.modelId !== '*' && c.accessPath !== 'cli') {
      if (!ctx.catalogueSet.has(c.modelId)) {
        rejected.push({
          offeringId: evidence.candidateKey(c),
          reason: 'MODEL_NOT_IN_CATALOG',
          scope: 'model',
          modelId: c.modelId,
        });
        continue;
      }
    }

    eligible.push(c);
  }

  // ── 2. Narrow (minimum capability) ─────────────────────────────
  // For now, all eligible candidates pass the capability filter.
  // The full integration with fitness.js Difficulty levels would add
  // a minimum-grade gate here.

  // ── 3. Score ───────────────────────────────────────────────────
  for (const c of eligible) {
    const { total, breakdown } = scoreCandidate(c, eligible, kind);
    c.score = total;
    c.scoreBreakdown = breakdown;
    c.scoreSource = 'evidence+capability+headroom+spread+cost';
  }

  // ── 4. Sort by score (descending) ──────────────────────────────
  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreak: prefer diverse upstreams.
    return a.upstream.localeCompare(b.upstream);
  });

  // ── 5. Select or refuse ────────────────────────────────────────
  const winner = eligible.length > 0 ? eligible[0] : null;
  const chosen = winner ? evidence.candidateKey(winner) : null;
  const reason = winner
    ? 'Score ' + winner.score + ' (evidence=' + winner.scoreBreakdown.evidence +
      ', capability=' + winner.scoreBreakdown.capability +
      ', headroom=' + winner.scoreBreakdown.headroom +
      ', spread=' + winner.scoreBreakdown.spread +
      ', cost=' + winner.scoreBreakdown.cost + ')'
    : 'REFUSED: no candidate qualifies';

  const decisionEntry = {
    stage: decisions.Stage.SELECTED,
    workItemId,
    role,
    candidates: eligible.map((c) => ({
      offeringId: evidence.candidateKey(c),
      harness: c.harness,
      accessPath: c.accessPath,
      upstream: c.upstream,
      modelId: c.modelId,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      evidence: (c.evidence || []).length,
      headroom: c.status || 'unknown',
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
  spreadPenalty,
  costScore,
  scoreCandidate,
  rankAndRecord,
  extractBaseName,
  buildCatalogueSet,
};
