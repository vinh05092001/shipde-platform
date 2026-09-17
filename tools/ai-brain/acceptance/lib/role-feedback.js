'use strict';
// TASK-AI-25 — the qualifiedRoles feedback rule, held in exactly one place.
//
// AC-AI-25-03 (sustained breach narrows, proved against the real disqualify),
// AC-AI-25-04 (single source), AC-AI-25-06 (floor negative proof),
// AC-AI-25-07 (scope negative proof) and AC-AI-25-08 (grant-refused) all require
// this module. Editing the rule here changes both the gate and the proof of the
// gate; a private copy in each script is the defect this repository has had to
// repair repeatedly.
//
// The module defines the removal decision for qualifiedRoles. It is the same
// rule the production feedback.js will call; this file is the reference,
// re-exported by reference, never copied. Nothing here writes production state —
// it evaluates a proposed change against the rules and returns the decision.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 it is violated   2 it cannot be measured

const { disqualify, getRole } = require('../../capabilities');

// --- Constants -----------------------------------------------------------

const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
const PASS_RATE_FLOOR = 0.5;
const RETRY_CEILING = 3;
const TOKENS_PER_MERGED_CEILING = 500000;

const EXCLUDED_METRICS = new Set([
  'cost', 'quotaPercent', 'grade', 'quality', 'preference',
]);

const WRITTEN_FIELDS = new Set(['qualifiedRoles', 'history']);

// --- Data shapes ---------------------------------------------------------

function outcomeRecord(offeringId, roleId, workItemId, instant, passed, retries, tokens) {
  return {
    offeringId,
    roleId,
    workItemId,
    instant: instant == null ? Date.now() : instant,
    passed: Boolean(passed),
    retries: Number(retries || 0),
    tokens: Number(tokens || 0),
  };
}

function qualifiedRoleEntry(roleId, removedAt, reason, aggregates, source) {
  return {
    roleId,
    removedAt: removedAt == null ? 0 : removedAt,
    reason: reason || '',
    aggregates: aggregates || null,
    source: source || null,
  };
}

// --- Aggregate -----------------------------------------------------------

function aggregateWindow(records, windowStart, windowEnd) {
  const inWindow = records.filter(
    (r) => r.instant >= windowStart && r.instant <= windowEnd
  );
  if (inWindow.length === 0) return null;

  const merged = new Map();
  for (const r of inWindow) {
    const key = r.workItemId;
    if (!merged.has(key)) merged.set(key, { passed: 0, retries: 0, tokens: 0 });
    const m = merged.get(key);
    m.passed += r.passed ? 1 : 0;
    m.retries += r.retries;
    m.tokens += r.tokens;
  }

  let totalPassed = 0, totalRetries = 0, totalTokens = 0, totalItems = 0;
  for (const m of merged.values()) {
    totalPassed += m.passed;
    totalRetries += m.retries;
    totalTokens += m.tokens;
    totalItems += 1;
  }

  return {
    samples: inWindow.length,
    mergedItems: merged.size,
    passRate: totalItems > 0 ? totalPassed / totalItems : 0,
    avgRetriesPerMerged: merged.size > 0 ? totalRetries / merged.size : 0,
    tokensPerMerged: merged.size > 0 ? totalTokens / merged.size : 0,
  };
}

function breachesFloor(agg) {
  if (!agg) return { count: 0, reasons: [] };
  const breaches = [];
  if (agg.passRate < PASS_RATE_FLOOR) breaches.push('passRate');
  if (agg.avgRetriesPerMerged > RETRY_CEILING) breaches.push('retries');
  if (agg.tokensPerMerged > TOKENS_PER_MERGED_CEILING) breaches.push('tokens');
  return { count: breaches.length, reasons: breaches };
}

// --- Evaluation ----------------------------------------------------------

function evaluateNarrowing(roleId, offeringId, records, now) {
  now = now == null ? Date.now() : now;

  // R05: non-delivery outcomes excluded.
  const deliveryRecords = records.filter(
    (r) => r.tokens > 0 || r.retries > 0 || r.passed
  );

  if (deliveryRecords.length === 0) {
    return { decision: 'keep', reason: 'no delivery outcomes in window' };
  }

  const windowEnd = now;
  const windowStart = now - 30 * 24 * 60 * 60 * 1000;
  const agg = aggregateWindow(deliveryRecords, windowStart, windowEnd);
  if (!agg) {
    return { decision: 'keep', reason: 'insufficient records in window' };
  }

  const breach = breachesFloor(agg);

  // R04 + R06: two-of-three breach required.
  if (breach.count < 2) {
    return {
      decision: 'keep',
      reason: 'below floor: ' + breach.count + ' of 3 breached',
      aggregates: agg,
    };
  }

  return {
    decision: 'narrow',
    reason: 'sustained breach: ' + breach.reasons.join(', '),
    aggregates: agg,
  };
}

// --- Validation ----------------------------------------------------------

function validateEntry(entry) {
  if (!entry) return 'ENTRY_MISSING';
  if (entry.source == null || entry.source === '') return 'SOURCE_MISSING';
  if (entry.removedAt == null) return 'MISSING_REMOVED_AT';
  if (entry.source === 'operator') {
    const age = Date.now() - entry.removedAt;
    if (age > STALE_AFTER_MS) return 'EVIDENCE_STALE';
  }
  return null;
}

// --- Narrowing (never grants) -------------------------------------------

function applyNarrowing(qualifiedRoles, roleId) {
  if (!Array.isArray(qualifiedRoles)) return [];
  return qualifiedRoles.filter((r) => r !== roleId);
}

// --- Single-source marker -----------------------------------------------

// This export lets AC-AI-25-04 assert that the removal rule lives in exactly
// this module and nowhere else.
const REMOVAL_RULE_MODULE = module;

// --- Public surface ------------------------------------------------------

module.exports = {
  STALE_AFTER_MS,
  PASS_RATE_FLOOR,
  RETRY_CEILING,
  TOKENS_PER_MERGED_CEILING,
  EXCLUDED_METRICS,
  WRITTEN_FIELDS,
  outcomeRecord,
  qualifiedRoleEntry,
  aggregateWindow,
  breachesFloor,
  evaluateNarrowing,
  validateEntry,
  applyNarrowing,
  REMOVAL_RULE_MODULE,
  getRole,
  disqualify,
};
