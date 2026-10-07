'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { importPassedCommit, hasCommit } = require('../passed-commit');

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let res = spawnSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  assert.strictEqual(res.status, 0);
  res = spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  assert.strictEqual(res.status, 0);
  res = spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  assert.strictEqual(res.status, 0);
  return dir;
}

function commitFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
  let res = spawnSync('git', ['add', name], { cwd: dir });
  assert.strictEqual(res.status, 0);
  res = spawnSync('git', ['commit', '-m', name], { cwd: dir });
  assert.strictEqual(res.status, 0);
  res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir });
  assert.strictEqual(res.status, 0);
  return res.stdout.toString().trim();
}

test('importPassedCommit fetches commit into host repo under namespaced ref', () => {
  const root = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.upstream-tmp', 't119a-'));
  try {
    const host = initRepo(path.join(root, 'host'));
    const worker = initRepo(path.join(root, 'worker'));
    const sha = commitFile(worker, 'file.txt', 'hello');
    const res = importPassedCommit({
      hostRepo: host,
      workerRoot: worker,
      workItemId: 'TASK-AI-111',
      sha,
    });
    assert.strictEqual(res.ok, true);
    assert(res.ref.startsWith('refs/shipde/passed/'));
    assert.strictEqual(hasCommit(host, sha), true);
    const cat = spawnSync('git', ['-C', host, 'cat-file', '-t', sha]);
    assert.strictEqual(cat.status, 0);
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  }
});

test('hasCommit returns false when missing', () => {
  const root = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.upstream-tmp', 't119b-'));
  try {
    const host = initRepo(path.join(root, 'host'));
    assert.strictEqual(hasCommit(host, '1111111111111111111111111111111111111111'), false);
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  }
});

test('dependent launches from dependency PASS SHA (KC-R01 + TASK-AI-114 handoff)', async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.upstream-tmp', 't119d-'));
  const host = initRepo(path.join(root, 'host'));
  const workerA = initRepo(path.join(root, 'workerA'));
  const workerB = initRepo(path.join(root, 'workerB'));
  const shaA = commitFile(workerA, 'a.txt', 'a');
  const checkpointDir = path.join(root, 'checkpoints');
  fs.mkdirSync(checkpointDir, { recursive: true });
  // ensure A's commit exists in host for dependency
  spawnSync('git', [
    '-C',
    host,
    'fetch',
    '--no-tags',
    workerA,
    shaA + ':refs/shipde/passed/TASK-AI-119-A/' + shaA,
  ]);

  const runner = require('../orchestrate');
  let bLaunchedBase = null;
  const fakeLauncher = (baseSha, opts) => {
    if (opts && opts.workItemId === 'TASK-AI-119-A') {
      return {
        sessionId: 'sa',
        workerRoot: workerA,
        publishCwd: workerA,
        workerSha: shaA,
        publishCwd: workerA,
        exitCode: 0,
      };
    }
    if (opts && opts.workItemId === 'TASK-AI-119-B') {
      bLaunchedBase = baseSha;
      return {
        sessionId: 'sb',
        workerRoot: workerB,
        workerSha: shaA,
        publishCwd: workerB,
        exitCode: 0,
      };
    }
    return { sessionId: 'sx', exitCode: 0 };
  };
  const fakeReviewer = (item, opts) => ({
    status: 'COMPLETED',
    sha: shaA,
    workerRoot: workerA,
    publishCwd: workerA,
    verdict: 'PASS',
    reviewer: 'codex',
  });
  await runner.runOrchestration(
    'orchestrate',
    {
      workItems: [
        { id: 'TASK-AI-119-A', dependencies: [] },
        { id: 'TASK-AI-119-B', dependencies: ['TASK-AI-119-A'] },
      ],
      checkpointDir,
      launcher: fakeLauncher,
      reviewer: fakeReviewer,
      hostCwd: host,
    },
    {}
  );
  assert.strictEqual(bLaunchedBase, shaA);
  assert.strictEqual(hasCommit(host, shaA), true);
});

test('resume re-imports missing host commit if worker has it; missing from both blocks (KC-R02)', async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.upstream-tmp', 't119e-'));
  const host = initRepo(path.join(root, 'host'));
  const workerA = initRepo(path.join(root, 'workerA'));
  const workerB = initRepo(path.join(root, 'workerB'));
  const shaA = commitFile(workerA, 'a.txt', 'a');
  const runner = require('../orchestrate');
  const checkpointDir = path.join(root, 'checkpoints');
  fs.mkdirSync(checkpointDir, { recursive: true });
  const fakeLauncher = (baseSha, opts) => {
    if (opts && opts.workItemId === 'TASK-AI-119-A') {
      return {
        sessionId: 'sa',
        workerRoot: workerA,
        publishCwd: workerA,
        workerSha: shaA,
        publishCwd: workerA,
        exitCode: 0,
      };
    }
    if (opts && opts.workItemId === 'TASK-AI-119-B') {
      return {
        sessionId: 'sb',
        workerRoot: workerB,
        workerSha: shaA,
        publishCwd: workerB,
        exitCode: 0,
      };
    }
    return { sessionId: 'sx', exitCode: 0 };
  };
  const fakeReviewer = (item, opts) => ({
    status: 'COMPLETED',
    sha: shaA,
    workerRoot: workerA,
    publishCwd: workerA,
    verdict: 'PASS',
    reviewer: 'codex',
  });
  await runner.runOrchestration(
    'orchestrate',
    {
      workItems: [
        { id: 'TASK-AI-119-A', dependencies: [] },
        { id: 'TASK-AI-119-B', dependencies: ['TASK-AI-119-A'] },
      ],
      checkpointDir,
      launcher: fakeLauncher,
      reviewer: fakeReviewer,
      hostCwd: host,
    },
    {}
  );
  assert.strictEqual(hasCommit(host, shaA), true);
});

test('PROVISION_BASE_MISSING blocks launch and does not exclude candidate (KC-R03)', async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.upstream-tmp', 't119f-'));
  const host = initRepo(path.join(root, 'host'));
  const worker = initRepo(path.join(root, 'worker'));
  const shaA = commitFile(worker, 'a.txt', 'a');
  const runner = require('../orchestrate');
  const checkpointDir = path.join(root, 'checkpoints');
  fs.mkdirSync(checkpointDir, { recursive: true });
  const fakeLauncher = (baseSha, opts) => {
    const e = new Error('missing base');
    e.code = 'PROVISION_BASE_MISSING';
    throw e;
  };
  const fakeReviewer = (item, opts) => ({
    status: 'COMPLETED',
    sha: shaA,
    workerRoot: workerA,
    publishCwd: workerA,
    verdict: 'PASS',
    reviewer: 'codex',
  });
  try {
    await runner.runOrchestration(
      'orchestrate',
      {
        workItems: [{ id: 'TASK-AI-119-M', dependencies: [] }],
        checkpointDir,
        launcher: fakeLauncher,
        reviewer: fakeReviewer,
        hostCwd: host,
      },
      {}
    );
    assert.fail('should have thrown');
  } catch (e) {
    // expected
  }
});
