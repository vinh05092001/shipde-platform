'use strict';

/**
 * Ship Dễ — TASK-AI-171: structured route decision with one score scale.
 *
 * Pure decision helper. No file, network, process or env access; every value
 * comes from its arguments, so the same input always yields the same output.
 *
 * The selector that failed mixed scores from different scales (prior-raw 84.5
 * ranked above aa-v5-percentile 56.6) and launched a route whose budget could
 * not afford the request. These functions separate the steps that were
 * tangled: classify the failure, filter by budget, rank inside one scale,
 * decide.
 */

const SEPARATOR = '::';

const FAILURE_CLASSES = Object.freeze({
  CREDIT_BUDGET: 'CREDIT_BUDGET',
  QUOTA_MONTHLY: 'QUOTA_MONTHLY',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

const REJECT_REASONS = Object.freeze({
  BUDGET_BELOW_REQUEST: 'BUDGET_BELOW_REQUEST',
  AUTH_FAILED: 'AUTH_FAILED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',
});

// Credit refusal: the gateway says the request needs more credits than the
// account holds, and names the requested and affordable token counts.
const CREDIT_PATTERN =
  /requires more credits|fewer max_tokens|can only afford|insufficient (?:credit|funds)|not enough credits/i;
const REQUESTED_PATTERN = /requested (?:up to )?(\d[\d,]*)\s*tokens/i;
const AFFORDABLE_PATTERN = /can only afford (\d[\d,]*)/i;

const QUOTA_PATTERN =
  /MONTHLY_REQUEST_COUNT|reached the (?:limit|cap)|monthly (?:request|usage) limit|quota exceeded/i;
const UPSTREAM_PATTERN =
  /service temporarily unavailable|currently at capacity|did not respond|model is unavailable|upstream unavailable|temporarily unavailable|high demand/i;

function toInt(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * A comparable instant from an epoch number or a parseable date string,
 * or null when it is absent or unparseable. Never reads the clock.
 */
function toTime(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify a route failure from its text.
 *
 * Handles both an "Error:" and an "[Error]" prefix; the prefix does not drive
 * the class. The class comes from what the text says, never from an HTTP code
 * alone — a 402 is a credit refusal, a quota refusal and an upstream refusal
 * depending on the message.
 *
 * @param {string} text - error text
 * @returns {{class: string, requested: number|null, affordable: number|null}}
 */
function classifyFailure(text) {
  const t = String(text || '');
  if (CREDIT_PATTERN.test(t)) {
    return {
      class: FAILURE_CLASSES.CREDIT_BUDGET,
      requested: toInt(t.match(REQUESTED_PATTERN) && t.match(REQUESTED_PATTERN)[1]),
      affordable: toInt(t.match(AFFORDABLE_PATTERN) && t.match(AFFORDABLE_PATTERN)[1]),
    };
  }
  if (QUOTA_PATTERN.test(t)) {
    return { class: FAILURE_CLASSES.QUOTA_MONTHLY, requested: null, affordable: null };
  }
  if (UPSTREAM_PATTERN.test(t)) {
    return { class: FAILURE_CLASSES.UPSTREAM_UNAVAILABLE, requested: null, affordable: null };
  }
  return { class: FAILURE_CLASSES.UNKNOWN, requested: null, affordable: null };
}

/**
 * A routeKey identifies a route exactly: source, harness, routeKind, account
 * and modelId, each as written. Two accounts of one model are two routes.
 */
function routeKeyOf(candidate) {
  const c = candidate || {};
  return [c.source, c.harness, c.routeKind, c.account, c.modelId]
    .map((p) => String(p))
    .join(SEPARATOR);
}

/**
 * Keep only candidates the request can actually use.
 *
 * A route is rejected only when its known budget cannot afford the request
 * (BUDGET_BELOW_REQUEST). A route with no budget data stays eligible with
 * budgetKnown false. Nothing is rejected for a name pattern.
 *
 * A route is also rejected when its own routeKey has a state that forbids it:
 * AUTH_FAILED when auth === false, QUOTA_EXHAUSTED when quota === 'EXHAUSTED',
 * COOLDOWN_ACTIVE when cooldownUntil is later than now. A state keyed on one
 * account never touches another account of the same model.
 *
 * @param {Array} candidates
 * @param {{outputTokens?: number}} request
 * @param {Object<string, Object>} [states] routeKey -> { auth, quota, cooldownUntil, ... }
 * @param {number|string} [now] current instant; never read from the clock
 * @returns {{eligible: Array, rejected: Array<{candidate, reason}>}}
 */
function filterEligible(candidates, request, states, now) {
  const reqTokens = request ? request.outputTokens : undefined;
  const stateMap = states || {};
  const nowMs = toTime(now);
  const eligible = [];
  const rejected = [];
  for (const c of candidates || []) {
    const state = stateMap[routeKeyOf(c)];
    if (state) {
      if (state.auth === false) {
        rejected.push({ candidate: c, reason: REJECT_REASONS.AUTH_FAILED });
        continue;
      }
      if (state.quota === 'EXHAUSTED') {
        rejected.push({ candidate: c, reason: REJECT_REASONS.QUOTA_EXHAUSTED });
        continue;
      }
      const untilMs = toTime(state.cooldownUntil);
      if (untilMs !== null && nowMs !== null && untilMs > nowMs) {
        rejected.push({ candidate: c, reason: REJECT_REASONS.COOLDOWN_ACTIVE });
        continue;
      }
    }
    const budget = c && c.budget;
    const maxOutput = budget && budget.maxOutputTokens;
    const budgetKnown = typeof maxOutput === 'number' && Number.isFinite(maxOutput);
    if (budgetKnown && maxOutput < reqTokens) {
      rejected.push({ candidate: c, reason: REJECT_REASONS.BUDGET_BELOW_REQUEST });
      continue;
    }
    eligible.push(Object.assign({}, c, { budgetKnown }));
  }
  return { eligible, rejected };
}

/**
 * Rank candidates that share one quality scale, by score, descending.
 *
 * Only candidates whose quality.scale === scale and whose quality.score is a
 * finite number are compared. Every other candidate — including ones whose
 * score is higher on a different scale, or missing a numeric score — goes to
 * unknown, unchanged. No conversion between scales.
 *
 * @param {Array} eligible
 * @param {string} scale
 * @returns {{ranked: Array, unknown: Array}}
 */
function rankByScale(eligible, scale) {
  const ranked = [];
  const unknown = [];
  for (const c of eligible || []) {
    const q = c && c.quality;
    if (q && q.scale === scale && Number.isFinite(q.score)) ranked.push(c);
    else unknown.push(c);
  }
  // Ties do not depend on input order: a known budget first, then the route key.
  const byKey = (a, b) =>
    routeKeyOf(a) < routeKeyOf(b) ? -1 : routeKeyOf(a) > routeKeyOf(b) ? 1 : 0;
  ranked.sort(
    (a, b) =>
      Number(b.quality.score) - Number(a.quality.score) ||
      Number(b.budgetKnown === true) - Number(a.budgetKnown === true) ||
      byKey(a, b)
  );
  return { ranked, unknown };
}

function toChosen(candidate) {
  const c = candidate || {};
  const q = c.quality;
  return {
    source: c.source,
    harness: c.harness,
    routeKind: c.routeKind,
    account: c.account === undefined ? null : c.account,
    modelId: c.modelId,
    budget: c.budget,
    cwd: c.cwd,
    quotaScope: c.quotaScope,
    quality: q ? { source: q.scale, scale: q.scale, score: q.score, version: q.version } : null,
  };
}

/**
 * True when any state carries a cooldownUntil. A cooldown cannot be honoured
 * without a comparable instant, so the caller must supply one.
 */
function hasCooldownState(states) {
  if (!states) return false;
  for (const key of Object.keys(states)) {
    const s = states[key];
    if (s && s.cooldownUntil !== undefined && s.cooldownUntil !== null) return true;
  }
  return false;
}

/**
 * Decide the route for a run.
 *
 * Filters by budget, ranks inside the requested scale, and picks the top
 * scorer. A combo is only ever chosen as itself — it carries no quality, so
 * it never enters the ranked list and never inherits a member score.
 *
 * When any state carries a cooldownUntil but `now` is not a number, the
 * cooldown cannot be evaluated. Rather than silently ignoring it, the decision
 * fails closed with NOW_REQUIRED.
 *
 * @param {{runId: string, candidates: Array, request: Object, states?: Object, now?: number, scale: string, workKind?: string}} opts
 * @returns {{status: string, runId: string, chosen: Object|null, reasons: Array<string>, rejected: Array, unknownQuality: Array}}
 */
function decide({ runId, candidates, request, states, now, scale, launchCheck }) {
  const nowIsNumber = typeof now === 'number' && Number.isFinite(now);
  if (!nowIsNumber && hasCooldownState(states)) {
    return {
      status: 'BLOCKED',
      runId,
      chosen: null,
      reasons: ['NOW_REQUIRED'],
      rejected: [],
      unknownQuality: [],
    };
  }
  const blockedBy = (reason) => ({
    status: 'BLOCKED',
    runId,
    chosen: null,
    reasons: [reason],
    rejected: [],
    unknownQuality: [],
  });
  // Without the launcher's check a decision could name a route nothing can run.
  if (typeof launchCheck !== 'function') return blockedBy('LAUNCH_CHECK_REQUIRED');
  const size = request ? request.outputTokens : undefined;
  const creditChecked = (candidates || []).some(
    (c) => c && c.budget && typeof c.budget.maxOutputTokens === 'number'
  );
  if (creditChecked && !(Number.isInteger(size) && size > 0)) {
    return blockedBy('INVALID_REQUEST_SIZE');
  }
  const filtered = filterEligible(candidates, request, states, now);
  const rejected = filtered.rejected;
  // A route the launcher cannot run must lose here, so the winner is always launchable.
  const launchable = [];
  for (const c of filtered.eligible) {
    const blocker = launchCheck(c);
    if (blocker) rejected.push({ candidate: c, reason: blocker });
    else launchable.push(c);
  }
  const { ranked, unknown } = rankByScale(launchable, scale);
  const reasons = [];
  if (ranked.length === 0) {
    return {
      status: 'BLOCKED',
      runId,
      chosen: null,
      reasons: ['NO_RANKED_CANDIDATE_FOR_SCALE'],
      rejected,
      unknownQuality: unknown,
    };
  }
  return {
    status: 'DECIDED',
    runId,
    chosen: toChosen(ranked[0]),
    reasons,
    rejected,
    unknownQuality: unknown,
  };
}

module.exports = {
  classifyFailure,
  filterEligible,
  rankByScale,
  decide,
  routeKey: routeKeyOf,
};
