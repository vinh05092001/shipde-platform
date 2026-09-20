'use strict';
// AC-AI-12-08 — behavioral invariant: executing install-task-scheduler.ps1 with
// -Action Install -DryRun runs safely, emits preview output, and exits 0.
//
// Exit codes: 0 dryrun pass, 1 execution failure, 2 source missing.
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
    ['-ExecutionPolicy', 'Bypass', '-File', SOURCE, '-Action', 'Install', '-DryRun'],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );

  if (!output.includes('[PREVIEW]') || !output.includes('[DRY-RUN]')) {
    console.error('MISSING_DRYRUN_OUTPUT: expected [PREVIEW] and [DRY-RUN] in:\n' + output);
    process.exit(1);
  }

  console.log(
    'TASK_SCHEDULER_DRYRUN_EXECUTION_PASS: install-task-scheduler.ps1 preview run executed cleanly with exit 0'
  );
  process.exit(0);
} catch (err) {
  console.error('EXECUTION_FAILED: ' + (err.stderr || err.message));
  process.exit(1);
}
