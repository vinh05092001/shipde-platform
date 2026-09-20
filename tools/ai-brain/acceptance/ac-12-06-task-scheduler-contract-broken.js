'use strict';
// AC-AI-12-06 — negative proof: a tampered copy of install-task-scheduler.ps1
// missing the Action parameter declaration is refused by the contract rule.
//
// Exit codes: 0 unexpected pass, 1 contract failure detected (expected), 2 error.
const fs = require('fs');
const { SOURCE, missingTaskSchedulerParts } = require('./lib/task-scheduler-contract');

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(SOURCE, 'utf8');

// Control: the untampered source must satisfy the contract.
const controlMissing = missingTaskSchedulerParts(real);
if (controlMissing.length > 0) {
  console.error('CONTROL_FAILED: real source already violates contract: ' + JSON.stringify(controlMissing));
  process.exit(2);
}

// Tamper: remove the ValidateSet attribute on $Action
const tampered = real.replace(/\[ValidateSet\(\s*"Install",\s*"Uninstall",\s*"Status"\s*\)\]/i, '');
if (tampered === real) {
  console.error('TAMPER_FAILED: pattern not found');
  process.exit(2);
}

const tamperedMissing = missingTaskSchedulerParts(tampered);
if (tamperedMissing.length === 0) {
  console.error('TAMPER_UNDETECTED: missing Action ValidateSet was accepted');
  process.exit(2);
}

if (!tamperedMissing.some((m) => m.id === 'ACTION_PARAM')) {
  console.error('UNEXPECTED_FINDINGS: ' + JSON.stringify(tamperedMissing));
  process.exit(2);
}

console.log('TASK_SCHEDULER_CONTRACT_BROKEN: missing action parameter declaration in param block');
process.exit(1);
