'use strict';
// TASK-AI-41 — the review-grade rule, held in exactly one place.
//
// AC-AI-41-05 (the invariant: reviewGradeOf reads reviewGrade separately from
// codingGrade and defaults undeclared models to one class below) and
// AC-AI-41-06 (the negative proof: a copy of the real grader whose review
// default has been raised to the coding grade is refused) both require this
// module. AC-AI-41-07 and AC-AI-41-08 require it for the declared review-grade
// half of the same rule.
//
// Nothing is restated. The ladder, reviewGradeOf, gradeOf and resolveReviewGrade
// are re-exported by reference from `tools/ai-brain/fitness.js`, the module that
// applies them, and the source contract reads that same real file rather than a
// transcription of it.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 it is violated   2 it cannot be measured

const {
  Difficulty,
  gradeOf,
  reviewGradeOf,
  resolveReviewGrade,
  scoreOffering,
} = require('../../fitness');

// The real ladder, by reference: the same object `fitness.js` compares against.
const LADDER = Difficulty;

const realReviewGradeOf = reviewGradeOf;
const realGradeOf = gradeOf;
const realResolveReviewGrade = resolveReviewGrade;
const realScoreOffering = scoreOffering;

const GRADER_SOURCE = 'tools/ai-brain/fitness.js';
const DECLARATIONS_SOURCE = 'tools/ai-brain/seed-accounts.js';

// Each part is one required property of the review grader, read from its source.
// They are the properties TASK-AI-41 must PRESERVE and PIN:
// 1. reviewGrade is read from offering.reviewGrade, never offering.codingGrade
// 2. an unrated model reviews one class below what it writes
// 3. review grade must be bounded to 1..4 to be explicit
// 4. an out-of-ladder review grade falls back to one-below rather than clamped
// 5. reviewers are selected by review grade (rankByFitness/scoreOffering reviewing branch)
const REQUIRED_PARTS = [
  {
    id: 'REVIEW_GRADE_READS_REVIEWGRADE_NOT_CODINGGRADE',
    label: 'a review grade read from reviewGrade, never from codingGrade',
    pattern: /offering\s*&&\s*offering\.reviewGrade/,
  },
  {
    id: 'UNRATED_REVIEWS_ONE_CLASS_BELOW',
    label: 'an unrated model reviewing one class below what it writes',
    pattern: /Math\.max\(\s*1\s*,\s*gradeOf\(offering\)\s*-\s*1\s*\)/,
  },
  {
    id: 'REVIEW_GRADE_RANGE_BOUNDED',
    label: 'a review grade explicitly bounded to the ladder',
    pattern: /explicit\s*>=\s*1\s*&&\s*explicit\s*<=\s*4/,
  },
  {
    id: 'OUT_OF_LADDER_FALLS_BACK_NOT_CLAMPED',
    label: 'an out-of-ladder review grade falling back rather than clamped',
    pattern:
      /if\s*\(Number\.isFinite\(explicit\)\s*&&\s*explicit\s*>=\s*1\s*&&\s*explicit\s*<=\s*4\)\s*return\s*explicit;\s*return\s*Math\.max/,
  },
  {
    id: 'REVIEWERS_SELECTED_BY_REVIEW_GRADE',
    label: 'reviewers selected by review grade, never by coding grade',
    pattern:
      /const\s*grade\s*=\s*reviewing\s*\?\s*reviewGradeOf\(offering\)\s*:\s*gradeOf\(offering\);/,
  },
];

/** Every part of the review-grade contract missing from `source`, in declaration order. */
function missingReviewGradeParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.pattern.test(source));
}

/** The four ladder values in ascending order, read from the real ladder. */
function ladderValues() {
  return Object.keys(LADDER)
    .map((name) => LADDER[name])
    .sort((a, b) => a - b);
}

/**
 * Review grade declarations that are not a member of the real ladder.
 *
 * `entries` is `[{ path, grade }]`, where a declaration that carries no review grade is
 * represented by `grade === undefined` and is NOT a violation: an unrated reviewer
 * is a legitimate state that falls back to one class below. A declaration that
 * carries a grade outside the ladder is a violation, because clamping it silently
 * would turn a typo into a confident middle grade.
 */
function outOfLadderReviewGrades(entries) {
  const allowed = ladderValues();
  return (entries || []).filter(
    (entry) => entry && entry.grade !== undefined && !allowed.includes(Number(entry.grade))
  );
}

/**
 * The review grade declarations the committed registry actually ships, read from
 * the real `seed-accounts.js`. Nothing is transcribed here: the module is loaded and
 * its exported lists are walked.
 */
function declaredReviewGradeEntries() {
  // eslint-disable-next-line global-require
  const seed = require('../../seed-accounts');
  const out = [];
  for (const [listName, list] of [
    ['ANTIGRAVITY_MODELS', seed.ANTIGRAVITY_MODELS],
    ['NINEROUTER_MODELS', seed.NINEROUTER_MODELS],
  ]) {
    for (const model of list || []) {
      out.push({ path: listName + '[' + model.model + ']', grade: model.reviewGrade });
    }
  }
  return out;
}

module.exports = {
  LADDER,
  realReviewGradeOf,
  realGradeOf,
  realResolveReviewGrade,
  realScoreOffering,
  GRADER_SOURCE,
  DECLARATIONS_SOURCE,
  REQUIRED_PARTS,
  missingReviewGradeParts,
  ladderValues,
  outOfLadderReviewGrades,
  declaredReviewGradeEntries,
};
