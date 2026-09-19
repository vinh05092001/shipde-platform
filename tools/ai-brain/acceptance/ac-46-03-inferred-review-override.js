'use strict';
// AC-AI-46-03 — Inferred review grade marked INFERRED and overridden by real evidence:
// Review grade defaults one class below coding grade (INFERRED). Any real review
// evidence overrides this inference.
//
// Exit codes: 0 invariant holds, 1 invariant violated, 2 cannot measure / control failed.

const fs = require('fs');
const path = require('path');

const FITNESS_PATH = path.resolve('tools/ai-brain/fitness.js');
if (!fs.existsSync(FITNESS_PATH)) {
  console.error('SOURCE_MISSING: ' + FITNESS_PATH);
  process.exit(2);
}

const { Difficulty, EVIDENCE_LAYER, resolveCapability, resolveReviewGrade } = require(FITNESS_PATH);

// CONTROL NEGATIVE STEP:
// Simulate a buggy resolver where the inferred one-below rule ignores real review evidence.
function buggyStubbornInferredResolver(offering) {
  const coding = offering.codingGrade || Difficulty.STANDARD;
  // Bug: always clamps review to coding - 1 regardless of real review evidence
  return {
    class: Math.max(1, coding - 1),
    layer: EVIDENCE_LAYER.INFERRED,
    inferred: true,
  };
}

const controlCandidate = {
  id: 'control-arch',
  codingGrade: Difficulty.ARCHITECTURAL,
  localEvaluation: { reviewGrade: Difficulty.ARCHITECTURAL }, // Real review evidence
};

const buggyReview = buggyStubbornInferredResolver(controlCandidate);
if (buggyReview.class === Difficulty.ARCHITECTURAL) {
  console.error('CONTROL_FAILED: stubborn resolver unexpectedly honored real review evidence');
  process.exit(2);
}
console.log(
  'CONTROL: stubborn inferred rule ignoring real review evidence detected (inferred ' +
    buggyReview.class +
    ' over real ' +
    controlCandidate.localEvaluation.reviewGrade +
    ')'
);

// MEASUREMENT: Real fitness resolution
// 1. Without review evidence: defaults to 1-below coding grade and marked as INFERRED
const unratedModel = {
  id: 'arch-coder-no-review',
  codingGrade: Difficulty.ARCHITECTURAL,
};
const r1 = resolveCapability(unratedModel);
if (r1.reviewGrade !== Difficulty.COMPLEX) {
  console.error(
    'INFERRED_REVIEW_VIOLATION: expected reviewGrade COMPLEX (3), got ' + r1.reviewGrade
  );
  process.exit(1);
}
if (r1.reviewLayer !== EVIDENCE_LAYER.INFERRED) {
  console.error(
    'INFERRED_REVIEW_VIOLATION: expected reviewLayer "inferred", got ' + r1.reviewLayer
  );
  process.exit(1);
}
if (r1.reviewInferred !== true) {
  console.error('INFERRED_REVIEW_VIOLATION: reviewInferred flag was not true');
  process.exit(1);
}

// 2. With real review evidence in localEvaluation: overrides inferred rule
const modelWithRealReview = {
  id: 'arch-coder-with-review',
  codingGrade: Difficulty.ARCHITECTURAL,
  localEvaluation: { reviewGrade: Difficulty.ARCHITECTURAL },
};
const r2 = resolveCapability(modelWithRealReview);
if (r2.reviewGrade !== Difficulty.ARCHITECTURAL) {
  console.error(
    'INFERRED_REVIEW_VIOLATION: real review evidence did not override inferred grade: got ' +
      r2.reviewGrade
  );
  process.exit(1);
}
if (r2.reviewLayer !== EVIDENCE_LAYER.LOCAL) {
  console.error(
    'INFERRED_REVIEW_VIOLATION: expected reviewLayer "localEvaluation", got ' + r2.reviewLayer
  );
  process.exit(1);
}
if (r2.reviewInferred !== false) {
  console.error(
    'INFERRED_REVIEW_VIOLATION: reviewInferred was true when real review evidence existed'
  );
  process.exit(1);
}

console.log(
  'INFERRED_REVIEW_OVERRIDE_VERIFIED: inferred review grade marked INFERRED and overridden by real review evidence'
);
process.exit(0);
