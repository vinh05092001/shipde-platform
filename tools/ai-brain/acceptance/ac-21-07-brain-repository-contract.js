'use strict';
// AC-AI-21-07 — invariant: the real ecosystem manifest enforces the surviving
// repository-local lesson trust boundary (AI-TOOL-06) after retiring the external
// shipde-brain checkout (TASK-AI-238 Addendum 5).
//
// Run outside the repository it exits 2, not 0.
const fs = require('fs');
const {
  MANIFEST_PATH,
  UNTRUSTED_POLICY,
  brainRepositoryViolations,
} = require('./lib/brain-repository-contract');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('SOURCE_MISSING: ' + MANIFEST_PATH);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// CONTROL: the contract detector must fail on an empty manifest.
if (brainRepositoryViolations({}).length === 0) {
  console.error(
    'CONTROL_FAILED: the contract detector cannot report a missing trust-boundary policy'
  );
  process.exit(2);
}

const violations = brainRepositoryViolations(manifest);
if (violations.length > 0) {
  for (const violation of violations) console.error(violation.code + ': ' + violation.detail);
  process.exit(1);
}

console.log(
  'BRAIN_TRUST_BOUNDARY_HOLDS: ' +
    UNTRUSTED_POLICY +
    ' enforces repository-local human-reviewed lessons with no PII/credentials in ' +
    MANIFEST_PATH
);
process.exit(0);
