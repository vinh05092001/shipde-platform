'use strict';
// AC-AI-24-01 — dry run (the default) never calls AO. Control: the same plan
// with dryRun: false calls the stub once per assignment, so the zero is not a
// stub that was never wired. Exit 0 proven, 1 violated, 2 cannot measure.
const fs = require('fs');
const path = require('path');

const EXECUTOR = 'tools/ai-brain/executor.js';
if (!fs.existsSync(EXECUTOR)) {
  console.error('SOURCE_MISSING: ' + EXECUTOR + ' (run from the repository root)');
  process.exit(2);
}
const { executePlan, Outcome } = require(path.resolve(EXECUTOR));

const OK = { exitCode: 0, stdout: JSON.stringify({ session: { id: 's-1' } }), stderr: '' };
function stub(res) {
  const calls = [];
  return { calls, runAo: (args) => (calls.push(args), res) };
}

const plan = {
  assignments: [
    {
      workItemId: 'TASK-AI-99',
      role: 'author.foundation',
      branch: 'feat/a',
      provider: 'antigravity',
    },
    { workItemId: 'TASK-AI-98', role: 'reviewer.primary', branch: 'feat/b', provider: '9router' },
  ],
  deferred: [],
  utilisation: { maxImplementation: 1 },
};

const control = stub(OK);
executePlan(plan, { runAo: control.runAo, dryRun: false });
if (control.calls.length !== plan.assignments.length) {
  console.error('CONTROL_FAILED: execute made ' + control.calls.length + ' AO calls');
  process.exit(2);
}
console.log(
  'CONTROL: dryRun false made ' +
    control.calls.length +
    ' AO calls for ' +
    plan.assignments.length +
    ' assignments'
);

const dry = stub(OK);
const result = executePlan(plan, { runAo: dry.runAo });
const allDry = result.records.every((r) => r.outcome === Outcome.DRY_RUN && Array.isArray(r.args));
console.log('DRY_RUN_AO_CALLS: ' + dry.calls.length);
process.exit(dry.calls.length === 0 && allDry ? 0 : 1);
