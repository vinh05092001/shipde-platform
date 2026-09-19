'use strict';
// AC-AI-11-05 — the invariant: the real supervisor source declares Preview and
// DryRun switches at the top level, emits a [PREVIEW] banner, and guards
// mutating operations when either flag is set.
//
// The contract lives in `./lib/preview-dryrun-contract.js`, the same module the
// negative proof `ac-11-06-preview-contract-broken.js` requires, so the gate
// and the proof of the gate cannot drift apart. The supervisor read here is the
// real `scripts/ai/control.ps1`; no fixture stands in for it. Run outside the
// repository it exits 2, not 0.
const fs = require('fs');
const {
  SOURCE,
  REQUIRED_PARTS,
  missingPreviewDryRunParts,
} = require('./lib/preview-dryrun-contract');

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

// CONTROL: the contract must be able to fail at all. An empty source is missing
// every part; if the detector reports none of them it is not measuring anything.
if (missingPreviewDryRunParts('').length !== REQUIRED_PARTS.length) {
  console.error('CONTROL_FAILED: the contract detector cannot report missing parts');
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');
const missing = missingPreviewDryRunParts(source);
if (missing.length > 0) {
  for (const part of missing) console.error('MISSING ' + part.id + ': ' + part.label);
  process.exit(1);
}

console.log('PREVIEW_DRYRUN_CONTRACT_HOLDS: Preview/DryRun surface present in ' + SOURCE);
process.exit(0);
