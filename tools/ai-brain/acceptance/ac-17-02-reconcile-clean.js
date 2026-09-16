'use strict';
// AC-AI-17-02 — the register reconciler reports zero errors against the REAL
// delivery register, and the reconciler that says so is demonstrably live.
//
// The stored row named `cli.js reconcile` but carried no executable command.
// This script runs the real CLI and asserts the invariant the row meant: no
// error finding. It reads its control from a tampered COPY of the real register
// (one Work Item id duplicated), so a clean verdict cannot come from a
// reconciler that never looked.
//
// Exit codes: 0 the claim holds - 1 the claim is violated - 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = 'tools/ai-brain/cli.js';
const REGISTER = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';

if (!fs.existsSync(CLI) || !fs.existsSync(REGISTER)) {
  console.error('SOURCE_MISSING: run from the repository root (' + REGISTER + ')');
  process.exit(2);
}

function runReconcile(registerPath) {
  const run = spawnSync(
    process.execPath,
    [CLI, 'reconcile', '--register', registerPath, '--json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }
  );
  if (run.status !== 0 && run.status !== 1) {
    console.error(
      'RECONCILE_UNRUNNABLE: exit ' + run.status + ' ' + (run.stderr || '').slice(0, 200)
    );
    process.exit(2);
  }
  try {
    return JSON.parse(run.stdout);
  } catch (e) {
    console.error('RECONCILE_UNREADABLE: ' + (run.stdout || '').slice(0, 200));
    process.exit(2);
  }
}

// Control: a copy of the real register with one id duplicated. The real
// reconciler must raise an error against it.
const lines = fs
  .readFileSync(REGISTER, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '');
const header = lines[0];
const target = lines.find((l) => /"TASK-AI-17"/.test(l));
if (!target) {
  console.error('CONTROL_FAILED: no TASK-AI-17 row in ' + REGISTER);
  process.exit(2);
}
const tmp = path.join(os.tmpdir(), 'shipde-ac17-02-' + process.pid + '.csv');
fs.writeFileSync(tmp, [header].concat(lines.slice(1), [target]).join('\n') + '\n');
const control = runReconcile(tmp);
fs.unlinkSync(tmp);
if (!control.summary || control.summary.error < 1) {
  console.error('CONTROL_FAILED: the reconciler accepted a register with a duplicated id');
  process.exit(2);
}
console.log('CONTROL: tampered register rejected with ' + control.summary.error + ' error(s)');

// Measurement: the real register, untouched on disk.
const result = runReconcile(REGISTER);
const summary = result.summary || {};
console.log(
  'RECONCILE: error ' + summary.error + ', warn ' + summary.warn + ', info ' + summary.info
);
if (summary.error !== 0) {
  for (const f of result.findings || []) {
    if (f.severity === 'error') console.error('ERROR ' + f.code + ': ' + (f.id || f.workItemId));
  }
  console.error('RECONCILE_ERRORS_PRESENT');
  process.exit(1);
}
console.log('RECONCILE_ERRORS: 0');
process.exit(0);
