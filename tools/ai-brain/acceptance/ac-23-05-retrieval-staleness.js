'use strict';
// AC-AI-23-05 — superseded and expired lessons stay out of retrieval even when
// approved. The real seed's only non-null `expiry` (`LESSON-SINGLE-REPAIR-PER-HEAD`,
// `2026-12-31`) sits on an already-superseded record, so this row also builds one
// synthetic fixture record — approved, not superseded, `expiry` before the pinned
// retrieval date — to exercise the expiry-only path the live seed cannot reach.
// The row states this explicitly rather than implying the fixture is the live seed.
//
// The predicate is `./lib/lesson-retrieval.js`, shared with every other retrieval
// row and the canonical gate. A COPY of the seed is extended with the synthetic
// fixture under `os.tmpdir()`; the original is never modified.
//
// Run outside the repository it exits 2, not 0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { retrieveLessons } = require('./lib/lesson-retrieval');

const SEED = 'tools/ai-brain/lessons/lesson-seed.json';
const PINNED_DATE = '2026-09-17';

if (!fs.existsSync(SEED)) {
  console.error('SOURCE_MISSING: ' + SEED);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(SEED, 'utf8'));

// Control: the real seed at the pinned date must admit the 4 approved live
// lessons and exclude the 1 superseded + 1 proposed. The superseded record
// carries `expiry: 2026-12-31`, which is AFTER the pinned date, so it is
// excluded for superseded alone — the expiry path is not exercised by the live
// seed at this date.
const realResult = retrieveLessons(PINNED_DATE);
if (!realResult.ok) {
  console.error('SOURCE_MISSING: ' + realResult.why);
  process.exit(2);
}
const realAdmitted = realResult.lessons.filter((d) => d.admissible);
const realExcluded = realResult.lessons.filter((d) => !d.admissible);
if (realAdmitted.length !== 4) {
  console.error('CONTROL_FAILED: real seed admitted ' + realAdmitted.length + ', expected 4');
  process.exit(2);
}
if (realExcluded.length !== 2) {
  console.error('CONTROL_FAILED: real seed excluded ' + realExcluded.length + ', expected 2');
  process.exit(2);
}

// Build a COPY of the seed extended with one synthetic fixture record that is
// approved, not superseded, and expired before the pinned date. This exercises
// the expiry-only exclusion path the live seed cannot reach at this date.
const syntheticId = 'LESSON-SYNTHETIC-EXPIRY-ONLY-FIXTURE';
const tampered = JSON.parse(JSON.stringify(real));
tampered.lessons.push({
  id: syntheticId,
  title: 'A synthetic fixture record built by AC-AI-23-05 to exercise expiry-only exclusion',
  status: 'approved',
  scope: 'fixture',
  source_commit: 'e5e06918d0b6d62de988168d23bb1309fc7cf3ed',
  expiry: '2026-01-01',
  superseded_by: null,
  evidence:
    'This record is a test fixture built by AC-AI-23-05 only; it is not part of the real seed.',
  created_at: '2026-09-17T00:00:00Z',
  proposed_by: 'acceptance',
  approved_by: 'vinh05092001',
});

const tmp = path.join(os.tmpdir(), 'shipde-ac23-05-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered));
const tamperedSeed = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

// Evaluate the tampered seed through the SAME predicate.
const tamperedResult = retrieveLessons(PINNED_DATE, tamperedSeed);
if (!tamperedResult.ok) {
  console.error('SOURCE_MISSING: ' + tamperedResult.why);
  process.exit(2);
}

const syntheticDecision = tamperedResult.lessons.find((d) => d.id === syntheticId);
if (!syntheticDecision) {
  console.error('CONTROL_FAILED: synthetic fixture not found in result');
  process.exit(2);
}
if (syntheticDecision.admissible) {
  console.error('RETRIEVAL_STALENESS_FAILED: synthetic expired lesson was admitted');
  process.exit(1);
}
if (syntheticDecision.reason !== 'expired') {
  console.error(
    'RETRIEVAL_STALENESS_FAILED: synthetic expired lesson excluded for ' +
      syntheticDecision.reason +
      ', not expired'
  );
  process.exit(1);
}

// The real superseded record must still be excluded for superseded even though
// its expiry (2026-12-31) is after the pinned date — precedence order.
const supersededDecision = tamperedResult.lessons.find(
  (d) => d.id === 'LESSON-SINGLE-REPAIR-PER-HEAD'
);
if (!supersededDecision || supersededDecision.admissible) {
  console.error('RETRIEVAL_STALENESS_FAILED: superseded record was admitted');
  process.exit(1);
}
if (supersededDecision.reason !== 'superseded') {
  console.error(
    'RETRIEVAL_STALENESS_FAILED: superseded record excluded for ' +
      supersededDecision.reason +
      ', not superseded'
  );
  process.exit(1);
}

console.log('RETRIEVAL_STALENESS_HOLDS: superseded and expired lessons stay out of retrieval');
console.log('  synthetic fixture ' + syntheticId + ' -> excluded: expired');
console.log('  LESSON-SINGLE-REPAIR-PER-HEAD -> excluded: superseded (precedence over expiry)');
process.exit(0);
