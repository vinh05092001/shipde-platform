'use strict';
// AC-AI-30-10 — the register does not overstate what the repository can prove.
// The real reconciler runs against the real register; no fixture stands in.
//
// Run outside the repository it exits 2, not 0, so it cannot pass where nothing
// exists.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// Running outside the repository must be detected operationally (exit 2), not as
// a finding (exit 1). Without this guard the child's own refusal would surface as
// `RECONCILE_FAILED`, which is the code a real reconciliation failure uses.
const REPO_MARKER = 'tools/ai-brain/qualification.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

const CLI = path.join(__dirname, '..', 'cli.js');
if (!fs.existsSync(CLI)) {
  console.error('SOURCE_MISSING: ' + CLI.split(path.sep).join('/'));
  process.exit(2);
}

const run = cp.spawnSync(process.execPath, [CLI, 'reconcile'], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 128,
});
const out = (run.stdout || '') + (run.stderr || '');

if (run.error) {
  console.error('SOURCE_MISSING: could not run cli.js reconcile: ' + run.error.message);
  process.exit(2);
}
if (run.status !== 0) {
  console.error('RECONCILE_FAILED: cli.js reconcile exited ' + run.status);
  process.exit(1);
}
if (!out.includes('Tổng: 0 lỗi')) {
  console.error('RECONCILE_OVERSTATED: reconcile did not report 0 lỗi');
  process.exit(1);
}

console.log('Tổng: 0 lỗi — register does not overstate (reconciler ran green)');
process.exit(0);
