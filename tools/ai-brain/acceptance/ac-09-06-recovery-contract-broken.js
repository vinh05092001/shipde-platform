'use strict';
// AC-AI-09-06 — negative proof that the restart-recovery contract rejects a
// supervisor whose checkpoint write is no longer atomic.
//
// The contract is `./lib/checkpoint-recovery-contract.js`, the same module
// `ac-09-05-recovery-contract.js` requires: editing the rule changes both the
// invariant and this proof. The real `scripts/ai/control.ps1` is read and proved
// to satisfy the contract as a CONTROL; then a COPY is written to `os.tmpdir()`
// with the temporary-file-and-rename checkpoint write replaced by a direct
// write, and the same detector must report the missing part. Nothing on disk is
// modified. A direct write loses the checkpoint if the process dies mid-write,
// which is exactly the restart failure TASK-AI-09 exists to prevent.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SOURCE, missingRecoveryParts } = require('./lib/checkpoint-recovery-contract');

const ATOMIC_WRITE =
  /Move-Item\s+-LiteralPath\s+\$temporaryPath\s+-Destination\s+\$script:SupervisorStateFile\s+-Force/;
const DIRECT_WRITE =
  'Set-Content -LiteralPath $script:SupervisorStateFile -Value (ConvertTo-Json $normalized)';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(SOURCE, 'utf8');

// Control: the untouched source must satisfy the contract, or refusing a
// degraded copy of it says nothing about the rule.
if (missingRecoveryParts(real).length > 0) {
  console.error('CONTROL_FAILED: the real supervisor already violates the contract');
  process.exit(2);
}

// Tamper a COPY: remove the atomic checkpoint write.
const tampered = real.replace(ATOMIC_WRITE, DIRECT_WRITE);
if (tampered === real) {
  console.error('CONTROL_FAILED: the atomic checkpoint write the rule names is not in the source');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac09-06-' + process.pid + '.ps1');
fs.writeFileSync(tmp, tampered);
const missing = missingRecoveryParts(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (missing.length === 0) {
  console.error('RECOVERY_CONTRACT_BREAK_NOT_DETECTED');
  process.exit(0);
}
// The rejection must be attributable to the intended tamper: every other part
// of the contract still holds in the copy.
const unexpected = missing.filter((part) => part.id !== 'CHECKPOINT_ATOMIC_WRITE');
if (unexpected.length > 0) {
  console.error('CONTROL_FAILED: the tamper broke unrelated parts: ' + unexpected.map((p) => p.id));
  process.exit(2);
}
console.error('RECOVERY_CONTRACT_BROKEN: ' + missing[0].label);
process.exit(1);
