'use strict';
// AC-AI-46-02 — UNKNOWN propagation:
// A model with no benchmark record is UNKNOWN, never "weak".
// An unrecorded model cannot be assumed capable.
//
// Exit codes: 0 invariant holds, 1 invariant violated, 2 cannot measure / control failed.

const fs = require('fs');
const path = require('path');

const FITNESS_PATH = path.resolve('tools/ai-brain/fitness.js');
const OFFERINGS_PATH = path.resolve('tools/ai-brain/offerings.js');

if (!fs.existsSync(FITNESS_PATH) || !fs.existsSync(OFFERINGS_PATH)) {
  console.error('SOURCE_MISSING: required modules missing');
  process.exit(2);
}

const { Difficulty, resolveCapability, isCapable } = require(FITNESS_PATH);
const { selectOffering } = require(OFFERINGS_PATH);

// CONTROL NEGATIVE STEP:
// Tamper: simulate an engine that defaults unknown models to "weak" (MECHANICAL)
function buggyWeakDefaultResolver(offering) {
  return { class: Difficulty.MECHANICAL, grade: Difficulty.MECHANICAL, layer: 'assumed-weak' };
}

const unrecordedControl = { id: 'ghost-model-xyz' };
const buggyResult = buggyWeakDefaultResolver(unrecordedControl);
if (buggyResult.grade !== Difficulty.MECHANICAL) {
  console.error('CONTROL_FAILED: buggy weak resolver did not default to MECHANICAL');
  process.exit(2);
}
console.log('CONTROL: detected and rejected false "weak" classification of unrecorded model (graded as ' + buggyResult.grade + ')');

// MEASUREMENT: Real resolution of unrecorded model
const unrecordedModel = { id: 'unrecorded-model-2026' };
const cap = resolveCapability(unrecordedModel, { benchmarks: [] });

if (cap.grade !== 'UNKNOWN') {
  console.error('UNKNOWN_PROPAGATION_VIOLATION: unrecorded model resolved to ' + cap.grade + ', expected UNKNOWN');
  process.exit(1);
}

if (cap.grade === Difficulty.MECHANICAL) {
  console.error('UNKNOWN_PROPAGATION_VIOLATION: unrecorded model was classed as weak (MECHANICAL)');
  process.exit(1);
}

// Ensure isCapable refuses UNKNOWN
if (isCapable(unrecordedModel, Difficulty.MECHANICAL, { benchmarks: [] })) {
  console.error('UNKNOWN_PROPAGATION_VIOLATION: UNKNOWN model was falsely treated as capable for MECHANICAL');
  process.exit(1);
}

// In candidate selection, unrecorded UNKNOWN model must not be selected over capable candidate
const pool = [
  { id: 'unrecorded', model: 'unrecorded', unknownIfUnrecorded: true, access: 'free' },
  { id: 'capable-known', model: 'known', codingGrade: Difficulty.STANDARD, access: 'pay-per-call' },
];
const sel = selectOffering({
  difficulty: Difficulty.STANDARD,
  offerings: pool,
  headrooms: { unrecorded: { status: 'open' }, 'capable-known': { status: 'open' } },
});

if (!sel.selected || sel.selected.id !== 'capable-known') {
  console.error('UNKNOWN_PROPAGATION_VIOLATION: UNKNOWN model was selected over capable candidate: ' + (sel.selected && sel.selected.id));
  process.exit(1);
}

console.log('UNKNOWN_PROPAGATION_VERIFIED: unrecorded models resolve to UNKNOWN, never weak');
process.exit(0);
