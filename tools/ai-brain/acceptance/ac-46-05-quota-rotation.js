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

const { selectOffering, ACCESS_TYPE } = require(OFFERINGS_PATH);
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
    access: ACCESS_TYPE.FREE,
    codingGrade: Difficulty.COMPLEX,
  },
  {
    id: 'acc-alpha::model-2',
    accountId: 'acc-alpha',
    model: 'model-2',
    access: ACCESS_TYPE.FREE,
    codingGrade: Difficulty.COMPLEX,
  },
  {
    id: 'acc-beta::model-3',
    accountId: 'acc-beta',
    model: 'model-3',
    // Pay-per-call, so this rotation also proves the ladder moved on to a dearer
    // access source and still reports the tier it moved to, not a capability.
    access: ACCESS_TYPE.PAY_PER_CALL,
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

// 3. The operator console text must read as the ROTATION PASS state the Work
//    Item specifies, naming the offering, its access tier and how many offerings
//    sharing the exhausted quota were skipped. A count alone is not enough: the
//    whole point of the ladder is that the operator can see the strong account
//    was skipped, not that all is well.
const { formatSelectionResult } = require(OFFERINGS_PATH);
const rotationLines = formatSelectionResult(rotated);
const expectedRotation =
  'Selected offering acc-beta::model-3 (access: pay-per-call, skipped 2 sharing exhausted quota)';
if (rotationLines[0] !== expectedRotation) {
  console.error(
    'ROTATION_VIOLATION: rotation line does not match the specified state: ' +
      JSON.stringify(rotationLines[0]) +
      ' expected ' +
      JSON.stringify(expectedRotation)
  );
  process.exit(1);
}
if (/\bgrade|capab/i.test(rotationLines[0])) {
  console.error(
    'ROTATION_VIOLATION: the rotation line conflates access with capability: ' +
      JSON.stringify(rotationLines[0])
  );
  process.exit(1);
}
if (!rotationLines.some((l) => l === 'Rotated from 2 offerings that declined this task:')) {
  console.error(
    'ROTATION_VIOLATION: rotation line omits the declined offerings: ' +
      JSON.stringify(rotationLines)
  );
  process.exit(1);
}
if (!rotationLines.some((l) => l === '- acc-alpha::model-1 (model-1): quota exhausted')) {
  console.error(
    'ROTATION_VIOLATION: declined offering acc-alpha::model-1 is not named: ' +
      JSON.stringify(rotationLines)
  );
  process.exit(1);
}
if (rotated.message !== rotationLines.join('\n')) {
  console.error('ROTATION_VIOLATION: selection message does not match the console lines');
  process.exit(1);
}

// 4. A refusal must read as a refusal, never as silence and never as a selection.
const refusal = selectOffering({
  difficulty: Difficulty.COMPLEX,
  offerings: pool,
  headrooms,
  exhaustedAccounts: ['acc-alpha', 'acc-beta'],
});
if (refusal.selected) {
  console.error('ROTATION_VIOLATION: expected refusal with every account exhausted');
  process.exit(1);
}
const refusalLines = formatSelectionResult(refusal);
if (refusalLines[0] !== 'No offering selected') {
  console.error('ROTATION_VIOLATION: refusal line does not read as a refusal: ' + refusalLines[0]);
  process.exit(1);
}
if (refusalLines.some((l) => l.startsWith('Selected '))) {
  console.error(
    'ROTATION_VIOLATION: a refusal printed a selection line: ' + JSON.stringify(refusalLines)
  );
  process.exit(1);
}

console.log(
  'QUOTA_ROTATION_VERIFIED: on quota refusal, rotation re-selects inside capable set and skips all sources sharing exhausted quota'
);
console.log(
  'OPERATOR_STATE_VERIFIED: rotation names the declined offerings (' +
    rotationLines[2] +
    ') and a refusal reads as a refusal (' +
    refusalLines[0] +
    ')'
);
process.exit(0);
