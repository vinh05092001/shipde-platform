'use strict';
// AC-AI-20-01: The specification-identity rule over the real register
//
// Expected: exit 0, print "SPEC_COVERAGE: 0 identity mismatches" after printing
// the measured specified/unspecified counts as evidence.
//
// The rule itself lives in lib/spec-coverage.js, and AC-AI-20-02 requires the
// same module, so editing the rule there changes both this invariant and its
// negative proof. The count is measured, never pinned - it drifts as the
// register grows and as Work Items are authored.
//
// CONTROL: the rule must read the real filesystem in both directions. A real
// specified row whose path is altered to a file that does not exist must be
// counted as unspecified, and a real unspecified row whose path is pointed at a
// real file must stop being counted. A rule answering from a constant passes
// neither probe.

const fs = require('fs');
const path = require('path');
const {
  REGISTER_PATH,
  registerRows,
  specExists,
  identityMismatches,
  unspecifiedRows,
} = require('./lib/spec-coverage');

const root = process.cwd();
const registerPath = path.resolve(root, REGISTER_PATH);

// Exit 2 when no register exists - AC-AI-20-04 exercises this.
if (!fs.existsSync(registerPath)) {
  console.error('SOURCE_MISSING: no register at', registerPath);
  process.exit(2);
}

const registerText = fs.readFileSync(registerPath, 'utf8');
const rows = registerRows(registerText);
const rowsWithPath = rows.filter((r) => r.work_item_path);

// CONTROL - an absent path is counted and an existing one is not.
const specifiedRow = rowsWithPath.find((r) => specExists(r, root));
const unspecifiedRow = rowsWithPath.find((r) => !specExists(r, root));
if (!specifiedRow || !unspecifiedRow) {
  console.error(
    'CONTROL_FAILURE: the register has no specified row or no unspecified row to probe'
  );
  process.exit(2);
}
const phantom = Object.assign({}, specifiedRow, {
  work_item_path: path.join('docs', 'product-spec', 'work-items', '__ac20-phantom__.md'),
});
if (unspecifiedRows([phantom], root).length !== 1) {
  console.error('CONTROL_FAILURE: an absent path was not counted as unspecified');
  process.exit(2);
}
const borrowed = Object.assign({}, unspecifiedRow, {
  work_item_path: specifiedRow.work_item_path,
});
if (unspecifiedRows([borrowed], root).length !== 0) {
  console.error('CONTROL_FAILURE: an existing path was counted as unspecified');
  process.exit(2);
}

const specified = rowsWithPath.filter((r) => specExists(r, root)).length;
const unspecified = rowsWithPath.filter((r) => !specExists(r, root)).length;
const mismatches = identityMismatches(rows, root);

console.log(`SPEC_COVERAGE: specified=${specified}, unspecified=${unspecified}`);
console.log('CONTROL: the rule counted an absent path and cleared an existing one');
console.log(`SPEC_COVERAGE: ${mismatches.length} identity mismatches`);

if (mismatches.length > 0) {
  console.error('\nIdentity mismatches found:');
  for (const entry of mismatches) {
    console.error(
      `  ${entry.row.work_item_id}: path="${entry.identity.path}" declares "${entry.identity.declaredId}"`
    );
  }
  process.exit(1);
}

process.exit(0);
