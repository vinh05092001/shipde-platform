'use strict';
// AC-AI-08-06 — negative proof that the bounded-repair contract rejects a
// supervisor whose budget bound has been removed.
//
// The contract is `./lib/repair-budget-contract.js`, the same module
// `ac-08-05-repair-budget-surface.js` requires: editing the rule changes both
// the invariant and this proof. The real `scripts/ai/control.ps1` is read and
// proved to satisfy the contract as a CONTROL; then a COPY is written to
// `os.tmpdir()` with the fail-closed comparison against the budget replaced by
// an effectively unbounded one, and the same detector must report the missing
// part. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SOURCE, missingRepairBudgetParts } = require('./lib/repair-budget-contract');

const FAIL_CLOSED = /\$State\.RepairCount\s+-gt\s+\$MaxRepairBudget/g;
const UNBOUNDED = 'RepairCount -gt ([int]::MaxValue)';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(SOURCE, 'utf8');

// Control: the untouched source must satisfy the contract, or refusing a
// degraded copy of it says nothing about the rule.
if (missingRepairBudgetParts(real).length > 0) {
  console.error('CONTROL_FAILED: the real supervisor already violates the contract');
  process.exit(2);
}

// Tamper a COPY: remove the fail-closed comparison against the budget.
const tampered = real.replace(FAIL_CLOSED, UNBOUNDED);
if (tampered === real) {
  console.error('CONTROL_FAILED: the budget comparison the rule names is not in the source');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), 'shipde-ac08-06-' + process.pid + '.ps1');
fs.writeFileSync(tmp, tampered);
const missing = missingRepairBudgetParts(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (missing.length === 0) {
  console.error('REPAIR_BUDGET_UNBOUNDED_NOT_DETECTED');
  process.exit(0);
}
console.error('REPAIR_BUDGET_UNBOUNDED: ' + missing[0].label);
process.exit(1);
