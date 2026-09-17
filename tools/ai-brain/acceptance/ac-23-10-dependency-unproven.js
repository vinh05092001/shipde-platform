'use strict';
// AC-AI-23-10 — negative proof that the dependency rule refuses an undelivered
// dependency and an artifact violating its own rule, having first proved the real
// row's declared dependency is what the register says. The rule is
// `./lib/dependency-delivered.js`, the same module `ac-23-09-dependency-blocked.js`
// requires: editing the rule changes both the invariant and this proof.
//
// The real register is read from disk; a COPY is written to `os.tmpdir()` with only
// the `dependencies` cell of the TASK-AI-23 row repointed at an id that no commit
// names (`TASK-AI-99`). Everything else in the copy is exactly what the register
// holds. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1. That property is measured by
// `ac-23-17-outside-repository.js`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  declaredDependency,
  deliverableAtOriginMain,
  dependencyDelivered,
  dependencyProven,
  originMainFile,
} = require('./lib/dependency-delivered');
const { csvFields, csvLine } = require('./lib/dependency-merged');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-23';
const UNPROVABLE = 'TASK-AI-99';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const real = fs.readFileSync(REG, 'utf8');

// Control: the real declared dependency must be measurable (even if not delivered),
// or refusing a copy of it says nothing about the rule.
const control = dependencyDelivered(real, WORK_ITEM);
if (!control.measurable) {
  console.error('SOURCE_MISSING: ' + control.why);
  process.exit(2);
}

// Tamper a COPY: repoint only the TASK-AI-23 row's dependency cell.
const lines = real.split(/\r?\n/);
const header = csvFields(lines[0]);
const idIndex = header.indexOf('work_item_id');
const depIndex = header.indexOf('dependencies');
const rowIndex = lines.findIndex((line, i) => i > 0 && csvFields(line)[idIndex] === WORK_ITEM);
if (idIndex < 0 || depIndex < 0 || rowIndex < 0) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' row in the register');
  process.exit(2);
}
const cells = csvFields(lines[rowIndex]);
cells[depIndex] = UNPROVABLE;
const tamperedLines = lines.slice();
tamperedLines[rowIndex] = csvLine(cells);

const tmp = path.join(os.tmpdir(), 'shipde-ac23-10-' + process.pid + '.csv');
fs.writeFileSync(tmp, tamperedLines.join('\n'));
const tamperedText = fs.readFileSync(tmp, 'utf8');
fs.unlinkSync(tmp);

if (declaredDependency(tamperedText, WORK_ITEM) !== UNPROVABLE) {
  console.error('CONTROL_FAILED: the tampered copy does not declare ' + UNPROVABLE);
  process.exit(2);
}

const verdict = dependencyDelivered(tamperedText, WORK_ITEM);
if (verdict.ok) {
  console.error('DEPENDENCY_WRONGLY_PROVEN');
  process.exit(0);
}
if (!verdict.measurable) {
  console.error('SOURCE_MISSING: ' + verdict.why);
  process.exit(2);
}
// The refusal must come from the declared dependency rule, not from an unrelated
// measurement failure.
if (!dependencyProven(UNPROVABLE).measurable) {
  console.error('CONTROL_FAILED: the tampered dependency could not be measured');
  process.exit(2);
}

console.error('DEPENDENCY_UNPROVEN: ' + verdict.why);
process.exit(1);
