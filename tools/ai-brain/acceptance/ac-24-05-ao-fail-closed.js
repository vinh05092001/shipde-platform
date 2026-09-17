'use strict';
// AC-AI-24-05 — an AO failure is never recorded as LAUNCHED. Control: a valid
// response is LAUNCHED, so the zero below is not an executor that launches
// nothing. Exit 0 proven, 1 violated, 2 cannot measure.
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
      branch: 'feat/a',
      provider: 'antigravity',
    },
  ],
  deferred: [],
  utilisation: { maxImplementation: 1 },
};
const run = (res) => executePlan(plan, { dryRun: false, runAo: () => res }).records[0];

const control = run({
  exitCode: 0,
  stdout: JSON.stringify({ session: { id: 's-1' } }),
  stderr: '',
});
if (control.outcome !== Outcome.LAUNCHED) {
  console.error('CONTROL_FAILED: a valid AO response was not LAUNCHED');
  process.exit(2);
}
console.log('CONTROL: valid response LAUNCHED session ' + control.sessionId);

const cases = [
  ['non-zero exit', { exitCode: 1, stdout: '{"id":"s"}', stderr: 'spawn failed' }],
  ['empty stdout', { exitCode: 0, stdout: '', stderr: '' }],
  ['invalid json', { exitCode: 0, stdout: 'Session started', stderr: '' }],
  ['missing id', { exitCode: 0, stdout: '{"status":"working"}', stderr: '' }],
];
let wrong = 0;
for (const [label, res] of cases) {
  const r = run(res);
  if (r.outcome !== Outcome.FAILED || r.sessionId !== null) wrong += 1;
  console.log('CASE ' + label + ': ' + r.outcome + ' - ' + r.detail);
}
console.log('AO_FAILURES_RECORDED_AS_LAUNCHED: ' + wrong);
process.exit(wrong === 0 ? 0 : 1);
