'use strict';
// AC-AI-10-03 - the invariant: TASK-AI-10's register row declares exactly one
// dependency and that dependency is really named by a commit reachable on
// `origin/main`.
//
// The rule lives in `./lib/dependency-merged.js`, the same module the negative
// proof `ac-10-04-dependency-unproven.js` requires. The register is read from
// disk and Git supplies the merge evidence. Run outside the repository it exits
// 2, never 1.
//
// This row exists because the register records TASK-AI-10 as BLOCKED_DEPENDENCY
// while TASK-AI-09's specification is already on `origin/main` (PR #70,
// 9132847): the dependency is proven here from the repository rather than from a
// register status the reconciler has not yet rewritten.
const fs = require('fs');
const { declaredDependency, dependencyProven } = require('./lib/dependency-merged');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-10';
const EXPECTED_DEPENDENCY = 'TASK-AI-09';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const declared = declaredDependency(fs.readFileSync(REG, 'utf8'), WORK_ITEM);
if (declared !== EXPECTED_DEPENDENCY) {
  console.error(
    'DEPENDENCY_DECLARATION_MISMATCH: register row for ' +
      WORK_ITEM +
      ' declares ' +
      declared +
      ', expected ' +
      EXPECTED_DEPENDENCY
  );
  process.exit(1);
}

const verdict = dependencyProven(EXPECTED_DEPENDENCY);
if (!verdict.measurable) {
  console.error('SOURCE_MISSING: ' + verdict.why);
  process.exit(2);
}
if (!verdict.ok) {
  console.error('DEPENDENCY_UNPROVEN: ' + verdict.why);
  process.exit(1);
}

console.log(EXPECTED_DEPENDENCY + ' dependency verified: merged into origin/main for ' + WORK_ITEM);
process.exit(0);
