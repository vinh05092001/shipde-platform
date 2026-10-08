'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const publisher = require('../publisher');
const reviewManifest = require('../review-manifest');
const routing = require('../routing');

const WORK_ITEM = 'TASK-AI-104';
const WRITER = 'harness-a::access-a::gateway-a::upstream-a::account-a::scope-a::model-a';
const REVIEWER = 'harness-b::access-b::gateway-b::upstream-b::account-b::scope-b::model-b';
const REGISTER = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeRepo(registerWorkItem = true, registerContents, workItemId = WORK_ITEM) {
  const dir = tmpDir('task-ai-104-repo-');
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
  git(['config', 'user.email', 'task-ai-104@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-104 test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  fs.mkdirSync(path.dirname(path.join(dir, REGISTER)), { recursive: true });
  fs.writeFileSync(
    path.join(dir, REGISTER),
    registerContents ||
      '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"\n' +
        (registerWorkItem
          ? `"218","S00","AI workflow","${workItemId}","","Test work item","test","READY_FOR_CODEX","","docs/product-spec/work-items/${workItemId}.md","feat/task-ai-104-publish-gates","","",""\n`
          : ''),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'change.txt'), 'reviewed\n');
  git(['add', REGISTER, 'change.txt']);
  git(['commit', '-q', '-m', 'reviewed']);
  return { dir, base, commit: git(['rev-parse', 'HEAD']), git };
}

function reviewFixture(registerWorkItem = true, workItemId = WORK_ITEM, registerContents) {
  const repo = makeRepo(registerWorkItem, registerContents, workItemId);
  const evidenceDir = tmpDir('task-ai-104-evidence-');
  const artifactPath = path.join(evidenceDir, 'review.md');
  const manifestPath = path.join(evidenceDir, 'manifest.json');
  fs.writeFileSync(artifactPath, '# Independent review\nPASS\n', 'utf8');
  const manifest = reviewManifest.buildManifest({
    repoCwd: repo.dir,
    workItemId,
    baseSha: repo.base,
    reviewedSha: repo.commit,
    writerCandidateKey: WRITER,
    reviewerCandidateKey: REVIEWER,
    verdict: 'PASS',
    findings: [],
    tests: [{ command: 'node --test', result: 'pass', summary: 'green' }],
    artifactPath,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { ...repo, evidenceDir, artifactPath, manifestPath, manifest };
}

function publishOptions(fixture, extra) {
  return Object.assign(
    {
      cwd: fixture.dir,
      reviewedSha: fixture.commit,
      approvalId: 'AP-TASK-AI-104',
      expiry: Date.now() + 60000,
      verdict: 'PASS',
      remoteUrl: 'https://github.com/example/repository.git',
      branch: 'feat/task-ai-104-publish-gates',
      workItemId: fixture.manifest.workItemId,
      reviewManifest: fixture.manifestPath,
      reviewArtifact: fixture.artifactPath,
      registryPath: path.join(fixture.evidenceDir, 'approvals.json'),
      testMode: true,
    },
    extra || {}
  );
}

function writeApproval(fixture, reviewer) {
  fs.writeFileSync(
    publishOptions(fixture).registryPath,
    JSON.stringify({
      'AP-TASK-AI-104': {
        approvalId: 'AP-TASK-AI-104',
        state: 'APPROVED',
        reviewedSha: fixture.commit,
        verdict: 'PASS',
        reviewer,
        expiry: new Date(Date.now() + 60000).toISOString(),
      },
    }),
    'utf8'
  );
}

test('PG-R01: approval reviewer must match the review manifest reviewer', () => {
  const fixture = reviewFixture();
  writeApproval(fixture, 'another::reviewer::gateway::upstream::account::scope::model');

  assert.throws(
    () => publisher.publish(publishOptions(fixture)),
    /PUBLISH_REFUSED: APPROVAL_REVIEWER_MISMATCH/
  );
});

test('PG-R01: an approval record without a reviewer refuses in test mode', () => {
  const fixture = reviewFixture();
  writeApproval(fixture, undefined);

  assert.throws(
    () => publisher.publish(publishOptions(fixture)),
    /PUBLISH_REFUSED: APPROVAL_REVIEWER_MISMATCH/
  );
});

test('PG-R02: a manifest for another commit is refused with its own gate code', () => {
  const fixture = reviewFixture();
  const wrongCommitManifest = { ...fixture.manifest, reviewedCommit: fixture.base };
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(wrongCommitManifest), 'utf8');

  let message = '';
  try {
    publisher.publish(publishOptions(fixture));
  } catch (err) {
    message = String(err && err.message);
  }
  assert.notEqual(message, '', 'a manifest for another commit must refuse the publish');
  assert.match(
    message,
    /PUBLISH_REFUSED: SHA_MISMATCH \(MANIFEST_SHA_MISMATCH\)/,
    'one clean message keeps the legacy SHA_MISMATCH token and names the manifest gate code'
  );
  assert.equal(
    message.split('PUBLISH_REFUSED:').length,
    2,
    'PUBLISH_REFUSED is prefixed exactly once'
  );
});

test('PG-R03: Work Item registration is read from the reviewed commit', () => {
  const fixture = reviewFixture(false);
  writeApproval(fixture, REVIEWER);

  assert.throws(
    () => publisher.publish(publishOptions(fixture, { testMode: false })),
    /PUBLISH_REFUSED: WORK_ITEM_NOT_REGISTERED/
  );
});

test('PG-R03: a register row at the reviewed commit is sufficient without checkout', () => {
  const fixture = reviewFixture();
  fs.rmSync(path.join(fixture.dir, REGISTER));

  assert.equal(publisher.workItemRegisteredAtCommit(fixture.dir, fixture.commit, WORK_ITEM), true);
});

test('PG-R03: the real register authorizes a published item and refuses an absent id', () => {
  const realRegister = fs.readFileSync(path.resolve(__dirname, '../../../', REGISTER), 'utf8');
  const registered = reviewFixture(true, WORK_ITEM, realRegister);
  writeApproval(registered, REVIEWER);

  assert.equal(
    publisher.workItemRegisteredAtCommit(registered.dir, registered.commit, WORK_ITEM),
    true
  );
  assert.equal(publisher.publish(publishOptions(registered)).status, 'published');

  const unregisteredId = 'TASK-AI-104-UNREGISTERED';
  const unregistered = reviewFixture(true, unregisteredId, realRegister);
  writeApproval(unregistered, REVIEWER);
  assert.throws(
    () => publisher.publish(publishOptions(unregistered)),
    /PUBLISH_REFUSED: WORK_ITEM_NOT_REGISTERED/
  );
});

test('PG-R04: publisher refuses a cwd inside the worker root', () => {
  const fixture = reviewFixture();

  assert.throws(
    () => publisher.publish(publishOptions(fixture, { cwd: 'C:\\ShipDeWorker\\task-ai-104' })),
    /PUBLISH_REFUSED: refusing to publish from inside the worker root/
  );
});

test('PG-R05: publisher failure domains use routing canonical behavior', () => {
  const keys = [
    WRITER,
    REVIEWER,
    'h::a::*::*::account::scope::model',
    'h::a::gateway-a::*::account::scope::model',
    'h::a::::ocz::account::scope::model',
    'h::a::*::ocz::account::scope::model',
  ];

  for (const key of keys) {
    assert.equal(
      publisher.failureDomainFromCandidateKey(key),
      routing.canonicalFailureDomain({
        gateway: String(key).split('::')[2],
        upstream: String(key).split('::')[3],
      }),
      String(key)
    );
  }

  assert.equal(publisher.failureDomainFromCandidateKey('not-a-candidate-key'), null);
  assert.equal(publisher.failureDomainFromCandidateKey(keys[3]), 'gateway-a/*');
  assert.equal(publisher.failureDomainFromCandidateKey(keys[4]), '9router/ocz');
  assert.equal(publisher.failureDomainFromCandidateKey(keys[5]), '9router/ocz');
  assert.match(
    fs.readFileSync(path.join(__dirname, '..', 'publisher.js'), 'utf8'),
    /require\(['"]\.\/routing['"]\)/
  );
});
