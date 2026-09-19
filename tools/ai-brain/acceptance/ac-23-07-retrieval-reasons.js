'use strict';
// AC-AI-23-07 — every excluded lesson carries a machine-readable reason. A silent
// drop is itself a violation (AI-23-R05). This row reads the real seed, runs the
// shared predicate at the pinned date, and asserts that every excluded lesson has
// a non-empty reason while every admitted lesson has no reason.
//
// The predicate is `./lib/lesson-retrieval.js`, shared with every other retrieval
// row and the canonical gate.
//
// Run outside the repository it exits 2, not 0.
const fs = require('fs');
const { retrieveLessons } = require('./lib/lesson-retrieval');

const PINNED_DATE = '2026-09-17';

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

// Every excluded lesson must carry a reason.
for (const d of excluded) {
  if (!d.reason) {
    console.error('RETRIEVAL_REASON_MISSING: ' + d.id + ' is excluded with no reason');
    process.exit(1);
  }
}

// Every admitted lesson must carry no reason.
for (const d of admitted) {
  if (d.reason) {
    console.error(
      'RETRIEVAL_REASON_MISMATCH: ' + d.id + ' is admitted but carries reason ' + d.reason
    );
    process.exit(1);
  }
}

console.log('RETRIEVAL_REASONS_HOLDS: every excluded lesson carries its reason');
console.log('  admitted: ' + admitted.length + ' lessons with no reason');
console.log('  excluded: ' + excluded.length + ' lessons, each with a reason');
for (const d of excluded) {
  console.log('    ' + d.id + ' -> ' + d.reason);
}
process.exit(0);
