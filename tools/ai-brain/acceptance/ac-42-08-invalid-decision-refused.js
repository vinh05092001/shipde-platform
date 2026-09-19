'use strict';
// AC-AI-42-08 — negative proof that an invalid or unvetted decision identifier
// fails to raise the ceiling and is clamped to 1.
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

const items = [
  { workItemId: 'ITEM-1', role: 'author.foundation', branch: 'feat/1', riskDomains: [] },
  { workItemId: 'ITEM-2', role: 'author.foundation', branch: 'feat/2', riskDomains: [] },
];

// Control: the valid decision DEC-017 must raise the ceiling to 2.
const controlPlan = planDispatch(items, pool, {
  limits: { maxImplementationAgents: 2 },
  governedDecision: 'DEC-017',
  now: NOW,
});
if (controlPlan.assignments.length !== 2) {
  console.error('CONTROL_FAILED: DEC-017 failed to raise ceiling in control pass');
  process.exit(2);
}

// Tamper: pass an invalid decision identifier
const invalidDecision = 'INVALID-FLAG';
const tamperedPlan = planDispatch(items, pool, {
  limits: { maxImplementationAgents: 2 },
  governedDecision: invalidDecision,
  now: NOW,
});

if (tamperedPlan.assignments.length === 2) {
  console.error(
    'INVALID_DECISION_NOT_REFUSED: ' + invalidDecision + ' was accepted to raise ceiling'
  );
  process.exit(0);
}

if (
  tamperedPlan.assignments.length === 1 &&
  tamperedPlan.deferred[0].reason === 'IMPLEMENTATION_LIMIT'
) {
  console.error(
    'INVALID_GOVERNED_DECISION_REFUSED: ' +
      invalidDecision +
      ' was refused and implementation ceiling clamped to 1'
  );
  process.exit(1);
}

console.error('UNEXPECTED_PLAN_STATE: ' + JSON.stringify(tamperedPlan));
process.exit(2);
