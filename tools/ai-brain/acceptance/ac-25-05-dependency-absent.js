'use strict';
// AC-AI-25-05 — the dependency block is genuinely true, not stale.
//
// Proves: no TASK-AI-24.md exists on this branch, and register order 158 still
// depends on TASK-AI-24. The block would be stale only if TASK-AI-24.md were
// present or the register had been updated; neither is the case.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');

const SPEC_DIR = 'docs/product-spec/work-items';
const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const DEPENDENCY = 'TASK-AI-24';
const WORK_ITEM = 'TASK-AI-25';

// SOURCE_MISSING check: the register must exist relative to CWD.
const cwd = process.cwd();
if (!fs.existsSync(path.join(cwd, REG))) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const registerText = fs.readFileSync(REG, 'utf8');
const registerLine = registerText
  .split(/\r?\n/)
  .find((line) => line.includes('"' + WORK_ITEM + '"'));

if (!registerLine) {
  console.error('SOURCE_MISSING: no ' + WORK_ITEM + ' row in register');
  process.exit(2);
}

// Parse the dependencies cell.
const depMatch = registerLine.match(/"dependencies","([^"]*)"/);
const declaredDeps = (registerLine.match(/"([^"]*)","[^"]*","([^"]*)"/) || [])[1];
const depsCell = registerLine.split(',').filter((c, i, arr) => {
  // Find the dependencies column — it's the 9th field (0-indexed 8).
  return false;
});

// Simpler: split by CSV rules.
function csvFields(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const fields = csvFields(registerLine);
const headerLine = registerText.split(/\r?\n/)[0];
const header = csvFields(headerLine);
const depIndex = header.indexOf('dependencies');
const dep = fields[depIndex] || '';

if (!dep.includes(DEPENDENCY)) {
  console.error('BLOCK_FALSE: register order 158 does not depend on ' + DEPENDENCY);
  process.exit(1);
}

// --- Control: TASK-AI-24.md is absent ----------------------------------

const depSpec = path.join(SPEC_DIR, DEPENDENCY + '.md');
if (fs.existsSync(depSpec)) {
  console.error('BLOCK_FALSE: ' + DEPENDENCY + '.md exists on this branch');
  process.exit(1);
}

console.log(
  'BLOCK_TRUE: ' +
    DEPENDENCY +
    ' undelivered — no ' +
    DEPENDENCY +
    '.md, register order 158 still deps ' +
    DEPENDENCY
);
process.exit(0);
