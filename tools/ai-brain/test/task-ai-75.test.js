'use strict';

/**
 * TASK-AI-75 — Work-evidence importer: turn REAL merged, independently reviewed work
 * into WORK_ITEM_PASS evidence. Never fabricate.
 *
 * Rules:
 *   W-R01 sha must be exactly 40 lowercase hex, else refuse SHA_INVALID.
 *   W-R02 writer must parse as a 7-part candidate key with non-empty parts, else WRITER_KEY_INVALID.
 *   W-R03 review file must exist; line 1 must contain the full sha; line 2 must be exactly
 *         'Review verdict: PASS'; else REVIEW_NOT_PASS (or REVIEW_SHA_MISMATCH when line 1 lacks the sha).
 *   W-R04 sha must be an ancestor of (or equal to) the main ref (git merge-base --is-ancestor),
 *         else NOT_MERGED. Squash merges: also accept when the review file names the sha and the
 *         main-ref history contains a commit whose message contains '[<work-item>]' — record which path proved it (ancestor|squash).
 *   W-R05 reviewer must be non-empty and must not equal the writer key, nor share its upstream segment or modelId,
 *         else REVIEWER_NOT_INDEPENDENT.
 *   W-R06 on success call evidence.recordProbe(dir, candidate, {level: 3 (OUTCOME), proofLevel:'WORK_ITEM_PASS',
 *         status:'passed', source:'import-work', workItem, sha, reviewer, reviewFile, mergeProof})
 *         so routing proofObserved reports WORK_ITEM_PASS for that exact candidate key and no other.
 *   W-R07 idempotent: importing the same sha+writer twice adds no second item (returns ALREADY_RECORDED).
 *   W-R08 every refusal writes nothing to the evidence store; exit code 0 on success/ALREADY_RECORDED,
 *         1 on refusal, 2 on bad argv.
 *   W-R09 a test proves routing.selectCandidate/rank (whichever exists) rejects the candidate with
 *         PROOF_FLOOR_NOT_MET before import and accepts it after import with proofFloor WORK_ITEM_PASS.
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { importWorkItemPass, isGitAncestor } = require('../work-evidence');
const { evidenceCommand } = require('../cli');
const evidence = require('../evidence');
const routing = require('../routing');
const { candidateKey } = require('../discovery/identity');
const { computeReviewedTree, computePatchId, sha256File } = require('../review-manifest');
const { failureDomainFromCandidateKey } = require('../publisher');

const cleanupDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

after(() => {
  for (const d of cleanupDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function createTestGitRepo() {
  const dir = tmpDir('git-test-repo-');
  const git = (args) => {
    const res = cp.spawnSync('git', ['-c', 'safe.directory=*', ...args], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
    }
    return res.stdout ? res.stdout.trim() : '';
  };

  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@shipde.local']);
  git(['config', 'user.name', 'Ship De Test']);
  git(['config', 'commit.gpgsign', 'false']);

  fs.writeFileSync(path.join(dir, 'README.md'), '# Test repo\n', 'utf8');
  git(['add', 'README.md']);
  git(['commit', '-m', 'initial commit']);

  return { dir, git };
}

function writeReview(dir, filename, sha, verdict = 'PASS') {
  const filePath = path.join(dir, filename);
  const content = `# Independent review for commit ${sha}\nReview verdict: ${verdict}\n\nEvidence and notes.\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// TASK-AI-77: the import is now authorised by a structured review manifest, so
// every fixture below that imports a review also writes the manifest that binds
// it (W-R04 base..commit, tree and the sha256 of the same markdown file). No
// assertion below changed: each test still proves the behaviour it proved.
function writeManifest(repo, opts) {
  const writer = opts.writer || VALID_WRITER;
  const reviewer =
    opts.reviewer || 'codex::cli::review-gw::openai::rev-acc::rev-scope::gpt-5-codex';
  const manifest = {
    schemaVersion: 1,
    workItemId: opts.workItem || 'TASK-AI-75',
    reviewedCommit: opts.commit,
    reviewedBase: opts.base,
    reviewedTree: computeReviewedTree(repo.dir, opts.commit),
    reviewedPatchId: computePatchId(repo.dir, opts.base, opts.commit),
    reviewerCandidateKey: reviewer,
    writerCandidateKey: writer,
    writerFailureDomain: failureDomainFromCandidateKey(writer),
    reviewerFailureDomain: failureDomainFromCandidateKey(reviewer),
    verdict: opts.verdict || 'PASS',
    findings: [],
    tests: [{ command: 'node --test', result: 'pass', summary: 'green' }],
    artifactSha256: sha256File(opts.review),
    createdAt: '2026-10-04T00:00:00.000Z',
  };
  const filePath = path.join(repo.dir, opts.filename || 'review-manifest.json');
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return filePath;
}

/**
 * One reviewed commit on its own branch, merged into main with the [<work-item>]
 * title and the reviewed patch (W-R04 ancestor path, M-R08).
 */
