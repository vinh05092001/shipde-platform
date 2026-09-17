'use strict';
// AC-AI-20-01: The specification-identity rule over the real register
//
// Expected: exit 0, print "SPEC_COVERAGE: 0 identity mismatches" after
// printing the measured specified/unspecified counts.
//
// The rule itself lives in lib/spec-coverage.js, and AC-AI-20-02 requires the
// same module, so editing the rule there changes both this invariant and its
// negative proof. The count is measured, never pinned — it drifts as the
// register grows and as Work Items are authored.

const fs = require('fs');
const path = require('path');
const {
  REGISTER_PATH,
  registerRows,
  specExists,
  identityMismatches,
} = require('./lib/spec-coverage');

const root = process.cwd();
const registerPath = path.resolve(root, REGISTER_PATH);

// Exit 2 when no register exists — the negative proof AC-AI-20-04 exercises this.
if (!fs.existsSync(registerPath)) {
  console.error('SOURCE_MISSING: no register at', registerPath);
  process.exit(2);
}

const registerText = fs.readFileSync(registerPath, 'utf8');
const rows = registerRows(registerText);
const rowsWithPath = rows.filter((r) => r.work_item_path);

const specified = rowsWithPath.filter((r) => specExists(r, root)).length;
const unspecified = rowsWithPath.filter((r) => !specExists(r, root)).length;
const mismatches = identityMismatches(rows, root);

console.log(`SPEC_COVERAGE: specified=${specified}, unspecified=${unspecified}`);
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
