'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const publisher = require('../publisher');
const reviewManifest = require('../review-manifest');
const orchestrate = require('../orchestrate');

const WORK_ITEM = 'TASK-AI-102';
const WRITER = 'paseo::opencode::router::github::author::scope::writer-model';
const REVIEWER = 'paseo::cli::review-gw::openai::reviewer::scope::review-model';
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeRepo() {
  const dir = tmpDir('task-ai-102-repo-');
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-102@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-102 test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'reviewed\n');
  git(['add', 'feature.txt']);
  git(['commit', '-q', '-m', 'reviewed']);
  return { dir, base, commit: git(['rev-parse', 'HEAD']), git };
}

function reviewFixture() {
  const repo = makeRepo();
  const decisionDir = tmpDir('task-ai-102-decisions-');
  const artifactPath = path.join(decisionDir, 'review-artifact.md');
  const manifestPath = path.join(decisionDir, 'review-manifest.json');
  fs.writeFileSync(artifactPath, '# Review\nPASS\n');
  const manifest = reviewManifest.buildManifest({
    repoCwd: repo.dir,
    workItemId: WORK_ITEM,
    baseSha: repo.base,
    reviewedSha: repo.commit,
    writerCandidateKey: WRITER,
    reviewerCandidateKey: REVIEWER,
    verdict: 'PASS',
    findings: [{ id: 'F-1', severity: 'low', status: 'resolved', summary: 'closed' }],
    tests: [{ command: 'node --test', result: 'pass', summary: 'all green' }],
    artifactPath,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...repo, decisionDir, artifactPath, manifestPath, manifest };
}

function publishOptions(fixture, extra) {
  return Object.assign(
    {
      cwd: fixture.dir,
      reviewedSha: fixture.commit,
      approvalId: 'AP-TASK-AI-102',
      expiry: Date.now() + 60000,
      verdict: 'PASS',
      remoteUrl: 'https://github.com/example/repository.git',
      branch: 'feat/task-ai-102-governed-draft',
      workItemId: WORK_ITEM,
      reviewManifest: fixture.manifestPath,
      reviewArtifact: fixture.artifactPath,
      registryPath: path.join(fixture.decisionDir, 'missing-approvals.json'),
      decisionDir: fixture.decisionDir,
      testMode: true,
      draft: {
        workItemId: WORK_ITEM,
        outcome: 'Carry reviewed evidence into draft pull requests',
        decisionEvidence: fixture.decisionDir,
        failBefore: { command: 'node --test tools/ai-brain/test/task-ai-102.test.js', exitCode: 1 },
      },
    },
    extra || {}
  );
}

test('PB-R01: orchestration merges caller title fields with manifest and checkpoint evidence', async () => {
  const fixture = makeRepo();
  const decisionDir = tmpDir('task-ai-102-orchestrate-');
  let publisherOptions;
  const result = await orchestrate.runOrchestration('Preserve draft review evidence', {
    cwd: fixture.dir,
    decisionDir,
    baseSha: fixture.base,
    sha: fixture.commit,
    run: (job) => {
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'writer-1' }));
      return {
        exitCode: 0,
        stdout: JSON.stringify({ session_id: 'writer-1' }),
        sessionId: 'writer-1',
      };
    },
    tests: () => ({ pass: true, command: 'node --test', exitCode: 0, detail: 'pass-after green' }),
    reviewer: async (sha) => ({
      pass: true,
      sha,
      verdict: 'PASS',
      reviewer: REVIEWER,
      findings: [],
    }),
    reviewerIdentity: REVIEWER,
    writerCandidateKey: WRITER,
    specs: [
      {
        id: WORK_ITEM,
        businessOutcome: 'Preserve reviewed draft evidence',
        verification: { command: 'node --test tools/ai-brain/test/task-ai-102.test.js' },
      },
    ],
    measureFailBefore: (cwd, baseSha, reviewedSha, command) => ({ command, exitCode: 1 }),
    publication: {
      approvalId: 'AP-TASK-AI-102',
      remoteUrl: 'https://github.com/example/repository.git',
      branch: 'feat/task-ai-102-governed-draft',
      draft: { workItemId: WORK_ITEM, outcome: 'Caller business outcome' },
      publish: (options) => {
        publisherOptions = options;
        return { status: 'published' };
      },
    },
    candidates: [
      {
        harness: 'paseo',
        accessPath: 'opencode',
        gateway: 'router',
        upstream: 'github',
        accountId: 'author',
        quotaScope: 'scope',
        modelId: 'writer-model',
        qualifiedRoles: ['author.foundation'],
        quality: 100,
      },
      {
        harness: 'paseo',
        accessPath: 'cli',
        gateway: 'review-gw',
        upstream: 'openai',
        accountId: 'reviewer',
        quotaScope: 'scope',
        modelId: 'review-model',
        qualifiedRoles: ['reviewer'],
        quality: 80,
      },
    ],
  });

  assert.equal(result.publication.status, 'PUBLISHED_DRAFT', JSON.stringify(result, null, 2));
  assert.ok(publisherOptions);
  assert.equal(publisherOptions.draft.workItemId, WORK_ITEM);
  assert.equal(publisherOptions.draft.outcome, 'Caller business outcome');
  assert.equal(publisherOptions.draft.writerCandidateKey, WRITER);
  assert.equal(publisherOptions.draft.reviewerCandidateKey, REVIEWER);
  assert.equal(publisherOptions.draft.verdict, 'PASS');
  assert.deepEqual(publisherOptions.draft.findings, []);
  assert.equal(publisherOptions.draft.tests[0].result, 'pass');
  assert.equal(publisherOptions.draft.reviewManifest, publisherOptions.reviewManifest);
  assert.equal(publisherOptions.draft.reviewArtifact, publisherOptions.reviewArtifact);
  assert.equal(publisherOptions.draft.decisionEvidence, decisionDir);
});

