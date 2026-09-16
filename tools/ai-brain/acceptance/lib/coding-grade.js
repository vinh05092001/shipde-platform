'use strict';
// TASK-AI-27 — the coding-grade rule, held in exactly one place.
//
// AC-AI-27-05 (the invariant: the real grader classes every model by a declared
// grade and treats an absent grade as STANDARD, never as the top class) and
// AC-AI-27-06 (the negative proof: a copy of the real grader whose default has
// been raised to the top class is refused) both require this module. AC-AI-27-07
// and AC-AI-27-08 require it for the declared-grade half of the same rule.
// Editing the rule here changes both the gate and the proof of the gate; a
// private copy in each script is the defect this repository has had to repair
// repeatedly, because the two copies drift while both stay green.
//
// Nothing is restated. The ladder is re-exported by reference from
// `tools/ai-brain/fitness.js`, the module that applies it, and the source
// contract reads that same real file rather than a transcription of it.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 it is violated   2 it cannot be measured

const { Difficulty, gradeOf, isSufficient } = require('../../fitness');

// The real ladder, by reference: the same object `fitness.js` compares against.
const LADDER = Difficulty;

// The real grader and sufficiency test, by reference: the same functions the
// scheduler calls, so a control below is evidence about the shipped rule rather
// than about a second copy of it.
const realGradeOf = gradeOf;
const realIsSufficient = isSufficient;

const GRADER_SOURCE = 'tools/ai-brain/fitness.js';
const DECLARATIONS_SOURCE = 'tools/ai-brain/seed-accounts.js';

// Each part is one required property of the real grader, read from its source.
// They are the properties TASK-AI-27 must PRESERVE while it makes a declared
// grade distinguishable from an assumed one: a four-level ordered ladder, an
// absent grade falling to the middle of it, sufficiency decided by the grade,
// and a grade read from `codingGrade` rather than inferred from `quality`.
const REQUIRED_PARTS = [
  {
    id: 'GRADE_LADDER_ORDERED',
    label: 'an ordered four-level coding ladder',
    pattern: /MECHANICAL:\s*1[\s\S]*?STANDARD:\s*2[\s\S]*?COMPLEX:\s*3[\s\S]*?ARCHITECTURAL:\s*4/,
  },
  {
    id: 'UNGRADED_DEFAULTS_TO_STANDARD',
    label: 'an absent codingGrade falling back to STANDARD',
    pattern: /g\s*>=\s*1\s*&&\s*g\s*<=\s*4\s*\?\s*g\s*:\s*Difficulty\.STANDARD/,
  },
  {
    id: 'DEFAULT_IS_NOT_THE_TOP_GRADE',
    label: 'a default that never grants the top class by omission',
    pattern: /:\s*Difficulty\.STANDARD\s*;/,
  },
  {
    id: 'SUFFICIENCY_COMPARES_THE_GRADE',
    label: 'sufficiency decided by the grade against the task class',
    pattern: /gradeOf\(offering\)\s*>=\s*difficulty/,
  },
  {
    id: 'INSUFFICIENT_GRADE_IS_REFUSED',
    label: 'a model below the task class refused outright',
    pattern: /if\s*\(grade\s*<\s*difficulty\)/,
  },
  {
    id: 'GRADE_READS_CODINGGRADE_NOT_QUALITY',
    label: 'a grade read from codingGrade, never from quality',
    pattern: /offering\s*&&\s*offering\.codingGrade/,
  },
];

/** Every part of the grade contract missing from `source`, in declaration order. */
function missingGradeParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.pattern.test(source));
}

/** The four ladder values in ascending order, read from the real ladder. */
function ladderValues() {
  return Object.keys(LADDER)
    .map((name) => LADDER[name])
    .sort((a, b) => a - b);
}

/**
 * Grade declarations that are not a member of the real ladder.
 *
 * `entries` is `[{ path, grade }]`, where a declaration that carries no grade is
 * represented by `grade === undefined` and is NOT a violation: an ungraded model
 * is a legitimate state this Work Item keeps visible. A declaration that carries
 * a grade outside the ladder is a violation, because clamping it silently would
 * turn a typo into a confident middle grade.
 */
function outOfLadderGrades(entries) {
  const allowed = ladderValues();
  return (entries || []).filter(
    (entry) => entry && entry.grade !== undefined && !allowed.includes(Number(entry.grade))
  );
}

/**
 * The grade declarations the committed registry actually ships, read from the
 * real `seed-accounts.js`. Nothing is transcribed here: the module is loaded and
 * its exported lists are walked.
 */
function declaredGradeEntries() {
  // eslint-disable-next-line global-require
  const seed = require('../../seed-accounts');
  const out = [];
  for (const [listName, list] of [
    ['ANTIGRAVITY_MODELS', seed.ANTIGRAVITY_MODELS],
    ['NINEROUTER_MODELS', seed.NINEROUTER_MODELS],
  ]) {
    for (const model of list || []) {
      out.push({ path: listName + '[' + model.model + ']', grade: model.codingGrade });
    }
  }
  return out;
}

module.exports = {
  LADDER,
  realGradeOf,
  realIsSufficient,
  GRADER_SOURCE,
  DECLARATIONS_SOURCE,
  REQUIRED_PARTS,
  missingGradeParts,
  ladderValues,
  outOfLadderGrades,
  declaredGradeEntries,
};
