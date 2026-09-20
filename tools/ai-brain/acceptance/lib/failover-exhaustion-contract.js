'use strict';
// TASK-AI-11 — the failover-exhaustion contract the supervisor source must
// satisfy, held in exactly one place.
//
// `ac-11-07-failover-exhaustion-contract.js` (the invariant: the real supervisor
// declares a bounded failover budget, terminates the session when it is
// exhausted, preserves the existing branch, and fails closed) and
// `ac-11-08-failover-exhaustion-broken.js` (the negative proof: a copy of the
// real source with the exhaustion guard removed is refused) both require this
// module, so the rule exists in exactly one place.
//
// The contract is a CLAIM ABOUT THE SUPERVISOR SOURCE, not a re-implementation
// of it. The supervisor that enforces the failover budget is
// `scripts/ai/control.ps1`; these scripts read that real file, and the negative
// proof tampers a copy. The claims are deliberately the properties TASK-AI-11
// must PRESERVE while it extends bounded failover: a budget variable exists,
// an exhaustion guard terminates the session, branch preservation follows
// exhaustion, and the session fails closed when the budget is exceeded.
//
// Exit codes used by the scripts that require this file:
//   0 the contract holds   1 it is violated   2 it cannot be measured

const SOURCE = 'scripts/ai/control.ps1';

// Each part is one required property of the real supervisor source.
const REQUIRED_PARTS = [
  {
    id: 'MAX_FAILOVERS_BOUND',
    label: 'a configurable failover-budget bound $MaxFailovers',
    pattern: /\$MaxFailovers\b/,
  },
  {
    id: 'FAILOVER_COUNTER',
    label: 'a failover counter that accumulates across attempts',
    pattern: /FailoverCount\b/,
  },
  {
    id: 'EXHAUSTION_GUARD',
    label: 'a guard that terminates the session when failover count exceeds the bound',
    pattern: /exhausted/i,
  },
  {
    id: 'BRANCH_PRESERVED_ON_EXHAUSTION',
    label: 'branch preservation after failover exhaustion',
    pattern: /branch.*preserv|preserv.*branch/i,
  },
  {
    id: 'FAIL_CLOSED_ON_EXHAUSTION',
    label: 'a fail-closed stop when failover budget is exhausted',
    pattern: /fail.closed.*exhaust|exhaust.*fail.closed/i,
  },
];

/** Every part of the contract missing from `source`, in declaration order. */
function missingFailoverExhaustionParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.pattern.test(source));
}

module.exports = { SOURCE, REQUIRED_PARTS, missingFailoverExhaustionParts };
