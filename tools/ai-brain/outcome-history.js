'use strict';

// TASK-AI-171 PR09: read quality history from structured decision/outcome
// records only. No git config, no log regex, no CSV label substring matching.
// A failed round is a changes_required/refused review bound to a reviewedSha;
// a missing/unrelated commit or an infra/quota/sandbox outage is not quality.

const { Cause, Scope } = require('./failure-classifier');

const VERDICT_FIELDS = ['verdict', 'review', 'reviewVerdict', 'reviewStatus', 'decision'];
const QUALITY = new Set(['changes_required', 'refused', 'refuse', 'rejected', 'reject']);
const FAILED = new Set(['failed', 'error', 'aborted', 'refused', 'timeout', 'cancelled']);

const INFRA_CAUSES = new Set(
  Object.entries(Cause)
    .filter(([name]) =>
      /QUOTA|CREDIT|MONTHLY|RATE_LIMIT|CAPACITY|EXHAUST|TIMEOUT|LAUNCH|HARNESS/.test(name)
    )
    .map(([, value]) => token(value))
);
const INFRA_SCOPES = new Set([Scope.LOCAL, Scope.HARNESS, Scope.GATEWAY].map(token));
const INFRA_TEXT =
  /quota|rate[\s_-]*limit|too many requests|\b429\b|cooldown|exhaust|capacity|timed?\s*out|timeout|econnrefused|etimedout|network|unavailable|sandbox|eperm|ebusy|isolation_verdict|worker_root|clone repository/i;

