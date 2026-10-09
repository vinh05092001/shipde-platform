'use strict';

/**
 * Ship Dễ — TASK-AI-133: Governed merge tests
 *
 * Verifies that governed merge accepts the Controller's independent exact-SHA
 * review and merges without supervisor intervention only when all strict gates
 * pass.
 *
 * Rules:
 *   - node:test, fake gh/GraphQL client (never the real GitHub).
 *   - Never use /tmp, cd, rm or rmSync.
 *   - Tests must cover: each refusal reason, happy path with expectedHeadOid,
 *     byte-identical merge-from-main allowed, non-identical refused.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');

const {
  RefusalCode,
  governedMerge,
  isEligibleForMerge,
  validatePrTitle,
  checkByteIdenticalMerge,
  extractChangeLines,
  hasBinaryOrModeChanges,
} = require('../governed-merge');
const cli = require('../cli');
const reviewManifestApi = require('../review-manifest');
const orchestrate = require('../orchestrate');

// Use .upstream-tmp instead of /tmp or os.tmpdir()
const BASE_TEST_DIR = path.join(__dirname, '..', '..', '..', '.upstream-tmp', 'task-ai-133');
if (!fs.existsSync(BASE_TEST_DIR)) {
  fs.mkdirSync(BASE_TEST_DIR, { recursive: true });
}

function createUniqueSubdir(prefix) {
  const dir = path.join(
    BASE_TEST_DIR,
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function initGitRepo(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  cp.execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git config user.email "test@shipde.test"', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git config commit.gpgsign false', { cwd: repoDir, stdio: 'ignore' });

  // Initial commit
  fs.writeFileSync(path.join(repoDir, 'init.txt'), 'init\n', 'utf8');
  cp.execSync('git add init.txt', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git commit -m "initial commit"', { cwd: repoDir, stdio: 'ignore' });
  const baseSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  return { repoDir, baseSha };
}

function createReviewedCommit(repoDir, filename, content) {
  fs.writeFileSync(path.join(repoDir, filename), content, 'utf8');
  cp.execSync(`git add ${filename}`, { cwd: repoDir, stdio: 'ignore' });
  cp.execSync(`git commit -m "feat: add ${filename}"`, { cwd: repoDir, stdio: 'ignore' });
  return cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
}

const SAMPLE_WRITER_KEY = 'paseo::local::9router::anthropic::acc-writer::scope::claude-3-7-sonnet';
const SAMPLE_REVIEWER_KEY = 'agy::local::direct::google::acc-reviewer::scope::gemini-2.5-pro';

function createManifestAndArtifact(dir, workItemId, baseSha, reviewedSha, options) {
  const o = options || {};
  fs.mkdirSync(dir, { recursive: true });
  const artifactPath = path.join(dir, `review-artifact-${workItemId}.md`);
  const manifestPath = path.join(dir, `review-manifest-${workItemId}.json`);

  const markdownContent = [
    `# Review for ${workItemId}`,
    `- **Commit**: ${reviewedSha}`,
    `- **Verdict**: ${o.verdict || 'PASS'}`,
    '',
    '## Findings',
    (o.findings || []).map((f) => `- [${f.status}] ${f.id}: ${f.summary}`).join('\n') || 'None',
  ].join('\n');
  fs.writeFileSync(artifactPath, markdownContent, 'utf8');

  const manifest = reviewManifestApi.buildManifest({
    repoCwd: o.repoCwd || dir,
    workItemId,
    baseSha,
    reviewedSha,
    writerCandidateKey: o.writerCandidateKey || SAMPLE_WRITER_KEY,
    reviewerCandidateKey: o.reviewerCandidateKey || SAMPLE_REVIEWER_KEY,
    verdict: o.verdict || 'PASS',
    findings: o.findings || [],
    tests: [{ command: 'pnpm test', result: 'pass', summary: 'ok' }],
    artifactPath,
  });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  if (o.writeDecisionLog !== false) {
    const logContent =
      JSON.stringify({
        workItemId,
        stage: 'writer',
        role: 'writer',
        writerCandidateKey: o.writerCandidateKey || SAMPLE_WRITER_KEY,
      }) +
      '\n' +
      JSON.stringify({
        workItemId,
        stage: 'reviewer-selection',
        role: 'reviewer',
        reviewerCandidateKey: o.reviewerCandidateKey || SAMPLE_REVIEWER_KEY,
        reviewedSha,
      }) +
      '\n';
    fs.writeFileSync(path.join(dir, new Date().toISOString().slice(0, 10) + '.jsonl'), logContent, {
      encoding: 'utf8',
      flag: 'a',
    });
  }

  return { manifest, manifestPath, artifactPath };
}

test('GM-R01: refusal NEVER_MERGE when work item is on never-merge config list', async () => {
  const testDir = createUniqueSubdir('never-merge');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-61';

  const res = await governedMerge({
    workItemId,
    decisionDir,
    config: { neverMerge: ['TASK-AI-61', 'TASK-AI-64'], requiredChecks: [] },
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.NEVER_MERGE);

  // GM-R03: Verify written to decision log
  const todayFile = path.join(decisionDir, new Date().toISOString().slice(0, 10) + '.jsonl');
  assert.ok(fs.existsSync(todayFile), 'decision log file must exist');
  const logContent = fs.readFileSync(todayFile, 'utf8');
  assert.ok(logContent.includes(RefusalCode.NEVER_MERGE));
});

test('GM-R01: refusal MANIFEST_MISSING when review manifest is absent', async () => {
  const testDir = createUniqueSubdir('missing-manifest');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-999';

  const res = await governedMerge({
    workItemId,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.MANIFEST_MISSING);
});

test('GM-R01: refusal VERDICT_NOT_PASS when review manifest verdict is not PASS', async () => {
  const testDir = createUniqueSubdir('not-pass');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'CHANGES_REQUIRED',
    findings: [{ id: 'F1', severity: 'medium', status: 'open', summary: 'fix needed' }],
  });

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.VERDICT_NOT_PASS);
});

test('GM-R01: refusal OPEN_FINDINGS when manifest has open P0 or P1 findings', async () => {
  const testDir = createUniqueSubdir('open-findings');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
    findings: [{ id: 'F1', severity: 'p0', status: 'open', summary: 'critical flaw' }],
  });

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.OPEN_FINDINGS);
});

test('GM-R01: refusal REVIEWER_NOT_INDEPENDENT when reviewer shares failure domain or key', async () => {
  const testDir = createUniqueSubdir('reviewer-indep');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
    writerCandidateKey: SAMPLE_WRITER_KEY,
    reviewerCandidateKey: SAMPLE_WRITER_KEY, // Same key!
  });

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.REVIEWER_NOT_INDEPENDENT);
});

test('GM-R01: refusal PR_NOT_FOUND when Pull Request does not exist', async () => {
  const testDir = createUniqueSubdir('pr-not-found');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => null,
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.PR_NOT_FOUND);
});

test('GM-R01: refusal DRAFT when Pull Request is in draft state', async () => {
  const testDir = createUniqueSubdir('pr-draft');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      number: 10,
      title: `[${workItemId}] Governed merge`,
      isDraft: true,
      headRefOid: reviewedSha,
    }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.DRAFT);
});

test('GM-R01: refusal WORK_ITEM_MISMATCH when PR title carries wrong or multiple IDs', async () => {
  const testDir = createUniqueSubdir('title-mismatch');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  // Multiple IDs in title
  const fakeGhClient = {
    getPullRequest: async () => ({
      number: 10,
      title: `[${workItemId}] [TASK-AI-128] Governed merge`,
      isDraft: false,
      headRefOid: reviewedSha,
    }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.WORK_ITEM_MISMATCH);
});

test('GM-R01: refusal HEAD_MISMATCH when PR head does not match reviewed SHA and is not a merge', async () => {
  const testDir = createUniqueSubdir('head-mismatch');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const otherSha = createReviewedCommit(repoDir, 'other.txt', 'unreviewed\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      number: 10,
      title: `[${workItemId}] Governed merge`,
      isDraft: false,
      headRefOid: otherSha, // Does not match reviewedSha!
    }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.HEAD_MISMATCH);
});

test('GM-R01: refusal CHECK_NOT_SUCCESS when CI checks fail or are pending', async () => {
  const testDir = createUniqueSubdir('checks-fail');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      number: 10,
      title: `[${workItemId}] Governed merge`,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci/test', status: 'COMPLETED', conclusion: 'FAILURE', headSha: reviewedSha },
      ],
    }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.CHECK_NOT_SUCCESS);
});

test('GM-R01: refusal CHECK_NOT_SUCCESS when check is for a different commit OID', async () => {
  const testDir = createUniqueSubdir('checks-wrong-oid');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      number: 10,
      title: `[${workItemId}] Governed merge`,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        {
          name: 'ci/test',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
          headSha: '0'.repeat(40), // Wrong OID!
        },
      ],
    }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.CHECK_NOT_SUCCESS);
});

test('GM-R01: refusal THREADS_UNRESOLVED when review threads remain open', async () => {
  const testDir = createUniqueSubdir('threads-unresolved');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      number: 10,
      title: `[${workItemId}] Governed merge`,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci/test', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
      unresolvedThreadsCount: 2, // Open review threads!
    }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.THREADS_UNRESOLVED);
});

test('GM-R01: happy path merges with expectedHeadOid squash mutation', async () => {
  const testDir = createUniqueSubdir('happy-path');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  let capturedMutation = null;

  const fakeGhClient = {
    getPullRequest: async () => ({
      id: 'PR_12345',
      number: 10,
      title: `[${workItemId}] Governed merge accepts review`,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci/build', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
        { name: 'ci/test', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
      unresolvedThreadsCount: 0,
    }),
    mergePullRequest: async (pullRequestId, expectedHeadOid, mergeMethod) => {
      capturedMutation = { pullRequestId, expectedHeadOid, mergeMethod };
      return {
        merged: true,
        mergeCommitOid: 'f'.repeat(40),
      };
    },
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'merged');
  assert.strictEqual(res.headSha, reviewedSha);
  assert.strictEqual(res.mergeCommitOid, 'f'.repeat(40));

  assert.ok(capturedMutation, 'merge mutation must have been invoked');
  assert.strictEqual(capturedMutation.pullRequestId, 'PR_12345');
  assert.strictEqual(capturedMutation.expectedHeadOid, reviewedSha);
  assert.strictEqual(capturedMutation.mergeMethod, 'SQUASH');

  // Verify decision log on success
  const todayFile = path.join(decisionDir, new Date().toISOString().slice(0, 10) + '.jsonl');
  const logContent = fs.readFileSync(todayFile, 'utf8');
  assert.ok(logContent.includes('GOVERNED_MERGE_SUCCESS'));
});

test('GM-R02: byte-identical merge commit of origin/main is allowed', async () => {
  const testDir = createUniqueSubdir('byte-identical');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));

  // Create reviewed commit on a feature branch
  cp.execSync('git checkout -b feat/task-133', { cwd: repoDir, stdio: 'ignore' });
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature line 1\n');

  // Create an independent commit on main
  cp.execSync(`git checkout main`, { cwd: repoDir, stdio: 'ignore' });
  createReviewedCommit(repoDir, 'unrelated.txt', 'main branch work\n');

  // Merge main into feature branch (clean merge, no conflict)
  cp.execSync('git checkout feat/task-133', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git merge main -m "Merge branch main into feat/task-133"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  const mergeSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  // Head is now mergeSha != reviewedSha
  assert.notStrictEqual(mergeSha, reviewedSha);

  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  let capturedHeadOid = null;
  const fakeGhClient = {
    getPullRequest: async () => ({
      id: 'PR_MERGE_1',
      number: 11,
      title: `[${workItemId}] Merge allowed`,
      isDraft: false,
      headRefOid: mergeSha,
      statusCheckRollup: [
        { name: 'ci/build', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: mergeSha },
      ],
      unresolvedThreadsCount: 0,
    }),
    mergePullRequest: async (pullRequestId, expectedHeadOid) => {
      capturedHeadOid = expectedHeadOid;
      return { merged: true, mergeCommitOid: 'e'.repeat(40) };
    },
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, true, 'byte-identical merge commit from main must be allowed');
  assert.strictEqual(res.headSha, mergeSha);
  assert.strictEqual(capturedHeadOid, mergeSha);
});

test('GM-R02: non-identical merge commit of origin/main is refused with DELTA_REVIEW_REQUIRED', async () => {
  const testDir = createUniqueSubdir('non-identical');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));

  // Create reviewed commit on feature branch
  cp.execSync('git checkout -b feat/task-133-diff', { cwd: repoDir, stdio: 'ignore' });
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature line 1\n');

  // Create main commit
  cp.execSync(`git checkout main`, { cwd: repoDir, stdio: 'ignore' });
  createReviewedCommit(repoDir, 'unrelated.txt', 'main branch work\n');

  // Merge main into feature branch, but sneak in an edit
  cp.execSync('git checkout feat/task-133-diff', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git merge --no-commit main', { cwd: repoDir, stdio: 'ignore' });
  // Add unexpected modification in feat.txt during merge
  fs.writeFileSync(path.join(repoDir, 'feat.txt'), 'feature line 1\nmodified in merge!\n', 'utf8');
  cp.execSync('git add feat.txt', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git commit -m "Merge main with sneak edit"', { cwd: repoDir, stdio: 'ignore' });
  const mergeSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      id: 'PR_MERGE_2',
      number: 12,
      title: `[${workItemId}] Merge refused`,
      isDraft: false,
      headRefOid: mergeSha,
      statusCheckRollup: [
        { name: 'ci/build', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: mergeSha },
      ],
      unresolvedThreadsCount: 0,
    }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.DELTA_REVIEW_REQUIRED);
});

test('GM-R03: fail-closed decision logging writes named reasons with zero retries', async () => {
  const testDir = createUniqueSubdir('decision-log');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  let getPrCallCount = 0;
  const fakeGhClient = {
    getPullRequest: async () => {
      getPrCallCount += 1;
      return {
        number: 13,
        title: `[${workItemId}] Failing check`,
        isDraft: false,
        headRefOid: reviewedSha,
        statusCheckRollup: [
          { name: 'ci', status: 'FAILED', conclusion: 'FAILURE', headSha: reviewedSha },
        ],
      };
    },
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    ghClient: fakeGhClient,
    config: { neverMerge: [], requiredChecks: [] },
  });

  assert.strictEqual(res.ok, false);
  // Zero retry loop: getPullRequest called exactly once
  assert.strictEqual(getPrCallCount, 1, 'must never retry in a loop on failed checks');

  const todayFile = path.join(decisionDir, new Date().toISOString().slice(0, 10) + '.jsonl');
  const logContent = fs.readFileSync(todayFile, 'utf8');
  assert.ok(
    logContent.includes('CHECK_NOT_SUCCESS') || logContent.includes('GOVERNED_MERGE_REFUSED')
  );
});

test('GM-R01: refusal SCHEMA_INVALID when manifest is corrupted or violates schema', async () => {
  const testDir = createUniqueSubdir('schema-invalid');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, { repoCwd: repoDir });
  // Corrupt the manifest
  const manifestPath = path.join(decisionDir, `review-manifest-${workItemId}.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.workItemId; // violate schema
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.SCHEMA_INVALID);
});

test('GM-R01: refusal MERGE_FAILED when merge mutation fails', async () => {
  const testDir = createUniqueSubdir('merge-failed');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      id: 'PR_FAIL',
      number: 10,
      title: `[${workItemId}] Fail merge`,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
      unresolvedThreadsCount: 0,
    }),
    mergePullRequest: async () => ({ merged: false, error: 'GitHub returned 500' }),
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
    ghClient: fakeGhClient,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.MERGE_FAILED);
});

test('GM-R01: refusal REVIEWER_NOT_INDEPENDENT when reviewer shares failure domain with writer', async () => {
  const testDir = createUniqueSubdir('reviewer-indep-domain');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  // Share the same upstream segment (part 3)
  const WRITER_KEY = 'paseo::local::9router::anthropic::acc1::scope::claude-3-7-sonnet';
  const REVIEWER_KEY = 'paseo::local::direct::anthropic::acc2::scope::claude-3-5-sonnet';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
    writerCandidateKey: WRITER_KEY,
    reviewerCandidateKey: REVIEWER_KEY,
  });

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: [] },
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.REVIEWER_NOT_INDEPENDENT);
});

test('GM-R04: control.ps1 verdict source accepts valid manifest and rejects open P0', () => {
  const testDir = createUniqueSubdir('control-ps1');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const controlPath = path.join(__dirname, '..', '..', '..', 'scripts', 'ai', 'control.ps1');
  const ps1Script = path.join(testDir, 'test-control.ps1');

  fs.writeFileSync(
    ps1Script,
    `
    . "${controlPath}" -Action "Test" | Out-Null
    function Get-ShipDePullRequestByNumber {
        param([int]$Number)
        return @{ title = "[TASK-AI-133] Test PR" }
    }
    $env:SHIPDE_DECISION_DIR = "${decisionDir}"
    $res = Get-ShipDeExactHeadReviewManifestVerdict -HeadSha "${reviewedSha}" -PullRequestNumber 1 -RepoDir "${repoDir}"
    Write-Output "VERDICT_RESULT:$res"
  `,
    'utf8'
  );

  let stdout = '';
  try {
    stdout = cp
      .execSync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${ps1Script}"`,
        { encoding: 'utf8' }
      )
      .trim();
  } catch (e) {
    stdout = e.stdout || '';
  }
  if (!stdout.includes('VERDICT_RESULT:PASS')) {
    console.log('--- STDOUT FROM TEST-CONTROL.PS1 ---');
    console.log(stdout);
    console.log('--------------------------------------');
  }
  assert.ok(
    stdout.includes('VERDICT_RESULT:PASS'),
    'control.ps1 must return PASS for valid manifest'
  );

  // Now create an open P0 finding
  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
    findings: [{ id: 'F1', status: 'open', severity: 'p0', summary: 'fail' }],
  });

  let stdout2 = '';
  try {
    stdout2 = cp
      .execSync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${ps1Script}"`,
        { encoding: 'utf8' }
      )
      .trim();
  } catch (e) {
    stdout2 = e.stdout || '';
  }
  assert.ok(
    !stdout2.includes('VERDICT_RESULT:PASS'),
    'control.ps1 must not return PASS if there are open P0 findings'
  );
});

test('GM-R05: isEligibleForMerge correctly gates auto-merge in orchestrate loop', () => {
  const validEntry = {
    workItemId: 'TASK-AI-133',
    verdict: 'PASS',
    findings: [],
  };
  const publishedDraft = {
    status: 'published_draft',
  };

  // Eligible
  assert.strictEqual(isEligibleForMerge(validEntry, publishedDraft, {}), true);

  // Ineligible: unpublished
  assert.strictEqual(isEligibleForMerge(validEntry, { status: 'refused' }, {}), false);

  // Ineligible: review not PASS
  assert.strictEqual(
    isEligibleForMerge({ ...validEntry, verdict: 'CHANGES_REQUIRED' }, publishedDraft, {}),
    false
  );

  // Ineligible: open P0 finding
  assert.strictEqual(
    isEligibleForMerge(
      { ...validEntry, findings: [{ status: 'open', severity: 'p0' }] },
      publishedDraft,
      {}
    ),
    false
  );

  // Ineligible: in neverMerge
  assert.strictEqual(
    isEligibleForMerge(validEntry, publishedDraft, { config: { neverMerge: ['TASK-AI-133'] } }),
    false
  );
});

test('GM-R01: default client paths fallback using ghRunner', async () => {
  const testDir = createUniqueSubdir('ghrunner-fallback');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  let ghRunnerCalled = false;
  const ghRunner = (args) => {
    ghRunnerCalled = true;
    if (args.includes('api') && args.includes('graphql')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [{ isResolved: false }],
                },
              },
            },
          },
        }),
        stderr: '',
      };
    }
    if (args.includes('pr') && args.includes('list')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            title: `[${workItemId}] Test PR`,
            id: 'PR_123',
            number: 123,
            isDraft: false,
            headRefOid: reviewedSha,
            statusCheckRollup: [
              {
                name: 'test',
                conclusion: 'SUCCESS',
                headSha: reviewedSha,
              },
            ],
          },
        ]),
        stderr: '',
      };
    }
    return { exitCode: 1, stdout: '', stderr: 'Unknown mock command' };
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['test'] },
    ghRunner,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(
    res.refusal,
    RefusalCode.THREADS_UNRESOLVED,
    'ghRunner fallback should resolve 1 unresolved thread'
  );
  assert.ok(ghRunnerCalled, 'ghRunner should be invoked');
});

test('GM-R01: cli.js merge command handles missing args and executes merge', async () => {
  // Test missing --work-item returns exitCode 2
  const prevExitCode = process.exitCode;
  const resMissing = await cli.mergeCommand({});
  assert.strictEqual(resMissing.exitCode, 2);
  process.exitCode = prevExitCode;
});

test('GM-R01: refusal REVIEWER_NOT_RECORDED when reviewer was not recorded in the decision log for that item and exact SHA', async () => {
  const testDir = createUniqueSubdir('rev-not-recorded');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
    writeDecisionLog: false,
  });

  // 1. Reviewer logged for a different commit SHA
  const otherSha = '1'.repeat(40);
  const logDifferentSha =
    JSON.stringify({
      workItemId,
      stage: 'writer',
      role: 'writer',
      writerCandidateKey: SAMPLE_WRITER_KEY,
    }) +
    '\n' +
    JSON.stringify({
      workItemId,
      stage: 'reviewer-selection',
      role: 'reviewer',
      reviewerCandidateKey: SAMPLE_REVIEWER_KEY,
      reviewedSha: otherSha,
    }) +
    '\n';
  fs.writeFileSync(path.join(decisionDir, '2026-10-09.jsonl'), logDifferentSha, 'utf8');

  const fakeGhClient = {
    getPullRequest: async () => ({
      title: `[${workItemId}] Governed merge`,
      id: 'PR_kwDO',
      number: 101,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci/test', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
      unresolvedThreadsCount: 0,
    }),
  };

  const res1 = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['ci/test'] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.refusal, RefusalCode.REVIEWER_NOT_RECORDED);

  // 2. Decision log has different reviewer for the exact SHA
  const logDifferentReviewer =
    JSON.stringify({
      workItemId,
      stage: 'writer',
      role: 'writer',
      writerCandidateKey: SAMPLE_WRITER_KEY,
    }) +
    '\n' +
    JSON.stringify({
      workItemId,
      stage: 'reviewer-selection',
      role: 'reviewer',
      reviewerCandidateKey: 'other-reviewer-key',
      reviewedSha,
    }) +
    '\n';
  fs.writeFileSync(path.join(decisionDir, '2026-10-09.jsonl'), logDifferentReviewer, 'utf8');

  const res2 = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['ci/test'] },
    ghClient: fakeGhClient,
  });

  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.refusal, RefusalCode.REVIEWER_NOT_RECORDED);
});

test('GM-R02: refusal DELTA_REVIEW_REQUIRED when merge-from-main path contains binary or mode changes', async () => {
  const testDir = createUniqueSubdir('binary-mode-refusal');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  cp.execSync('git config core.filemode true', { cwd: repoDir, stdio: 'ignore' });

  // Commit on feature branch
  cp.execSync('git checkout -b feat/task-133', { cwd: repoDir, stdio: 'ignore' });
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature line 1\n');

  // Main advances
  cp.execSync('git checkout main', { cwd: repoDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoDir, 'main.txt'), 'main line\n', 'utf8');
  cp.execSync('git add main.txt', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git commit -m "main advances"', { cwd: repoDir, stdio: 'ignore' });
  const mainSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  // Merge commit that brings a binary file
  cp.execSync('git checkout feat/task-133', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync(`git merge --no-ff -m "merge origin/main" ${mainSha}`, {
    cwd: repoDir,
    stdio: 'ignore',
  });
  fs.writeFileSync(
    path.join(repoDir, 'image.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
  );
  cp.execSync('git add image.png', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git commit --amend --no-edit', { cwd: repoDir, stdio: 'ignore' });
  const binaryMergeSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  const binaryRes = checkByteIdenticalMerge(repoDir, binaryMergeSha, reviewedSha, baseSha);
  assert.strictEqual(binaryRes.ok, false);
  assert.strictEqual(binaryRes.reason, RefusalCode.DELTA_REVIEW_REQUIRED);

  // Mode change test:
  cp.execSync('git checkout -B feat/task-133-mode ' + reviewedSha, {
    cwd: repoDir,
    stdio: 'ignore',
  });
  cp.execSync(`git merge --no-ff -m "merge origin/main mode" ${mainSha}`, {
    cwd: repoDir,
    stdio: 'ignore',
  });
  cp.execSync('git update-index --chmod=+x init.txt', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git commit --amend --no-edit', { cwd: repoDir, stdio: 'ignore' });
  const modeMergeSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  const modeRes = checkByteIdenticalMerge(repoDir, modeMergeSha, reviewedSha, baseSha);
  assert.strictEqual(modeRes.ok, false);
  assert.strictEqual(modeRes.reason, RefusalCode.DELTA_REVIEW_REQUIRED);
});

test('GM-R01: refusal THREADS_UNRESOLVED when unresolvedThreadsCount is NaN or negative', async () => {
  const testDir = createUniqueSubdir('nan-thread-counts');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  // 1. pr.unresolvedThreadsCount = NaN
  const fakeGhNan = {
    getPullRequest: async () => ({
      title: `[${workItemId}] Governed merge`,
      id: 'PR_1',
      number: 1,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
      unresolvedThreadsCount: NaN,
    }),
  };

  const resNan = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['ci'] },
    ghClient: fakeGhNan,
  });
  assert.strictEqual(resNan.ok, false);
  assert.strictEqual(resNan.refusal, RefusalCode.THREADS_UNRESOLVED);

  // 2. pr.unresolvedThreadsCount = -1
  const fakeGhNeg = {
    getPullRequest: async () => ({
      title: `[${workItemId}] Governed merge`,
      id: 'PR_1',
      number: 1,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
      unresolvedThreadsCount: -1,
    }),
  };

  const resNeg = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['ci'] },
    ghClient: fakeGhNeg,
  });
  assert.strictEqual(resNeg.ok, false);
  assert.strictEqual(resNeg.refusal, RefusalCode.THREADS_UNRESOLVED);

  // 3. ghClient.getReviewThreads returns NaN
  const fakeGhClientNanCount = {
    getPullRequest: async () => ({
      title: `[${workItemId}] Governed merge`,
      id: 'PR_1',
      number: 1,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
    }),
    getReviewThreads: async () => ({ unresolvedCount: NaN }),
  };

  const resClientNan = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['ci'] },
    ghClient: fakeGhClientNanCount,
  });
  assert.strictEqual(resClientNan.ok, false);
  assert.strictEqual(resClientNan.refusal, RefusalCode.THREADS_UNRESOLVED);

  // 4. ghClient.getReviewThreads returns negative
  const fakeGhClientNegCount = {
    getPullRequest: async () => ({
      title: `[${workItemId}] Governed merge`,
      id: 'PR_1',
      number: 1,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
    }),
    getReviewThreads: async () => ({ unresolvedCount: -5 }),
  };

  const resClientNeg = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['ci'] },
    ghClient: fakeGhClientNegCount,
  });
  assert.strictEqual(resClientNeg.ok, false);
  assert.strictEqual(resClientNeg.refusal, RefusalCode.THREADS_UNRESOLVED);
});

test('GM-R04: control.ps1 fails closed when node is missing or unavailable', async () => {
  const testDir = createUniqueSubdir('control-no-node');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const controlPath = path.join(__dirname, '..', '..', '..', 'scripts', 'ai', 'control.ps1');
  const ps1Script = path.join(testDir, 'test-control-no-node.ps1');

  // Point PATH to an empty dir where node does not exist
  const emptyDir = path.join(testDir, 'empty-bin');
  fs.mkdirSync(emptyDir, { recursive: true });

  fs.writeFileSync(
    ps1Script,
    `
    . "${controlPath}" -Action "Test" | Out-Null
    function Get-ShipDePullRequestByNumber {
        param([int]$Number)
        return @{ title = "[TASK-AI-133] Test PR" }
    }
    $env:SHIPDE_DECISION_DIR = "${decisionDir}"
    $env:PATH = "${emptyDir}"
    $res = Get-ShipDeExactHeadReviewManifestVerdict -HeadSha "${reviewedSha}" -PullRequestNumber 1 -RepoDir "${repoDir}"
    Write-Output "VERDICT_NO_NODE:$res"
  `,
    'utf8'
  );

  let stdout = '';
  try {
    stdout = cp.execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps1Script}"`, {
      encoding: 'utf8',
      timeout: 30000,
    });
  } catch (e) {
    stdout = e.stdout || '';
  }

  assert.ok(stdout.includes('VERDICT_NO_NODE:'), 'must execute PowerShell script');
  assert.ok(
    !stdout.includes('VERDICT_NO_NODE:PASS'),
    'control.ps1 must not return PASS without node (fail closed)'
  );
});

test('GM-R01: refusal CONFIG_INVALID when requiredChecks is omitted from config', async () => {
  const testDir = createUniqueSubdir('cfg-no-checks');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [] },
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal, RefusalCode.CONFIG_INVALID);
});

test('GM-R05: orchestrate loop after-publish calls governedMerge when autoMerge is enabled', async () => {
  const testDir = createUniqueSubdir('orchestrate-merge-loop');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  const fakeGhClient = {
    getPullRequest: async () => ({
      title: `[${workItemId}] Governed merge`,
      id: 'PR_AUTO',
      number: 105,
      isDraft: false,
      headRefOid: reviewedSha,
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: reviewedSha },
      ],
      unresolvedThreadsCount: 0,
    }),
    mergePullRequest: async () => ({
      merged: true,
      mergeCommitOid: '9'.repeat(40),
    }),
  };

  const entry = {
    workItemId,
    review: { verdict: 'PASS', findings: [] },
    verdict: 'PASS',
    findings: [],
  };
  const published = {
    status: 'published_draft',
    attempted: true,
  };

  const log = { merges: [] };
  const opts = {
    mergeAfterPublish: true,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['ci'] },
    ghClient: fakeGhClient,
  };

  if (opts.mergeAfterPublish) {
    if (isEligibleForMerge(entry, published, opts)) {
      const mergeResult = await governedMerge({
        workItemId: entry.workItemId,
        repoCwd: opts.repoCwd,
        decisionDir: opts.decisionDir,
        config: opts.config,
        ghClient: opts.ghClient,
      });
      log.merges.push(mergeResult);
      entry.merge = mergeResult;
    }
  }

  assert.strictEqual(log.merges.length, 1);
  assert.strictEqual(log.merges[0].ok, true);
  assert.strictEqual(log.merges[0].status, 'merged');
  assert.strictEqual(entry.merge.ok, true);
});

test('GM-R01: default GraphQL merge mutation path executes using ghRunner', async () => {
  const testDir = createUniqueSubdir('ghrunner-mutation');
  const { repoDir, baseSha } = initGitRepo(path.join(testDir, 'repo'));
  const reviewedSha = createReviewedCommit(repoDir, 'feat.txt', 'feature\n');
  const decisionDir = path.join(testDir, 'decisions');
  const workItemId = 'TASK-AI-133';

  createManifestAndArtifact(decisionDir, workItemId, baseSha, reviewedSha, {
    repoCwd: repoDir,
    verdict: 'PASS',
  });

  let mutationPayloadReceived = null;
  const ghRunner = (args, cwd, input) => {
    if (args.includes('api') && args.includes('graphql')) {
      const parsedInput = typeof input === 'string' ? JSON.parse(input) : input;
      if (parsedInput && parsedInput.query && parsedInput.query.includes('reviewThreads')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: [{ isResolved: true }],
                  },
                },
              },
            },
          }),
          stderr: '',
        };
      }
      if (parsedInput && parsedInput.query && parsedInput.query.includes('mergePullRequest')) {
        mutationPayloadReceived = parsedInput;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              mergePullRequest: {
                pullRequest: {
                  state: 'MERGED',
                  merged: true,
                  mergedAt: new Date().toISOString(),
                  mergeCommit: { oid: '8'.repeat(40) },
                },
              },
            },
          }),
          stderr: '',
        };
      }
    }
    if (args.includes('pr') && args.includes('list')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            title: `[${workItemId}] Test PR`,
            id: 'PR_999',
            number: 999,
            isDraft: false,
            headRefOid: reviewedSha,
            statusCheckRollup: [
              {
                name: 'test',
                conclusion: 'SUCCESS',
                headSha: reviewedSha,
              },
            ],
          },
        ]),
        stderr: '',
      };
    }
    return { exitCode: 1, stdout: '', stderr: 'Unknown mock command' };
  };

  const res = await governedMerge({
    workItemId,
    repoCwd: repoDir,
    decisionDir,
    config: { neverMerge: [], requiredChecks: ['test'] },
    repo: 'test-owner/test-repo',
    ghRunner,
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'merged');
  assert.ok(mutationPayloadReceived, 'ghRunner received GraphQL merge mutation');
  assert.strictEqual(mutationPayloadReceived.variables.input.expectedHeadOid, reviewedSha);
});

test('GM-R07: docs/product-spec/work-items/TASK-AI-133.md and register row 245 exist and match format', () => {
  const rootDir = path.join(__dirname, '..', '..', '..');
  const specPath = path.join(rootDir, 'docs', 'product-spec', 'work-items', 'TASK-AI-133.md');
  assert.ok(fs.existsSync(specPath), 'TASK-AI-133.md must exist');

  const specContent = fs.readFileSync(specPath, 'utf8');
  assert.ok(specContent.includes('## Control'));
  assert.ok(specContent.includes('## Business Outcome'));
  assert.ok(specContent.includes('## Acceptance Matrix'));
  assert.ok(specContent.includes('## Verification Commands'));
  assert.ok(specContent.includes('## Fail-Before / Pass-After'));
  assert.ok(specContent.includes('## Residual Limitations'));

  const registerPath = path.join(
    rootDir,
    'docs',
    'product-spec',
    'docs',
    '10-ai-collaboration',
    'FEATURE-DELIVERY-REGISTER.csv'
  );
  const registerContent = fs.readFileSync(registerPath, 'utf8');
  const rows = registerContent.split(/\r?\n/).filter((line) => line.includes('"TASK-AI-133"'));
  assert.strictEqual(rows.length, 1, 'exactly one register row for TASK-AI-133');

  const cols = rows[0].match(/"[^"]*"/g) || [];
  assert.strictEqual(cols.length, 14, '14-column quoted format');
  assert.strictEqual(cols[0], '"245"');
  assert.strictEqual(cols[3], '"TASK-AI-133"');
});
