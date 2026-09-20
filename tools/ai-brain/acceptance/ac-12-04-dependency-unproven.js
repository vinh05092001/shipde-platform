'use strict';
// AC-AI-12-04 — negative proof that the dependency rule refuses a dependency
// with no merge commit, having first proved the real row is accepted.
//
// The rule is `./lib/dependency-merged.js`, the same module
// `ac-12-03-dependency-merged.js` requires: editing the rule changes both the
// invariant and this proof. The real register is read from disk; a COPY is
// written to `os.tmpdir()` with only the `dependencies` cell of the
// TASK-AI-12 row repointed at an id that no commit names. Everything else in
// the copy is exactly what the register holds. Nothing on disk is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  csvFields,
  csvLine,
  declaredDependency,
  dependencyProven,
} = require('./lib/dependency-merged');

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const WORK_ITEM = 'TASK-AI-12';
const UNPROVABLE = 'TASK-AI-99';

if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

const real = fs.readFileSync(REG, 'utf8');

// Control: the real declared dependency must be provable, or refusing a copy of
// it says nothing about the rule.
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

// Tamper: rewrite only the dependencies cell of TASK-AI-12's row in a copy.
const lines = real.split(/\r?\n/);
let tampered = false;
const rewritten = lines.map((line) => {
  if (!line.includes('"' + WORK_ITEM + '"')) return line;
  const fields = csvFields(line);
  fields[8] = UNPROVABLE; // Column 8 is 'dependencies'
  tampered = true;
  return csvLine(fields);
});

if (!tampered) {
  console.error('NO_ROW_FOUND: could not find row for ' + WORK_ITEM);
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-12-04-'));
try {
  const tamperedPath = path.join(scratch, 'FEATURE-DELIVERY-REGISTER.csv');
  fs.writeFileSync(tamperedPath, rewritten.join('\n'));

  const parsed = declaredDependency(fs.readFileSync(tamperedPath, 'utf8'), WORK_ITEM);
  if (parsed !== UNPROVABLE) {
    console.error('TAMPER_FAILED: got ' + parsed + ', expected ' + UNPROVABLE);
    process.exit(2);
  }

  const verdict = dependencyProven(parsed);
  if (!verdict.measurable) {
    console.error('SOURCE_MISSING: ' + verdict.why);
    process.exit(2);
  }
  if (verdict.ok) {
    console.error(
      'TAMPER_UNDETECTED: ' +
        UNPROVABLE +
        ' was reported proven; expected it to have no merge commit'
    );
    process.exit(2);
  }

  console.log(
    'DEPENDENCY_UNPROVEN: ' + UNPROVABLE + ' has no merge commit reachable on origin/main'
  );
  process.exit(1);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
