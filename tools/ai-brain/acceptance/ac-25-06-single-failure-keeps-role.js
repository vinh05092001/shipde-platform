'use strict';
// AC-AI-25-06 — negative proof: one failure keeps the role.
//
// The floor rule (R04 + R06) requires two of three breaches in the same window.
// A single failure — even a costly one — never disqualifies. This script proves
// that by building a fixture with exactly one breach and asserting the module
// keeps the role.
//
// Expected: exit 1 with KEPT_BELOW_FLOOR. Exit 0 means the negative proof
// passed when it should have caught the violation.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');

// SOURCE_MISSING check: verify files exist relative to CWD.
const cwd = process.cwd();
if (!fs.existsSync(path.join(cwd, 'tools/ai-brain/acceptance/lib/role-feedback.js'))) {
  console.error('SOURCE_MISSING: tools/ai-brain/acceptance/lib/role-feedback.js');
  process.exit(2);
}

const {
  evaluateNarrowing,
  outcomeRecord,
} = require('./lib/role-feedback');

const NOW = Date.now();
const roleId = 'reviewer.primary';
const offeringId = 'acct-a::claude-sonnet-5';
const workItemId = 'FEAT-TEST-01';

// --- Fixture: exactly one merged item, one breach -----------------------

// One merged item with passRate=0 (below floor), but retries=2 (below ceiling)
// and tokens=100000 (below ceiling). Only 1 of 3 breaches → keep.
const records = [
  outcomeRecord(offeringId, roleId, workItemId, NOW, false, 2, 100000),
];

const result = evaluateNarrowing(roleId, offeringId, records, NOW);

if (result.decision === 'narrow') {
  console.error('KEPT_BELOW_FLOOR: role was narrowed with only 1 breach');
  process.exit(0); // The violation was caught — this is the failing case.
}

if (result.decision === 'keep' && result.reason && result.reason.includes('below floor')) {
  console.error('KEPT_BELOW_FLOOR');
  process.exit(1);
}

console.error('CONTROL_FAILED: unexpected result ' + JSON.stringify(result));
process.exit(2);
