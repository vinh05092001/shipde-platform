const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');
const decisions = require('../decisions');

const TMP = path.join(__dirname, '..', '..', '..', '.upstream-tmp', 'retained-dirty-repair-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function setup(name) {
  const hostCwd = path.join(TMP, name + '-host');
  fs.mkdirSync(hostCwd, { recursive: true });
  const sh = (cmd, cwd) => cp.execSync(cmd, { cwd, stdio: 'pipe' });
  sh('git init', hostCwd);
  sh('git config user.name "Test"', hostCwd);
  sh('git config user.email "test@example.com"', hostCwd);
  fs.writeFileSync(path.join(hostCwd, 'file.txt'), 'base');
  sh('git add file.txt', hostCwd);
  sh('git commit -m base', hostCwd);
  const hook = path.join(hostCwd, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const baseSha = sh('git rev-parse HEAD', hostCwd).toString().trim();
  const workerRoot = path.join(TMP, name + '-worker');
  fs.mkdirSync(workerRoot, { recursive: true });
  sh(`git clone "${hostCwd}" .`, workerRoot);
  sh('git config user.name "Test"', workerRoot);
  sh('git config user.email "test@example.com"', workerRoot);
  const verdictPath = path.join(TMP, name + '-verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: hostCwd,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: getFolderHash(path.join(hostCwd, 'scripts/ai/isolation')),
      sid: 'SID-1',
      details: { Test: 'PASS' },
    })
  );
  const decisionDir = path.join(TMP, name + '-decisions');
  fs.mkdirSync(decisionDir, { recursive: true });
  return { hostCwd, baseSha, workerRoot, verdictPath, decisionDir };
}

function launchOpts(s) {
  return {
    baseSha: s.baseSha,
    retainWorkerHead: s.baseSha,
    cwd: s.hostCwd,
    workerRoot: s.workerRoot,
    decisionDir: s.decisionDir,
    workItemId: 'FEAT-1',
    verdictPath: s.verdictPath,
    getWorkerSid: () => 'SID-1',
    verifyBoundary: () => true,
  };
}

const git = (cwd, args) =>
  cp
    .execSync('git ' + args, { cwd, stdio: 'pipe' })
    .toString()
    .trim();

test("dirty retained root after this item's repair turn is committed, next repair proceeds", async () => {
  const s = setup('own');
  fs.writeFileSync(path.join(s.workerRoot, 'file.txt'), 'repair edit left uncommitted');
  decisions.recordDecision(
    { stage: 'writer-launch-result', workItemId: 'FEAT-1', kind: 'host-gate-repair', exitCode: 0 },
    { dir: s.decisionDir }
  );
  await getIsolatedLauncher()({ id: 'test' }, null, launchOpts(s));
  assert.strictEqual(git(s.workerRoot, 'status --porcelain'), '', 'tree must be clean');
  assert.strictEqual(git(s.workerRoot, 'log -1 --format=%s'), 'Restore interrupted writer work');
  assert.notStrictEqual(git(s.workerRoot, 'rev-parse HEAD'), s.baseSha);
});

test('dirty retained root with no writer record for this item still fails closed', async () => {
  const s = setup('foreign');
  fs.writeFileSync(path.join(s.workerRoot, 'file.txt'), 'foreign edit');
  await assert.rejects(
    () => Promise.resolve().then(() => getIsolatedLauncher()({ id: 'test' }, null, launchOpts(s))),
    /WORKER_HEAD_MISMATCH.*is dirty/
  );
  assert.notStrictEqual(git(s.workerRoot, 'status --porcelain'), '');
});