function token(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return value
    .trim()
    .split('(')[0]
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function str(...values) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

// The outcome sub-object when the record nests one (dispatch records do).
function inner(record) {
  return record && record.outcome && typeof record.outcome === 'object' ? record.outcome : {};
}

function verdictValue(value) {
  if (typeof value === 'string' && value.trim()) return token(value);
  if (value && typeof value === 'object' && typeof value.verdict === 'string')
    return token(value.verdict);
  return null;
}

// Cause/scope/text a record carries, flat or nested in `outcome`.
function signals(record) {
  if (!record) return { cause: '', scope: '', text: '' };
  const nest = inner(record);
  const cause = token(str(record.cause, record.errorClass, nest.cause, nest.errorClass));
  const scope = token(str(record.scope, nest.scope));
  const text = [record, nest]
    .flatMap((r) => [r.reason, r.body, r.message, r.error, r.detail])
    .filter(Boolean)
    .join(' ');
  return { cause, scope, text };
}

// Full route identity; never the leaf model suffix.
function routeKeyOf(record) {
  if (!record) return null;
  const direct = str(record.candidateKey, record.writerCandidateKey);
  if (direct) return direct;
  const chosen = record.chosen;
  if (typeof chosen === 'string' && chosen.trim()) return chosen.trim();
  if (chosen && typeof chosen === 'object')
    return str(chosen.candidateKey, chosen.offeringId, chosen.key);
  return null;
}

function isExplicitReviewRecord(record) {
  if (!record) return false;
  const nest = inner(record);
  const stage = token(str(record.stage, nest.stage));
  if (stage === 'review' || stage === 'review_completed' || stage === 'review_result') return true;
  const role = token(str(record.role, nest.role));
  if (role === 'reviewer' || role.startsWith('reviewer_') || role.startsWith('reviewer.'))
    return true;
  if (str(record.reviewer, nest.reviewer)) return true;
  if (record.review && typeof record.review === 'object') return true;
  return false;
}

function reviewedShaOf(record) {
  if (!record) return null;
  const nest = inner(record);
  const direct = str(
    record.reviewedSha,
    record.reviewedCommit,
    nest.reviewedSha,
    nest.reviewedCommit
  );
  if (direct) return direct;
  if (isExplicitReviewRecord(record)) {
    return str(
      record.commit,
      record.sha,
      nest.commit,
      nest.sha,
      record.review && record.review.sha,
      record.review && record.review.commit
    );
  }
  return null;
}

function declaredVerdict(record) {
  if (!record) return null;
  const nest = inner(record);
  for (const field of VERDICT_FIELDS) {
    const found = verdictValue(record[field]) || verdictValue(nest[field]);
    if (found) return found;
  }
  return null;
}

function isInfrastructureOutcome(record) {
  if (!record) return false;
  const { cause, scope, text } = signals(record);
  if (INFRA_SCOPES.has(scope) || INFRA_CAUSES.has(cause)) return true;
  if (cause || scope) return false;
  return text ? INFRA_TEXT.test(text) : false;
}

// Durable quality-vs-outage classification stored with each dispatch outcome.
function classifyOutcome(record) {
  const { cause, scope } = signals(record);
  return {
    infrastructure: isInfrastructureOutcome(record),
    cause: cause || null,
    scope: scope || null,
  };
}

// Shared by routing's proof check: a quality outcome, not an outage.
function isQualityVerdict(item) {
  if (!item) return false;
  if (item.revoked === true || token(item.status) === 'revoked') return true;
  for (const field of VERDICT_FIELDS) if (QUALITY.has(token(item[field]))) return true;
  const status = token(item.status);
  return status === 'changes_required' || status === 'refused';
}

// When runId is specified, only records matching that exact runId are counted; untagged legacy records are excluded.
function parseScope(workItemId, options) {
  if (workItemId && typeof workItemId === 'object') {
    return {
      workItemId: workItemId.workItemId != null ? String(workItemId.workItemId) : null,
      runId: workItemId.runId != null ? String(workItemId.runId) : null,
    };
  }
  const opts = options || {};
  return {
    workItemId: workItemId != null ? String(workItemId) : null,
    runId: opts.runId != null ? String(opts.runId) : null,
  };
}

function isQualityRoundFailure(record, workItemId, options) {
  if (!record) return false;
  const scope = parseScope(workItemId, options);
  if (scope.workItemId != null && String(record.workItemId || '') !== scope.workItemId)
    return false;
  const recordRunId = str(record.runId, inner(record).runId);
  if (scope.runId && recordRunId !== scope.runId) return false;
  const verdict = declaredVerdict(record) || token(record.status) || token(inner(record).status);
  return QUALITY.has(verdict) && Boolean(reviewedShaOf(record)) && !isInfrastructureOutcome(record);
}

function isStructuredFailure(record) {
  if (!record) return false;
  if (token(record.stage) === 'failed') return true;
  const status = token(inner(record).status) || token(record.status);
  return FAILED.has(status);
}

// Per full route: round count and verdict tally for this Work Item.
function verdictHistory(records, workItemId) {
  const out = new Map();
  for (const record of records || []) {
    if (!record || String(record.workItemId || '') !== String(workItemId)) continue;
    const key = routeKeyOf(record);
    const verdict = declaredVerdict(record);
    if (!key || !verdict) continue;
    const entry = out.get(key) || { routeKey: key, rounds: 0, verdicts: {} };
    entry.rounds += 1;
    entry.verdicts[verdict] = (entry.verdicts[verdict] || 0) + 1;
    out.set(key, entry);
  }
  return out;
}

// routeKey -> Set(reviewedSha) for each failed round this Work Item ran.
// When runId is specified, only records matching that exact runId are counted; untagged legacy records are excluded.
function failedRounds(records, workItemId, options) {
  const scope = parseScope(workItemId, options);
  const out = new Map();
  for (const record of records || []) {
    if (!isQualityRoundFailure(record, scope)) continue;
    const key = routeKeyOf(record);
    if (!key) continue;
    const shas = out.get(key) || new Set();
    shas.add(reviewedShaOf(record));
    out.set(key, shas);
  }
  return out;
}

function roundsUsed(records, workItemId, options) {
  return new Set(failedRounds(records, workItemId, options).keys());
}

// Newest structured failure for this Work Item, optionally one run. Item/run
// scope keeps one local failure from penalising every run of the model.
// When runId is specified, only records matching that exact runId are counted; untagged legacy records are excluded.
function lastFailedRoute(records, workItemId, options) {
  const scope = parseScope(workItemId, options);
  const scoped = (records || [])
    .filter(
      (r) => r && (scope.workItemId == null || String(r.workItemId || '') === scope.workItemId)
    )
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  for (const record of scoped) {
    const key = routeKeyOf(record);
    if (!key || !isStructuredFailure(record)) continue;
    const recordRunId = str(record.runId, inner(record).runId);
    if (scope.runId && recordRunId !== scope.runId) continue;
    return { routeKey: key, at: record.at || null, sha: reviewedShaOf(record) };
  }
  return null;
}

// Known quality first, then higher score.
function defaultCompare(a, b) {
  const known = Number(Boolean(a && a.qualityKnown)) - Number(Boolean(b && b.qualityKnown));
  if (known) return known;
  return Number((a && a.score) || 0) - Number((b && b.score) || 0);
}

// Escalate only to an untried candidate whose quality is known and whose score
// ties or beats the best tried route. The retained route is never rejected; a
// lone failed candidate is an honest BLOCKED, not a blind relaunch.
function escalationPlan(eligible, options) {
  const opts = options || {};
  const compare = typeof opts.compare === 'function' ? opts.compare : defaultCompare;
  const list = (eligible || []).filter(Boolean);
  const rejected = [];
  if (!list.length)
    return { action: 'BLOCKED', reason: 'NO_ELIGIBLE_CANDIDATE', launch: null, rejected };

  const failed =
    opts.failedRoutes instanceof Set ? opts.failedRoutes : new Set(opts.failedRoutes || []);
  const last = opts.lastFailedRoute || null;
  const lastKey = last && typeof last === 'object' ? routeKeyOf(last) || last.routeKey : last;

  const isTried = (c) => {
    const k = routeKeyOf(c);
    return failed.has(k) || (lastKey != null && k === lastKey);
  };

  if (list.length === 1 && isTried(list[0]))
    return { action: 'BLOCKED', reason: 'ONLY_FAILED_CANDIDATE', launch: null, rejected };

  const best = (rows) =>
    rows.reduce((pick, c) => (pick == null || compare(c, pick) > 0 ? c : pick), null);
  const tried = list.filter(isTried);
  const untried = list.filter((c) => !isTried(c));
  const bestTried = best(tried);
  const eligibleUntried = best(
    untried.filter(
      (c) => c.qualityKnown === true && (bestTried == null || compare(c, bestTried) >= 0)
    )
  );

  let launch = null;
  if (lastKey) {
    launch = eligibleUntried || null;
  } else {
    launch = eligibleUntried || bestTried || best(list);
  }

  if (!launch) {
    for (const c of list) {
      const k = routeKeyOf(c);
      rejected.push({
        routeKey: k,
        reason:
          lastKey && k === lastKey
            ? 'LAST_FAILED_THIS_ITEM'
            : failed.has(k)
              ? 'TRIED_ROUND_NO_HIGHER_UNTRIED'
              : 'UNTRIED_UNKNOWN_OR_LOWER',
      });
    }
    return { action: 'BLOCKED', reason: 'NO_ELIGIBLE_CANDIDATE', launch: null, rejected };
  }

  const launchKey = routeKeyOf(launch);
  for (const c of list) {
    const k = routeKeyOf(c);
    if (k === launchKey) continue;
    rejected.push({
      routeKey: k,
      reason:
        lastKey && k === lastKey
          ? 'LAST_FAILED_THIS_ITEM'
          : failed.has(k)
            ? 'TRIED_ROUND_NO_HIGHER_UNTRIED'
            : 'UNTRIED_UNKNOWN_OR_LOWER',
    });
  }
  return {
    action: 'LAUNCH',
    launch: launchKey,
    escalated: Boolean(bestTried) && Boolean(eligibleUntried),
    retained: launch === bestTried ? launchKey : null,
    rejected,
  };
}

// Bounded structured counts only: no "best finisher" claim and no question.
function boundedOutcomeSummary(records, workItemId, options) {
  const opts = options || {};
  const failed = failedRounds(records, workItemId, options);
  const routes = [...verdictHistory(records, workItemId).values()].map((entry) => ({
    routeKey: entry.routeKey,
    rounds: entry.rounds,
    verdicts: entry.verdicts,
    failedRounds: (failed.get(entry.routeKey) || new Set()).size,
  }));
  const full = routes
    .map((r) => `${r.routeKey}: ${r.rounds} round(s) ${JSON.stringify(r.verdicts)}`)
    .join('; ');
  const maxChars = Number(opts.maxChars);
  const summary = Number.isFinite(maxChars) && maxChars > 0 ? full.slice(0, maxChars) : full;
  return { workItemId, routes, summary, truncated: summary.length < full.length };
}

module.exports = {
  routeKeyOf,
  reviewedShaOf,
  declaredVerdict,
  isInfrastructureOutcome,
  classifyOutcome,
  isQualityVerdict,
  isQualityRoundFailure,
  verdictHistory,
  failedRounds,
  roundsUsed,
  lastFailedRoute,
  defaultCompare,
  escalationPlan,
  boundedOutcomeSummary,
};
