'use strict';
// AC-AI-08-14 — the negative proof `ac-08-02-status-divergence.js` must fail
// operationally (exit 2), not as a finding (exit 1), when run outside the
// repository. Without this, "exit 1 detected a divergence" and "exit 1 died for
// an unrelated reason" are indistinguishable, and the proof could pass where no
// repository exists.
//
// This script spawns AC-AI-08-02 with its working directory in a fresh
// temporary folder that holds no repository, and requires the child to exit 2
// with SOURCE_MISSING. Arguments are passed as an argv array, so no shell
// re-quotes anything.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SUBJECT = path.join(__dirname, 'ac-08-02-status-divergence.js');
const EXPECTED = 'docs/product-spec/work-items/TASK-AI-08.md';

if (!fs.existsSync(SUBJECT)) {
  console.error('SOURCE_MISSING: ' + SUBJECT.split(path.sep).join('/'));
  process.exit(2);
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac08-14-outside-'));
let child;
try {
  child = cp.spawnSync(process.execPath, [SUBJECT], {
    cwd: outside,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  });
} finally {
  fs.rmSync(outside, { recursive: true, force: true });
}

const out = (child.stdout || '') + (child.stderr || '');

// CONTROL: the child must really run outside the repository. A spawn failure
// would otherwise look like a refusal.
if (child.error) {
  console.error('CONTROL_FAILED: could not spawn the subject: ' + child.error.message);
  process.exit(2);
}
if (child.status !== 2) {
  console.error(
    'SUBJECT_EXIT_UNEXPECTED: child exited ' + child.status + ' outside the repository (expected 2)'
  );
  process.exit(1);
}
if (!out.includes('SOURCE_MISSING: ' + EXPECTED)) {
  console.error('SUBJECT_OUTPUT_UNEXPECTED: ' + out.trim().split('\n')[0]);
  process.exit(1);
}
console.log('CONTROL: child ran with no repository on disk and refused operationally');
console.log('OUTSIDE_REPOSITORY_PROBE: child exit 2 with SOURCE_MISSING: ' + EXPECTED);
process.exit(0);
