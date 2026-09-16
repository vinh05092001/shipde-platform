'use strict';
// AC-AI-20-01 — the specification-coverage rule applied to the real register.
//
// The row's invariant is the identity half: no register row whose spec file
// exists may be served by a document that declares a different Work Item ID.
// The count of rows that are still unspecified is measured and printed as
// evidence and is deliberately NOT asserted, because TASK-AI-20's whole point is
// that the number falls to zero; pinning it would make the row fail for the
// wrong reason at the moment it succeeded.
//
// CONTROL: the rule must read the real filesystem in both directions. A real
// row whose path is altered to something absent must be counted as unspecified,
// and a real row that is unspecified must stop being counted once its path is
// pointed at a file that exists. A rule answering from a constant passes neither
// probe.
//
// The rule is ./lib/spec-coverage.js, which AC-AI-20-02 also requires.
const fs = require('fs');
const path = require('path');
const {
  REGISTER_PATH,
  registerRows,
  unspecifiedRows,
  identityMismatches,
} = require('./lib/spec-coverage');

if (!fs.existsSync(REGISTER_PATH)) {
  console.error('SOURCE_MISSING: ' + REGISTER_PATH.split(path.sep).join('/'));
  process.exit(2);
}

const root = process.cwd();
const rows = registerRows(fs.readFileSync(REGISTER_PATH, 'utf8'));
const unspecified = unspecifiedRows(rows, root);
const mismatches = identityMismatches(rows, root);

const specified = rows.filter((row) => row.work_item_path).length - unspecified.length;

// CONTROL — an absent path is counted, an existing one is not.
const withSpec = rows.find((row) => row.work_item_path && !unspecified.includes(row));
const withoutSpec = unspecified[0];
if (!withSpec || !withoutSpec) {
  console.error('CONTROL_FAILED: the register has no specified row or no unspecified row to probe');
  process.exit(2);
}
const phantom = Object.assign({}, withSpec, {
  work_item_path: path.join('docs', 'product-spec', 'work-items', '__ac20-phantom__.md'),
});
if (unspecifiedRows([phantom], root).length !== 1) {
  console.error('CONTROL_FAILED: an absent path was not counted as unspecified');
  process.exit(2);
}
const borrowed = Object.assign({}, withoutSpec, { work_item_path: withSpec.work_item_path });
if (unspecifiedRows([borrowed], root).length !== 0) {
  console.error('CONTROL_FAILED: an existing path was counted as unspecified');
  process.exit(2);
}

for (const entry of mismatches) {
  console.error(
    'SPEC_IDENTITY_MISMATCH: ' +
      entry.identity.path +
      ' declares ' +
      entry.identity.declaredId +
      ', register row is ' +
      entry.row.work_item_id
  );
}

console.log(
  'SPEC_COVERAGE_EVIDENCE: ' +
    rows.length +
    ' rows, ' +
    specified +
    ' specified, ' +
    unspecified.length +
    ' unspecified'
);
console.log('CONTROL: the rule counted an absent path and cleared an existing one');
if (mismatches.length > 0) process.exit(1);
console.log('SPEC_COVERAGE: 0 identity mismatches');
