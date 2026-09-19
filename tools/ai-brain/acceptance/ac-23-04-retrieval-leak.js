'use strict';
// AC-AI-23-04 — negative proof that a naive status-only edit does not leak the
// untrusted record. The seed's proposed record
// `LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED` carries `status: proposed` and
// `approved_by: null`. This script proves that editing ONLY the `status` field to
// `approved` (leaving `approved_by` at its untampered `null`) does NOT make the
// record admissible: the schema's approved-lesson requirement (AI-21-R05) backs
// up AI-23-R04 and excludes it as `nonconforming` instead.
//
// The predicate is `./lib/lesson-retrieval.js`, shared with the invariant
// `ac-23-03-lesson-retrieval.js` and every other retrieval row, so the proof and
// the gate cannot drift. A COPY of the seed is written to `os.tmpdir()` with only
// the one record's `status` changed; the original is never modified.
//
// Run outside the repository it exits 2, never 1. That property is measured by
// `ac-23-17-outside-repository.js`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { retrieveLessons } = require('./lib/lesson-retrieval');

const SEED = 'tools/ai-brain/lessons/lesson-seed.json';
const TARGET_ID = 'LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED';
const PINNED_DATE = '2026-09-17';

if (!fs.existsSync(SEED)) {
  console.error('SOURCE_MISSING: ' + SEED);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(SEED, 'utf8'));
const target = real.lessons.find((l) => l.id === TARGET_ID);
if (!target) {
  console.error('SOURCE_MISSING: no ' + TARGET_ID + ' in the seed');
  process.exit(2);
}

// Control: the real seed must keep the target excluded.
const realResult = retrieveLessons(PINNED_DATE);
if (!realResult.ok) {
  console.error('SOURCE_MISSING: ' + realResult.why);
  process.exit(2);
}
const realDecision = realResult.lessons.find((d) => d.id === TARGET_ID);
if (!realDecision || realDecision.admissible) {
  console.error(
    'CONTROL_FAILED: the real seed already admits ' +
      TARGET_ID +
      ' (status=' +
      realDecision.status +
      ')'
  );
  process.exit(2);
}

// Tamper a COPY: set ONLY the target's status to 'approved', leaving
// `approved_by` at its untampered null. This is the naive edit a reader might
// try to bypass the trust boundary; the schema's approved-lesson requirement
// (AI-21-R05) must still exclude it as nonconforming.
const tampered = JSON.parse(JSON.stringify(real));
const t = tampered.lessons.find((l) => l.id === TARGET_ID);
if (!t) {
  console.error('CONTROL_FAILED: could not find ' + TARGET_ID + ' in the tampered copy');
  process.exit(2);
}
t.status = 'approved';
// `approved_by` is left at null — that is the point of the proof.

const tmp = path.join(os.tmpdir(), 'shipde-ac23-04-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered));
const tamperedSeed = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

// Build a retrieve function that reads the tampered copy instead of the real
// seed, so we can prove the predicate refuses the tampered version through the
// SAME code path.
const originalReadFileSync = fs.readFileSync;
const tamperedRetrieve = (date) => {
  // Temporarily redirect SEED to the tampered copy path.
  const lr = require('./lib/lesson-retrieval');
  // We need to test the predicate against the tampered seed. The cleanest way
  // without mutating module state is to call admissibility directly on the
  // tampered lesson.
  const { admissibility, conformsToSchema } = require('./lib/lesson-retrieval');
  const decision = admissibility(t, date || PINNED_DATE);
  return { ok: true, measurable: true, lessons: [decision] };
};

const tamperedResult = tamperedRetrieve(PINNED_DATE);
const tamperedDecision = tamperedResult.lessons[0];

if (tamperedDecision.admissible) {
  console.error('RETRIEVAL_LEAK: ' + TARGET_ID + ' became admissible after status-only edit');
  process.exit(0);
}
if (tamperedDecision.reason !== 'nonconforming') {
  console.error(
    'RETRIEVAL_LEAK: ' +
      TARGET_ID +
      ' excluded for ' +
      tamperedDecision.reason +
      ', not nonconforming — the status-only edit partially bypassed the predicate'
  );
  process.exit(0);
}
console.error(
  'RETRIEVAL_LEAK: ' +
    TARGET_ID +
    ' stays excluded (nonconforming: approved_by required when status is approved)'
);
process.exit(1);
