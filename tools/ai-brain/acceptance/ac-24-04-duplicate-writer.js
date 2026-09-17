'use strict';
// AC-AI-24-04 — a second writer on the same branch within one plan is refused
// before AO is called. Control: the first writer is launched.
// Exit 0 proven, 1 violated, 2 cannot measure.
const fs = require('fs');
const path = require('path');

const EXECUTOR = 'tools/ai-brain/executor.js';
if (!fs.existsSync(EXECUTOR)) {
  console.error('SOURCE_MISSING: ' + EXECUTOR + ' (run from the repository root)');
  process.exit(2);
}
const { executePlan, Outcome } = require(path.resolve(EXECUTOR));

const plan = {
  assignments: [
    {
      workItemId: 'TASK-AI-99',
      role: 'author.foundation',
      branch: 'feat/shared',
      provider: 'antigravity',
    },
    {
      workItemId: 'TASK-AI-77',
      role: 'author.lowrisk',
      branch: 'feat/shared',
      provider: '9router',
    },
  ],
  deferred: [],
  utilisation: { maxImplementation: 5 },
};

const calls = [];
const result = executePlan(plan, {
  dryRun: false,
  runAo: (args) => (calls.push(args), { exitCode: 0, stdout: '{"id":"s"}', stderr: '' }),
});
if (result.records[0].outcome !== Outcome.LAUNCHED) {
  console.error('CONTROL_FAILED: the first writer was not launched');
  process.exit(2);
}
console.log('CONTROL: first writer ' + result.records[0].outcome);

const dup = result.records[1];
const dupCalls = calls.filter((a) => a.includes('task-ai-77-worker')).length;
console.log('DUPLICATE_AO_CALLS: ' + dupCalls);
console.log(dup.outcome + ': ' + dup.detail);
process.exit(
  dup.outcome === Outcome.REFUSED && dup.detail === 'DUPLICATE_WRITER' && dupCalls === 0 ? 0 : 1
);
