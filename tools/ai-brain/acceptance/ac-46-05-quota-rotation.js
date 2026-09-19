'use strict';
// AC-AI-46-05 — Quota-aware rotation on refusal:
// On quota refusal, re-select inside the capable set and skip every source
// sharing the exhausted quota.
//
// Exit codes: 0 invariant holds, 1 invariant violated, 2 cannot measure / control failed.

const fs = require('fs');
const path = require('path');

const OFFERINGS_PATH = path.resolve('tools/ai-brain/offerings.js');
const FITNESS_PATH = path.resolve('tools/ai-brain/fitness.js');

if (!fs.existsSync(OFFERINGS_PATH) || !fs.existsSync(FITNESS_PATH)) {
  console.error('SOURCE_MISSING: required modules missing');
  process.exit(2);
}

const { selectOffering } = require(OFFERINGS_PATH);
const { Difficulty } = require(FITNESS_PATH);

// CONTROL NEGATIVE STEP:
// Simulate a buggy rotator that naively picks the next model on the SAME exhausted account.
function buggySharedQuotaRotator(offerings, refusedOffering) {
  // Bug: only filters out the exact refused offering ID, ignoring that other models share the quota
  return offerings.filter((o) => o.id !== refusedOffering.id)[0] || null;
}

const pool = [
  {
    id: 'acc-alpha::model-1',
    accountId: 'acc-alpha',
    model: 'model-1',
    codingGrade: Difficulty.COMPLEX,
  },
  {
    id: 'acc-alpha::model-2',
    accountId: 'acc-alpha',
    model: 'model-2',
    codingGrade: Difficulty.COMPLEX,
  },
  {
    id: 'acc-beta::model-3',
    accountId: 'acc-beta',
    model: 'model-3',
    codingGrade: Difficulty.COMPLEX,
  },
];

const refused = pool[0];
const buggySelected = buggySharedQuotaRotator(pool, refused);
if (buggySelected.accountId !== refused.accountId) {
  console.error('CONTROL_FAILED: buggy rotator did not select sibling on shared account');
  process.exit(2);
}
console.log(
  'CONTROL: detected failure to skip shared quota (buggy rotator picked sibling ' +
    buggySelected.id +
    ' sharing ' +
    refused.accountId +
    ')'
);

// MEASUREMENT: Real quota-aware rotation in selectOffering
const headrooms = {
  'acc-alpha::model-1': { status: 'open' },
  'acc-alpha::model-2': { status: 'open' },
  'acc-beta::model-3': { status: 'open' },
};

// 1. Initial selection selects model-1 from acc-alpha
const initial = selectOffering({
  difficulty: Difficulty.COMPLEX,
  offerings: pool,
  headrooms,
});

if (!initial.selected || initial.selected.id !== 'acc-alpha::model-1') {
  console.error(
    'ROTATION_VIOLATION: initial selection failed: ' + (initial.selected && initial.selected.id)
  );
  process.exit(1);
}

// 2. Refusal occurs on initial.selected (acc-alpha::model-1).
// Re-selection must skip both acc-alpha::model-1 and acc-alpha::model-2,
// selecting acc-beta::model-3.
const rotated = selectOffering({
  difficulty: Difficulty.COMPLEX,
  offerings: pool,
  headrooms,
  refusedOffering: initial.selected,
});

if (!rotated.selected) {
  console.error('ROTATION_VIOLATION: rotation returned no candidate when capable acc-beta exists');
  process.exit(1);
}

if (rotated.selected.accountId === 'acc-alpha') {
  console.error(
    'ROTATION_VIOLATION: rotation selected ' +
      rotated.selected.id +
      ' which shares exhausted quota with acc-alpha'
  );
  process.exit(1);
}

if (rotated.selected.id !== 'acc-beta::model-3') {
  console.error('ROTATION_VIOLATION: expected acc-beta::model-3, got ' + rotated.selected.id);
  process.exit(1);
}

// Verify skippedExhausted records both offerings from acc-alpha
const skipped = rotated.skippedExhausted.map((o) => o.id);
if (!skipped.includes('acc-alpha::model-1') || !skipped.includes('acc-alpha::model-2')) {
  console.error(
    'ROTATION_VIOLATION: skippedExhausted did not contain both shared-quota models: ' +
      JSON.stringify(skipped)
  );
  process.exit(1);
}

console.log(
  'QUOTA_ROTATION_VERIFIED: on quota refusal, rotation re-selects inside capable set and skips all sources sharing exhausted quota'
);
process.exit(0);
