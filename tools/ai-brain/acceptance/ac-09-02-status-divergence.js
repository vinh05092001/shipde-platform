'use strict';
// AC-AI-09-02 — negative proof for the Control-table/register comparison.
//
// The check lives in `./lib/spec-status-alignment.js` and this script calls the
// SAME aggregate function the invariant `ac-09-01-status-alignment.js` calls
// (`statusAlignmentViolations`), so editing the rule changes both outcomes: a
// rule that stops reporting divergence keeps the invariant green while this proof
// goes red. This script reads the REAL specification and the REAL register,
// proves the untouched pair agrees as a CONTROL, then tampers a COPY of the
// specification in `os.tmpdir()` and requires the same comparison to reject it.
// Nothing on disk is modified.
//
// Run outside the repository it exits 2 (the real sources are missing), never 1,
// so the negative proof cannot pass by accident where nothing exists. That
// property is itself measured by `ac-09-14-outside-repository.js`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  controlStatus,
  registerStatus,
  statusAlignmentViolations,
} = require('./lib/spec-status-alignment');

const SPEC = 'docs/product-spec/work-items/TASK-AI-09.md';
const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-09';

for (const source of [SPEC, REG]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source);
    process.exit(2);
  }
}

const real = fs.readFileSync(SPEC, 'utf8');
const registerText = fs.readFileSync(REG, 'utf8');
const register = registerStatus(registerText, WORK_ITEM);
if (!register) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' status in the register');
  process.exit(2);
}

// Control: the untampered pair must agree, otherwise the tampered case below
// proves nothing about the comparison.
if (statusAlignmentViolations(real, registerText, WORK_ITEM).length > 0) {
  console.error('CONTROL_FAILED: the real specification already diverges from the register');
  process.exit(2);
}

const declared = controlStatus(real);
const tampered = real.replace(
  new RegExp('(\\n\\|\\s*Status\\s*\\|\\s*`?)' + declared + '(`?\\s*\\|)'),
  '$1READY_FOR_AUTHOR$2'
);
if (tampered === real) {
  console.error('CONTROL_FAILED: the Status cell the rule names is not in the specification');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac09-02-' + process.pid + '.md');
fs.writeFileSync(tmp, tampered);
const tamperedText = fs.readFileSync(tmp, 'utf8');
fs.unlinkSync(tmp);

// The rejection must come from the comparison itself, not from a missing cell.
const violations = statusAlignmentViolations(tamperedText, registerText, WORK_ITEM);
if (violations.length === 0) {
  console.error('DIVERGENCE_NOT_DETECTED');
  process.exit(0);
}
if (!violations.some((violation) => violation.indexOf('STATUS_DIVERGENCE') === 0)) {
  console.error('CONTROL_FAILED: the tamper produced an unrelated violation: ' + violations[0]);
  process.exit(2);
}
console.error(
  'STATUS_DIVERGENCE_DETECTED: tampered copy ' +
    controlStatus(tamperedText) +
    ' != register ' +
    register
);
process.exit(1);
