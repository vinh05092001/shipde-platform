'use strict';
// AC-AI-41-08 — negative proof that the declared review-grade rule refuses a
// declaration carrying a review grade outside the ladder.
//
// The rule lives in `./lib/review-grade.js`, the same module
// `ac-41-07-declared-review-grades.js` requires. The declarations the repository
// really ships are read from the REAL `tools/ai-brain/seed-accounts.js` and
// proved to be inside the ladder as a CONTROL; then a COPY of those declarations
// is written to `os.tmpdir()` with one review grade moved outside the ladder,
// re-read, and the same rule must report it. Nothing on disk is modified, and no
// value in this file is a transcription of a registry declaration.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DECLARATIONS_SOURCE,
  declaredReviewGradeEntries,
  outOfLadderReviewGrades,
  ladderValues,
} = require('./lib/review-grade');

if (!fs.existsSync(DECLARATIONS_SOURCE)) {
  console.error('SOURCE_MISSING: ' + DECLARATIONS_SOURCE);
  process.exit(2);
}

const real = declaredReviewGradeEntries();
const declared = real.filter((entry) => entry.grade !== undefined);

// Control: the untouched declarations must be inside the ladder, or rejecting a
// tampered copy of them says nothing about the rule.
if (declared.length === 0) {
  console.error('CONTROL_FAILED: no declared review grade to tamper with');
  process.exit(2);
}
if (outOfLadderReviewGrades(real).length > 0) {
  console.error(
    'CONTROL_FAILED: the real declarations already carry a review grade outside the ladder'
  );
  process.exit(2);
}

// Tamper a COPY: move one declared review grade outside the ladder.
const outside = Math.max.apply(null, ladderValues()) + 1;
const tamperedEntries = real.map((entry, index) =>
  index === real.indexOf(declared[0]) ? Object.assign({}, entry, { grade: outside }) : entry
);
const tmp = path.join(os.tmpdir(), 'shipde-ac41-08-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tamperedEntries));
const reread = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

const violations = outOfLadderReviewGrades(reread);
if (violations.length === 0) {
  console.error('OUT_OF_LADDER_REVIEW_GRADE_NOT_DETECTED');
  process.exit(0);
}
console.error(
  'OUT_OF_LADDER_REVIEW_GRADE: ' + violations[0].path + ' declares ' + violations[0].grade
);
process.exit(1);
