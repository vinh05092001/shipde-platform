'use strict';
// AC-AI-25-09 — every negative proof of TASK-AI-25 must fail operationally
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
    script: 'ac-25-01-control-alignment.js',
    missing: 'docs/product-spec/work-items/TASK-AI-25.md',
  },
  {
    script: 'ac-25-02-existing-gates.js',
    missing: 'tools/ai-brain/capabilities.js',
  },
  {
    script: 'ac-25-03-narrow-on-evidence.js',
    missing: 'tools/ai-brain/capabilities.js',
  },
  {
    script: 'ac-25-04-rule-single-source.js',
    missing: 'tools/ai-brain/acceptance/lib/role-feedback.js',
  },
  {
    script: 'ac-25-05-dependency-absent.js',
    missing: 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',
  },
  {
    script: 'ac-25-06-single-failure-keeps-role.js',
    missing: 'tools/ai-brain/acceptance/lib/role-feedback.js',
  },
  {
    script: 'ac-25-07-refusal-not-evidence.js',
    missing: 'tools/ai-brain/acceptance/lib/role-feedback.js',
  },
  {
    script: 'ac-25-08-grant-refused.js',
    missing: 'tools/ai-brain/acceptance/lib/role-feedback.js',
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

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac25-09-outside-'));
const results = [];

try {
  for (const subject of SUBJECTS) {
    let child;
    try {
      child = cp.spawnSync(process.execPath, [subject.absolute], {
        cwd: outside,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 16,
      });
    } catch (err) {
      console.error('CONTROL_FAILED: could not spawn ' + subject.script + ': ' + err.message);
      process.exit(2);
    }
    if (child.error) {
      console.error('CONTROL_FAILED: could not spawn ' + subject.script + ': ' + child.error.message);
      process.exit(2);
    }
    if (child.status !== 2) {
      console.error(
        'SUBJECT_EXIT_UNEXPECTED: ' + subject.script +
        ' exited ' + child.status + ' outside the repository (expected 2)'
      );
      process.exit(1);
    }
    const out = (child.stdout || '') + (child.stderr || '');
    if (!out.includes('SOURCE_MISSING: ' + subject.missing)) {
      console.error(
        'SUBJECT_OUTPUT_UNEXPECTED: ' + subject.script +
        ' printed ' + (out.trim().split('\n')[0] || '(nothing)')
      );
      process.exit(1);
    }
    results.push(subject.script);
  }
} finally {
  // Best-effort cleanup: remove the temp directory if empty.
  try { fs.rmdirSync(outside); } catch (e) { /* may not be empty */ }
}

console.log('OUTSIDE_REPOSITORY: ' + results.length +
  ' rows exited 2 with SOURCE_MISSING');
process.exit(0);
