'use strict';
// AC-AI-08-05 — the invariant: the real supervisor source declares and enforces
// a bounded, fail-closed repair budget, and binds every repair dispatch to an
// exact HEAD.
//
// The contract lives in `./lib/repair-budget-contract.js`, the same module the
// negative proof `ac-08-06-repair-budget-unbounded.js` requires, so the gate and
// the proof of the gate cannot drift apart. The supervisor read here is the
// real `scripts/ai/control.ps1`; no fixture stands in for it. Run outside the
// repository it exits 2, not 0.
const fs = require('fs');
const {
  SOURCE,
  REQUIRED_PARTS,
  missingRepairBudgetParts,
} = require('./lib/repair-budget-contract');

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

// CONTROL: the contract must be able to fail at all. An empty source is missing
// every part; if the detector reports none of them it is not measuring anything.
if (missingRepairBudgetParts('').length !== REQUIRED_PARTS.length) {
  console.error('CONTROL_FAILED: the contract detector cannot report missing parts');
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');
const missing = missingRepairBudgetParts(source);
if (missing.length > 0) {
  for (const part of missing) console.error('MISSING ' + part.id + ': ' + part.label);
  process.exit(1);
}

console.log('REPAIR_BUDGET_CONTRACT_HOLDS: bounded repair budget present in ' + SOURCE);
process.exit(0);
