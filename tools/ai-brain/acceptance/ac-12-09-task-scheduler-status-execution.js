'use strict';
// AC-AI-12-09 — behavioral invariant: executing install-task-scheduler.ps1 with
// -Action Status queries task status safely, emits [TASK-SCHEDULER] output, and exits 0.
//
// Exit codes: 0 status pass, 1 execution failure, 2 source missing.
const fs = require('fs');
const cp = require('child_process');

const SOURCE = 'scripts/ai/install-task-scheduler.ps1';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

try {
  const output = cp.execFileSync(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', SOURCE, '-Action', 'Status'],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );

  if (!output.includes('[TASK-SCHEDULER]')) {
    console.error('MISSING_STATUS_OUTPUT: expected [TASK-SCHEDULER] in:\n' + output);
    process.exit(1);
  }

  console.log(
    'TASK_SCHEDULER_STATUS_EXECUTION_PASS: install-task-scheduler.ps1 status query executed cleanly with exit 0'
  );
  process.exit(0);
} catch (err) {
  console.error('EXECUTION_FAILED: ' + (err.stderr || err.message));
  process.exit(1);
}
