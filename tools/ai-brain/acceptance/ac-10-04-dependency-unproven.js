'use strict';
// AC-AI-10-04 - negative proof that the dependency rule refuses a dependency
// with no merge commit, having first proved the real row is accepted.
//
// The rule is `./lib/dependency-merged.js`, the same module
// `ac-10-03-dependency-merged.js` requires. The real register is read from disk;
// an IN-MEMORY copy has only the `dependencies` cell of the TASK-AI-10 row
// repointed at an id that no commit names. Everything else in the copy is exactly
// what the register holds. Nothing is written to disk.
//
// A rule that proves every dependency makes this row exit 2, never 0. Run
// outside the repository it exits 2, never 1.
const fs = require('fs');
const {
  csvFields,
  csvLine,
  declaredDependency,
  dependencyProven,
} = require('./lib/dependency-merged');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-10';
const UNPROVABLE = 'TASK-AI-99';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const real = fs.readFileSync(REG, 'utf8');

const realDependency = declaredDependency(real, WORK_ITEM);
const control = dependencyProven(realDependency || '');
if (!control.measurable) {
  console.error('SOURCE_MISSING: ' + control.why);
  process.exit(2);
}
if (!control.ok) {
  console.error(
    'CONTROL_FAILED: the real dependency ' +
      realDependency +
      ' is not provable, so the negative case is meaningless'
  );
  process.exit(2);
}

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
const tampered = tamperedLines.join('\n');

const rereadDependency = declaredDependency(tampered, WORK_ITEM);
if (rereadDependency !== UNPROVABLE) {
  console.error('CONTROL_FAILED: the tampered copy does not declare ' + UNPROVABLE);
  process.exit(2);
}

const verdict = dependencyProven(rereadDependency);
if (verdict.ok) {
  console.error('DEPENDENCY_WRONGLY_PROVEN');
  process.exit(2);
}
if (!verdict.measurable) {
  console.error('SOURCE_MISSING: ' + verdict.why);
  process.exit(2);
}
console.error('DEPENDENCY_UNPROVEN: ' + verdict.why);
process.exit(1);
