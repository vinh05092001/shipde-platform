'use strict';
// AC-AI-22-01 — the Control table of TASK-AI-22 and its delivery-register row
// cannot diverge.
//
// The comparison lives in `./lib/spec-status-alignment.js`, the same module the
// negative proof `ac-22-02-status-divergence.js` requires, so editing the rule
// changes both outcomes. The register row number is READ from the register
// rather than typed here, so the row's own output cannot go stale while the
// register keeps a different delivery order.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');
const { REGISTER_PATH, registerRows } = require('./lib/spec-coverage');
const { controlStatus, registerStatus } = require('./lib/spec-status-alignment');

const SPEC = 'docs/product-spec/work-items/TASK-AI-22.md';
const WORK_ITEM = 'TASK-AI-22';

for (const source of [SPEC, REGISTER_PATH]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source.split(path.sep).join('/'));
    process.exit(2);
  }
}

const specText = fs.readFileSync(SPEC, 'utf8');
const registerText = fs.readFileSync(REGISTER_PATH, 'utf8');

const control = controlStatus(specText);
const register = registerStatus(registerText, WORK_ITEM);
if (!control) {
  console.error('SOURCE_MISSING: the specification declares no Status cell');
  process.exit(2);
}
if (!register) {
  console.error('SOURCE_MISSING: the register records no status for ' + WORK_ITEM);
  process.exit(2);
}

if (control !== register) {
  console.error('STATUS_DIVERGENCE: Control table ' + control + ' vs register ' + register);
  process.exit(1);
}

const row = registerRows(registerText).find((candidate) => candidate.work_item_id === WORK_ITEM);
const order = row ? row.delivery_order : '(unknown)';

console.log(
  'Control status matches register row ' + order + ': ' + register + ' (declared ' + WORK_ITEM + ')'
);
