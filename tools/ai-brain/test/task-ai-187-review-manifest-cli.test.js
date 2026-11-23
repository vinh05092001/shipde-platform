'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildManifest } = require('../review-manifest');
const { candidateKey } = require('../candidates');

const CLI_PATH = path.resolve(__dirname, '..', 'review-manifest.js');

function makeFixture(t, workItemId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-187-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const repoDir = path.join(dir, 'repo');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const git = (...args) => {
    const res = cp.spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
    assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
    return res.stdout.trim();
  };

  git('init');
  git('config', 'user.email', 'fixture@shipde.local');
  git('config', 'user.name', 'ShipDe Fixture');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'base\n', 'utf8');
  git('add', 'a.txt');
  git('commit', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD');

  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'changed\n', 'utf8');
  git('add', 'a.txt');
  git('commit', '-m', 'change');
  const reviewedSha = git('rev-parse', 'HEAD');

  const artifactPath = path.join(outDir, `review-artifact-${workItemId}.md`);
  fs.writeFileSync(artifactPath, '# Review Artifact\n\nVERDICT: PASS\n', 'utf8');

  const manifest = buildManifest({
    workItemId,
    repoCwd: repoDir,
    baseSha,
    reviewedSha,
    writerCandidateKey: candidateKey({
      harness: 'opencode-direct',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'bzl',
      accountId: '9router',
      quotaScope: '9router:bzl',
      modelId: 'bzl/glm-5.3',
    }),
    reviewerCandidateKey: candidateKey({
      harness: 'opencode-direct',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gcli',
      accountId: '9router',
      quotaScope: '9router:gcli',
      modelId: 'gcli/grok-4.7',
    }),
    verdict: 'PASS',
    findings: [],
    tests: [{ command: 'node --test', result: 'pass', summary: 'ok' }],
    artifactPath,
  });

  const manifestPath = path.join(outDir, 'review-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return { dir, repoDir, outDir, manifestPath, artifactPath, reviewedSha };
}

test('TASK-AI-187 AC1: CLI without artifact arg fails cleanly with ARTIFACT_REQUIRED instead of ReferenceError', (t) => {
  const workItemId = 'TASK-AI-187';
  const f = makeFixture(t, workItemId);
  fs.unlinkSync(f.artifactPath);

  const run = cp.spawnSync(
    process.execPath,
    [CLI_PATH, f.manifestPath, f.repoDir, f.reviewedSha, workItemId],
    { encoding: 'utf8' }
  );

  assert.doesNotMatch(run.stderr || '', /ReferenceError/i);
  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'ARTIFACT_REQUIRED');
});

test('TASK-AI-187 AC2: CLI without artifact arg auto-discovers review-artifact-<work-item>.md next to manifest', (t) => {
  const workItemId = 'TASK-AI-187';
  const f = makeFixture(t, workItemId);

  const okRun = cp.spawnSync(
    process.execPath,
    [CLI_PATH, f.manifestPath, f.repoDir, f.reviewedSha, workItemId],
    { encoding: 'utf8' }
  );
  assert.doesNotMatch(okRun.stderr || '', /ReferenceError/i);
  assert.equal(
    okRun.status,
    0,
    `expected exit 0, got ${okRun.status}: ${okRun.stdout} ${okRun.stderr}`
  );
  const okParsed = JSON.parse(okRun.stdout);
  assert.equal(okParsed.ok, true);

  // Tampering with the discovered artifact must fail with ARTIFACT_HASH_MISMATCH
  fs.writeFileSync(f.artifactPath, '# Tampered\n', 'utf8');
  const mismatchRun = cp.spawnSync(
    process.execPath,
    [CLI_PATH, f.manifestPath, f.repoDir, f.reviewedSha, workItemId],
    { encoding: 'utf8' }
  );
  assert.equal(mismatchRun.status, 1);
  const mismatchParsed = JSON.parse(mismatchRun.stdout);
  assert.equal(mismatchParsed.ok, false);
  assert.equal(mismatchParsed.code, 'ARTIFACT_HASH_MISMATCH');
});
