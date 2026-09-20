'use strict';
// AC-AI-12-05 — the invariant: the real task scheduler installer satisfies the
// contract in `./lib/task-scheduler-contract.js`.
//
// Exit codes: 0 contract holds, 1 contract violated, 2 source missing.
const fs = require('fs');
const { SOURCE, missingTaskSchedulerParts } = require('./lib/task-scheduler-contract');

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');
const missing = missingTaskSchedulerParts(source);

if (missing.length > 0) {
  for (const part of missing) {
    console.error('CONTRACT_VIOLATION: missing ' + part.label + ' (' + part.id + ')');
  }
  process.exit(1);
}

console.log(
  'TASK_SCHEDULER_CONTRACT_HOLDS: install-task-scheduler.ps1 matches all contract requirements'
);
process.exit(0);
