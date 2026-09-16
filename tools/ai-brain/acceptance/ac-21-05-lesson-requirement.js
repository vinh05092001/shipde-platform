'use strict';
// AC-AI-21-05 — the invariant: the real lesson schema requires the four fields
// the register's key behaviour names, for an APPROVED lesson.
//
// The rule lives in `./lib/lesson-schema.js`, the same module the negative proof
// `ac-21-06-lesson-requirement-missing.js` requires. The schema read here is the
// real `tools/ai-brain/lessons/lesson-schema.json`; no fixture stands in for it.
// Run outside the repository it exits 2, not 0.
//
// `ac-21-01` proves the schema is satisfiable — that the seed conforms. This row
// proves the schema is binding — that an approved lesson cannot be written
// without `source_commit`, `scope`, `expiry` and `superseded_by`, and that
// `expiry` and `superseded_by` can be written as explicit nulls so "no expiry"
// and "not replaced" are stated rather than inferred from absent keys.
const fs = require('fs');
const {
  SCHEMA_PATH,
  SEED_PATH,
  APPROVAL_FIELDS,
  approvedRequirementViolations,
} = require('./lib/lesson-schema');

for (const source of [SCHEMA_PATH, SEED_PATH]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source);
    process.exit(2);
  }
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

// CONTROL: the requirement detector must be able to fail at all. A schema with no
// `properties` and no `allOf` requires nothing, so it must report every field.
if (approvedRequirementViolations({}).length < APPROVAL_FIELDS.length) {
  console.error('CONTROL_FAILED: the requirement detector cannot report missing requirements');
  process.exit(2);
}

const violations = approvedRequirementViolations(schema);
if (violations.length > 0) {
  for (const violation of violations) console.error('LESSON_REQUIREMENT_VIOLATED: ' + violation);
  process.exit(1);
}

console.log(
  'LESSON_REQUIREMENT_HOLDS: an approved lesson must carry ' + APPROVAL_FIELDS.join(', ')
);
console.log(
  'evidence: expiry and superseded_by accept an explicit null, so their not-applicable state is written down'
);
process.exit(0);
