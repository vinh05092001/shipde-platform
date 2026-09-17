'use strict';
// AC-AI-10-05 - the invariant: the permission boundary the supervisor must obey
// is declared, complete, and in one authority.
//
// The rule lives in `./lib/permission-allowlist.js`, the same module the negative
// proof `ac-10-06-allowlist-broken.js` requires, so editing the rule changes both
// outcomes. The source is the REAL decisions document, not a transcription of it.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const {
  DECISIONS_SOURCE,
  ALLOWED_OPS,
  DENIED_OPS,
  permissionBoundaryViolations,
} = require('./lib/permission-allowlist');

if (!fs.existsSync(DECISIONS_SOURCE)) {
  console.error('SOURCE_MISSING: ' + DECISIONS_SOURCE);
  process.exit(2);
}

const source = fs.readFileSync(DECISIONS_SOURCE, 'utf8');

const violations = permissionBoundaryViolations(source);
if (violations.length > 0) {
  for (const violation of violations) console.error('ALLOWLIST_BOUNDARY_VIOLATED: ' + violation);
  process.exit(1);
}

console.log('CONTROL: the boundary was read from ' + DECISIONS_SOURCE + ', not restated here');
console.log(
  'ALLOWLIST_BOUNDARY_HOLDS: ' +
    ALLOWED_OPS.length +
    ' allowed and ' +
    DENIED_OPS.length +
    ' denied operations declared, none missing'
);
process.exit(0);
