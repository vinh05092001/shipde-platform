'use strict';
// AC-AI-25-01 — the invariant: TASK-AI-25's Control table and its
// delivery-register row (order 158) carry the same status. The comparison lives
// in ./lib/spec-status-alignment.js, the same module used by the parallel
// acceptance families, so the gate and the proof of the gate cannot drift apart.
//
// The row reads the real specification and the real register; there is no
// fixture. Run outside the repository it exits 2, not 0, so it cannot pass
// where nothing exists.
const fs = require('fs');
const { controlStatus, statusAlignmentViolations } = require('./lib/spec-status-alignment');

const SPEC = 'docs/product-spec/work-items/TASK-AI-25.md';
const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-25';

for (const source of [SPEC, REG]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source);
    process.exit(2);
  }
}

const specText = fs.readFileSync(SPEC, 'utf8');
const registerText = fs.readFileSync(REG, 'utf8');

const violations = statusAlignmentViolations(specText, registerText, WORK_ITEM);
if (violations.length > 0) {
  for (const v of violations) console.error('CONTROL_DIVERGED: ' + v);
  process.exit(2);
}

console.log(
  'CONTROL_ALIGNED: ' + WORK_ITEM + ' ' + controlStatus(specText) +
  ' order 158'
);
process.exit(0);
