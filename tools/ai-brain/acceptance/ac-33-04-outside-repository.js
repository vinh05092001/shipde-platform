'use strict';
// AC-AI-33-04 — negative proof that the three checks fail operationally (exit 2),
// not as findings (exit 0 or 1), when run outside the repository.
//
// A negative acceptance script that reported success where its source does not
// exist would be worse than no script. This one spawns each of the others with
// its working directory in a fresh temporary folder holding no repository, and
// requires every child to exit 2 with SOURCE_MISSING. Arguments are passed as an
// argv array, so no shell re-quotes anything and the probe cannot die for a
// reason unrelated to the scripts under test. It exits 2 itself when its own
// subjects are missing, so it cannot pass where nothing exists.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SUBJECTS = [
  'ac-33-01-shadow-parity.js',
  'ac-33-02-shadow-divergence.js',
  'ac-33-03-rule-single-source.js',
].map((name) => path.join(__dirname, name));

for (const subject of SUBJECTS) {
  if (!fs.existsSync(subject)) {
    console.error('SOURCE_MISSING: ' + subject.split(path.sep).join('/'));
    process.exit(2);
  }
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-33-04-outside-'));
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
console.log('CONTROL: every subject ran with no register on disk and refused operationally');
console.log(
  'OUTSIDE_REPOSITORY_PROBE: ' + SUBJECTS.length + ' subjects exited 2 with no register present'
);
