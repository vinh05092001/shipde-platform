'use strict';

/**
 * Ship Dễ — TASK-AI-83: Live review manifest and publisher handoff tests.
 *
 * L-R01: buildManifest fills schema v1 using git and failure domains, without inventing verdict/findings.
 * L-R02: After each review round, human markdown artifact and JSON manifest are written next to decision log and validate.
 * L-R03: Publish passes reviewManifest and reviewArtifact; refuses on SHA mismatch, open findings, or CHANGES_REQUIRED.
 * L-R04: End-to-end in temp repo with fake reviewer: PASS + 0 findings -> publisher receives both paths; open finding -> PASS_WITH_OPEN_FINDINGS.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const reviewManifestApi = require('../review-manifest');
const publisherApi = require('../publisher');
const orchestrate = require('../orchestrate');

const WORK_ITEM = 'TASK-AI-83';
const WRITER_KEY = 'opencode-direct::opencode::router::github::acc-1::scope-1::gpt-4.1';
const REVIEWER_KEY = 'opencode-direct::cli::review-gw::openai::rev-acc::rev-scope::gpt-5-codex';

const CANDIDATES = [
  {
    harness: 'opencode-direct',
    accessPath: 'opencode',
    gateway: 'router',
    upstream: 'github',
    accountId: 'acc-1',
    quotaScope: 'scope-1',
    modelId: 'gpt-4.1',
    qualifiedRoles: ['author', 'author.foundation', 'writer'],
    quality: 90,
  },
  {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'review-gw',
    upstream: 'openai',
    accountId: 'rev-acc',
    quotaScope: 'rev-scope',
    modelId: 'gpt-5-codex',
    qualifiedRoles: ['reviewer', 'reviewer.primary'],
    quality: 80,
  },
];

const cleanupDirs = [];
after(() => {
  for (const dir of cleanupDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function makeRepo() {
  const dir = tmpDir('task-ai-83-repo-');
  const git = (args) => {
    const res = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(res.status, 0, 'git ' + args.join(' ') + ': ' + (res.stderr || res.stdout));
    return (res.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'ai-83@shipde.test']);
  git(['config', 'user.name', 'ShipDe AI83']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# ai-83 fixture\n', 'utf8');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'initial commit']);
  const base = git(['rev-parse', 'HEAD']);
  return { dir, git, base };
}

function featureCommit(repo, file) {
  const name = file || 'feature.txt';
  fs.writeFileSync(path.join(repo.dir, name), 'reviewed code change\n', 'utf8');
  repo.git(['add', name]);
  repo.git(['commit', '-q', '-m', 'feat: reviewed code change']);
  const commit = repo.git(['rev-parse', 'HEAD']);
  return { base: repo.base, commit, branch: 'feat/' + WORK_ITEM.toLowerCase() };
}

function writeArtifact(dir, name, content) {
  const file = path.join(dir, name || 'review.md');
  fs.writeFileSync(file, content || '# Review\nVerdict: PASS\n', 'utf8');
  return file;
}

test('L-R01: buildManifest fills schema v1 and never invents verdict or findings', () => {
  assert.equal(
    typeof reviewManifestApi.buildManifest,
    'function',
    'buildManifest must be exported'
  );

  const repo = makeRepo();
  const { base, commit } = featureCommit(repo);
  const artifactPath = writeArtifact(
    repo.dir,
    'review.md',
    '# Review for commit ' + commit + '\nVerdict: PASS\n'
  );

  const manifest = reviewManifestApi.buildManifest({
    repoCwd: repo.dir,
    workItemId: WORK_ITEM,
    baseSha: base,
    reviewedSha: commit,
    writerCandidateKey: WRITER_KEY,
    reviewerCandidateKey: REVIEWER_KEY,
    verdict: 'PASS',
    findings: [],
    tests: [{ command: 'node --test', result: 'pass', summary: 'all passed' }],
    artifactPath,
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.workItemId, WORK_ITEM);
  assert.equal(manifest.reviewedCommit, commit);
  assert.equal(manifest.reviewedBase, base);
  assert.equal(manifest.reviewedTree, reviewManifestApi.computeReviewedTree(repo.dir, commit));
  assert.equal(manifest.reviewedPatchId, reviewManifestApi.computePatchId(repo.dir, base, commit));
  assert.equal(manifest.artifactSha256, reviewManifestApi.sha256File(artifactPath));
  assert.equal(
    manifest.writerFailureDomain,
    publisherApi.failureDomainFromCandidateKey(WRITER_KEY)
  );
  assert.equal(
    manifest.reviewerFailureDomain,
    publisherApi.failureDomainFromCandidateKey(REVIEWER_KEY)
  );
  assert.equal(manifest.verdict, 'PASS');
  assert.deepEqual(manifest.findings, []);

  const validated = reviewManifestApi.validateManifest(manifest, {
    repoCwd: repo.dir,
    expected: { workItemId: WORK_ITEM, commit },
    artifactPath,
  });
  assert.equal(
    validated.ok,
    true,
    'built manifest must validate successfully: ' + validated.reason
  );

  // It never invents a verdict: changes required remains changes required
  const crManifest = reviewManifestApi.buildManifest({
    repoCwd: repo.dir,
    workItemId: WORK_ITEM,
    baseSha: base,
    reviewedSha: commit,
    writerCandidateKey: WRITER_KEY,
    reviewerCandidateKey: REVIEWER_KEY,
    verdict: 'CHANGES_REQUIRED',
    findings: [{ id: 'F-1', severity: 'minor', status: 'open', summary: 'needs fix' }],
    tests: [{ command: 'node --test', result: 'pass', summary: 'ok' }],
    artifactPath,
  });
  assert.equal(crManifest.verdict, 'CHANGES_REQUIRED');
  assert.equal(crManifest.findings.length, 1);
  assert.equal(crManifest.findings[0].id, 'F-1');
  assert.equal(crManifest.findings[0].status, 'open');

  // If verdict is undefined, buildManifest does not default it to PASS
  const noVerdict = reviewManifestApi.buildManifest({
    repoCwd: repo.dir,
    workItemId: WORK_ITEM,
    baseSha: base,
    reviewedSha: commit,
    writerCandidateKey: WRITER_KEY,
    reviewerCandidateKey: REVIEWER_KEY,
    verdict: undefined,
    findings: [],
    artifactPath,
  });
  assert.equal(noVerdict.verdict, undefined);
  const vRes = reviewManifestApi.validateManifest(noVerdict, { repoCwd: repo.dir, artifactPath });
  assert.equal(vRes.ok, false);
  assert.equal(vRes.code, 'SCHEMA_INVALID');
});

test('L-R02: after each review round the loop writes the markdown artifact and manifest next to decision log', async () => {
  const repo = makeRepo();
  const { base, commit } = featureCommit(repo);
  const decisionDir = tmpDir('task-ai-83-dec-');

  let reviewCallCount = 0;
  const fakeReviewer = async (sha) => {
    reviewCallCount += 1;
    return {
      pass: true,
      sha,
      verdict: 'PASS',
      reviewer: REVIEWER_KEY,
      findings: [],
    };
  };

  const fakeRunner = (job) => {
    if (job.usageFile) {
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + Date.now() }), 'utf8');
    }
    return {
      exitCode: 0,
      stdout: 'worker done',
      stderr: '',
      sessionId: 'sess-ai-83',
    };
  };

  const runResult = await orchestrate.runOrchestration('Run TASK-AI-83 goal', {
    cwd: repo.dir,
    decisionDir,
    baseSha: base,
    sha: commit,
    run: fakeRunner,
    reviewer: fakeReviewer,
    reviewerIdentity: REVIEWER_KEY,
    writerCandidateKey: WRITER_KEY,
    tests: () => ({ pass: true, command: 'node --test', exitCode: 0, detail: 'tests passed' }),
    specs: [{ id: WORK_ITEM, files: ['feature.txt'], acceptanceCriteria: ['feature implemented'] }],
    candidates: CANDIDATES,
  });

  assert.equal(reviewCallCount, 1);
  const manifestPath = path.join(decisionDir, 'review-manifest.json');
  const artifactPath = path.join(decisionDir, 'review-artifact.md');

  assert.equal(fs.existsSync(manifestPath), true, 'manifest file must exist in decisionDir');
  assert.equal(fs.existsSync(artifactPath), true, 'artifact file must exist in decisionDir');

  const validated = reviewManifestApi.validateManifestFile(manifestPath, {
    repoCwd: repo.dir,
    expected: { workItemId: WORK_ITEM, commit },
    artifactPath,
  });
  assert.equal(
    validated.ok,
    true,
    'manifest written by loop must validate against reviewed SHA: ' + validated.reason
  );
  assert.equal(validated.verdict, 'PASS');
});

test('L-R03: publish refuses with validator code on SHA mismatch, open findings, or CHANGES_REQUIRED', async () => {
  const repo = makeRepo();
  const { base, commit } = featureCommit(repo);
  const decisionDir = tmpDir('task-ai-83-dec-l03-');

  // Case A: manifest for a different SHA
  const otherRepo = makeRepo();
  const { commit: otherCommit } = featureCommit(otherRepo, 'other.txt');
  const otherArtifact = writeArtifact(otherRepo.dir, 'other-review.md');
  const otherManifestFile = path.join(decisionDir, 'other-manifest.json');
  const otherManifest = reviewManifestApi.buildManifest({
    repoCwd: otherRepo.dir,
    workItemId: WORK_ITEM,
    baseSha: otherRepo.base,
    reviewedSha: otherCommit,
    writerCandidateKey: WRITER_KEY,
    reviewerCandidateKey: REVIEWER_KEY,
    verdict: 'PASS',
    findings: [],
    tests: [{ command: 'node --test', result: 'pass', summary: 'ok' }],
    artifactPath: otherArtifact,
  });
  fs.writeFileSync(otherManifestFile, JSON.stringify(otherManifest, null, 2) + '\n');

  let published = false;
  const fakePublisher = (opts) => {
    published = true;
    return { status: 'published', sha: opts.reviewedSha };
  };

  const resMismatch = await orchestrate.runOrchestration('Run TASK-AI-83 publish mismatch', {
    cwd: repo.dir,
    decisionDir,
    baseSha: base,
    sha: commit,
    run: (job) => {
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 's-' + Date.now() }), 'utf8');
      return { exitCode: 0, stdout: 'worked', sessionId: 's1' };
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0, detail: 'ok' }),
    reviewer: async (sha) => ({
      pass: true,
      sha,
      verdict: 'PASS',
      reviewer: REVIEWER_KEY,
      findings: [],
    }),
    reviewerIdentity: REVIEWER_KEY,
    writerCandidateKey: WRITER_KEY,
    specs: [{ id: WORK_ITEM, files: ['feature.txt'] }],
    publication: {
      approvalId: 'AP-AI-83-A',
      remoteUrl: 'https://github.com/shipde/shipde-platform.git',
      branch: 'feat/ai-83',
      publish: fakePublisher,
      reviewManifest: otherManifestFile,
      reviewArtifact: otherArtifact,
    },
    candidates: CANDIDATES,
  });

  assert.equal(published, false, 'fakePublisher must not be called when manifest SHA mismatches');
  assert.equal(resMismatch.publication.status, 'REFUSED');
  assert.match(resMismatch.publication.reason, /SHA_MISMATCH/);

  // Case B: manifest with CHANGES_REQUIRED
  const crArtifact = writeArtifact(repo.dir, 'cr-review.md');
  const crManifestFile = path.join(decisionDir, 'cr-manifest.json');
  const crManifest = reviewManifestApi.buildManifest({
    repoCwd: repo.dir,
    workItemId: WORK_ITEM,
    baseSha: base,
    reviewedSha: commit,
    writerCandidateKey: WRITER_KEY,
    reviewerCandidateKey: REVIEWER_KEY,
    verdict: 'CHANGES_REQUIRED',
    findings: [{ id: 'F-1', severity: 'minor', status: 'open', summary: 'bug' }],
    tests: [{ command: 'node --test', result: 'pass', summary: 'ok' }],
    artifactPath: crArtifact,
  });
  fs.writeFileSync(crManifestFile, JSON.stringify(crManifest, null, 2) + '\n');

  const resCR = await orchestrate.runOrchestration('Run TASK-AI-83 publish CHANGES_REQUIRED', {
    cwd: repo.dir,
    decisionDir,
    baseSha: base,
    sha: commit,
    run: (job) => {
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 's-' + Date.now() }), 'utf8');
      return { exitCode: 0, stdout: 'worked', sessionId: 's2' };
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0, detail: 'ok' }),
    reviewer: async (sha) => ({
      pass: false,
      sha,
      verdict: 'CHANGES_REQUIRED',
      reviewer: REVIEWER_KEY,
      findings: [{ id: 'F-1', open: true, detail: 'bug' }],
    }),
    reviewerIdentity: REVIEWER_KEY,
    writerCandidateKey: WRITER_KEY,
    specs: [{ id: WORK_ITEM, files: ['feature.txt'] }],
    publication: {
      approvalId: 'AP-AI-83-B',
      remoteUrl: 'https://github.com/shipde/shipde-platform.git',
      branch: 'feat/ai-83',
      publish: fakePublisher,
      reviewManifest: crManifestFile,
      reviewArtifact: crArtifact,
    },
    candidates: CANDIDATES,
  });

  assert.equal(published, false);
  assert.equal(resCR.publication.status, 'REFUSED');
  assert.match(resCR.publication.reason, /VERDICT_NOT_PASS/);
});

test('L-R04: end-to-end fake reviewer PASS -> publisher receives paths; open finding -> PASS_WITH_OPEN_FINDINGS', async () => {
  const repo = makeRepo();
  const { base, commit } = featureCommit(repo);
  const decisionDir = tmpDir('task-ai-83-dec-l04-');

  let publisherArgs = null;
  const fakePublisher = (opts) => {
    publisherArgs = opts;
    return { status: 'published', sha: opts.reviewedSha };
  };

  // Subtest 1: PASS and zero findings -> publisher receives both paths
  const resPass = await orchestrate.runOrchestration('Run TASK-AI-83 e2e pass', {
    cwd: repo.dir,
    decisionDir,
    baseSha: base,
    sha: commit,
    run: (job) => {
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 's-' + Date.now() }), 'utf8');
      return { exitCode: 0, stdout: 'worked', sessionId: 's-pass' };
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0, detail: 'ok' }),
    reviewer: async (sha) => ({
      pass: true,
      sha,
      verdict: 'PASS',
      reviewer: REVIEWER_KEY,
      findings: [],
    }),
    reviewerIdentity: REVIEWER_KEY,
    writerCandidateKey: WRITER_KEY,
    specs: [{ id: WORK_ITEM, files: ['feature.txt'] }],
    publication: {
      approvalId: 'AP-AI-83-PASS',
      remoteUrl: 'https://github.com/shipde/shipde-platform.git',
      branch: 'feat/ai-83',
      publish: fakePublisher,
    },
    candidates: CANDIDATES,
  });

  assert.equal(resPass.publication.status, 'PUBLISHED_DRAFT');
  assert.ok(publisherArgs, 'fakePublisher must have been called');
  assert.ok(publisherArgs.reviewManifest, 'publisher must receive reviewManifest path');
  assert.ok(publisherArgs.reviewArtifact, 'publisher must receive reviewArtifact path');
  assert.equal(
    fs.existsSync(publisherArgs.reviewManifest),
    true,
    'manifest file must exist on disk'
  );
  assert.equal(
    fs.existsSync(publisherArgs.reviewArtifact),
    true,
    'artifact file must exist on disk'
  );

  const check = reviewManifestApi.validateManifestFile(publisherArgs.reviewManifest, {
    repoCwd: repo.dir,
    expected: { workItemId: WORK_ITEM, commit },
    artifactPath: publisherArgs.reviewArtifact,
  });
  assert.equal(check.ok, true, 'manifest received by publisher must validate against reviewed SHA');

  // Subtest 2: with an open finding -> PUBLISH refused with PASS_WITH_OPEN_FINDINGS
  const decDirFail = tmpDir('task-ai-83-dec-fail-');
  publisherArgs = null;
  const resFail = await orchestrate.runOrchestration('Run TASK-AI-83 e2e open finding', {
    cwd: repo.dir,
    decisionDir: decDirFail,
    baseSha: base,
    sha: commit,
    run: (job) => {
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 's-' + Date.now() }), 'utf8');
      return { exitCode: 0, stdout: 'worked', sessionId: 's-fail' };
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0, detail: 'ok' }),
    reviewer: async (sha) => ({
      pass: true,
      sha,
      verdict: 'PASS',
      reviewer: REVIEWER_KEY,
      findings: [{ id: 'F-OPEN-1', open: true, detail: 'security vulnerability' }],
    }),
    reviewerIdentity: REVIEWER_KEY,
    writerCandidateKey: WRITER_KEY,
    specs: [{ id: WORK_ITEM, files: ['feature.txt'] }],
    publication: {
      approvalId: 'AP-AI-83-FAIL',
      remoteUrl: 'https://github.com/shipde/shipde-platform.git',
      branch: 'feat/ai-83',
      publish: fakePublisher,
    },
    candidates: CANDIDATES,
  });

  assert.equal(publisherArgs, null, 'publisher must not be called when finding is open');
  assert.equal(resFail.publication.status, 'REFUSED');
  assert.match(resFail.publication.reason, /PASS_WITH_OPEN_FINDINGS/);
});
