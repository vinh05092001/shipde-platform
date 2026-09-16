'use strict';
// AC-AI-24-05 — the invariant: the real planner plans and launches nothing.
//
// The rule is `./lib/dispatch-executor-contract.js`, the same module the
// negative proof `ac-24-06-planner-launch-detected.js` requires. The planner is
// read from disk, and `planDispatch` is also called with no accounts, so the
// row is evidence about the shipped planner rather than about its text alone.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');
const { PLANNER_PATH, plannerViolations } = require('./lib/dispatch-executor-contract');

if (!fs.existsSync(PLANNER_PATH)) {
  console.error('SOURCE_MISSING: ' + PLANNER_PATH);
  process.exit(2);
}

const violations = plannerViolations(fs.readFileSync(PLANNER_PATH, 'utf8'));
if (violations.length > 0) {
  console.error('PLANNER_CONTRACT_VIOLATED: ' + violations.join('; '));
  process.exit(1);
}

// A plan with nothing to place must still be a plain value: no assignment, and
// the item named as waiting rather than silently dropped.
const { planDispatch } = require(path.resolve(PLANNER_PATH));
const plan = planDispatch(
  [{ workItemId: 'AC-24-05-PROBE', role: 'author.foundation', branch: 'probe', riskDomains: [] }],
  [],
  { reported: {}, now: Date.parse('2026-09-16T00:00:00Z') }
);
if (!plan || !Array.isArray(plan.assignments) || !Array.isArray(plan.deferred)) {
  console.error('PLANNER_CONTRACT_VIOLATED: planDispatch did not return assignments and deferred');
  process.exit(1);
}
if (plan.assignments.length !== 0 || plan.deferred.length !== 1) {
  console.error(
    'PLANNER_CONTRACT_VIOLATED: with no accounts the planner assigned ' +
      plan.assignments.length +
      ' and deferred ' +
      plan.deferred.length
  );
  process.exit(1);
}

console.log(
  'PLANNER_LAUNCHES_NOTHING: scheduler.js requires no launch capability and planDispatch returns a plan (deferred: ' +
    plan.deferred[0].reason +
    ')'
);
