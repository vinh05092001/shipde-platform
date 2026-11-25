'use strict';

// Single source of truth for constants and role helpers shared across orchestrate.js
// and tools/ai-brain/orchestrate/*.js.

function exhaustedAccountKey(c) {
  if (!c || !c.accountId || c.accountId === '*') return null;
  return `account-exhausted::${c.harness || ''}::${c.accountId}`;
}

function parseExhaustedAccountKey(key) {
  if (typeof key !== 'string') return null;
  const match = /^account-exhausted::([^:]*)::(.+)$/.exec(key);
  if (!match) return null;
  return { harness: match[1], accountId: match[2] };
}

const ItemStatus = Object.freeze({
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  BLOCKED_NO_ROUTE: 'BLOCKED_NO_ROUTE',
  DEFERRED: 'deferred',
  // DT-R02: an item the format gate stopped before review. It is neither
  // completed nor an infrastructure block — the work exists, it is unformatted,
  // and it is never reviewed or published until a repair round formats it.
  REFUSED: 'refused',
});

const RunStatus = Object.freeze({
  PUBLISHED_DRAFT: 'PUBLISHED_DRAFT',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  BLOCKED_NO_ROUTE: 'BLOCKED_NO_ROUTE',
  REFUSED: 'REFUSED',
  FAILED: 'FAILED',
});

const PublicationStatus = Object.freeze({
  PUBLISHED_DRAFT: 'PUBLISHED_DRAFT',
  NOT_REQUESTED: 'NOT_REQUESTED',
  REFUSED: 'REFUSED',
});

const DEFAULT_REVIEW_BUDGET = 3;
const SHA_40 = /^[0-9a-f]{40}$/i;
const ACCEPTED_VERDICTS = Object.freeze(['PASS', 'FALLBACK_PASS']);

function roleOf(item) {
  return (
    (item && item.roleRequirement && item.roleRequirement.role) ||
    (item && item.role) ||
    'author.foundation'
  );
}

function routingRoleOf(item) {
  const role = roleOf(item);
  if (/review/i.test(role)) return 'reviewer';
  if (/security/i.test(role)) return 'security-review';
  if (/analyst|research/i.test(role)) return 'researcher';
  if (/scan/i.test(role)) return 'scanner';
  if (/integrat/i.test(role)) return 'integrator';
  return 'writer';
}

module.exports = {
  exhaustedAccountKey,
  parseExhaustedAccountKey,
  ItemStatus,
  RunStatus,
  PublicationStatus,
  DEFAULT_REVIEW_BUDGET,
  SHA_40,
  ACCEPTED_VERDICTS,
  roleOf,
  routingRoleOf,
};
