'use strict';
// AC-AI-10-06 - negative proof that the permission-boundary rule fires, having
// first proved the real boundary is complete.
//
// The rule lives in `./lib/permission-allowlist.js`, the same module the
// invariant `ac-10-05-allowlist-contract.js` requires. The real decisions
// document is read from disk and shown complete as the CONTROL; then one denied
// operation is removed from an IN-MEMORY copy and the same rule must report it
// as DENIED_OP_MISSING. Nothing is written to disk.
//
// A rule that stops reporting a removed deny entry makes this row exit 2, never
// 0. Run outside the repository it exits 2, never 1.
const fs = require('fs');
const {
  DECISIONS_SOURCE,
  DENIED_OPS,
  permissionBoundaryViolations,
} = require('./lib/permission-allowlist');

if (!fs.existsSync(DECISIONS_SOURCE)) {
  console.error('SOURCE_MISSING: ' + DECISIONS_SOURCE);
  process.exit(2);
}

const real = fs.readFileSync(DECISIONS_SOURCE, 'utf8');

if (permissionBoundaryViolations(real).length > 0) {
  console.error('CONTROL_FAILED: the real decisions document already violates the boundary');
  process.exit(2);
}

// Remove the FIRST denied operation - the auto-merge denial, the most
// consequential one - from an in-memory copy.
const removed = DENIED_OPS[0];
const tampered = real.replace('- ' + removed, '- (deny entry removed)');
if (tampered === real) {
  console.error('CONTROL_FAILED: the deny entry the rule names is not in the source');
  process.exit(2);
}

const violations = permissionBoundaryViolations(tampered);
if (violations.length === 0) {
  console.error('ALLOWLIST_BREAK_NOT_DETECTED');
  process.exit(2);
}
if (violations.indexOf('DENIED_OP_MISSING: ' + removed) < 0) {
  console.error('CONTROL_FAILED: the tamper produced an unrelated violation: ' + violations[0]);
  process.exit(2);
}
console.error('ALLOWLIST_BOUNDARY_BROKEN: DENIED_OP_MISSING: ' + removed);
process.exit(1);