test('PB-R02: draft publication refuses missing reviewer or decision evidence', () => {
  const fixture = reviewFixture();
  const missingReviewer = {
    ...fixture.manifest,
    reviewerCandidateKey: undefined,
  };
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(missingReviewer));
  assert.throws(
    () => publisher.publish(publishOptions(fixture)),
    /PUBLISH_REFUSED:.*reviewerCandidateKey|PUBLISH_REFUSED:.*reviewer candidate/i
  );

  fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  assert.throws(
    () =>
      publisher.publish(
        publishOptions(fixture, {
          draft: {
            ...publishOptions(fixture).draft,
            decisionEvidence: path.join(fixture.decisionDir, 'absent'),
          },
        })
      ),
    /PUBLISH_REFUSED:.*decision evidence/i
  );
});

test('PB-R04: PASS draft publication refuses a manifest with an open finding', () => {
  const fixture = reviewFixture();
  const openManifest = {
    ...fixture.manifest,
    findings: [{ id: 'F-OPEN', severity: 'high', status: 'open', summary: 'unresolved' }],
  };
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(openManifest));
  assert.throws(
    () => publisher.publish(publishOptions(fixture)),
    /PUBLISH_REFUSED:.*PASS_WITH_OPEN_FINDINGS/
  );
});

test('PB-R05: generated draft body satisfies PR headings and carries reviewed evidence', () => {
  const fixture = reviewFixture();
  const argsSeen = [];
  const body = publisher.buildDraftBody(fixture.manifest, {
    workItemId: WORK_ITEM,
    outcome: 'Carry reviewed evidence into draft pull requests',
    reviewedSha: fixture.commit,
    reviewManifest: fixture.manifestPath,
    reviewArtifact: fixture.artifactPath,
    decisionEvidence: fixture.decisionDir,
    failBefore: { command: 'node --test tools/ai-brain/test/task-ai-102.test.js', exitCode: 1 },
  });
  const headings = [
    '## Work Item',
    '## Source requirements',
    '## Scope integrity',
    '## Implementation',
    '## Acceptance evidence',
    '## Verification',
    '## Safety and recovery',
    '## Documentation and traceability',
    '## Risks and limitations',
    '## Codex review',
  ];
  for (const heading of headings) assert.ok(body.includes(heading), 'contains ' + heading);
  assert.ok(body.includes('Review status: READY_FOR_CODEX'));
  assert.ok(body.includes('Reviewed commit: ' + fixture.commit));
  assert.ok(body.includes(WRITER));
  assert.ok(body.includes(REVIEWER));
  assert.ok(body.includes('node --test tools/ai-brain/test/task-ai-102.test.js exited 1'));
  assert.ok(body.includes('node --test -> pass (all green)'));
  assert.ok(body.includes(fixture.manifestPath));
  assert.ok(body.includes(fixture.decisionDir));

  const spawn = (args) => {
    argsSeen.push(args);
    if (args[0] === 'pr' && args[1] === 'list') return { exitCode: 0, stdout: '[]', stderr: '' };
    if (args[0] === 'pr' && args[1] === 'create')
      return { exitCode: 0, stdout: 'https://github.com/example/repository/pull/123', stderr: '' };
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        isDraft: true,
        headRefOid: fixture.commit,
        title: '[TASK-AI-102] reviewed evidence',
      }),
      stderr: '',
    };
  };
  publisher.createDraftPullRequest({
    ...publishOptions(fixture).draft,
    remoteUrl: 'https://github.com/example/repository.git',
    branch: 'feat/task-ai-102-governed-draft',
    reviewedSha: fixture.commit,
    manifest: fixture.manifest,
    reviewManifest: fixture.manifestPath,
    reviewArtifact: fixture.artifactPath,
    ghRun: spawn,
  });
  const createArgs = argsSeen.find((args) => args[0] === 'pr' && args[1] === 'create');
  assert.ok(createArgs);
  assert.equal(createArgs[createArgs.indexOf('--body') + 1], body);
});
