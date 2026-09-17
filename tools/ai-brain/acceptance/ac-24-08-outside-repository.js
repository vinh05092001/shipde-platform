'use strict';
// AC-AI-24-08 — every other ac-24-*.js fails operationally (exit 2 with
// SOURCE_MISSING), not as a finding, when run where no repository exists, and
// writes nothing into that directory.
//
// Subjects are discovered from this directory rather than listed, so a row
// added later is probed without editing a pinned count. Each subject is spawned
// with an argv array and its working directory in a fresh empty temp folder.
//
// Exit codes: 0 every subject refused operationally - 1 a subject did not -
// 2 cannot measure (no subject found).
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SELF = path.basename(__filename);
const SUBJECTS = fs
  .readdirSync(__dirname)
  .filter((name) => /^ac-24-.*\.js$/.test(name) && name !== SELF)
  .sort()
  .map((name) => path.join(__dirname, name));

if (SUBJECTS.length === 0) {
  console.error('SOURCE_MISSING: no ac-24-*.js subject beside ' + SELF);
  process.exit(2);
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-24-08-outside-'));
let failures = 0;
try {
  for (const subject of SUBJECTS) {
    const name = path.basename(subject);
    const child = cp.spawnSync(process.execPath, [subject], {
      cwd: outside,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    });
    const out = (child.stdout || '') + (child.stderr || '');
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
    } else {
      console.log('SUBJECT: ' + name + ' exited 2 with SOURCE_MISSING');
    }
  }
  const written = fs.readdirSync(outside);
  if (written.length > 0) {
    console.error('OUTSIDE_WRITTEN: subjects left ' + written.join(', '));
    failures += 1;
  }
} finally {
  fs.rmSync(outside, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(
  'OUTSIDE_REPOSITORY_PROBE: ' + SUBJECTS.length + ' subjects exited 2 with no repository present'
);
process.exit(0);
