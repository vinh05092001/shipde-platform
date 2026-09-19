'use strict';
// AC-AI-41-05 — the invariant: the real review grader classes a model by a
// declared reviewGrade and defaults an undeclared model to one class below what
// it writes, never to the coding grade.
//
// The rule lives in `./lib/review-grade.js`, the same module the negative proof
// `ac-41-06-review-default-raised.js` requires, so editing the rule changes both
// outcomes. The source contract is read from the REAL `tools/ai-brain/fitness.js`
// and the behavioural half calls the REAL `reviewGradeOf` and `scoreOffering`,
// so this row is a claim about the shipped grader rather than about a transcription.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const {
  LADDER,
  realReviewGradeOf,
  realGradeOf,
  realResolveReviewGrade,
  realScoreOffering,
  GRADER_SOURCE,
  REQUIRED_PARTS,
  missingReviewGradeParts,
  ladderValues,
} = require('./lib/review-grade');

if (!fs.existsSync(GRADER_SOURCE)) {
  console.error('SOURCE_MISSING: ' + GRADER_SOURCE);
  process.exit(2);
}

const missing = missingReviewGradeParts(fs.readFileSync(GRADER_SOURCE, 'utf8'));
if (missing.length > 0) {
  for (const part of missing) console.error('REVIEW_GRADE_CONTRACT_VIOLATED: ' + part.label);
  process.exit(1);
}

// CONTROL — the behavioural half.
const values = ladderValues();
if (JSON.stringify(values) !== JSON.stringify([1, 2, 3, 4])) {
  console.error('GRADE_LADDER_DRIFT: ' + JSON.stringify(values));
  process.exit(1);
}

// 1. Undeclared review grade reviews one class below coding grade
const unratedArch = { id: 'unrated-arch', codingGrade: LADDER.ARCHITECTURAL };
if (realReviewGradeOf(unratedArch) !== LADDER.COMPLEX) {
  console.error('CONTROL_FAILED: an unrated architectural model did not review at COMPLEX');
  process.exit(2);
}

const unratedStd = { id: 'unrated-std', codingGrade: LADDER.STANDARD };
if (realReviewGradeOf(unratedStd) !== LADDER.MECHANICAL) {
  console.error('CONTROL_FAILED: an unrated standard model did not review at MECHANICAL');
  process.exit(2);
}

const unratedMech = { id: 'unrated-mech', codingGrade: LADDER.MECHANICAL };
if (realReviewGradeOf(unratedMech) !== LADDER.MECHANICAL) {
  console.error('CONTROL_FAILED: an unrated mechanical model dropped below MECHANICAL');
  process.exit(2);
}

// 2. An offering with neither codingGrade nor reviewGrade
const completelyUnrated = { id: 'completely-unrated' };
if (realReviewGradeOf(completelyUnrated) !== LADDER.MECHANICAL) {
  console.error('CONTROL_FAILED: an undeclared model did not default to MECHANICAL review');
  process.exit(2);
}

// 3. Explicit declaration reviews at the declared level, independent of codingGrade
const declaredArchReviewer = {
  id: 'declared-arch-rev',
  codingGrade: LADDER.STANDARD,
  reviewGrade: LADDER.ARCHITECTURAL,
};
if (realReviewGradeOf(declaredArchReviewer) !== LADDER.ARCHITECTURAL) {
  console.error('CONTROL_FAILED: an explicit architectural review declaration was ignored');
  process.exit(2);
}

// 4. Out-of-ladder review grade falls back to one-below coding grade, not clamped
const outOfLadderOffering = {
  id: 'out-of-ladder',
  codingGrade: LADDER.STANDARD,
  reviewGrade: 5,
};
if (realReviewGradeOf(outOfLadderOffering) !== LADDER.MECHANICAL) {
  console.error('CONTROL_FAILED: an out-of-ladder reviewGrade did not fall back to one-below');
  process.exit(2);
}

// 5. Reviewer selection uses review grade, not coding grade
const dummyHeadroom = {
  status: 'open',
  windows: { tokensPerDay: { limit: 1000000, used: 0, ratio: 0 } },
};
const unratedComplexCoder = {
  id: 'complex-coder',
  codingGrade: LADDER.COMPLEX,
  cost: { inputPerMillion: 0, outputPerMillion: 0 },
};
const coderReviewVerdict = realScoreOffering(
  unratedComplexCoder,
  LADDER.COMPLEX,
  dummyHeadroom,
  {},
  { reviewing: true }
);
if (coderReviewVerdict.usable) {
  console.error('CONTROL_FAILED: an unrated COMPLEX coder was allowed to review COMPLEX');
  process.exit(2);
}

const declaredComplexReviewer = {
  id: 'complex-reviewer',
  codingGrade: LADDER.STANDARD,
  reviewGrade: LADDER.COMPLEX,
  cost: { inputPerMillion: 0, outputPerMillion: 0 },
};
const declaredReviewVerdict = realScoreOffering(
  declaredComplexReviewer,
  LADDER.COMPLEX,
  dummyHeadroom,
  {},
  { reviewing: true }
);
if (!declaredReviewVerdict.usable) {
  console.error(
    'CONTROL_FAILED: a declared COMPLEX reviewer was rejected for COMPLEX review: ' +
      declaredReviewVerdict.reason
  );
  process.exit(2);
}

console.log(
  'REVIEW_GRADE_CONTRACT_EVIDENCE: ' +
    REQUIRED_PARTS.length +
    ' parts present in ' +
    GRADER_SOURCE +
    '; review grade derived separately from coding grade'
);
console.log('CONTROL: the real grader was exercised, not a copy of it');
console.log(
  'REVIEW_GRADE_CONTRACT_HOLDS: reviewGradeOf reads reviewGrade separately from codingGrade and defaults undeclared models to one class below'
);
