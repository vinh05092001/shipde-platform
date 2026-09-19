#!/usr/bin/env node
'use strict';
// AC-AI-20-04: Negative proof — the three scripts above fail operationally
// (exit 2), not as findings, when run where no register exists.
//
// A script that printed "0 mismatches" from an empty directory would prove nothing
// about the repository's own coverage, and the Work Item records that none of these
// scripts does. This row is the proof of that claim.
//
// A vantage point is required to make it. The three subjects are spawned twice:
// once in a fresh empty directory, where standing outside the repository is the
// condition under test, and once here, where the repository is present. Each is
// judged on its own exit code and stderr, so a subject that printed SOURCE_MISSING
// from inside the repository and exit 2 from outside fails this row rather than
// passing it. That contrast is what makes the empty-directory leg observable at
// all: without it, a broken subject that reports SOURCE_MISSING everywhere would
// satisfy the claim. And it is what makes this row exit 2 where no register exists
// — the probe cannot answer the repository half of its own question from an empty
// directory, so it reports the missing source instead of passing.
//
// The empty vantage point is a fresh directory under the OS temporary root. No
// repository-relative path is passed to it, and each spawn gets its own directory,
// so no two subjects can influence each other through a shared path.
//
// Exit 0 every subject exited 2 with SOURCE_MISSING outside the repository, and
//        none of them did so inside it.
// Exit 1 a subject did not answer as claimed.
// Exit 2 the probe itself cannot see a register from here.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REGISTER_PATH } = require('./lib/spec-coverage');

const subjects = [
  'ac-20-01-spec-coverage.js',
  'ac-20-02-spec-identity.js',
  'ac-20-03-spec-missing-severity.js',
];

// The probe's own source: the register the subjects read when they run inside the
// repository. Its absence makes the repository half of the comparison unmeasurable.
const registerPath = path.resolve(process.cwd(), REGISTER_PATH);
if (!fs.existsSync(registerPath)) {
  console.error('SOURCE_MISSING: no register at ' + registerPath);
  process.exit(2);
}

let failures = 0;
const vantagePoints = [];

for (const subject of subjects) {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-20-04-outside-'));
  const subjectPath = path.join(__dirname, subject);
  let emptyResult;
  let repoResult;
  try {
    emptyResult = spawnSync(process.execPath, [subjectPath], {
      cwd: outside,
      encoding: 'utf8',
      timeout: 60000,
    });
    repoResult = spawnSync(process.execPath, [subjectPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120000,
    });
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }

  const emptyFailedAsClaimed =
    emptyResult.status === 2 && /SOURCE_MISSING/.test(emptyResult.stderr);
  const repoFailedAsClaimed = repoResult.status === 2 && /SOURCE_MISSING/.test(repoResult.stderr);
  if (!emptyFailedAsClaimed) {
    console.error(
      'PROBE_FAILURE: ' +
        subject +
        ' run with no repository did not fail as claimed (exit ' +
        emptyResult.status +
        ')'
    );
    failures++;
    continue;
  }
  if (repoFailedAsClaimed) {
    console.error(
      'PROBE_FAILURE: ' +
        subject +
        ' reports SOURCE_MISSING inside the repository, so the outside-repository exit proves nothing'
    );
    failures++;
    continue;
  }
  vantagePoints.push({ subject, emptyResult, repoResult });
}

for (const point of vantagePoints) {
  console.log(
    'AC-AI-20-04 CONTROL: ' +
      point.subject +
      ' exited ' +
      point.emptyResult.status +
      ' with SOURCE_MISSING from an empty directory and ' +
      point.repoResult.status +
      ' without it from the repository'
  );
}

if (failures > 0) {
  console.error(
    `PROBE_FAILURE: ${failures} of ${subjects.length} subjects did not fail as claimed`
  );
  process.exit(1);
}

console.log(
  `OUTSIDE_REPOSITORY_PROBE: ${subjects.length} subjects exited 2 with no register present`
);
process.exit(0);
