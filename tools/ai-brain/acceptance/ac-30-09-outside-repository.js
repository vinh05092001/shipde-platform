'use strict';
// AC-AI-30-09 — every negative proof of TASK-AI-30 must fail operationally
// (exit 2), not as a finding (exit 1), when run outside the repository. Without
// this, "exit 1 detected a violation" and "exit 1 died for an unrelated reason"
// are indistinguishable, and a proof could pass where no repository exists.
//
// This script spawns each negative proof with its working directory in a fresh
// temporary folder that holds no repository, and requires each child to exit 2
// with the SOURCE_MISSING line that names the real file it could not read.
// Arguments are passed as an argv array, so no shell re-quotes anything.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SUBJECTS = [
  {
    script: 'ac-30-02-status-divergence.js',
    missing: 'docs/product-spec/work-items/TASK-AI-30.md',
  },
  {
    script: 'ac-30-04-dependency-repointed.js',
    missing: 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',
  },
  {
    script: 'ac-30-06-probe-rule-refused.js',
    missing: 'tools/ai-brain/qualification.js',
  },
  {
    script: 'ac-30-08-credential-in-result.js',
    missing: 'tools/ai-brain/qualification.js',
  },
];

for (const subject of SUBJECTS) {
  const absolute = path.join(__dirname, subject.script);
  if (!fs.existsSync(absolute)) {
    console.error('SOURCE_MISSING: tools/ai-brain/acceptance/' + subject.script);
    process.exit(2);
  }
  subject.absolute = absolute;
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac30-09-outside-'));
let child;
try {
  for (const subject of SUBJECTS) {
    let spawned;
    try {
      spawned = cp.spawnSync(process.execPath, [subject.absolute], {
        cwd: outside,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 16,
      });
    } catch (err) {
      console.error('CONTROL_FAILED: could not spawn ' + subject.script + ': ' + err.message);
      process.exit(2);
    }
    if (spawned.error) {
      console.error(
        'CONTROL_FAILED: could not spawn ' + subject.script + ': ' + spawned.error.message
      );
      process.exit(2);
    }
    if (spawned.status !== 2) {
      console.error(
        'SUBJECT_EXIT_UNEXPECTED: ' +
          subject.script +
          ' exited ' +
          spawned.status +
          ' outside the repository (expected 2)'
      );
      process.exit(1);
    }
    const out = (spawned.stdout || '') + (spawned.stderr || '');
    if (!out.includes('SOURCE_MISSING: ' + subject.missing)) {
      console.error(
        'SUBJECT_OUTPUT_UNEXPECTED: ' +
          subject.script +
          ' printed ' +
          (out.trim().split('\n')[0] || '(nothing)')
      );
      process.exit(1);
    }
  }
} finally {
  fs.rmSync(outside, { recursive: true, force: true });
}

console.log('CONTROL: each child ran with no repository on disk and refused operationally');
console.log(
  'OUTSIDE_REPOSITORY_PROBE: ' +
    SUBJECTS.length +
    ' negative proofs exited 2 with SOURCE_MISSING outside the repository'
);
process.exit(0);
