'use strict';
// AC-AI-42-07 — behavioral verification: DEC-017 permits raising the
// implementation ceiling while unvetted settings are clamped and the
// writer safety invariant holds permanently.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const { SCHEDULER_SOURCE, planDispatch } = require('./lib/implementation-ceiling');

if (!fs.existsSync(SCHEDULER_SOURCE)) {
  console.error('SOURCE_MISSING: ' + SCHEDULER_SOURCE);
  process.exit(2);
}

const NOW = Date.parse('2026-09-19T12:00:00Z');

const pool = [
  {
    id: 'acct-1',
    provider: 'google',
    model: 'gemini-2.5-pro',
    enabled: true,
    capabilities: { jsonSchema: true, tools: true, contextWindow: 1000000 },
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    limits: {},
  },
  {
    id: 'acct-2',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    enabled: true,
    capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
    cost: { inputPerMillion: 3, outputPerMillion: 15 },
    limits: {},
  },
];

const itemA = {
  workItemId: 'ITEM-A',
  role: 'author.foundation',
  branch: 'feat/item-a',
  riskDomains: [],
};
const itemB = {
  workItemId: 'ITEM-B',
  role: 'author.foundation',
  branch: 'feat/item-b',
  riskDomains: [],
};

// 1. Default ceiling is 1: second item is deferred with IMPLEMENTATION_LIMIT
const defaultPlan = planDispatch([itemA, itemB], pool, { now: NOW });
if (
  defaultPlan.assignments.length !== 1 ||
  defaultPlan.deferred[0].reason !== 'IMPLEMENTATION_LIMIT'
) {
  console.error('DEFAULT_CEILING_NOT_ONE: ' + JSON.stringify(defaultPlan));
  process.exit(1);
}

// 2. Unvetted setting requesting 2 is clamped to 1: second item still deferred
const unvettedPlan = planDispatch([itemA, itemB], pool, {
  limits: { maxImplementationAgents: 2 },
  now: NOW,
});
if (
  unvettedPlan.assignments.length !== 1 ||
  unvettedPlan.deferred[0].reason !== 'IMPLEMENTATION_LIMIT'
) {
  console.error('UNVETTED_SETTING_NOT_CLAMPED: ' + JSON.stringify(unvettedPlan));
  process.exit(1);
}

// 3. Governed decision DEC-017 permits raising ceiling to 2: both items assigned
const governedPlan = planDispatch([itemA, itemB], pool, {
  limits: { maxImplementationAgents: 2 },
  governedDecision: 'DEC-017',
  now: NOW,
});
if (governedPlan.assignments.length !== 2 || governedPlan.deferred.length !== 0) {
  console.error('GOVERNED_DECISION_FAILED_TO_RAISE: ' + JSON.stringify(governedPlan));
  process.exit(1);
}

// 4. Single-writer invariant holds permanently even with governed decision
const collisionPlan = planDispatch([itemA, itemA], pool, {
  limits: { maxImplementationAgents: 2 },
  governedDecision: 'DEC-017',
  now: NOW,
});
if (
  collisionPlan.assignments.length !== 1 ||
  collisionPlan.deferred[0].reason !== 'WORK_ITEM_ALREADY_WRITING'
) {
  console.error('WRITER_SAFETY_INVARIANT_VIOLATED: ' + JSON.stringify(collisionPlan));
  process.exit(1);
}

console.log(
  'GOVERNED_DECISION_EFFECTIVE: DEC-017 permits raising implementation ceiling while unvetted setting is clamped and writer safety invariant holds'
);
process.exit(0);
