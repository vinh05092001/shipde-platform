'use strict';
// AC-AI-11-06 — negative proof that the Preview/DryRun contract rejects a
// supervisor whose Preview guard has been removed.
//
// The contract is `./lib/preview-dryrun-contract.js`, the same module
// `ac-11-05-preview-contract.js` requires: editing the rule changes both
// the invariant and this proof. The real `scripts/ai/control.ps1` is read and
// proved to satisfy the contract as a CONTROL; then a COPY is written to
// `os.tmpdir()` with the Preview guard replaced by a no-op, and the same
// detector must report the missing part. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SOURCE, missingPreviewDryRunParts } = require('./lib/preview-dryrun-contract');

// The Preview guard pattern to tamper with
const PREVIEW_GUARD = /\[switch\]\$Preview\b/g;
const NO_PREVIEW = '[switch]$PreviewRemoved';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(SOURCE, 'utf8');

// Control: the untouched source must satisfy the contract, or refusing a
// degraded copy of it says nothing about the rule.
if (missingPreviewDryRunParts(real).length > 0) {
  console.error('CONTROL_FAILED: the real supervisor already violates the contract');
  process.exit(2);
}

// Tamper a COPY: remove the Preview switch declaration.
const tampered = real.replace(PREVIEW_GUARD, NO_PREVIEW);
if (tampered === real) {
  console.error('CONTROL_FAILED: the Preview switch the rule names is not in the source');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac11-06-' + process.pid + '.ps1');
fs.writeFileSync(tmp, tampered);
const missing = missingPreviewDryRunParts(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (missing.length === 0) {
  // Exit 2, never 0: a proof that cannot detect the tamper has not established
  // anything, and 0 is the code a caller reads as success.
  console.error('PREVIEW_GUARD_REMOVAL_NOT_DETECTED');
  process.exit(2);
}
console.error('PREVIEW_CONTRACT_BROKEN: ' + missing[0].label);
process.exit(1);
