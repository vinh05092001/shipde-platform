'use strict';
// AC-AI-32-09 — register reconciliation passes with 0 errors.
const path = require('path');
const cp = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'cli.js');

const res = cp.spawnSync(process.execPath, [CLI_PATH, 'reconcile'], {
  encoding: 'utf8',
});

const out = (res.stdout || '') + (res.stderr || '');
if (res.status !== 0 || (out.includes('Tổng: ') && !out.includes('Tổng: 0 lỗi'))) {
  console.error('RECONCILE_FAILED:\n' + out);
  process.exit(1);
}

console.log('RECONCILE_CLEAN: register reconciliation passes with 0 errors');
process.exit(0);
