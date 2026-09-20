'use strict';
// AC-AI-31-03 - Register declares dependency TASK-AI-20; TASK-AI-25.
//
// The rule lives in `./lib/dependency-merged.js` (declaredDependency), the same
// module the negative proof `ac-31-04-dependency-repointed.js` requires. The
// register is read from disk; no Git merge evidence is asserted here.
// Run outside the repository it exits 2, so it cannot pass where nothing exists.
const fs = require('fs');
const { declaredDependency } = require('./lib/dependency-merged');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-31';
const REQUIRED_DEPS = ['TASK-AI-20', 'TASK-AI-25'];

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const registerText = fs.readFileSync(REG, 'utf8');
const deps = declaredDependency(registerText, WORK_ITEM);
if (deps === null) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' row in the register');
  process.exit(2);
}

const missing = REQUIRED_DEPS.filter((dep) => !deps.includes(dep));
if (missing.length > 0) {
  console.error(
    'DEPENDENCY_MISSING: register row for ' + WORK_ITEM + ' does not declare ' + missing.join(', ')
  );
  process.exit(1);
}

console.log(
  'DEPENDENCY_DECLARED: register row for ' + WORK_ITEM + ' declares ' + REQUIRED_DEPS.join('; ')
);
process.exit(0);
