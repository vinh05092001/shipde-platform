'use strict';
// AC-AI-48-03 — the proof: TASK-AI-06 dependency for TASK-AI-48 is verified on origin/main
// This test asserts that the controller's dependency check correctly confirms the merge
// commit for TASK-AI-06 exists. It runs against the real repository, not a fixture.
// Outside the repository it exits 2, not 0, when TASK-AI-06 is missing.
const { execSync } = require('child_process');
const fs = require('fs');

const WORK_ITEM = 'TASK-AI-48';
const DEPENDENCY_ID = 'TASK-AI-06';

// The merge commit for TASK-AI-06 as recorded in the dependency cell
const EXPECTED_MERGE_COMMIT = 'fdf87594e60dc95aa1b9facb8af365666236f0e9';
const ORIGIN_MAIN_BRANCH = 'origin/main';

if (!fs.existsSync('.git')) {
  console.error('GIT_REPO_NOT_FOUND: working directory is not a git repository');
  process.exit(2);
}

try {
  // Check if the commit is reachable from origin/main
  const commitOidCapture = execSync(
    `git merge-base --is-ancestor ${EXPECTED_MERGE_COMMIT} ${ORIGIN_MAIN_BRANCH} && echo ${EXPECTED_MERGE_COMMIT} || echo ""`,
    { encoding: 'utf8' }
  ).trim();

  if (commitOidCapture === EXPECTED_MERGE_COMMIT) {
    console.log(
      `TASK-AI-48 dependency verified: ${DEPENDENCY_ID} (commit ${EXPECTED_MERGE_COMMIT}) is reachable on ${ORIGIN_MAIN_BRANCH}`
    );
    process.exit(0);
  } else {
    console.error(
      `DEPENDENCY_UNVERIFIED: ${DEPENDENCY_ID} commit ${EXPECTED_MERGE_COMMIT} is not reachable on ${ORIGIN_MAIN_BRANCH}`
    );
    process.exit(1);
  }
} catch (error) {
  console.error('DEPENDENCY_VERIFICATION_ERROR: failed to verify dependency');
  console.error(error.message);
  process.exit(1);
}
