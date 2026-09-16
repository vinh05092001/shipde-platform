'use strict';
// AC-AI-21-08 — negative proof that the brain contract refuses a manifest copy
// whose brain entry is repointed at another repository or unpinned.
//
// The contract is `./lib/brain-repository-contract.js`, the same module
// `ac-21-07-brain-repository-contract.js` requires: editing the rule changes both
// the invariant and this proof. The real `tools/ecosystem-manifest.json` is read
// and proved to satisfy the contract as a CONTROL; then TWO independent COPIES are
// written to `os.tmpdir()`, one with the brain entry repointed at another
// repository and one with its pin replaced by a movable ref, and the same detector
// must refuse both. Nothing on disk is modified.
//
// Both tampers are the classes this rule exists for: AI-TOOL-11 forbids falling
// back to `latest` or to another source, and a knowledge base that silently points
// at a different repository is exactly the substitution that rule prevents.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MANIFEST_PATH,
  BRAIN_ID,
  CODES,
  brainEntry,
  brainRepositoryViolations,
} = require('./lib/brain-repository-contract');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('SOURCE_MISSING: ' + MANIFEST_PATH);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// Control: the untouched manifest must satisfy the contract, or refusing a
// degraded copy of it says nothing about the rule.
if (brainRepositoryViolations(real).length > 0) {
  console.error('CONTROL_FAILED: the real manifest already violates the brain contract');
  process.exit(2);
}
if (!brainEntry(real)) {
  console.error('SOURCE_MISSING: ' + MANIFEST_PATH + ' declares no ' + BRAIN_ID + ' entry');
  process.exit(2);
}

/** Write one tampered copy, read it back, and return the contract's verdict. */
function verdict(mutate) {
  const copy = JSON.parse(JSON.stringify(real));
  mutate(brainEntry(copy));
  const tmp = path.join(
    os.tmpdir(),
    'shipde-ac21-06-' + process.pid + '-' + Math.random() + '.json'
  );
  fs.writeFileSync(tmp, JSON.stringify(copy));
  const onDisk = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  const violations = brainRepositoryViolations(onDisk);
  return violations[0] || null;
}

const unpinned = verdict((entry) => {
  entry.pinned_version_or_commit = 'latest';
});
if (!unpinned || unpinned.code !== CODES.UNPINNED) {
  console.error('CONTROL_FAILED: the contract accepted a brain pinned to a movable ref');
  process.exit(2);
}

const repointed = verdict((entry) => {
  entry.repository = 'someone-else/notes';
});
if (!repointed || repointed.code !== CODES.UNSOURCED) {
  console.error('CONTROL_FAILED: the contract accepted a brain sourced from another repository');
  process.exit(2);
}

console.error('BRAIN_REPOSITORY_UNPINNED: ' + unpinned.detail);
process.exit(1);
