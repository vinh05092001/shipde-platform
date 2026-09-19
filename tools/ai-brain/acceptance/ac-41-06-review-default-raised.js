'use strict';
// AC-AI-41-06 — negative proof that the review-grade contract rejects a grader
// whose review default has been raised to the coding level.
//
// The contract is `./lib/review-grade.js`, the same module
// `ac-41-05-review-grade-contract.js` requires: editing the rule changes both the
// invariant and this proof. The REAL `tools/ai-brain/fitness.js` is read and
// proved to satisfy the contract as a CONTROL; then a COPY is written to
// `os.tmpdir()` with the fallback that an unrated model receives changed from
// one class below to its full coding grade, and the same detector must report
// the missing part. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GRADER_SOURCE, missingReviewGradeParts } = require('./lib/review-grade');

const SAFE_DEFAULT = /Math\.max\(\s*1\s*,\s*gradeOf\(offering\)\s*-\s*1\s*\)/g;
const RAISED_DEFAULT = 'gradeOf(offering)';

if (!fs.existsSync(GRADER_SOURCE)) {
  console.error('SOURCE_MISSING: ' + GRADER_SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(GRADER_SOURCE, 'utf8');

// Control: the untouched grader must satisfy the contract, or refusing a
// degraded copy of it says nothing about the rule.
if (missingReviewGradeParts(real).length > 0) {
  console.error('CONTROL_FAILED: the real grader already violates the review contract');
  process.exit(2);
}

// Tamper a COPY: an unrated model now reviews at the level it writes.
const tampered = real.replace(SAFE_DEFAULT, RAISED_DEFAULT);
if (tampered === real) {
  console.error('CONTROL_FAILED: the default the rule names is not in the source');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac41-06-' + process.pid + '.js');
fs.writeFileSync(tmp, tampered);
const missing = missingReviewGradeParts(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (missing.length === 0) {
  console.error('REVIEW_DEFAULT_RAISED_NOT_DETECTED');
  process.exit(0);
}
console.error('REVIEW_GRADE_CONTRACT_VIOLATED: ' + missing[0].label);
process.exit(1);
