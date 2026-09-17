'use strict';
// AC-AI-30-13 — no secret surface: the ai-guard secret-surface check runs green.
//
// The real `tools/ai-guard/cli.js secret-surface` command runs against the real
// repository; no fixture stands in. Run outside the repository it exits 2, not 0.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'ai-guard', 'cli.js');
if (!fs.existsSync(CLI)) {
  console.error('SOURCE_MISSING: ' + CLI.split(path.sep).join('/'));
  process.exit(2);
}

const run = cp.spawnSync(process.execPath, [CLI, 'secret-surface'], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 128,
});
const out = (run.stdout || '') + (run.stderr || '');

if (run.error) {
  console.error('SOURCE_MISSING: could not run secret-surface: ' + run.error.message);
  process.exit(2);
}
if (run.status !== 0) {
  console.error('SECRET_SURFACE_FAILED: secret-surface exited ' + run.status);
  process.exit(1);
}
if (!out.includes('SECRET_SURFACE_CLEAN')) {
  console.error('SECRET_SURFACE_DIRTY: secret-surface did not report clean');
  process.exit(1);
}

console.log('SECRET_SURFACE_CLEAN — ai-guard secret-surface ran green');
process.exit(0);
