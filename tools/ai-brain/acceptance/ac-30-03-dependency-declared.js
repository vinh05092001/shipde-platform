'use strict';
// AC-AI-30-03 — the invariant: TASK-AI-30's register row declares exactly one
// dependency and that dependency is exactly TASK-AI-29.
//
// The rule lives in `./lib/dependency-declared.js`, the same module the negative
// proof `ac-30-04-dependency-repointed.js` requires. The register is read from
// disk; no Git merge evidence is asserted here (the dependency is still
// `BLOCKED_DEPENDENCY`). Run outside the repository it exits 2, so it cannot pass
// where nothing exists.
const fs = require('fs');
const { dependencyDeclared } = require('./lib/dependency-declared');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-30';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const declared = dependencyDeclared(fs.readFileSync(REG, 'utf8'), WORK_ITEM);
if (!declared.measurable) {
  console.error('SOURCE_MISSING: ' + declared.why);
  process.exit(2);
}
if (!declared.ok) {
  console.error(
    'DEPENDENCY_DECLARATION_MISMATCH: register row for ' +
      WORK_ITEM +
      ' declares ' +
      declared.declared +
      ', expected ' +
      'TASK-AI-29'
  );
  process.exit(1);
}

console.log('TASK-AI-29 dependency declared for ' + WORK_ITEM + ' (name only, no merge claim)');
process.exit(0);
