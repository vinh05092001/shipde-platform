'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolveRtkBinDir, stageTrustedRtkShim } = require('../isolation-launcher');
const { getTreeStatus, isTreeDirty } = require('../orchestrate/writer-loop');
const { orchestrateCommand } = require('../cli/commands');

function initTempGitRepo() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-196-root-'));
  const dir = path.join(parent, 'worker-repo');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@shipde.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return { parent, dir };
}

test('TASK-AI-196 AC1: stageTrustedRtkShim stages outside workerRoot with ACL lockdown, rejects symlink/ACL failure, and keeps worker .shipde-bin fail-closed', () => {
  const { parent, dir } = initTempGitRepo();
  const fakeSrc = path.join(parent, 'trusted-rtk.exe');
  fs.writeFileSync(fakeSrc, 'trusted-rtk-binary', 'utf8');

  // 1. Happy path: stages in unpredictable per-launch dir outside workerRoot with ACL hook invoked
  const aclCalls = [];
  const staged = stageTrustedRtkShim(dir, fakeSrc, {
    workerUser: 'ShipDeWorker',
    lockAcl: (targetDir, workerUser) => {
      aclCalls.push({ targetDir, workerUser });
      return { ok: true };
    },
  });
  assert.equal(staged.ok, true);
  assert.equal(aclCalls.length, 1);
  assert.equal(aclCalls[0].targetDir, staged.dir);
  assert.equal(aclCalls[0].workerUser, 'ShipDeWorker');
  const rel = path.relative(dir, staged.dir);
  assert.ok(rel.startsWith('..') || path.isAbsolute(rel), 'RTK shim must be outside workerRoot');
  assert.ok(staged.dir.includes('.shipde-bin'));
  assert.equal(fs.existsSync(staged.exe), true);
  assert.equal(isTreeDirty(dir), false);
  assert.deepEqual(getTreeStatus(dir, { untracked: 'all' }).dirtyPaths, []);

  // 2. ACL failure fails safely to rtk_acl_failed and removes the staged directory
  const aclFail = stageTrustedRtkShim(dir, fakeSrc, {
    nonce: 'aclfail01',
    lockAcl: () => ({ ok: false, detail: 'icacls denied' }),
  });
  assert.equal(aclFail.ok, false);
  assert.equal(aclFail.reason, 'rtk_acl_failed');
  assert.equal(fs.existsSync(resolveRtkBinDir(dir, 'aclfail01')), false);

  // 3. Pre-existing directory at target nonce fails closed (non-recursive mkdir EEXIST)
  const preExistDir = resolveRtkBinDir(dir, 'preexist01');
  fs.mkdirSync(preExistDir, { recursive: true });
  const preExistRes = stageTrustedRtkShim(dir, fakeSrc, {
    nonce: 'preexist01',
    lockAcl: () => ({ ok: true }),
  });
  assert.equal(preExistRes.ok, false);
  assert.equal(preExistRes.reason, 'rtk_copy_failed');

  // 4. Pre-existing junction/symlink at .shipde-bin container fails closed with rtk_unsafe_symlink
  const symParent = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-196-sym-'));
  const symWorker = path.join(symParent, 'worker-repo');
  const decoyDir = path.join(symParent, 'decoy');
  fs.mkdirSync(symWorker, { recursive: true });
  fs.mkdirSync(decoyDir, { recursive: true });
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(decoyDir, path.join(symParent, '.shipde-bin'), linkType);
  const symRes = stageTrustedRtkShim(symWorker, fakeSrc, {
    lockAcl: () => ({ ok: true }),
  });
  assert.equal(symRes.ok, false);
  assert.equal(symRes.reason, 'rtk_unsafe_symlink');

  // 5. Fail-closed dirty-tree proof: arbitrary worker-created .shipde-bin/evil.exe INSIDE workerRoot
  // MUST still be reported dirty (even with no activeWorkItemId)
  fs.mkdirSync(path.join(dir, '.shipde-bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.shipde-bin', 'evil.exe'), 'untrusted', 'utf8');
  const status = getTreeStatus(dir, { untracked: 'all' });
  assert.equal(status.isDirty, true);
  assert.deepEqual(status.dirtyPaths, ['.shipde-bin/evil.exe']);
  assert.equal(isTreeDirty(dir), true);

  fs.rmSync(parent, { recursive: true, force: true });
  fs.rmSync(symParent, { recursive: true, force: true });
});

test('TASK-AI-196 AC2: orchestrateCommand enables comboJevSelect on live isolated-worker runs and disables it when candidates or run are injected', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-196-cmd-'));
  const specsFile = path.join(tmpDir, 'specs.json');
  fs.writeFileSync(specsFile, JSON.stringify([{ id: 'TASK-X', title: 'Test' }]), 'utf8');

  const registry = {
    dispatch: { nineRouterWriterCombo: 'vinh', comboSource: '9router' },
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        harness: 'paseo',
        endpoint: 'http://127.0.0.1:20128/v1',
        credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
      },
    ],
  };

  let capturedOpts = null;
  const baseDeps = {
    registry,
    env: { NINEROUTER_API_KEY: 'test-key' },
    listAccounts: () => [],
    loadSources: () => registry,
    log: () => {},
    error: () => {},
    exit: () => {},
    runOrchestration: async (_goal, opts) => {
      capturedOpts = opts;
      return { status: 'COMPLETED', outcomes: [] };
    },
  };

  // Live isolated-worker run (no injected d.candidates or d.run) -> comboJevSelect: true
  await orchestrateCommand(
    {
      _: ['orchestrate'],
      goal: 'Live test',
      specs: specsFile,
      'isolated-worker': true,
      'decision-dir': tmpDir,
      json: true,
    },
    baseDeps
  );
  assert.equal(capturedOpts.comboJevSelect, true);

  // Injected d.candidates -> comboJevSelect: false
  capturedOpts = null;
  await orchestrateCommand(
    {
      _: ['orchestrate'],
      goal: 'Test with injected candidates',
      specs: specsFile,
      'isolated-worker': true,
      'decision-dir': tmpDir,
      json: true,
    },
    { ...baseDeps, candidates: [{ candidateKey: 'mock::a::b::c::d::e::f' }] }
  );
  assert.equal(capturedOpts.comboJevSelect, false);

  // Injected d.run stub -> comboJevSelect: false
  capturedOpts = null;
  await orchestrateCommand(
    {
      _: ['orchestrate'],
      goal: 'Test with injected runner',
      specs: specsFile,
      'isolated-worker': true,
      'decision-dir': tmpDir,
      json: true,
    },
    { ...baseDeps, run: async () => ({ exitCode: 0 }) }
  );
  assert.equal(capturedOpts.comboJevSelect, false);
});
