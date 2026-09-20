'use strict';
// AC-AI-46-04 — Access separated from capability:
// offerings.js carries an access dimension (free, included-in-paid-plan, pay-per-call)
// independent of capability, so a strong model reached through a free source is not
// ranked as weak.
// Selection order: role/difficulty -> capable candidates -> headroom/no cooldown -> cheapest access first.
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

const { ACCESS_TYPE, expandOfferings, selectOffering } = require(OFFERINGS_PATH);
const { Difficulty } = require(FITNESS_PATH);

// CONTROL NEGATIVE STEP:
// Simulate a broken ranking where free access automatically degrades capability to MECHANICAL
function buggyConflatedAccessGrader(offering) {
  if (offering.access === ACCESS_TYPE.FREE) {
    return Difficulty.MECHANICAL; // Bug: treating free as weak
  }
  return offering.codingGrade || Difficulty.STANDARD;
}

const controlOffering = {
  id: 'free-strong',
  model: 'opus-free',
  codingGrade: Difficulty.ARCHITECTURAL,
  access: ACCESS_TYPE.FREE,
};

const degradedGrade = buggyConflatedAccessGrader(controlOffering);
if (degradedGrade === Difficulty.ARCHITECTURAL) {
  console.error('CONTROL_FAILED: conflated grader did not degrade free offering');
  process.exit(2);
}
console.log(
  'CONTROL: detected conflation of access and capability (free strong model degraded to ' +
    degradedGrade +
    ')'
);

// MEASUREMENT: Real offerings and selection
const accounts = [
  {
    id: 'free-source',
    provider: 'local',
    tier: 0,
    access: ACCESS_TYPE.FREE,
    models: [{ model: 'gemini-pro', codingGrade: Difficulty.ARCHITECTURAL, quality: 90 }],
  },
  {
    id: 'plan-source',
    provider: 'subscription',
    tier: 1,
    access: ACCESS_TYPE.INCLUDED_IN_PAID_PLAN,
    models: [{ model: 'gemini-pro', codingGrade: Difficulty.ARCHITECTURAL, quality: 90 }],
  },
  {
    id: 'paid-source',
    provider: 'api',
    tier: 2,
    access: ACCESS_TYPE.PAY_PER_CALL,
    models: [
      {
        model: 'gemini-pro',
        codingGrade: Difficulty.ARCHITECTURAL,
        quality: 90,
        cost: { inputPerMillion: 10 },
      },
    ],
  },
];

const offerings = expandOfferings(accounts);
const freeOff = offerings.find((o) => o.accountId === 'free-source');
const planOff = offerings.find((o) => o.accountId === 'plan-source');
const paidOff = offerings.find((o) => o.accountId === 'paid-source');

// 1. Verify access dimension is carried
if (!freeOff || freeOff.access !== ACCESS_TYPE.FREE) {
  console.error('ACCESS_SEPARATION_VIOLATION: free offering missing ACCESS_TYPE.FREE');
  process.exit(1);
}
if (!planOff || planOff.access !== ACCESS_TYPE.INCLUDED_IN_PAID_PLAN) {
  console.error(
    'ACCESS_SEPARATION_VIOLATION: plan offering missing ACCESS_TYPE.INCLUDED_IN_PAID_PLAN'
  );
  process.exit(1);
}
if (!paidOff || paidOff.access !== ACCESS_TYPE.PAY_PER_CALL) {
  console.error('ACCESS_SEPARATION_VIOLATION: paid offering missing ACCESS_TYPE.PAY_PER_CALL');
  process.exit(1);
}

// 2. Verify strong model reached through free source retains ARCHITECTURAL capability
if (freeOff.codingGrade !== Difficulty.ARCHITECTURAL) {
  console.error(
    'ACCESS_SEPARATION_VIOLATION: strong free offering was not graded ARCHITECTURAL: ' +
      freeOff.codingGrade
  );
  process.exit(1);
}

// 3. Selection order: cheapest access first
const headrooms = {
  [freeOff.id]: { status: 'open' },
  [planOff.id]: { status: 'open' },
  [paidOff.id]: { status: 'open' },
};

const sel1 = selectOffering({
  difficulty: Difficulty.ARCHITECTURAL,
  offerings,
  headrooms,
});

if (!sel1.selected || sel1.selected.id !== freeOff.id) {
  console.error(
    'ACCESS_SEPARATION_VIOLATION: free offering was not chosen first: ' +
      (sel1.selected && sel1.selected.id)
  );
  process.exit(1);
}

// If free is unavailable, plan (included-in-paid-plan) is chosen before pay-per-call
const sel2 = selectOffering({
  difficulty: Difficulty.ARCHITECTURAL,
  offerings: [planOff, paidOff],
  headrooms,
});

if (!sel2.selected || sel2.selected.id !== planOff.id) {
  console.error(
    'ACCESS_SEPARATION_VIOLATION: included-in-paid-plan was not chosen before pay-per-call: ' +
      (sel2.selected && sel2.selected.id)
  );
  process.exit(1);
}

console.log(
  'ACCESS_SEPARATED_FROM_CAPABILITY_VERIFIED: access dimension independent of capability, cheapest access selected first'
);
process.exit(0);
