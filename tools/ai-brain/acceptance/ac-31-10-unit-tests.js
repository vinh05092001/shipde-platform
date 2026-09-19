'use strict';
// AC-AI-31-10 - Unit tests pass.
// Runs `node --test tools/ai-brain/test/qualification-gate.test.js` and asserts
// exit 0 with zero failing tests.
const fs = require('fs');
const { spawnSync } = require('child_process');

const REPO_MARKER = 'tools/ai-brain/qualification-gate.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

const TEST_FILE = 'tools/ai-brain/test/qualification-gate.test.js';
if (!fs.existsSync(TEST_FILE)) {
  console.error('SOURCE_MISSING: ' + TEST_FILE);
  process.exit(2);
}

const result = spawnSync(process.execPath, ['--test', TEST_FILE], {
  encoding: 'utf8',
  timeout: 30000,
});

const combined = (result.stdout || '') + (result.stderr || '');

if (result.status !== 0) {
  console.error('UNIT_TESTS_FAILED: exit code ' + result.status);
  console.error(combined.slice(-2000));
  process.exit(1);
}

// node:test output format: lines like "  ✔ test name" for pass, "  ✘ test name" for fail
// and summary lines like "ℹ pass N" and "ℹ fail M"
const passMatch = combined.match(/pass (\d+)/);
const failMatch = combined.match(/fail (\d+)/);
const passCount = passMatch ? Number(passMatch[1]) : 0;
const failCount = failMatch ? Number(failMatch[1]) : 0;

if (passCount === 0) {
  console.error('UNIT_TESTS_FAILED: no passing tests detected');
  console.error(combined.slice(-2000));
  process.exit(1);
}

if (failCount > 0) {
  console.error('UNIT_TESTS_FAILED: ' + failCount + ' failing test(s)');
  console.error(combined.slice(-2000));
  process.exit(1);
}

console.log(
  'UNIT_TESTS_PASS: ' + passCount + ' passing, ' + failCount + ' failing'
);
process.exit(0);
