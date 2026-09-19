'use strict';
// AC-AI-22-03 — the invariant: the lesson schema TASK-AI-22 builds on declares
// both a proposed and an approved state.
//
// The rule is `./lib/lesson-promotion.js`, the same module the negative proof
// `ac-22-04-proposed-state-removed.js` requires. The schema is read from disk.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const { SCHEMA_PATH, REQUIRED_STATES, lifecycleViolations } = require('./lib/lesson-promotion');

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error('SOURCE_MISSING: ' + SCHEMA_PATH);
  process.exit(2);
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
} catch (error) {
  console.error('SOURCE_MISSING: ' + SCHEMA_PATH + ' is not JSON: ' + error.message);
  process.exit(2);
}

const violations = lifecycleViolations(schema);
if (violations.length > 0) {
  console.error('LIFECYCLE_CONTRACT_VIOLATED: ' + violations.join('; '));
  process.exit(1);
}

console.log(
  'LIFECYCLE_STATES_PRESENT: ' + SCHEMA_PATH + ' declares ' + REQUIRED_STATES.join(' and ')
);
