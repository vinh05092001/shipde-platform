'use strict';
// AC-AI-21-07 — the invariant: the real ecosystem manifest declares shipde-brain
// as a governed knowledge repository.
//
// The contract lives in `./lib/brain-repository-contract.js`, the same module the
// negative proof `ac-21-08-brain-repository-overstated.js` requires, so the gate
// and the proof of the gate cannot drift apart. The manifest read here is the
// real `tools/ecosystem-manifest.json`; no fixture stands in for it. Run outside
// the repository it exits 2, not 0.
//
// This row asserts the declaration surface this Work Item depends on. It does not
// assert the reconciliation `TASK-AI-17` performed, which `AC-AI-17-01` and
// `AC-AI-17-04` already own, and it does not assert a lifecycle state.
const fs = require('fs');
const {
  MANIFEST_PATH,
  BRAIN_ID,
  brainRepositoryViolations,
} = require('./lib/brain-repository-contract');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('SOURCE_MISSING: ' + MANIFEST_PATH);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// CONTROL: the contract must be able to fail at all. An empty manifest declares
// no brain entry, so it must report the missing declaration.
if (brainRepositoryViolations({}).length === 0) {
  console.error('CONTROL_FAILED: the contract detector cannot report a missing declaration');
  process.exit(2);
}

const violations = brainRepositoryViolations(manifest);
if (violations.length > 0) {
  for (const violation of violations) console.error(violation.code + ': ' + violation.detail);
  process.exit(1);
}

console.log(
  'BRAIN_REPOSITORY_CONTRACT_HOLDS: ' +
    BRAIN_ID +
    ' is declared as a governed knowledge repository in ' +
    MANIFEST_PATH
);
console.log(
  'evidence: canonical source, 40-character pin, declared role and boundary, and the untrusted-until-human-reviewed policy'
);
process.exit(0);
