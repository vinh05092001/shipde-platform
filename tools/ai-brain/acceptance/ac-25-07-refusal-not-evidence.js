'use strict';
// AC-AI-25-07 — negative proof: quota/timeout/500-only feed writes no
// aggregate, keeps the role.
//
// R05 excludes non-delivery outcomes. This script proves that a set of records
// that contains only quota refusals, timeouts and 500s (no real delivery
// attempts) does not narrow the role. The module must filter them out and
// return 'keep'.
//
// Expected: exit 1 with REFUSAL_IGNORED. Exit 0 means the scope rule was
// violated.
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

const { evaluateNarrowing, outcomeRecord } = require('./lib/role-feedback');

const NOW = Date.now();
const roleId = 'reviewer.primary';
const offeringId = 'acct-a::claude-sonnet-5';
const workItemId = 'FEAT-TEST-01';

// --- Fixture: only non-delivery outcomes --------------------------------

// These records represent quota refusals, timeouts and 500 errors — none of
// them are completed task attempts. R05 must exclude them all.
const records = [
  // A quota refusal: zero tokens, zero retries, not passed.
  outcomeRecord(offeringId, roleId, workItemId + '-refusal', NOW - 1000, false, 0, 0),
  // A timeout: same shape.
  outcomeRecord(offeringId, roleId, workItemId + '-timeout', NOW - 2000, false, 0, 0),
  // A 500 error: same shape.
  outcomeRecord(offeringId, roleId, workItemId + '-500', NOW - 3000, false, 0, 0),
];

const result = evaluateNarrowing(roleId, offeringId, records, NOW);

if (result.decision === 'narrow') {
  console.error('REFUSAL_IGNORED: non-delivery outcomes narrowed the role');
  process.exit(0);
}

if (result.decision === 'keep' && result.reason && result.reason.includes('no delivery')) {
  console.error('REFUSAL_IGNORED');
  process.exit(1);
}

console.error('CONTROL_FAILED: unexpected result ' + JSON.stringify(result));
process.exit(2);
