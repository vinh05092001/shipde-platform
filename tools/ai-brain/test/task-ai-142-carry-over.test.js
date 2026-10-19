'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  carryOverSave,
  carryOverRestore,
  getIsolatedLauncher,
  getFolderHash,
} = require('../isolation-launcher');

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false'];
function git(cwd, ...args) {
  const r = cp.spawnSync('git', ID.concat(args), {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    }),
  });
  assert.equal(r.status, 0, args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}

function scenario(t, conflicting) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-over-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const host = path.join(tmp, 'host');
  fs.mkdirSync(host);
  git(host, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(host, 'a.txt'), 'base\n');
  git(host, 'add', '-A');
  git(host, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(host, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  const headSha = git(host, 'rev-parse', 'HEAD');
  const oldRoot = path.join(tmp, 'old');
  git(tmp, 'clone', '-q', host, oldRoot);
  git(oldRoot, 'checkout', '-q', '-B', 'feat/x', headSha);
  fs.writeFileSync(path.join(oldRoot, conflicting ? 'a.txt' : 'done.txt'), 'old commit\n');
  git(oldRoot, 'add', '-A');
  git(oldRoot, 'commit', '-q', '-m', 'writer commit');
  fs.writeFileSync(path.join(oldRoot, 'wip.txt'), 'uncommitted\n');

  assert.equal(carryOverSave(host, oldRoot, 'feat/x', headSha), true);
  fs.rmSync(oldRoot, { recursive: true, force: true });

  // The host moves on so a conflicting carry cannot fast-forward.
  const newRoot = path.join(tmp, 'new');
  git(tmp, 'clone', '-q', '--no-checkout', host, newRoot);
  git(newRoot, 'checkout', '-q', '-B', 'feat/x', headSha);
  if (conflicting) {
    // headSha is the same, so make the base itself differ: rewrite a.txt on a new head.
    fs.writeFileSync(path.join(newRoot, 'a.txt'), 'different\n');
    git(newRoot, 'add', '-A');
    git(newRoot, 'commit', '-q', '-m', 'new head');
  }
  return { host, newRoot };
}

test('carry-over: committed and uncommitted work survive a fresh checkout', (t) => {
  const { host, newRoot } = scenario(t, false);
  assert.equal(carryOverRestore(host, newRoot, 'feat/x'), 'merged');
  assert.equal(fs.readFileSync(path.join(newRoot, 'done.txt'), 'utf8'), 'old commit\n');
  assert.equal(fs.readFileSync(path.join(newRoot, 'wip.txt'), 'utf8'), 'uncommitted\n');
  assert.equal(carryOverRestore(host, newRoot, 'feat/x'), 'none');
});

test('carry-over: a conflicting merge is aborted and the checkout stays plain', (t) => {
  const { host, newRoot } = scenario(t, true);
  const before = git(newRoot, 'rev-parse', 'HEAD');
  assert.equal(carryOverRestore(host, newRoot, 'feat/x'), 'conflict');
  assert.equal(git(newRoot, 'rev-parse', 'HEAD'), before);
  assert.equal(git(newRoot, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(newRoot, 'a.txt'), 'utf8'), 'different\n');
});

for (const missing of [true, false])
  test(`carry-over refuses ${missing ? 'missing' : 'rejecting'} host hook without advancing HEAD`, (t) => {
    const { host, newRoot } = scenario(t, false);
    const hook = path.join(host, '.git/hooks/pre-commit');
    if (missing) fs.unlinkSync(hook);
    else fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const before = git(newRoot, 'rev-parse', 'HEAD');
    assert.throws(() => carryOverRestore(host, newRoot, 'feat/x'), /WORKER_COMMIT_FAILED/);
    assert.equal(git(newRoot, 'rev-parse', 'HEAD'), before);
    assert.equal(git(newRoot, 'status', '--porcelain'), '');
    assert.match(git(host, 'rev-parse', 'refs/shipde/carry/feat/x'), /^[a-f0-9]{40}$/);
  });

test('launcher handles rejecting carry-over restore as structured local failure without throw', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-launch-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const host = path.join(tmp, 'host');
  fs.mkdirSync(host);
  git(host, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(host, 'a.txt'), 'base\n');
  git(host, 'add', '-A');
  git(host, 'commit', '-q', '-m', 'base');
  const headSha = git(host, 'rev-parse', 'HEAD');
  const oldRoot = path.join(tmp, 'old');
  git(tmp, 'clone', '-q', host, oldRoot);
  git(oldRoot, 'checkout', '-q', '-B', 'feat/x', headSha);
  fs.writeFileSync(path.join(oldRoot, 'done.txt'), 'old commit\n');
  git(oldRoot, 'add', '-A');
  git(oldRoot, 'commit', '-q', '-m', 'writer commit');
  assert.equal(carryOverSave(host, oldRoot, 'feat/x', headSha), true);
  fs.rmSync(oldRoot, { recursive: true, force: true });

  // Hook rejects:
  fs.writeFileSync(path.join(host, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  });

  const workerRoot = path.join(tmp, 'worker');
  const verdictPath = path.join(host, 'verdict.json');
  fs.mkdirSync(path.join(host, 'scripts', 'ai', 'isolation'), { recursive: true });
  fs.writeFileSync(path.join(host, 'scripts', 'ai', 'isolation', 'policy.txt'), 'policy');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: host,
      timestamp: new Date().toISOString(),
      policyHash: getFolderHash(path.join(host, 'scripts', 'ai', 'isolation')),
      sid: 'mock-sid',
      details: { check: 'PASS' },
    })
  );

  const launcher = getIsolatedLauncher();
  const res = launcher({ id: 'dummy', command: 'node' }, [], {
    cwd: host,
    workerRoot,
    baseSha: headSha,
    branch: 'feat/x',
    verdictPath,
    verifyBoundary: () => true,
    getWorkerSid: () => 'mock-sid',
  });

  assert.equal(res.exitCode, 1);
  assert.equal(res.localFailure, 'WORKER_COMMIT_FAILED');
  assert.match(res.failureReason, /WORKER_COMMIT_FAILED/);
  assert.equal(res.workerSha, undefined);
  assert.equal(res.retainedHeadSha, undefined);
});
