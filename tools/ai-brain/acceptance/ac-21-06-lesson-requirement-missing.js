'use strict';
// AC-AI-21-06 — negative proof that the requirement rule refuses a schema whose
// approved-lesson requirement has been removed.
//
// The rule is `./lib/lesson-schema.js`, the same module
// `ac-21-05-lesson-requirement.js` requires: editing the rule changes both the
// invariant and this proof. The real `tools/ai-brain/lessons/lesson-schema.json`
// is read and proved to state the requirement as a CONTROL; then a COPY is
// written to `os.tmpdir()` with `source_commit` removed from both the top-level
// `required` list and the approved branch's `then.required`, and the same
// detector must report the missing requirement. Nothing on disk is modified.
//
// The copy is then shown to be genuinely weaker: the same evaluator that rejects
// an approved lesson without `source_commit` under the real schema admits it under
// the tampered one. A refusal of the tampered copy is therefore evidence about
// the rule, not about the fixture.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCHEMA_PATH,
  SEED_PATH,
  matchesViolations,
  seedLessons,
  approvedRequirementViolations,
} = require('./lib/lesson-schema');

const FIELD = 'source_commit';
const SUBJECT = 'LESSON-MANIFEST-TRUTH';

for (const source of [SCHEMA_PATH, SEED_PATH]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source);
    process.exit(2);
  }
}

const real = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

// Control: the untouched schema must state the requirement, or refusing a
// degraded copy of it says nothing about the rule.
if (approvedRequirementViolations(real).length > 0) {
  console.error('CONTROL_FAILED: the real schema already fails the requirement rule');
  process.exit(2);
}

// Tamper a COPY: remove the requirement from both places that state it.
const tampered = JSON.parse(JSON.stringify(real));
tampered.required = (tampered.required || []).filter((field) => field !== FIELD);
for (const branch of tampered.allOf || []) {
  if (branch.then && Array.isArray(branch.then.required)) {
    branch.then.required = branch.then.required.filter((field) => field !== FIELD);
  }
}
if (JSON.stringify(tampered) === JSON.stringify(real)) {
  console.error('CONTROL_FAILED: the requirement the rule names is not in the schema');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac21-04-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered));
const onDisk = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

// The tamper must really weaken the gate: a lesson without the field is rejected
// by the real schema and admitted by the copy.
const withoutField = JSON.parse(
  JSON.stringify(seedLessons(seed).find((lesson) => lesson.id === SUBJECT))
);
delete withoutField[FIELD];
if (matchesViolations(real, withoutField, '$.' + SUBJECT, []).length === 0) {
  console.error('CONTROL_FAILED: the real schema admits an approved lesson without ' + FIELD);
  process.exit(2);
}
if (matchesViolations(onDisk, withoutField, '$.' + SUBJECT, []).length > 0) {
  console.error('CONTROL_FAILED: the tampered schema did not lose the requirement');
  process.exit(2);
}

const violations = approvedRequirementViolations(onDisk);
if (violations.length === 0) {
  console.error('LESSON_REQUIREMENT_MISSING_NOT_DETECTED');
  process.exit(0);
}
if (violations.indexOf(FIELD + ' is not required for an approved lesson') < 0) {
  console.error('CONTROL_FAILED: the tamper produced an unrelated violation: ' + violations[0]);
  process.exit(2);
}
console.error('LESSON_REQUIREMENT_MISSING: ' + FIELD + ' is not required for an approved lesson');
process.exit(1);
