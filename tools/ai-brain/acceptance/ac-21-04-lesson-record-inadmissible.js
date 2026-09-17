'use strict';
// AC-AI-21-04 — negative proof that the lesson schema refuses an approved lesson
// that has lost `source_commit`.
//
// The rule is `./lib/lesson-schema.js`, the same module
// `ac-21-03-lesson-schema.js` requires: editing the rule changes both the
// invariant and this proof. This script reads the REAL schema and the REAL seed,
// proves the untouched set is admitted as a CONTROL, then tampers a COPY of the
// seed in `os.tmpdir()` by deleting `source_commit` from a named approved lesson,
// and requires the same comparison to reject it. Nothing on disk is modified.
//
// The tampered lesson keeps its `approved` status on purpose: the contract under
// test is that an approved lesson CARRIES the exact commit it was learned from,
// so a lesson that is approved without one is inadmissible rather than merely
// unlabelled. `source_commit` is required both at the top level and in the
// approved branch, so the schema states the violation twice; the first is
// reported.
//
// Run outside the repository it exits 2, never 1. That property is itself
// measured by `ac-21-17-outside-repository.js`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SCHEMA_PATH, SEED_PATH, matchesViolations, seedLessons } = require('./lib/lesson-schema');

const SUBJECT = 'LESSON-MANIFEST-TRUTH';

for (const source of [SCHEMA_PATH, SEED_PATH]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source);
    process.exit(2);
  }
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const real = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

// Control: the untouched seed must be admitted, or refusing a copy of it says
// nothing about the rule.
const control = seedLessons(real);
if (control.length === 0) {
  console.error('CONTROL_FAILED: the seed carries no lesson to admit');
  process.exit(2);
}
for (const lesson of control) {
  if (matchesViolations(schema, lesson, '$.' + lesson.id, []).length > 0) {
    console.error('CONTROL_FAILED: the real seed already violates the schema');
    process.exit(2);
  }
}
const target = control.find((lesson) => lesson.id === SUBJECT);
if (!target) {
  console.error('SOURCE_MISSING: the seed carries no ' + SUBJECT + ' lesson');
  process.exit(2);
}
if (target.status !== 'approved') {
  console.error('CONTROL_FAILED: ' + SUBJECT + ' is not an approved lesson');
  process.exit(2);
}

// Tamper a COPY: delete source_commit from one approved lesson.
const tampered = JSON.parse(JSON.stringify(real));
const tamperedLesson = seedLessons(tampered).find((lesson) => lesson.id === SUBJECT);
delete tamperedLesson.source_commit;

const tmp = path.join(os.tmpdir(), 'shipde-ac21-02-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered));
const onDisk = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

const observed = seedLessons(onDisk).find((lesson) => lesson.id === SUBJECT);
const violations = matchesViolations(schema, observed, '$.' + SUBJECT, []);
if (violations.length === 0) {
  console.error('INADMISSIBLE_LESSON_NOT_DETECTED');
  process.exit(2);
}
if (!violations.some((violation) => violation.indexOf("missing required 'source_commit'") > 0)) {
  console.error('CONTROL_FAILED: the tamper produced an unrelated violation: ' + violations[0]);
  process.exit(2);
}
console.error(
  'LESSON_INADMISSIBLE: ' +
    SUBJECT +
    ' missing source_commit is not admissible as an approved lesson'
);
process.exit(1);
