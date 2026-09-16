'use strict';
// AC-AI-27-05 — the invariant: the real grader classes a model by a declared
// grade and treats an absent grade as STANDARD, never as the top class.
//
// The rule lives in `./lib/coding-grade.js`, the same module the negative proof
// `ac-27-06-grade-default-raised.js` requires, so editing the rule changes both
// outcomes. The source contract is read from the REAL `tools/ai-brain/fitness.js`
// and the behavioural half calls the REAL `gradeOf` and `isSufficient`, so this
// row is a claim about the shipped grader rather than about a transcription.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const {
  LADDER,
  realGradeOf,
  realIsSufficient,
  GRADER_SOURCE,
  REQUIRED_PARTS,
  missingGradeParts,
  ladderValues,
} = require('./lib/coding-grade');

if (!fs.existsSync(GRADER_SOURCE)) {
  console.error('SOURCE_MISSING: ' + GRADER_SOURCE);
  process.exit(2);
}

const missing = missingGradeParts(fs.readFileSync(GRADER_SOURCE, 'utf8'));
if (missing.length > 0) {
  for (const part of missing) console.error('GRADE_CONTRACT_VIOLATED: ' + part.label);
  process.exit(1);
}

// CONTROL — the behavioural half. An ungraded offering must be exactly STANDARD
// and must be refused the top class, with no declaration anywhere.
const values = ladderValues();
if (JSON.stringify(values) !== JSON.stringify([1, 2, 3, 4])) {
  console.error('GRADE_LADDER_DRIFT: ' + JSON.stringify(values));
  process.exit(1);
}
const ungraded = { id: 'ac27-control-ungraded' };
if (realGradeOf(ungraded) !== LADDER.STANDARD) {
  console.error('CONTROL_FAILED: an ungraded offering did not grade STANDARD');
  process.exit(2);
}
if (realIsSufficient(ungraded, LADDER.ARCHITECTURAL)) {
  console.error('CONTROL_FAILED: an ungraded offering was trusted with the top class');
  process.exit(2);
}
if (!realIsSufficient({ codingGrade: LADDER.ARCHITECTURAL }, LADDER.MECHANICAL)) {
  console.error('CONTROL_FAILED: a graded offering was not sufficient for an easier class');
  process.exit(2);
}

console.log(
  'GRADE_CONTRACT_EVIDENCE: ' +
    REQUIRED_PARTS.length +
    ' parts present in ' +
    GRADER_SOURCE +
    '; the real grader graded an undeclared offering ' +
    realGradeOf(ungraded) +
    ' and refused it the top class'
);
console.log('CONTROL: the real grader was exercised, not a copy of it');
console.log(
  'GRADE_CONTRACT_HOLDS: codingGrade decides the class of work and an absent grade defaults to STANDARD, never to the top class'
);
