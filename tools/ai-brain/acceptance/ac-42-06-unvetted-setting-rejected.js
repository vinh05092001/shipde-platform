'use strict';
// AC-AI-42-06 — negative proof that a scheduler which allows unvetted settings
// to raise the implementation ceiling is rejected by the contract.
//
// The rule lives in `./lib/implementation-ceiling.js`, the same module
// `ac-42-05-ceiling-contract.js` requires. A copy of `scheduler.js` is written
// to `os.tmpdir()` with the clamping of unvetted settings removed, and the
// contract rule must detect the violation.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SCHEDULER_SOURCE, missingCeilingParts } = require('./lib/implementation-ceiling');

if (!fs.existsSync(SCHEDULER_SOURCE)) {
  console.error('SOURCE_MISSING: ' + SCHEDULER_SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(SCHEDULER_SOURCE, 'utf8');

// Control: the real scheduler must satisfy the contract.
const controlMissing = missingCeilingParts(real);
if (controlMissing.length > 0) {
  console.error(
    'CONTROL_FAILED: real scheduler fails contract: ' + controlMissing.map((m) => m.id).join('; ')
  );
  process.exit(2);
}

// Tamper a COPY: remove the clamp so unvetted settings can raise the ceiling.
const target = 'effectiveMaxImpl = 1;';
if (!real.includes(target)) {
  console.error('CONTROL_FAILED: target clamp statement not found in scheduler');
  process.exit(2);
}

const tampered = real.replace(target, 'effectiveMaxImpl = requestedMaxImpl; // tampered');
const tmp = path.join(os.tmpdir(), 'shipde-ac42-06-' + process.pid + '.js');
fs.writeFileSync(tmp, tampered);
const tamperedSource = fs.readFileSync(tmp, 'utf8');
fs.unlinkSync(tmp);

const violations = missingCeilingParts(tamperedSource);
if (violations.length === 0) {
  console.error('UNVETTED_SETTING_TAMPER_NOT_DETECTED');
  process.exit(0);
}

console.error(
  'CEILING_CONTRACT_VIOLATED: ' + violations.map((m) => m.id + ': ' + m.label).join('; ')
);
process.exit(1);
