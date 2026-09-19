'use strict';
// AC-AI-46-01 — Fixed evidence layer precedence:
// productionResults > localEvaluation > externalEvidence.
//
// The resolved grade exposes which layer it came from, allowing callers to
// distinguish measurement from inference.
//
// Exit codes: 0 invariant holds, 1 invariant violated, 2 cannot measure / control failed.

const fs = require('fs');
const path = require('path');

const FITNESS_PATH = path.resolve('tools/ai-brain/fitness.js');
if (!fs.existsSync(FITNESS_PATH)) {
  console.error('SOURCE_MISSING: ' + FITNESS_PATH);
  process.exit(2);
}

const { Difficulty, EVIDENCE_LAYER, resolveCapability, resolveGrade } = require(FITNESS_PATH);

// CONTROL NEGATIVE STEP:
// Invert the precedence rule (e.g. let externalEvidence override productionResults).
// The test must detect and reject this inverted logic.
function invertedResolver(offering) {
  // Buggy inverted precedence: external > local > production
  if (offering.externalEvidence) {
    return { class: offering.externalEvidence.grade, layer: EVIDENCE_LAYER.EXTERNAL };
  }
  if (offering.localEvaluation) {
    return { class: offering.localEvaluation.grade, layer: EVIDENCE_LAYER.LOCAL };
  }
  if (offering.productionResults) {
    return { class: offering.productionResults.grade, layer: EVIDENCE_LAYER.PRODUCTION };
  }
  return { class: Difficulty.STANDARD, layer: null };
}

const controlCandidate = {
  id: 'control-model',
  productionResults: { grade: Difficulty.ARCHITECTURAL },
  localEvaluation: { grade: Difficulty.COMPLEX },
  externalEvidence: { grade: Difficulty.STANDARD },
};

const invertedResult = invertedResolver(controlCandidate);
if (invertedResult.layer === EVIDENCE_LAYER.PRODUCTION) {
  console.error('CONTROL_FAILED: inverted resolver unexpectedly chose productionResults');
  process.exit(2);
}
console.log(
  'CONTROL: inverted precedence rejected (incorrectly chose ' +
    invertedResult.layer +
    ' instead of productionResults)'
);

// MEASUREMENT: Real fitness module precedence evaluation
const candidate = {
  id: 'candidate-model',
  productionResults: { grade: Difficulty.ARCHITECTURAL },
  localEvaluation: { grade: Difficulty.COMPLEX },
  externalEvidence: { grade: Difficulty.STANDARD },
};

// 1. All three present: productionResults MUST win
const r1 = resolveCapability(candidate);
if (r1.grade !== Difficulty.ARCHITECTURAL || r1.layer !== EVIDENCE_LAYER.PRODUCTION) {
  console.error(
    'PRECEDENCE_VIOLATION: productionResults did not win when all three present: got ' +
      r1.layer +
      ' (' +
      r1.grade +
      ')'
  );
  process.exit(1);
}

// 2. Remove productionResults: localEvaluation MUST win over externalEvidence
delete candidate.productionResults;
const r2 = resolveCapability(candidate);
if (r2.grade !== Difficulty.COMPLEX || r2.layer !== EVIDENCE_LAYER.LOCAL) {
  console.error(
    'PRECEDENCE_VIOLATION: localEvaluation did not win over externalEvidence: got ' +
      r2.layer +
      ' (' +
      r2.grade +
      ')'
  );
  process.exit(1);
}

// 3. Remove localEvaluation: externalEvidence MUST win
delete candidate.localEvaluation;
const r3 = resolveCapability(candidate);
if (r3.grade !== Difficulty.STANDARD || r3.layer !== EVIDENCE_LAYER.EXTERNAL) {
  console.error(
    'PRECEDENCE_VIOLATION: externalEvidence did not resolve: got ' +
      r3.layer +
      ' (' +
      r3.grade +
      ')'
  );
  process.exit(1);
}

console.log('PRECEDENCE_VERIFIED: productionResults > localEvaluation > externalEvidence');
process.exit(0);
