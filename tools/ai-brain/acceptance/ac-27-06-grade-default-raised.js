'use strict';
// AC-AI-27-06 — negative proof that the grade contract rejects a grader whose
// default has been raised to the top class.
//
// The contract is `./lib/coding-grade.js`, the same module
// `ac-27-05-grade-contract.js` requires: editing the rule changes both the
// invariant and this proof. The REAL `tools/ai-brain/fitness.js` is read and
// proved to satisfy the contract as a CONTROL; then a COPY is written to
// `os.tmpdir()` with the fallback that an ungraded model receives changed from
// STANDARD to ARCHITECTURAL, and the same detector must report the missing part.
// Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GRADER_SOURCE, missingGradeParts } = require('./lib/coding-grade');

const SAFE_DEFAULT = /:\s*Difficulty\.STANDARD\s*;/;
const RAISED_DEFAULT = ': Difficulty.ARCHITECTURAL;';

if (!fs.existsSync(GRADER_SOURCE)) {
  console.error('SOURCE_MISSING: ' + GRADER_SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(GRADER_SOURCE, 'utf8');

// Control: the untouched grader must satisfy the contract, or refusing a
// degraded copy of it says nothing about the rule.
if (missingGradeParts(real).length > 0) {
  console.error('CONTROL_FAILED: the real grader already violates the contract');
  process.exit(2);
}

// Tamper a COPY: an ungraded model now falls to the top class.
const tampered = real.replace(SAFE_DEFAULT, RAISED_DEFAULT);
if (tampered === real) {
  console.error('CONTROL_FAILED: the default the rule names is not in the source');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac27-06-' + process.pid + '.js');
fs.writeFileSync(tmp, tampered);
const missing = missingGradeParts(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (missing.length === 0) {
  console.error('GRADE_DEFAULT_RAISED_NOT_DETECTED');
  process.exit(0);
}
console.error('GRADE_CONTRACT_VIOLATED: ' + missing[0].label);
process.exit(1);
