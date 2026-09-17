'use strict';
// AC-AI-24-03 — plan.deferred entries and assignment alternatives are never
// launched. Control: the one real assignment is launched exactly once.
// Exit 0 proven, 1 violated, 2 cannot measure.
const fs = require('fs');
const path = require('path');

const EXECUTOR = 'tools/ai-brain/executor.js';
if (!fs.existsSync(EXECUTOR)) {
  console.error('SOURCE_MISSING: ' + EXECUTOR + ' (run from the repository root)');
  process.exit(2);
}
const { executePlan, workerName } = require(path.resolve(EXECUTOR));

const deferred = [
  {
    workItemId: 'TASK-AI-50',
    role: 'author.foundation',
    branch: 'feat/d1',
    provider: 'antigravity',
    reason: 'IMPLEMENTATION_LIMIT',
  },
  {
    workItemId: 'TASK-AI-51',
    role: 'author.lowrisk',
    branch: 'feat/d2',
    provider: '9router',
    reason: 'NO_QUOTA_OR_BUSY',
  },
];
const plan = {
  assignments: [
    {
      workItemId: 'TASK-AI-99',
      role: 'author.foundation',
      branch: 'feat/a',
      provider: 'antigravity',
      alternatives: ['agy-b::m'],
    },
  ],
  deferred,
  utilisation: { maxImplementation: 5 },
};

const calls = [];
executePlan(plan, {
  dryRun: false,
  runAo: (args) => (calls.push(args), { exitCode: 0, stdout: '{"id":"s"}', stderr: '' }),
});
if (calls.length !== 1) {
  console.error('CONTROL_FAILED: expected one launch for the one assignment, got ' + calls.length);
  process.exit(2);
}
console.log('CONTROL: the single assignment was launched once');

const deferredNames = new Set(deferred.map((d) => workerName(d.workItemId)));
const deferredBranches = new Set(deferred.map((d) => d.branch));
const launched = calls.filter(
  (a) =>
    deferredNames.has(a[a.indexOf('--name') + 1]) ||
    deferredBranches.has(a[a.indexOf('--branch') + 1])
).length;
console.log('DEFERRED_LAUNCHED: ' + launched);
process.exit(launched === 0 ? 0 : 1);
