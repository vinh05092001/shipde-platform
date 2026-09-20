'use strict';
// AC-AI-31-04 - negative proof that the declared-dependency rule refuses a register
// copy whose TASK-AI-31 dependency is repointed at an id that is not TASK-AI-20.
//
// The rule is `./lib/dependency-merged.js` (declaredDependency), the same module
// `ac-31-03-dependency-declared.js` requires: editing the rule changes both the
// invariant and this proof. The real register is read from disk; a COPY is written
// to `os.tmpdir()` with only the `dependencies` cell of the TASK-AI-31 row
// repointed at an id that is not TASK-AI-20. Everything else in the copy is exactly
// what the register holds. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { declaredDependency, csvFields, csvLine } = require('./lib/dependency-merged');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-31';
const REQUIRED_DEPS = ['TASK-AI-20', 'TASK-AI-25'];
const REPPOINTED = 'TASK-AI-99';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const real = fs.readFileSync(REG, 'utf8');

// Control: the real declared dependency must include both required deps.
const realDeps = declaredDependency(real, WORK_ITEM);
if (realDeps === null) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' row in the register');
  process.exit(2);
}
const realMissing = REQUIRED_DEPS.filter((dep) => !realDeps.includes(dep));
if (realMissing.length > 0) {
  console.error(
    'CONTROL_FAILED: the real dependency ' +
      realDeps +
      ' is missing ' +
      realMissing.join(', ') +
      ', so the negative case is meaningless'
  );
  process.exit(2);
}

// Tamper a COPY: repoint only the TASK-AI-31 row's dependency cell.
const lines = real.split(/\r?\n/);
const header = csvFields(lines[0]);
const idIndex = header.indexOf('work_item_id');
const depIndex = header.indexOf('dependencies');
const rowIndex = lines.findIndex((line, i) => i > 0 && line.includes('"' + WORK_ITEM + '"'));
if (idIndex < 0 || depIndex < 0 || rowIndex < 0) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' row in the register');
  process.exit(2);
}
const cells = csvFields(lines[rowIndex]);
cells[depIndex] = REPPOINTED;
const tamperedLines = lines.slice();
tamperedLines[rowIndex] = csvLine(cells);

const tmp = path.join(os.tmpdir(), 'shipde-ac31-04-' + process.pid + '.csv');
fs.writeFileSync(tmp, tamperedLines.join('\n'));
const tamperedDeps = declaredDependency(fs.readFileSync(tmp, 'utf8'), WORK_ITEM);
fs.unlinkSync(tmp);

if (tamperedDeps === null) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' row in tampered register');
  process.exit(2);
}
const tamperedMissing = REQUIRED_DEPS.filter((dep) => !tamperedDeps.includes(dep));
if (tamperedMissing.length === 0) {
  console.error('CONTROL_FAILED: tampered deps were not detected as wrong');
  process.exit(2);
}

console.error(
  'DEPENDENCY_WRONG_DECLARED: repointed copy missing ' +
    tamperedMissing.join(', ') +
    ' (negative proof confirmed)'
);
process.exit(1);
