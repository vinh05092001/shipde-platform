'use strict';
// AC-AI-23-03 — the invariant: the gate admits exactly the approved live lessons
// from the real seed and excludes the proposed and superseded ones with reasons.
//
// The predicate is `./lib/lesson-retrieval.js`, the same module every retrieval
// row and the canonical gate under `tools/ai-brain/retrieval/` require, so the
// invariant and the negative proofs share one decision function. This row pins
// the retrieval date to `2026-09-17` (the date the matrix was written) so the
// output is stable across runs — AI-23-R03 and the matrix's evidence note.
//
// The real seed carries 4 approved live records, 1 superseded (with expiry
// `2026-12-31`) and 1 proposed. At the pinned date none of the approved records
// are expired, so the expected result is 4 admitted and 2 excluded (1 superseded,
// 1 unapproved).
//
// Run outside the repository it exits 2, not 0.
const fs = require('fs');
const { retrieveLessons } = require('./lib/lesson-retrieval');

// The pinned retrieval date this row asserts against — AI-23-R03.
const PINNED_DATE = '2026-09-17';

// Expected outcome derived from the real seed at the pinned date:
//   - 4 approved live lessons admitted (the four approved records in the seed)
//   - 1 superseded lesson excluded (LESSON-SINGLE-REPAIR-PER-HEAD)
//   - 1 proposed lesson excluded (LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED)
const EXPECTED_ADMITTED = 4;
const EXPECTED_EXCLUDED = 2;

const result = retrieveLessons(PINNED_DATE);
if (!result.ok) {
  console.error('SOURCE_MISSING: ' + result.why);
  process.exit(2);
}
if (!result.measurable) {
  console.error('SOURCE_MISSING: ' + result.why);
  process.exit(2);
}

const admitted = result.lessons.filter((d) => d.admissible);
const excluded = result.lessons.filter((d) => !d.admissible);

if (admitted.length !== EXPECTED_ADMITTED) {
  console.error(
    'RETRIEVAL_MISMATCH: expected ' + EXPECTED_ADMITTED + ' admitted, got ' + admitted.length
  );
  process.exit(1);
}
if (excluded.length !== EXPECTED_EXCLUDED) {
  console.error(
    'RETRIEVAL_MISMATCH: expected ' + EXPECTED_EXCLUDED + ' excluded, got ' + excluded.length
  );
  process.exit(1);
}

// Every excluded lesson must carry a machine-readable reason — AI-23-R05.
for (const d of excluded) {
  if (!d.reason) {
    console.error('RETRIEVAL_REASON_MISSING: ' + d.id + ' is excluded with no reason');
    process.exit(1);
  }
}

console.log('LESSON_RETRIEVAL_HOLDS: only approved live lessons are retrievable');
console.log('  admitted: ' + admitted.length + ' approved live lessons');
console.log('  excluded: ' + excluded.length + ' (superseded + unapproved)');
for (const d of excluded) {
  console.log('    ' + d.id + ' -> excluded: ' + d.reason);
}
process.exit(0);
