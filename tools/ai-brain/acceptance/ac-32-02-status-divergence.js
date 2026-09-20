'use strict';
// AC-AI-32-02 — negative proof for the Control-table/register comparison.
//
// The comparison lives in `./lib/spec-status-alignment.js`, the same module the
// invariant `ac-32-01-status-alignment.js` requires. This script reads the REAL
// specification and the REAL register, proves the untouched pair agrees as a
// CONTROL, then tampers a COPY of the specification in `os.tmpdir()` and
// requires the same comparison to reject it. Nothing on disk is modified.
//
// Run outside the repository it exits 2 (the real sources are missing), never 1,
// so the negative proof cannot pass by accident where nothing exists. That
// property is measured by `ac-32-08-outside-repository.js`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STATUS_CELL, controlStatus, registerStatus } = require('./lib/spec-status-alignment');

const SPEC = 'docs/product-spec/work-items/TASK-AI-32.md';
const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-32';

for (const source of [SPEC, REG]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source);
    process.exit(2);
  }
}

const real = fs.readFileSync(SPEC, 'utf8');
const register = registerStatus(fs.readFileSync(REG, 'utf8'), WORK_ITEM);
if (!register) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' status in the register');
  process.exit(2);
}

// Control: the untampered file must agree with the register, otherwise the
// tampered case below proves nothing about the comparison.
const match = STATUS_CELL.exec(real);
if (!match) {
  console.error('NO_STATUS_CELL');
  process.exit(2);
}
if (controlStatus(real) !== register) {
  console.error('CONTROL_FAILED: the real specification already diverges from the register');
  process.exit(2);
}

const tampered =
  real.slice(0, match.index) +
  match[0].replace(match[1], 'READY_FOR_AUTHOR') +
  real.slice(match.index + match[0].length);
const tmp = path.join(os.tmpdir(), 'shipde-ac32-02-' + process.pid + '.md');
fs.writeFileSync(tmp, tampered);
const observed = controlStatus(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (observed === register) {
  console.error('DIVERGENCE_NOT_DETECTED');
  process.exit(0);
}
console.error('STATUS_DIVERGENCE_DETECTED: tampered copy ' + observed + ' != register ' + register);
process.exit(1);
