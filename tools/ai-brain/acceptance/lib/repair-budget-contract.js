'use strict';
// TASK-AI-08 — the bounded-repair contract the supervisor source must satisfy,
// held in exactly one place.
//
// `ac-08-05-repair-budget-surface.js` (the invariant: the real supervisor
// declares and enforces a bounded, fail-closed repair budget) and
// `ac-08-06-repair-budget-unbounded.js` (the negative proof: a copy of the real
// source with the bound removed is refused) both require this module, so the
// rule exists in exactly one place.
//
// The contract is a CLAIM ABOUT THE SUPERVISOR SOURCE, not a re-implementation
// of it. The supervisor that enforces the budget is `scripts/ai/control.ps1`;
// these scripts read that real file, and the negative proof tampers a copy. The
// claims are deliberately the properties TASK-AI-08 must PRESERVE while it
// extends the per-HEAD budget — a bound exists, exhaustion stops fail-closed,
// the counter is Work-Item scoped, and every dispatch is bound to an exact HEAD.
//
// Exit codes used by the scripts that require this file:
//   0 the contract holds   1 it is violated   2 it cannot be measured

const SOURCE = 'scripts/ai/control.ps1';

// Each part is one required property of the real supervisor source.
const REQUIRED_PARTS = [
  {
    id: 'REPAIR_BUDGET_BOUND',
    label: 'a configurable repair-budget bound',
    pattern: /\$MaxRepairBudget\b/,
  },
  {
    id: 'REPAIR_COUNTER',
    label: 'a repair counter that accumulates across heads',
    pattern: /RepairCount\b/,
  },
  {
    id: 'BUDGET_EXHAUSTION_FAIL_CLOSED',
    label: 'a fail-closed stop when the repair counter exceeds the bound',
    // The Work Item total is computed as the next count and compared before
    // anything is written; the refusal throws without assigning it, so a
    // refused repair never inflates the counter it was refused by.
    pattern: /\$nextTotal\s+-gt\s+\$MaxRepairBudget/,
  },
  {
    id: 'BUDGET_EXHAUSTION_DIAGNOSTIC',
    label: 'a durable budget-exhaustion diagnostic',
    pattern: /repair budget exhausted/i,
  },
  {
    id: 'EXACT_HEAD_CI_BINDING',
    label: 'a repair dispatch bound to the exact CI head SHA',
    pattern: /PendingDispatch\s*=\s*@\{\s*Type\s*=\s*"CI_REPAIR"/,
  },
  {
    id: 'EXACT_HEAD_REVIEW_BINDING',
    label: 'a repair dispatch bound to the exact review head SHA',
    pattern: /PendingDispatch\s*=\s*@\{\s*Type\s*=\s*"REVIEW_REPAIR"/,
  },
  {
    id: 'PER_HEAD_BOUND',
    label: 'a configurable per-HEAD repair bound (AI-08-R02)',
    pattern: /\[int\]\$MaxRepairAttemptsPerHead\s*=\s*\d+/,
  },
  {
    id: 'PER_HEAD_FAIL_CLOSED',
    label: 'a fail-closed stop when one HEAD reaches its repair bound (AI-08-R04)',
    pattern: /\$attempts\s+-ge\s+\$MaxRepairAttemptsPerHead/,
  },
  {
    id: 'EVIDENCE_BEFORE_DISPATCH',
    label: 'a refusal to dispatch a repair without evidence (AI-08-R01)',
    pattern: /Cannot bind repair evidence/,
  },
];

/** Every part of the contract missing from `source`, in declaration order. */
function missingRepairBudgetParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.pattern.test(source));
}

module.exports = { SOURCE, REQUIRED_PARTS, missingRepairBudgetParts };
