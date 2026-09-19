'use strict';
// AC-AI-11-08 — negative proof that the failover-exhaustion contract rejects a
// supervisor whose exhaustion guard has been removed.
//
// The contract is `./lib/failover-exhaustion-contract.js`, the same module
// `ac-11-07-failover-exhaustion-contract.js` requires: editing the rule changes
// both the invariant and this proof. The real `scripts/ai/control.ps1` is read
// and proved to satisfy the contract as a CONTROL; then a COPY is written to
// `os.tmpdir()` with the $MaxFailovers parameter replaced by a no-op name, and
// the same detector must report the missing part. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SOURCE, missingFailoverExhaustionParts } = require('./lib/failover-exhaustion-contract');

// The MaxFailovers pattern to tamper with — this is the anchor of the bounded
// failover budget; removing it must violate the contract.
const MAX_FAILOVERS_RE = /\$MaxFailovers\b/g;
const NO_MAX_FAILOVERS = '$MaxFailoversRemoved';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(SOURCE, 'utf8');

// Control: the untouched source must satisfy the contract, or refusing a
// degraded copy of it says nothing about the rule.
if (missingFailoverExhaustionParts(real).length > 0) {
  console.error('CONTROL_FAILED: the real supervisor already violates the contract');
  process.exit(2);
}

// Tamper a COPY: remove the $MaxFailovers parameter declaration.
const tampered = real.replace(MAX_FAILOVERS_RE, NO_MAX_FAILOVERS);
if (tampered === real) {
  console.error('CONTROL_FAILED: the $MaxFailovers the rule names is not in the source');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac11-08-' + process.pid + '.ps1');
fs.writeFileSync(tmp, tampered);
const missing = missingFailoverExhaustionParts(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (missing.length === 0) {
  // Exit 2, never 0: a proof that cannot detect the tamper has not established
  // anything, and 0 is the code a caller reads as success.
  console.error('EXHAUSTION_GUARD_REMOVAL_NOT_DETECTED');
  process.exit(2);
}
console.error('FAILOVER_EXHAUSTION_CONTRACT_BROKEN: ' + missing[0].label);
process.exit(1);
