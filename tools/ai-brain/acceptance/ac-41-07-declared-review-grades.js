'use strict';
// AC-AI-41-07 — the invariant: every review grade the committed registry ships
// is a member of the four-level ladder.
//
// The rule lives in `./lib/review-grade.js`, the same module the negative proof
// `ac-41-08-review-grade-out-of-ladder.js` requires. The declarations are read
// from the REAL `tools/ai-brain/seed-accounts.js` through that module's exported
// lists, and the ladder is the REAL object `fitness.js` compares against, so
// this row is a claim about what the repository declares rather than about a
// fixture.
//
// The count of models with declared and undeclared review grades is printed as
// evidence and is deliberately NOT asserted: `seed-accounts.js` is expected to
// change as review grades move from provisional to measured, and pinning the
// count would fail the row for the change it exists to allow.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
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

// CONTROL — the rule must discriminate, or a clean result means nothing.
const allowed = ladderValues();
if (outOfLadderReviewGrades([{ path: 'control', grade: allowed[0] }]).length !== 0) {
  console.error('CONTROL_FAILED: a ladder member was reported as out of the ladder');
  process.exit(2);
}
const outside = Math.max.apply(null, allowed) + 1;
if (outOfLadderReviewGrades([{ path: 'control', grade: outside }]).length !== 1) {
  console.error('CONTROL_FAILED: a grade outside the ladder was not reported');
  process.exit(2);
}
if (outOfLadderReviewGrades([{ path: 'control', grade: undefined }]).length !== 0) {
  console.error('CONTROL_FAILED: an unrated declaration was reported as out of the ladder');
  process.exit(2);
}

const entries = declaredReviewGradeEntries();
const declared = entries.filter((entry) => entry.grade !== undefined).length;
const undeclared = entries.length - declared;
const violations = outOfLadderReviewGrades(entries);

for (const violation of violations) {
  console.error('OUT_OF_LADDER_REVIEW_GRADE: ' + violation.path + ' declares ' + violation.grade);
}

console.log(
  'DECLARED_REVIEW_GRADES_EVIDENCE: ' +
    entries.length +
    ' declared models, ' +
    declared +
    ' with declared reviewGrade, ' +
    undeclared +
    ' unrated for review, ladder ' +
    allowed.join('<') +
    ' read from fitness.js'
);
console.log('CONTROL: the rule admitted a ladder member and rejected a grade outside it');
if (violations.length > 0) process.exit(1);
console.log(
  'DECLARED_REVIEW_GRADES_IN_LADDER: every declared reviewGrade in ' +
    DECLARATIONS_SOURCE +
    ' is a member of the four-level ladder read from fitness.js'
);
