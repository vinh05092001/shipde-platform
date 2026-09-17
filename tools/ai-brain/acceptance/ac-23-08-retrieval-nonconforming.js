'use strict';
// AC-AI-23-08 — a schema-nonconforming lesson stays out of retrieval even when
// its `status` reads `approved` (AI-23-R04). This row builds one synthetic
// fixture record that is approved and otherwise well-formed except for a missing
// required field (`source_commit`), and proves the predicate excludes it as
// `nonconforming`. The live seed cannot exercise this path because every approved
// record in it conforms, so the row builds an explicit fixture and states that.
//
// The predicate is `./lib/lesson-retrieval.js`, shared with every other retrieval
// row. The schema check uses `lib/lesson-schema.js`'s `matchesViolations`, the
// same function the schema rows use.
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
// lessons and exclude the 1 superseded + 1 proposed.
const realResult = retrieveLessons(PINNED_DATE);
if (!realResult.ok) {
  console.error('SOURCE_MISSING: ' + realResult.why);
  process.exit(2);
}
const realAdmitted = realResult.lessons.filter((d) => d.admissible);
if (realAdmitted.length !== 4) {
  console.error('CONTROL_FAILED: real seed admitted ' + realAdmitted.length + ', expected 4');
  process.exit(2);
}

// Build a COPY of the seed extended with one synthetic fixture record that is
// approved, not superseded, not expired, but missing `source_commit` — so it
// fails the schema's approved-lesson requirement (AI-21-R05) and is excluded as
// `nonconforming`.
const syntheticId = 'LESSON-SYNTHETIC-NONCONFORMING-APPROVED-FIXTURE';
const tampered = JSON.parse(JSON.stringify(real));
tampered.lessons.push({
  id: syntheticId,
  title:
    'A synthetic fixture record built by AC-AI-23-08 to exercise nonconforming-approved exclusion',
  status: 'approved',
  scope: 'fixture',
  // `source_commit` is intentionally omitted — the schema requires it for an
  // approved lesson (AI-21-R05), so this record is nonconforming.
  expiry: null,
  superseded_by: null,
  evidence:
    'This record is a test fixture built by AC-AI-23-08 only; it is not part of the real seed.',
  created_at: '2026-09-17T00:00:00Z',
  proposed_by: 'acceptance',
  approved_by: 'vinh05092001',
});

const tmp = path.join(os.tmpdir(), 'shipde-ac23-08-' + process.pid + '.json');
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
  console.error(
    'RETRIEVAL_CONFORMANCE_FAILED: synthetic nonconforming approved lesson was admitted'
  );
  process.exit(1);
}
if (syntheticDecision.reason !== 'nonconforming') {
  console.error(
    'RETRIEVAL_CONFORMANCE_FAILED: synthetic nonconforming lesson excluded for ' +
      syntheticDecision.reason +
      ', not nonconforming'
  );
  process.exit(1);
}

console.log('RETRIEVAL_CONFORMANCE_HOLDS: a nonconforming approved lesson stays out of retrieval');
console.log('  synthetic fixture ' + syntheticId + ' -> excluded: nonconforming');
process.exit(0);
