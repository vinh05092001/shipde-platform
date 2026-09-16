'use strict';
// AC-AI-09-05 — the invariant: the real supervisor source persists a durable
// checkpoint, reclaims a stale supervisor lock, and resumes from an existing
// Pull Request without duplicating work.
//
// The contract lives in `./lib/checkpoint-recovery-contract.js`, the same module
// the negative proof `ac-09-06-recovery-contract-broken.js` requires, so the gate
// and the proof of the gate cannot drift apart. The supervisor read here is the
// real `scripts/ai/control.ps1`; no fixture stands in for it. Run outside the
// repository it exits 2, not 0.
//
// The contract asserts the properties TASK-AI-09 must PRESERVE while it extends
// restart recovery. It does not assert the extended behaviour, which does not
// exist yet.
const fs = require('fs');
const {
  SOURCE,
  RECOVERY_FIELDS,
  REQUIRED_PARTS,
  missingRecoveryParts,
} = require('./lib/checkpoint-recovery-contract');

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

// CONTROL: the contract must be able to fail at all. An empty source is missing
// every part; if the detector reports fewer, it is not measuring anything.
if (missingRecoveryParts('').length !== REQUIRED_PARTS.length) {
  console.error('CONTROL_FAILED: the contract detector cannot report missing parts');
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');
const missing = missingRecoveryParts(source);
if (missing.length > 0) {
  for (const part of missing) console.error('MISSING ' + part.id + ': ' + part.label);
  process.exit(1);
}

console.log(
  'RECOVERY_CONTRACT_HOLDS: durable checkpoint and restart recovery present in ' +
    SOURCE +
    ' (' +
    REQUIRED_PARTS.length +
    ' parts, ' +
    RECOVERY_FIELDS.length +
    ' recovery fields)'
);
process.exit(0);
