'use strict';
// AC-AI-24-09 — the four negative proofs must fail operationally (exit 2), not
// as findings (exit 1), when run outside the repository.
//
// Without this, "exit 1 detected a violation" and "exit 1 died for an unrelated
// reason" are indistinguishable, and a negative row could pass where no
// repository exists. Each subject is spawned with its working directory in a
// fresh temporary folder holding no repository, and every child must exit 2 with
// SOURCE_MISSING. Arguments are passed as an argv array, so no shell re-quotes
// anything and a subject cannot die from a quoting accident.
//
// The subjects are the negative proofs of this Work Item, all of which require
// `./lib/dispatch-executor-contract.js` or `./lib/spec-status-alignment.js` or
// `./lib/dependency-merged.js` and read their sources by relative path.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SUBJECTS = [
  'ac-24-02-status-divergence.js',
  'ac-24-04-dependency-unproven.js',
  'ac-24-06-planner-launch-detected.js',
  'ac-24-08-spawn-branch-dropped.js',
].map((name) => path.join(__dirname, name));

for (const subject of SUBJECTS) {
  if (!fs.existsSync(subject)) {
    console.error('SOURCE_MISSING: ' + subject.split(path.sep).join('/'));
    process.exit(2);
  }
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-24-09-outside-'));
let failures = 0;
try {
  for (const subject of SUBJECTS) {
    const child = cp.spawnSync(process.execPath, [subject], {
      cwd: outside,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    });
    const out = (child.stdout || '') + (child.stderr || '');
    const name = path.basename(subject);
    // CONTROL: a spawn failure would otherwise look like a refusal.
    if (child.error) {
      console.error('CONTROL_FAILED: could not spawn ' + name + ': ' + child.error.message);
      failures += 1;
    } else if (child.status !== 2 || !out.includes('SOURCE_MISSING:')) {
      console.error(
        'SUBJECT_EXIT_UNEXPECTED: ' +
          name +
          ' exited ' +
          child.status +
          ' outside the repository (expected 2 with SOURCE_MISSING)'
      );
      failures += 1;
    }
  }
} finally {
  fs.rmSync(outside, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log('CONTROL: every subject ran with no repository on disk and refused operationally');
console.log(
  'OUTSIDE_REPOSITORY_PROBE: ' + SUBJECTS.length + ' subjects exited 2 with no repository present'
);
