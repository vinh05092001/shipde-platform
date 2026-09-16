'use strict';
// AC-AI-21-09 — the invariant: TASK-AI-21's register row declares exactly one
// dependency and that dependency is really delivered on `origin/main`.
//
// The rule lives in `./lib/dependency-delivered.js`, the same module the negative
// proof `ac-21-10-dependency-unproven.js` requires. That module re-exports the
// register's dependency parser and the commit-name merge rule from
// `./dependency-merged.js` by reference, and the dependency's OWN deliverable rule
// from `./reconcile-expectations.js` by reference; it restates neither.
//
// This row exists because the register records TASK-AI-21 as `BLOCKED_DEPENDENCY`
// while register row 150 still reads `READY_FOR_CODEX` for TASK-AI-17. The
// dependency is therefore proven from the repository, not from a register status.
// The proof has two halves on purpose: a commit whose message merely names
// TASK-AI-17 satisfies the commit-name rule, so the row additionally requires
// TASK-AI-17's declared deliverable to be present on `origin/main` and to pass
// TASK-AI-17's own acceptance rule there.
//
// Run outside the repository it exits 2, not 0.
const fs = require('fs');
const { dependencyDelivered } = require('./lib/dependency-delivered');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-21';
const EXPECTED_DEPENDENCY = 'TASK-AI-17';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const registerText = fs.readFileSync(REG, 'utf8');

// CONTROL: the rule must be able to fail at all. An id the register does not
// declare must be reported as unmeasurable, not silently accepted.
const probe = dependencyDelivered(registerText, 'TASK-AI-999');
if (probe.measurable || probe.ok) {
  console.error('CONTROL_FAILED: the rule accepted a Work Item the register does not declare');
  process.exit(2);
}

const verdict = dependencyDelivered(registerText, WORK_ITEM);
if (!verdict.measurable) {
  console.error('SOURCE_MISSING: ' + verdict.why);
  process.exit(2);
}
if (verdict.dependency !== EXPECTED_DEPENDENCY) {
  console.error(
    'DEPENDENCY_DECLARATION_MISMATCH: register row for ' +
      WORK_ITEM +
      ' declares ' +
      verdict.dependency +
      ', expected ' +
      EXPECTED_DEPENDENCY
  );
  process.exit(1);
}
if (!verdict.ok) {
  console.error('DEPENDENCY_UNPROVEN: ' + verdict.why);
  process.exit(1);
}

console.log(
  EXPECTED_DEPENDENCY + ' dependency verified: delivered on origin/main for ' + WORK_ITEM
);
console.log(
  'evidence: ' + verdict.deliverable + ' on origin/main satisfies its own acceptance rule'
);
process.exit(0);
