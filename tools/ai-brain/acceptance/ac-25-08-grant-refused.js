'use strict';
// AC-AI-25-08 — negative proof: feedback never grants; re-qualification
// requires TASK-AI-31.
//
// The narrowing rule is narrowing-only (R03). This script attempts to make the
// module grant (restore) a role and proves it refuses. A mutant module that
// adds a grant path would exit 0 here — this row exists to catch exactly that.
//
// Expected: exit 1 with GRANT_REFUSED. Exit 0 means the narrowing-only
// invariant was violated.
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

const { applyNarrowing, evaluateNarrowing, outcomeRecord } = require('./lib/role-feedback');

const NOW = Date.now();
const roleId = 'reviewer.primary';
const offeringId = 'acct-a::claude-sonnet-5';
const workItemId = 'FEAT-TEST-01';

// --- Attempt 1: applyNarrowing must not restore -----------------------

const originalRoles = [roleId, 'analyst.default'];

// ApplyNarrowing with a role that is NOT in the list must not add it.
const afterRemoveMissing = applyNarrowing(originalRoles, 'nonexistent.role');
if (afterRemoveMissing.includes('nonexistent.role')) {
  console.error('GRANT_REFUSED: applyNarrowing added a role');
  process.exit(0);
}

// ApplyNarrowing must not re-add a role that was removed.
const afterRemove = applyNarrowing(originalRoles, roleId);
if (afterRemove.includes(roleId)) {
  console.error('GRANT_REFUSED: applyNarrowing restored a removed role');
  process.exit(0);
}

// ApplyNarrowing on an empty array must not add the role.
const fromEmpty = applyNarrowing([], roleId);
if (fromEmpty.includes(roleId)) {
  console.error('GRANT_REFUSED: applyNarrowing granted from empty');
  process.exit(0);
}

// --- Attempt 2: evaluateNarrowing never returns 'restore' -------------

const records = [];
for (let i = 0; i < 10; i++) {
  records.push(
    outcomeRecord(offeringId, roleId, workItemId + '-' + i, NOW - i * 1000, true, 0, 1000)
  );
}

const result = evaluateNarrowing(roleId, offeringId, records, NOW);

if (result.decision === 'restore') {
  console.error('GRANT_REFUSED: evaluateNarrowing returned restore');
  process.exit(0);
}

// --- Attempt 3: the module exports no grant function ------------------

// If a grant function exists, the narrowing-only invariant is broken.
const rf = require('./lib/role-feedback');
if (typeof rf.grantRole === 'function' || typeof rf.restoreRole === 'function') {
  console.error('GRANT_REFUSED: module exports a grant/restore function');
  process.exit(0);
}

console.error('GRANT_REFUSED: feedback never grants; re-qualify via TASK-AI-31');
process.exit(1);
