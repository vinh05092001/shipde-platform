'use strict';
// AC-AI-20-04: Negative proof — scripts fail operationally outside repository
//
// Expected: exit 0, print "OUTSIDE_REPOSITORY_PROBE: 3 subjects exited 2 with
// no register present".
//
// Spawns each subject with a fresh empty working directory and fails if any
// subject exits without SOURCE_MISSING.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const subjects = [
  'ac-20-01-spec-coverage.js',
  'ac-20-02-spec-identity.js',
  'ac-20-03-spec-missing-severity.js',
];

const acceptanceDir = __dirname;
let failedCount = 0;

for (const subject of subjects) {
  const subjectPath = path.join(acceptanceDir, subject);

  // Create a fresh empty directory for each subject.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ac-20-04-${subject}-`));

  const result = spawnSync('node', [subjectPath], {
    cwd: tmpDir,
    encoding: 'utf8',
    timeout: 5000,
  });

  const exitCode = result.status;
  const stderr = result.stderr || '';

  // Each subject must exit 2 with SOURCE_MISSING.
  if (exitCode !== 2 || !stderr.includes('SOURCE_MISSING')) {
    console.error(
      `PROBE_FAILURE: ${subject} exited ${exitCode} from empty directory, expected exit 2 with SOURCE_MISSING`
    );
    console.error(`  stderr: ${stderr.substring(0, 200)}`);
    failedCount++;
  }

  // Clean up.
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (failedCount > 0) {
  console.error(
    `OUTSIDE_REPOSITORY_PROBE: ${failedCount} subjects did not exit 2`
  );
  process.exit(1);
}

console.log(
  `OUTSIDE_REPOSITORY_PROBE: ${subjects.length} subjects exited 2 with no register present`
);
process.exit(0);
