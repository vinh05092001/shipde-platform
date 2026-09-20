'use strict';
// AC-AI-11-01 — the invariant: TASK-AI-11's Control table and its
// delivery-register row (row 144) carry the same status. The comparison lives
// in `./lib/spec-status-alignment.js`, the same module the negative proof
// `ac-11-02-status-divergence.js` requires, so the gate and the proof of the
// gate cannot drift apart.
//
// The row reads the real specification and the real register; there is no
// fixture. Run outside the repository it exits 2, not 0, so it cannot pass
// where nothing exists.
const fs = require('fs');
const { controlStatus, statusAlignmentViolations } = require('./lib/spec-status-alignment');

const SPEC = 'docs/product-spec/work-items/TASK-AI-11.md';
const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-11';

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
  for (const violation of violations) console.error(violation);
  process.exit(1);
}

console.log(
  'Control status matches register row 144: ' +
    controlStatus(specText) +
    ' (declared ' +
    WORK_ITEM +
    ')'
);
process.exit(0);
