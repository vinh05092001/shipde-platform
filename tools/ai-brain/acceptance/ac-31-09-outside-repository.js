'use strict';
// AC-AI-31-09 - Negative proofs exit 2 outside repository.
// Spawns each acceptance script (ac-31-01 through ac-31-08) in a temp
// directory where the sources are absent and asserts each exits 2 with
// SOURCE_MISSING.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_MARKER = 'tools/ai-brain/qualification-gate.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

const NEGATIVE_SCRIPTS = [
  'tools/ai-brain/acceptance/ac-31-01-status-alignment.js',
  'tools/ai-brain/acceptance/ac-31-02-status-divergence.js',
  'tools/ai-brain/acceptance/ac-31-03-dependency-declared.js',
  'tools/ai-brain/acceptance/ac-31-04-dependency-repointed.js',
  'tools/ai-brain/acceptance/ac-31-05-gate-rule.js',
  'tools/ai-brain/acceptance/ac-31-06-gate-rule-refused.js',
  'tools/ai-brain/acceptance/ac-31-07-grant-credential-free.js',
  'tools/ai-brain/acceptance/ac-31-08-credential-in-grant.js',
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-31-09-'));
let allPassed = true;

for (const script of NEGATIVE_SCRIPTS) {
  const absScript = path.resolve(script);
  const result = spawnSync(process.execPath, [absScript], {
    cwd: tmpDir,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.status !== 2) {
    console.error(
      'OUTSIDE_REPO_WRONG_EXIT: ' + script + ' exited ' + result.status +
      ' outside repo (expected 2); stderr: ' + (result.stderr || '').trim()
    );
    allPassed = false;
  } else {
    const stderr = result.stderr || '';
    if (!stderr.includes('SOURCE_MISSING')) {
      console.error(
        'OUTSIDE_REPO_WRONG_MESSAGE: ' + script + ' exited 2 but did not print SOURCE_MISSING; got: ' + stderr.trim()
      );
      allPassed = false;
    }
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });

if (!allPassed) process.exit(1);
console.log('OUTSIDE_REPO_GUARD: all ' + NEGATIVE_SCRIPTS.length + ' acceptance scripts exit 2 with SOURCE_MISSING outside repository');
process.exit(0);
