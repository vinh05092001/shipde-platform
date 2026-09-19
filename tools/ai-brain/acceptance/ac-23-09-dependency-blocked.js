'use strict';
// AC-AI-23-09 — the invariant: TASK-AI-23's register row declares exactly one
// dependency (`TASK-AI-22`) and that dependency is NOT delivered on
// `origin/main`. The row 156 dependency is `TASK-AI-22`, whose register row 155
// records `BLOCKED_DEPENDENCY` behind `TASK-AI-21`, and no commit on
// `origin/main` merges a `TASK-AI-22` Work Item file.
//
// The rule lives in `./lib/dependency-delivered.js`, the same module the negative
// proof `ac-23-10-dependency-unproven.js` requires, so the invariant and the proof
// of the invariant share one rule. This row exists because the register records
// TASK-AI-23 as `BLOCKED_DEPENDENCY` and the dependency is NOT delivered — the
// row proves the block rather than asserting delivery.
//
// Run outside the repository it exits 2, not 0.
const fs = require('fs');
const { dependencyDelivered } = require('./lib/dependency-delivered');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-23';
const EXPECTED_DEPENDENCY = 'TASK-AI-22';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const registerText = fs.readFileSync(REG, 'utf8');

// CONTROL: the rule must be able to fail at all. An id the register does not
// declare must be reported as unmeasurable, not silently accepted.
const probe = dependencyDelivered(registerText, 'TASK-AI-999');
if (probe.measurable && probe.ok) {
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

// The expected outcome for this Work Item is that the dependency is NOT delivered:
// the register records BLOCKED_DEPENDENCY for TASK-AI-22, and no merge commit for
// TASK-AI-22 is reachable on origin/main. This row proves the block; it does not
// assert delivery.
if (verdict.ok) {
  console.error(
    'DEPENDENCY_BLOCK_FAILED: ' +
      EXPECTED_DEPENDENCY +
      ' is reported delivered, but the register records BLOCKED_DEPENDENCY'
  );
  process.exit(1);
}

console.log('TASK-AI-22 dependency blocked: no promotion gate delivered for TASK-AI-23');
console.log('  dependency: ' + verdict.dependency);
console.log('  reason: ' + verdict.why);
process.exit(0);
