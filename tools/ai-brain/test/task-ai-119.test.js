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
