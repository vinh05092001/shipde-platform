'use strict';
// AC-AI-23-06 — negative proof that an in-memory copy of the admissibility
// predicate with the approved-status check deleted admits the proposed record,
// and is therefore refused. This proves the predicate's approved-status check is
// not redundant: removing it changes the outcome. The gate itself (which per
// AI-23-R07 never restates the predicate) is not touched; only a COPY of the
// predicate function is tampered in memory.
//
// The predicate is `./lib/lesson-retrieval.js`, shared with every other retrieval
// row. The proof builds a tampered copy of the `admissibility` function that
// skips the status check, and proves it admits the record the real predicate
// excludes.
//
// Run outside the repository it exits 2, never 1. That property is measured by
// `ac-23-17-outside-repository.js`.
const fs = require('fs');
const { retrieveLessons, admissibility, ADMISSIBLE_STATUS } = require('./lib/lesson-retrieval');

const SEED = 'tools/ai-brain/lessons/lesson-seed.json';
const TARGET_ID = 'LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED';
const PINNED_DATE = '2026-09-17';

if (!fs.existsSync(SEED)) {
  console.error('SOURCE_MISSING: ' + SEED);
  process.exit(2);
}

const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
const target = seed.lessons.find((l) => l.id === TARGET_ID);
if (!target) {
  console.error('SOURCE_MISSING: no ' + TARGET_ID + ' in the seed');
  process.exit(2);
}

// Control: the real predicate must exclude the target.
const realResult = retrieveLessons(PINNED_DATE);
if (!realResult.ok) {
  console.error('SOURCE_MISSING: ' + realResult.why);
  process.exit(2);
}
const realDecision = realResult.lessons.find((d) => d.id === TARGET_ID);
if (!realDecision || realDecision.admissible) {
  console.error('CONTROL_FAILED: the real predicate already admits ' + TARGET_ID);
  process.exit(2);
}

// Build a tampered copy of the admissibility function that deletes the
// approved-status check. The tampered version still checks superseded, expired,
// and nonconforming, but treats any status as admissible on the status dimension.
function admissibilityWithoutStatusCheck(lesson, retrievalDate) {
  const date = retrievalDate || '2026-09-17';
  // Skip the status check: the tampered predicate treats every status as
  // admissible on the status dimension. The other checks still apply.
  let reason = null;
  // Reuse the exported helpers, but skip the status check.
  const { isSuperseded, isExpired, conformsToSchema } = require('./lib/lesson-retrieval');
  if (isSuperseded(lesson)) reason = 'superseded';
  else if (isExpired(lesson, date)) reason = 'expired';
  // Status check DELETED: do not check lesson.status !== ADMISSIBLE_STATUS.
  else if (!conformsToSchema(lesson)) reason = 'nonconforming';
  return {
    id: lesson.id,
    status: lesson.status,
    admissible: reason === null,
    reason: reason,
    retrievalDate: date,
  };
}

const tamperedDecision = admissibilityWithoutStatusCheck(target, PINNED_DATE);

if (!tamperedDecision.admissible) {
  console.error(
    'RETRIEVAL_REQUIREMENT_MISSING: the tampered predicate still excluded ' +
      TARGET_ID +
      ' for ' +
      tamperedDecision.reason +
      ' — the status check was not the active exclusion'
  );
  process.exit(0);
}
console.error('RETRIEVAL_REQUIREMENT_MISSING: status is not required for retrieval');
process.exit(1);
