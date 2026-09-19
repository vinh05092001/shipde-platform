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
// counted as unspecified, a real unspecified row whose path is pointed at a real
// file must stop being counted, and a row that names no path at all must be
// counted as unspecified rather than vanish from the measure. A rule answering
// from a constant passes none of these probes.
//
// The printed counts come out of the module's own partition, so this script never
// restates what "specified" means: the same rule AC-AI-20-02 exercises is the one
// that produces the numbers recorded as this row's evidence.

const fs = require('fs');
const path = require('path');
const {
  REGISTER_PATH,
  registerRows,
  coverageByPath,
  identityMismatches,
  specifiedRows,
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
const partition = coverageByPath(rows, root);

// CONTROL - an absent path is counted and an existing one is not.
const specifiedRow = partition.specified[0];
const unspecifiedRow = partition.unspecified[0];
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
// CONTROL - a row that names no document at all is the least actionable row the
// register can carry, so it must land in the unspecified set rather than being
// skipped by the measure (AI-20-R01).
const nameless = Object.assign({}, specifiedRow, { work_item_path: '' });
if (unspecifiedRows([nameless], root).length !== 1) {
  console.error('CONTROL_FAILURE: a row with no work_item_path was not counted as unspecified');
  process.exit(2);
}

// The counts printed below are produced by the module's partition, so this script
// states the rule nowhere of its own. A row that handed back a constant, or that
// dropped rows from the measure, is caught here: every register row must appear in
// exactly one of the two sets, and the two exported views of the measure must
// agree with each other.
const { specified, unspecified } = partition;
if (specified.length + unspecified.length !== rows.length) {
  console.error('CONTROL_FAILURE: the partition does not cover every register row once');
  process.exit(2);
}
if (
  specifiedRows(rows, root).length !== specified.length ||
  unspecifiedRows(rows, root).length !== unspecified.length
) {
  console.error('CONTROL_FAILURE: the exported sets disagree with the partition');
  process.exit(2);
}
const mismatches = identityMismatches(rows, root);

console.log(`SPEC_COVERAGE: specified=${specified.length}, unspecified=${unspecified.length}`);
console.log('CONTROL: the rule counted an absent path and cleared an existing one');
console.log(
  `CONTROL: every register row is counted exactly once (${specified.length}+${unspecified.length}=${rows.length})`
);
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
