'use strict';
// AC-AI-30-04 — negative proof that the declared-dependency rule refuses a register
// copy whose TASK-AI-30 dependency is repointed at an id that is not TASK-AI-29.
//
// The rule is `./lib/dependency-declared.js`, the same module
// `ac-30-03-dependency-declared.js` requires: editing the rule changes both the
// invariant and this proof. The real register is read from disk; a COPY is written
// to `os.tmpdir()` with only the `dependencies` cell of the TASK-AI-30 row
// repointed at an id that is not TASK-AI-29. Everything else in the copy is exactly
// what the register holds. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dependencyDeclared } = require('./lib/dependency-declared');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-30';
const REPPOINTED = 'TASK-AI-99';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const real = fs.readFileSync(REG, 'utf8');

// Control: the real declared dependency must be measurable and correct, or refusing
// a copy of it says nothing about the rule.
const realDecl = dependencyDeclared(real, WORK_ITEM);
if (!realDecl.measurable) {
  console.error('SOURCE_MISSING: ' + realDecl.why);
  process.exit(2);
}
if (!realDecl.ok) {
  console.error(
    'CONTROL_FAILED: the real dependency ' +
      realDecl.declared +
      ' is not the declared dependency, so the negative case is meaningless'
  );
  process.exit(2);
}

// Tamper a COPY: repoint only the TASK-AI-30 row's dependency cell.
const lines = real.split(/\r?\n/);
const header = lines[0].split(',').map((c) => c.replace(/^"/, '').replace(/"$/, ''));
const idIndex = header.indexOf('work_item_id');
const depIndex = header.indexOf('dependencies');
const rowIndex = lines.findIndex(
  (line, i) => i > 0 && line.includes('"' + WORK_ITEM + '"')
);
if (idIndex < 0 || depIndex < 0 || rowIndex < 0) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' row in the register');
  process.exit(2);
}
const cells = lines[rowIndex]
  .split(',')
  .map((c) => c.replace(/^"/, '').replace(/"$/, ''));
cells[depIndex] = REPPOINTED;
const tamperedCells = cells.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"');
const tamperedLines = lines.slice();
tamperedLines[rowIndex] = tamperedCells.join(',');

const tmp = path.join(os.tmpdir(), 'shipde-ac30-04-' + process.pid + '.csv');
fs.writeFileSync(tmp, tamperedLines.join('\n'));
const reread = dependencyDeclared(fs.readFileSync(tmp, 'utf8'), WORK_ITEM);
fs.unlinkSync(tmp);

if (reread.ok) {
  console.error('DEPENDENCY_WRONG_DECLARED');
  process.exit(0);
}
if (!reread.measurable) {
  console.error('SOURCE_MISSING: ' + reread.why);
  process.exit(2);
}
console.error(
  'DEPENDENCY_MISMATCH: repointed copy declares ' +
    reread.declared +
    ' != expected TASK-AI-29'
);
process.exit(1);
