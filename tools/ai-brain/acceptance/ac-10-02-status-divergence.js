'use strict';
// AC-AI-10-02 - negative proof for the Control-table/register comparison.
//
// The check lives in `./lib/spec-status-alignment.js` and this script calls the
// SAME aggregate function the invariant `ac-10-01-status-alignment.js` calls, so
// editing the rule changes both outcomes. It reads the REAL specification and the
// REAL register, proves the untouched pair agrees as a CONTROL, then tampers an
// IN-MEMORY copy of the specification and requires the same comparison to reject
// it. Nothing is written to disk.
//
// A negative proof that stops detecting its tamper exits 2, never 0: a green 0
// from a dead rule is indistinguishable from a pass. Run outside the repository
// it also exits 2 (the real sources are missing), never 1.
const fs = require('fs');
const {
  controlStatus,
  registerStatus,
  statusAlignmentViolations,
} = require('./lib/spec-status-alignment');

const SPEC = 'docs/product-spec/work-items/TASK-AI-10.md';
const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-10';

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

const violations = statusAlignmentViolations(tampered, registerText, WORK_ITEM);
if (violations.length === 0) {
  console.error('DIVERGENCE_NOT_DETECTED');
  process.exit(2);
}
if (!violations.some((violation) => violation.indexOf('STATUS_DIVERGENCE') === 0)) {
  console.error('CONTROL_FAILED: the tamper produced an unrelated violation: ' + violations[0]);
  process.exit(2);
}
console.error(
  'STATUS_DIVERGENCE_DETECTED: tampered copy ' +
    controlStatus(tampered) +
    ' != register ' +
    register
);
process.exit(1);
