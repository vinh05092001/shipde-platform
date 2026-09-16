'use strict';
// AC-AI-37-18 — negative proof that AC-AI-37-07 fails operationally (exit 2),
// not as a finding (exit 1), when run outside the repository.
//
// The stored row was `cd $env:TEMP; node $REPO/tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js`.
// That is PowerShell syntax, `$REPO` is defined nowhere, and under the
// documented bash harness the whole line dies at `cd: :TEMP: No such file or
// directory` (measured exit 1, expected 2). It proved nothing in either shell.
//
// This script performs the same probe with arguments passed as an argv array,
// so no shell re-quotes anything: it spawns AC-AI-37-07 with its working
// directory in a fresh temporary folder that holds no repository, and requires
// the child to exit 2 with SOURCE_MISSING. Exits 2 itself when its own source
// is missing, so it cannot pass where nothing exists.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SUBJECT = path.join(__dirname, 'ac-37-07-forbidden-lifecycle.js');
if (!fs.existsSync(SUBJECT)) {
  console.error('SOURCE_MISSING: ' + SUBJECT.split(path.sep).join('/'));
  process.exit(2);
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-37-18-outside-'));
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

// CONTROL: the child must exist and really run outside the repository. A spawn
// failure would otherwise look like a refusal.
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
if (!out.includes('SOURCE_MISSING: package.json')) {
  console.error('SUBJECT_OUTPUT_UNEXPECTED: ' + out.trim().split('\n')[0]);
  process.exit(1);
}
console.log('CONTROL: child ran with no package.json on disk and refused operationally');
console.log('OUTSIDE_REPOSITORY_PROBE: child exit 2 with SOURCE_MISSING: package.json');
