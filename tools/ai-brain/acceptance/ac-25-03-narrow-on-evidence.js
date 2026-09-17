'use strict';
// AC-AI-25-03 — sustained breach narrows, and the narrowed result is proved
// against the real, unmodified disqualify (imported from capabilities.js,
// never reimplemented).
//
// The fixture: an account qualified for reviewer.primary that has delivered
// enough merged items to breach two of three floors. The module narrows
// reviewer.primary out of the account's qualifiedRoles, then calls the real
// disqualify and proves it returns the Vietnamese refusal string.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');

// SOURCE_MISSING check: verify files exist relative to CWD.
const cwd = process.cwd();
if (!fs.existsSync(path.join(cwd, 'tools/ai-brain/capabilities.js'))) {
  console.error('SOURCE_MISSING: tools/ai-brain/capabilities.js');
  process.exit(2);
}
if (!fs.existsSync(path.join(cwd, 'tools/ai-brain/acceptance/lib/role-feedback.js'))) {
  console.error('SOURCE_MISSING: tools/ai-brain/acceptance/lib/role-feedback.js');
  process.exit(2);
}

const { evaluateNarrowing, applyNarrowing, outcomeRecord } = require('./lib/role-feedback');
const { getRole, disqualify } = require('../capabilities');

const NOW = Date.now();
const roleId = 'reviewer.primary';
const offeringId = 'acct-a::claude-sonnet-5';
const workItemId = 'FEAT-TEST-01';

// --- Fixture: enough merged items to breach two floors ------------------

// We need passRate < 0.5 AND (retries > 3 OR tokens > 500000) per merged.
// Build 10 merged items, each with 0 passes, 4 retries, 600000 tokens.
// That gives passRate=0, avgRetries=4, tokensPerMerged=600000 — all three
// breach, which satisfies the two-of-three requirement.
const records = [];
const items = 10;
for (let i = 0; i < items; i++) {
  records.push(outcomeRecord(
    offeringId, roleId, workItemId + '-' + i, NOW - i * 1000, false, 4, 600000
  ));
}

// --- Evaluate -----------------------------------------------------------

const result = evaluateNarrowing(roleId, offeringId, records, NOW);

if (result.decision !== 'narrow') {
  console.error('NARROWING_FAILED: evaluateNarrowing returned ' + result.decision);
  process.exit(1);
}

if (!result.aggregates) {
  console.error('NARROWING_FAILED: no aggregates in narrowing result');
  process.exit(1);
}

// --- Prove against real disqualify -------------------------------------

const account = {
  id: 'acct-a',
  enabled: true,
  capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
  qualifiedRoles: [roleId],
};

// Apply the narrowing to a copy of the account's qualifiedRoles.
const narrowedRoles = applyNarrowing(account.qualifiedRoles, roleId);

// Prove the narrowed role is removed.
if (narrowedRoles.includes(roleId)) {
  console.error('NARROWING_FAILED: role still present after applyNarrowing');
  process.exit(1);
}

// Call the real disqualify with the narrowed qualifiedRoles.
const role = getRole(roleId);
const refusal = disqualify(role, Object.assign({}, account, {
  qualifiedRoles: narrowedRoles,
}), { workItemId, role: roleId });

if (!refusal || !refusal.includes('chưa vượt')) {
  console.error(
    'DISQUALIFY_FAILED: real disqualify did not refuse narrowed role: ' +
    (refusal || '(no reason)')
  );
  process.exit(1);
}

console.log(
  'NARROWED_ON_EVIDENCE: ' + roleId + ' narrowed, ' +
  'aggregates=' + JSON.stringify(result.aggregates) + ', ' +
  'disqualify refuses: ' + refusal
);
process.exit(0);