function mergeReviewedWork(repo, workItem) {
  const base = repo.git(['rev-parse', 'HEAD']);
  repo.git(['checkout', '-b', 'feat/reviewed']);
  fs.writeFileSync(path.join(repo.dir, 'reviewed.txt'), 'reviewed work\n', 'utf8');
  repo.git(['add', 'reviewed.txt']);
  repo.git(['commit', '-m', 'feat: reviewed work item']);
  const commit = repo.git(['rev-parse', 'HEAD']);
  repo.git(['checkout', 'main']);
  repo.git(['merge', '--no-ff', '-m', `[${workItem}] Merge reviewed work item`, 'feat/reviewed']);
  return { commit, base };
}

const VALID_WRITER = 'openclaw::opencode::router::github::acc-1::scope-1::gpt-4.1';

describe('TASK-AI-75: Work-evidence importer', () => {
  test('W-R01: sha must be exactly 40 lowercase hex, else refuse SHA_INVALID', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r01-');
    const review = writeReview(repo.dir, 'rev.md', '1111111111111111111111111111111111111111');

    // short sha
    const r1 = importWorkItemPass({
      sha: '1234567890abcdef1234567890abcdef1234567',
      writer: VALID_WRITER,
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'SHA_INVALID');

    // uppercase hex
    const r2 = importWorkItemPass({
      sha: '1234567890ABCDEF1234567890ABCDEF12345678',
      writer: VALID_WRITER,
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'SHA_INVALID');

    // non-hex character
    const r3 = importWorkItemPass({
      sha: '1234567890abcdef1234567890abcdef1234567z',
      writer: VALID_WRITER,
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r3.ok, false);
    assert.equal(r3.code, 'SHA_INVALID');

    // empty or non-string
    const r4 = importWorkItemPass({
      sha: '',
      writer: VALID_WRITER,
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r4.ok, false);
    assert.equal(r4.code, 'SHA_INVALID');
  });

  test('W-R02: writer must parse as a 7-part candidate key with non-empty parts, else WRITER_KEY_INVALID', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r02-');
    const sha = '1111111111111111111111111111111111111111';
    const review = writeReview(repo.dir, 'rev.md', sha);

    // 6 parts
    const r1 = importWorkItemPass({
      sha,
      writer: 'openclaw::opencode::router::github::acc-1::gpt-4.1',
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'WRITER_KEY_INVALID');

    // 8 parts
    const r2 = importWorkItemPass({
      sha,
      writer: 'openclaw::opencode::router::github::acc-1::scope-1::gpt-4.1::extra',
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'WRITER_KEY_INVALID');

    // empty part (empty gateway)
    const r3 = importWorkItemPass({
      sha,
      writer: 'openclaw::opencode::::github::acc-1::scope-1::gpt-4.1',
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r3.ok, false);
    assert.equal(r3.code, 'WRITER_KEY_INVALID');

    // whitespace-only part
    const r4 = importWorkItemPass({
      sha,
      writer: 'openclaw::opencode::  ::github::acc-1::scope-1::gpt-4.1',
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r4.ok, false);
    assert.equal(r4.code, 'WRITER_KEY_INVALID');

    // non-string
    const r5 = importWorkItemPass({
      sha,
      writer: null,
      review,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r5.ok, false);
    assert.equal(r5.code, 'WRITER_KEY_INVALID');
  });

  test('W-R03: review file must exist; line 1 must contain full sha; line 2 must be exactly "Review verdict: PASS"', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r03-');
    const sha = '1111111111111111111111111111111111111111';

    // M-R07: the markdown review alone is no longer evidence.
    const proseOnly = writeReview(repo.dir, 'rev-prose.md', sha);
    const noManifest = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review: proseOnly,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(noManifest.ok, false);
    assert.equal(noManifest.code, 'MANIFEST_REQUIRED');

    // File does not exist
    const missingReview = writeReview(repo.dir, 'rev-present.md', sha);
    const missingManifest = writeManifest(repo, {
      commit: sha,
      base: repo.git(['rev-parse', 'HEAD']),
      review: missingReview,
    });
    const r1 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review: path.join(repo.dir, 'non-existent.md'),
      manifest: missingManifest,
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'REVIEW_NOT_PASS');

    // Line 1 missing sha -> REVIEW_SHA_MISMATCH
    const mismatchFile = path.join(repo.dir, 'rev-mismatch.md');
    fs.writeFileSync(
      mismatchFile,
      '# Review for commit 2222222222222222222222222222222222222222\nReview verdict: PASS\n',
      'utf8'
    );
    const r2 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review: mismatchFile,
      manifest: writeManifest(repo, {
        commit: sha,
        base: repo.git(['rev-parse', 'HEAD']),
        review: mismatchFile,
        filename: 'rev-mismatch.manifest.json',
      }),
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'REVIEW_SHA_MISMATCH');

    // Line 2 is not "Review verdict: PASS" -> REVIEW_NOT_PASS
    const failFile = writeReview(repo.dir, 'rev-fail.md', sha, 'FAIL');
    const r3 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review: failFile,
      manifest: writeManifest(repo, {
        commit: sha,
        base: repo.git(['rev-parse', 'HEAD']),
        review: failFile,
        filename: 'rev-fail.manifest.json',
      }),
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r3.ok, false);
    assert.equal(r3.code, 'REVIEW_NOT_PASS');

    // Line 2 has extra whitespace -> REVIEW_NOT_PASS
    const spaceFile = path.join(repo.dir, 'rev-space.md');
    fs.writeFileSync(spaceFile, `# Review for commit ${sha}\nReview verdict: PASS \n`, 'utf8');
    const r4 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review: spaceFile,
      manifest: writeManifest(repo, {
        commit: sha,
        base: repo.git(['rev-parse', 'HEAD']),
        review: spaceFile,
        filename: 'rev-space.manifest.json',
      }),
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r4.ok, false);
    assert.equal(r4.code, 'REVIEW_NOT_PASS');
  });

  test('W-R04: sha must be ancestor of main ref, or squash merge with [<work-item>] commit on main', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r04-');

    // 1. Create an unmerged commit on another branch
    repo.git(['checkout', '-b', 'unmerged-branch']);
    fs.writeFileSync(path.join(repo.dir, 'unmerged.txt'), 'unmerged\n', 'utf8');
    repo.git(['add', 'unmerged.txt']);
    repo.git(['commit', '-m', 'unmerged commit']);
    const unmergedSha = repo.git(['rev-parse', 'HEAD']);
    repo.git(['checkout', 'main']);

    const unmergedReview = writeReview(repo.dir, 'rev-unmerged.md', unmergedSha);
    const r1 = importWorkItemPass({
      sha: unmergedSha,
      writer: VALID_WRITER,
      review: unmergedReview,
      manifest: writeManifest(repo, {
        commit: unmergedSha,
        base: repo.git(['rev-parse', unmergedSha + '^']),
        review: unmergedReview,
        filename: 'rev-unmerged.manifest.json',
      }),
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'NOT_MERGED');

    // 2. Ancestor merge path: commit merged directly into main
    repo.git(['checkout', '-b', 'feat/task-ai-ancestor']);
    const ancestorBase = repo.git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repo.dir, 'ancestor.txt'), 'ancestor\n', 'utf8');
    repo.git(['add', 'ancestor.txt']);
    repo.git(['commit', '-m', 'feat: ancestor commit']);
    const ancestorSha = repo.git(['rev-parse', 'HEAD']);
    repo.git(['checkout', 'main']);
    repo.git([
      'merge',
      '--no-ff',
      '-m',
      '[TASK-AI-75] Merge feature branch',
      'feat/task-ai-ancestor',
    ]);

    const ancestorReview = writeReview(repo.dir, 'rev-ancestor.md', ancestorSha);
    const r2 = importWorkItemPass({
      sha: ancestorSha,
      writer: VALID_WRITER,
      review: ancestorReview,
      manifest: writeManifest(repo, {
        commit: ancestorSha,
        base: ancestorBase,
        review: ancestorReview,
        filename: 'rev-ancestor.manifest.json',
      }),
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.status, 'IMPORTED');
    assert.equal(r2.mergeProof, 'ancestor');

    // 3. Squash merge path: feature commit squashed onto main with [<work-item>] in commit message
    repo.git(['checkout', '-b', 'feat/task-ai-squash']);
    const squashBase = repo.git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repo.dir, 'squash.txt'), 'squash feature content\n', 'utf8');
    repo.git(['add', 'squash.txt']);
    repo.git(['commit', '-m', 'feat: pre-squash commit']);
    const squashFeatureSha = repo.git(['rev-parse', 'HEAD']);
    repo.git(['checkout', 'main']);
    repo.git(['merge', '--squash', 'feat/task-ai-squash']);
    repo.git(['commit', '-m', '[TASK-AI-75] Squashed work item pass importer']);

    // Check that squashFeatureSha is NOT an ancestor of main
    assert.equal(isGitAncestor(squashFeatureSha, 'main', repo.dir), false);
    // Review file names squashFeatureSha
    const squashReview = writeReview(repo.dir, 'rev-squash.md', squashFeatureSha);
    const evDirSquash = tmpDir('ev-r04-squash-');
    const r3 = importWorkItemPass({
      sha: squashFeatureSha,
      writer: VALID_WRITER,
      review: squashReview,
      manifest: writeManifest(repo, {
        commit: squashFeatureSha,
        base: squashBase,
        review: squashReview,
        filename: 'rev-squash.manifest.json',
      }),
      reviewer: 'codex-reviewer',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDirSquash,
      cwd: repo.dir,
    });
    assert.equal(r3.ok, true);
    assert.equal(r3.status, 'IMPORTED');
    assert.equal(r3.mergeProof, 'squash');
  });

  test('W-R05: reviewer must be non-empty and must not equal writer key, nor share upstream segment or modelId', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r05-');
    const reviewed = mergeReviewedWork(repo, 'TASK-AI-75');
    const sha = reviewed.commit;
    const review = writeReview(repo.dir, 'rev.md', sha);
    const manifest = writeManifest(repo, {
      commit: reviewed.commit,
      base: reviewed.base,
      review,
      filename: 'rev.manifest.json',
    });
    // writer is: openclaw::opencode::router::github::acc-1::scope-1::gpt-4.1
    // upstream is 'github', modelId is 'gpt-4.1'

    // Empty reviewer
    const r1 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: '',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'REVIEWER_NOT_INDEPENDENT');

    // Reviewer equals writer key
    const r2 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: VALID_WRITER,
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'REVIEWER_NOT_INDEPENDENT');

    // Reviewer shares upstream segment ('github') via candidate key
    const r3 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'paseo::opencode::router::github::acc-2::scope-2::claude-3-5',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r3.ok, false);
    assert.equal(r3.code, 'REVIEWER_NOT_INDEPENDENT');

    // Reviewer shares modelId ('gpt-4.1') via candidate key
    const r4 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'paseo::opencode::router::openai::acc-2::scope-2::gpt-4.1',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r4.ok, false);
    assert.equal(r4.code, 'REVIEWER_NOT_INDEPENDENT');

    // Reviewer identity string equals upstream segment
    const r5 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'github',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r5.ok, false);
    assert.equal(r5.code, 'REVIEWER_NOT_INDEPENDENT');

    // Reviewer identity string equals modelId
    const r6 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'gpt-4.1',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r6.ok, false);
    assert.equal(r6.code, 'REVIEWER_NOT_INDEPENDENT');

    // Independent reviewer: different upstream and modelId
    const r7 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'chatgpt-codex-connector[bot]',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r7.ok, true);
    assert.equal(r7.status, 'IMPORTED');
  });

  test('W-R06: on success call evidence.recordProbe so routing proofObserved reports WORK_ITEM_PASS for exact candidate', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r06-');
    const reviewed = mergeReviewedWork(repo, 'TASK-AI-75');
    const sha = reviewed.commit;
    const review = writeReview(repo.dir, 'rev.md', sha);
    const manifest = writeManifest(repo, {
      commit: reviewed.commit,
      base: reviewed.base,
      review,
      filename: 'rev.manifest.json',
    });

    const r = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'independent-codex',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });

    assert.equal(r.ok, true);
    assert.equal(r.status, 'IMPORTED');

    // Verify record in evidence store
    const evData = evidence.loadEvidence(evDir);
    const writerCand = {
      harness: 'openclaw',
      accessPath: 'opencode',
      gateway: 'router',
      upstream: 'github',
      account: 'acc-1',
      accountId: 'acc-1',
      quotaScope: 'scope-1',
      modelId: 'gpt-4.1',
      model: 'gpt-4.1',
    };
    const items = evidence.getEvidence(evData, writerCand);
    assert.equal(items.length, 1);
    const item = items[0];
    assert.equal(item.level, 3);
    assert.equal(item.proofLevel, 'WORK_ITEM_PASS');
    assert.equal(item.status, 'passed');
    assert.equal(item.source, 'import-work');
    assert.equal(item.workItem, 'TASK-AI-75');
    assert.equal(item.sha, sha);
    assert.equal(item.reviewer, 'independent-codex');
    assert.equal(item.mergeProof, 'ancestor');

    // routing.proofObserved reports WORK_ITEM_PASS for exact candidate key
    const observed = routing.proofObserved(evData, writerCand);
    assert.equal(observed, 'WORK_ITEM_PASS');

    // other candidate receives null
    const otherCand = {
      harness: 'paseo',
      accessPath: 'opencode',
      gateway: 'router',
      upstream: 'github',
      account: 'acc-1',
      accountId: 'acc-1',
      quotaScope: 'scope-1',
      modelId: 'gpt-4.1',
    };
    assert.equal(routing.proofObserved(evData, otherCand), null);
  });

  test('W-R07: idempotent: importing same sha+writer twice adds no second item (returns ALREADY_RECORDED)', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r07-');
    const reviewed = mergeReviewedWork(repo, 'TASK-AI-75');
    const sha = reviewed.commit;
    const review = writeReview(repo.dir, 'rev.md', sha);
    const manifest = writeManifest(repo, {
      commit: reviewed.commit,
      base: reviewed.base,
      review,
      filename: 'rev.manifest.json',
    });

    // First import
    const r1 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'independent-codex',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.status, 'IMPORTED');

    // Second import with same sha + writer
    const r2 = importWorkItemPass({
      sha,
      writer: VALID_WRITER,
      review,
      manifest,
      reviewer: 'independent-codex',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.status, 'ALREADY_RECORDED');
    assert.equal(r2.code, 'ALREADY_RECORDED');

    // Evidence store still has exactly 1 item
    const evData = evidence.loadEvidence(evDir);
    const writerCand = {
      harness: 'openclaw',
      accessPath: 'opencode',
      gateway: 'router',
      upstream: 'github',
      account: 'acc-1',
      accountId: 'acc-1',
      quotaScope: 'scope-1',
      modelId: 'gpt-4.1',
    };
    const items = evidence.getEvidence(evData, writerCand);
    assert.equal(items.length, 1);
  });

  test('W-R08: every refusal writes nothing to evidence store; exit code 0 on success/ALREADY_RECORDED, 1 on refusal, 2 on bad argv', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r08-');
    const reviewed = mergeReviewedWork(repo, 'TASK-AI-75');
    const sha = reviewed.commit;
    const review = writeReview(repo.dir, 'rev.md', sha);
    const manifest = writeManifest(repo, {
      commit: reviewed.commit,
      base: reviewed.base,
      review,
      filename: 'rev.manifest.json',
    });

    // Verify refusals write nothing
    const refusals = [
      { sha: 'bad-sha', writer: VALID_WRITER, review, reviewer: 'codex', workItem: 'TASK-AI-75' },
      { sha, writer: 'bad-writer', review, reviewer: 'codex', workItem: 'TASK-AI-75' },
      {
        sha,
        writer: VALID_WRITER,
        review: 'nonexistent.md',
        reviewer: 'codex',
        workItem: 'TASK-AI-75',
      },
      { sha, writer: VALID_WRITER, review, reviewer: VALID_WRITER, workItem: 'TASK-AI-75' },
    ];
    for (const badOpts of refusals) {
      const res = importWorkItemPass(
        Object.assign({}, badOpts, { mainRef: 'main', evidenceDir: evDir, cwd: repo.dir })
      );
      assert.equal(res.ok, false);
      assert.equal(fs.existsSync(path.join(evDir, 'evidence.json')), false);
    }

    // CLI tests via evidenceCommand with injected exit/log/error
    const logs = [];
    const errors = [];
    let exitCode = null;
    const testDeps = {
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (code) => {
        exitCode = code;
      },
      rootDir: repo.dir,
      evidenceDir: evDir,
    };

    // 1. Bad argv: unknown subcommand -> exit 2
    exitCode = null;
    const cliBadSub = evidenceCommand({ _: ['evidence', 'unknown-sub'] }, testDeps);
    assert.equal(exitCode, 2);
    assert.equal(cliBadSub.exitCode, 2);

    // 2. Bad argv: missing required args -> exit 2
    exitCode = null;
    const cliMissingArgs = evidenceCommand({ _: ['evidence', 'import-work'], sha }, testDeps);
    assert.equal(exitCode, 2);
    assert.equal(cliMissingArgs.exitCode, 2);

    // 3. Refusal via CLI -> exit 1
    exitCode = null;
    const cliRefusal = evidenceCommand(
      {
        _: ['evidence', 'import-work'],
        sha: 'bad-sha',
        writer: VALID_WRITER,
        review,
        manifest,
        reviewer: 'codex',
        'work-item': 'TASK-AI-75',
        'main-ref': 'main',
        'evidence-dir': evDir,
      },
      testDeps
    );
    assert.equal(exitCode, 1);
    assert.equal(cliRefusal.exitCode, 1);

    // 4. Success via CLI -> exit 0
    exitCode = null;
    const cliSuccess = evidenceCommand(
      {
        _: ['evidence', 'import-work'],
        sha,
        writer: VALID_WRITER,
        review,
        manifest,
        reviewer: 'independent-codex',
        'work-item': 'TASK-AI-75',
        'main-ref': 'main',
        'evidence-dir': evDir,
      },
      testDeps
    );
    assert.equal(exitCode, 0);
    assert.equal(cliSuccess.exitCode, 0);

    // 5. ALREADY_RECORDED via CLI -> exit 0
    exitCode = null;
    const cliAlready = evidenceCommand(
      {
        _: ['evidence', 'import-work'],
        sha,
        writer: VALID_WRITER,
        review,
        manifest,
        reviewer: 'independent-codex',
        'work-item': 'TASK-AI-75',
        'main-ref': 'main',
        'evidence-dir': evDir,
        json: true,
      },
      testDeps
    );
    assert.equal(exitCode, 0);
    assert.equal(cliAlready.exitCode, 0);
    assert.equal(cliAlready.result.status, 'ALREADY_RECORDED');
  });

  test('W-R09: routing rank rejects candidate with PROOF_FLOOR_NOT_MET before import and accepts it after import with proofFloor WORK_ITEM_PASS', async () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-r09-');
    const reviewed = mergeReviewedWork(repo, 'TASK-AI-75');
    const sha = reviewed.commit;
    const review = writeReview(repo.dir, 'rev.md', sha);
    const manifest = writeManifest(repo, {
      commit: reviewed.commit,
      base: reviewed.base,
      review,
      filename: 'rev.manifest.json',
    });

    const candidate = {
      harness: 'openclaw',
      accessPath: 'opencode',
      gateway: 'router',
      upstream: 'github',
      account: 'acc-1',
      accountId: 'acc-1',
      quotaScope: 'scope-1',
      modelId: 'gpt-4.1',
      model: 'gpt-4.1',
      quality: 95,
      cost: 1,
      contextWindow: 16384,
      capabilities: { text: true },
    };
    const key = candidateKey(candidate);
    assert.equal(key, VALID_WRITER);

    const taskProfile = {
      taskId: 'TASK-AI-75',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: ['text'],
      proofFloor: 'WORK_ITEM_PASS',
      contextSize: 2000,
      expectedDuration: 1000,
      latencyPriority: 'normal',
      qualityFloor: 50,
      costCeiling: 1000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 10,
      currentWorkload: 0,
    };

    const assessment = await routing.assessTask(taskProfile);

    // BEFORE IMPORT: ranking rejects candidate with PROOF_FLOOR_NOT_MET:NONE
    const ctxBefore = {
      evidenceData: evidence.loadEvidence(evDir),
      now: Date.now(),
    };
    const rankBefore = routing.rankForProfile([candidate], taskProfile, assessment, ctxBefore);
    assert.equal(rankBefore.chosen, null);
    const rejection = rankBefore.rejected.find((r) => r.candidateKey === key);
    assert.ok(rejection, 'candidate must be rejected before import');
    assert.equal(rejection.reasonCode, 'PROOF_FLOOR_NOT_MET:NONE');

    // PERFORM IMPORT
    const importRes = importWorkItemPass({
      sha,
      writer: key,
      review,
      manifest,
      reviewer: 'independent-codex',
      workItem: 'TASK-AI-75',
      mainRef: 'main',
      evidenceDir: evDir,
      cwd: repo.dir,
    });
    assert.equal(importRes.ok, true);
    assert.equal(importRes.status, 'IMPORTED');

    // AFTER IMPORT: ranking accepts candidate with proofFloor WORK_ITEM_PASS
    const ctxAfter = {
      evidenceData: evidence.loadEvidence(evDir),
      now: Date.now(),
    };
    const rankAfter = routing.rankForProfile([candidate], taskProfile, assessment, ctxAfter);
    assert.equal(rankAfter.chosen, key);
    const rejectionAfter = rankAfter.rejected.find((r) => r.candidateKey === key);
    assert.equal(rejectionAfter, undefined, 'candidate must not be rejected after import');
  });

  test('CLI end-to-end process execution', () => {
    const repo = createTestGitRepo();
    const evDir = tmpDir('ev-cli-proc-');
    const reviewed = mergeReviewedWork(repo, 'TASK-AI-75');
    const sha = reviewed.commit;
    const review = writeReview(repo.dir, 'rev.md', sha);
    const manifest = writeManifest(repo, {
      commit: reviewed.commit,
      base: reviewed.base,
      review,
      filename: 'rev.manifest.json',
    });
    const cliPath = path.resolve(__dirname, '..', 'cli.js');

    // Test successful CLI execution via node subprocess
    const procSuccess = cp.spawnSync(
      process.execPath,
      [
        cliPath,
        'evidence',
        'import-work',
        '--sha',
        sha,
        '--writer',
        VALID_WRITER,
        '--review',
        review,
        '--manifest',
        manifest,
        '--reviewer',
        'independent-codex',
        '--work-item',
        'TASK-AI-75',
        '--main-ref',
        'main',
        '--evidence-dir',
        evDir,
        '--json',
      ],
      { cwd: repo.dir, encoding: 'utf8', windowsHide: true }
    );
    assert.equal(procSuccess.status, 0);
    const parsed = JSON.parse(procSuccess.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, 'IMPORTED');

    // Test CLI refusal exit code 1
    const procRefusal = cp.spawnSync(
      process.execPath,
      [
        cliPath,
        'evidence',
        'import-work',
        '--sha',
        'bad-sha',
        '--writer',
        VALID_WRITER,
        '--review',
        review,
        '--manifest',
        manifest,
        '--reviewer',
        'independent-codex',
        '--work-item',
        'TASK-AI-75',
        '--main-ref',
        'main',
        '--evidence-dir',
        evDir,
      ],
      { cwd: repo.dir, encoding: 'utf8', windowsHide: true }
    );
    assert.equal(procRefusal.status, 1);

    // Test CLI bad argv exit code 2
    const procBadArgv = cp.spawnSync(process.execPath, [cliPath, 'evidence', 'import-work'], {
      cwd: repo.dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(procBadArgv.status, 2);
  });
});
