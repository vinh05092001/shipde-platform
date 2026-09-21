'use strict';
// AC-AI-32-04 — negative proof that an unmerged dependency is rejected.
//
// The rule lives in `./lib/dependency-merged.js`, the same module
// `ac-32-03-dependency-merged.js` requires. A copy of the register is written
// to `os.tmpdir()` with the dependency cell of TASK-AI-32 set to an unmerged
// Work Item id (`TASK-AI-99`), and the same rule that proved the real dependency
// must report `ok === false`.
//
// Run outside the repository it exits 2, never 1, so the negative proof cannot
// pass by accident where no repository exists.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  REGISTER_HEADER,
  csvFields,
  csvLine,
  declaredDependency,
  dependencyProven,
} = require('./lib/dependency-merged');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-32';
const UNMERGED = 'TASK-AI-99';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

// Control: the untouched register must be measurable and proven for this
// item, or rejecting a tampered one says nothing about the rule.
const realText = fs.readFileSync(REG, 'utf8');
const realDep = declaredDependency(realText, WORK_ITEM);
if (!realDep) {
  console.error('SOURCE_MISSING: no dependency declared for ' + WORK_ITEM);
  process.exit(2);
}
const control = dependencyProven(realDep);
if (!control.measurable || !control.ok) {
  console.error('CONTROL_FAILED: real dependency ' + realDep + ' is not proven: ' + control.why);
  process.exit(2);
}

// Tamper a COPY: change the dependencies cell to an unmerged id.
const lines = realText.split(/\r?\n/).filter(Boolean);
const header = csvFields(lines[0]);
const idIndex = header.indexOf('work_item_id');
const depIndex = header.indexOf('dependencies');
if (idIndex < 0 || depIndex < 0) {
  console.error('SOURCE_MISSING: register header missing columns');
  process.exit(2);
}

const tamperedLines = [lines[0]];
for (const line of lines.slice(1)) {
  const fields = csvFields(line);
  if (fields[idIndex] === WORK_ITEM) {
    fields[depIndex] = UNMERGED;
  }
  tamperedLines.push(csvLine(fields));
}

const tmp = path.join(os.tmpdir(), 'shipde-ac32-04-' + process.pid + '.csv');
fs.writeFileSync(tmp, tamperedLines.join('\n') + '\n');
const tamperedDep = declaredDependency(fs.readFileSync(tmp, 'utf8'), WORK_ITEM);
fs.unlinkSync(tmp);

if (tamperedDep !== UNMERGED) {
  console.error('TAMPER_FAILED');
  process.exit(2);
}

const verdict = dependencyProven(tamperedDep);
if (!verdict.measurable) {
  console.error('SOURCE_MISSING: ' + verdict.why);
  process.exit(2);
}
if (verdict.ok) {
  console.error('UNPROVEN_DEPENDENCY_NOT_DETECTED: ' + tamperedDep + ' was accepted');
  process.exit(0);
}

console.error('DEPENDENCY_UNPROVEN: ' + verdict.why);
process.exit(1);
