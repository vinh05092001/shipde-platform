'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolveIsolatedRtkDecision } = require('../isolation-launcher');
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

test('TASK-AI-196 AC1: isolated RTK omits untrusted/repo locations, never writes into workerRoot, and keeps worker .shipde-bin fail-closed', () => {
  const { parent, dir } = initTempGitRepo();

  // 1. Default isolated launch without pre-provisioned trustedBinDir omits optional RTK cleanly
  const omitted = resolveIsolatedRtkDecision(dir, { enabled: true }, {});
  assert.equal(omitted.enabled, false);
  assert.equal(omitted.pathPrepend, null);
  assert.equal(omitted.reason, 'rtk_omitted_isolated_no_trusted_bin');
  assert.equal(fs.existsSync(path.join(dir, '.shipde-bin')), false);
  assert.equal(isTreeDirty(dir), false);

  // 2. Rejects any directory inside workerRoot OR under workerRoot's parent (worker-writable ancestor)
  const insideRepo = resolveIsolatedRtkDecision(
    dir,
    { enabled: true, trustedBinDir: path.join(dir, '.shipde-bin') },
    {}
  );
  assert.equal(insideRepo.enabled, false);
  assert.equal(insideRepo.pathPrepend, null);
  assert.equal(insideRepo.reason, 'rtk_omitted_isolated_untrusted_ancestor');

  const underParent = resolveIsolatedRtkDecision(
    dir,
    { enabled: true, trustedBinDir: path.join(parent, '.shipde-bin') },
    {}
  );
  assert.equal(underParent.enabled, false);
  assert.equal(underParent.pathPrepend, null);
  assert.equal(underParent.reason, 'rtk_omitted_isolated_untrusted_ancestor');

  // 3. Accepts an external pre-provisioned trustedBinDir outside workerRoot/parent with real rtk.exe
  const externalTrusted = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-196-trusted-'));
  fs.writeFileSync(path.join(externalTrusted, 'rtk.exe'), 'trusted-rtk', 'utf8');
  const allowed = resolveIsolatedRtkDecision(
    dir,
    { enabled: true, trustedBinDir: externalTrusted },
    {}
  );
  assert.equal(allowed.enabled, true);
  assert.equal(allowed.pathPrepend, path.resolve(externalTrusted));
  assert.equal(allowed.reason, 'provided');
  assert.equal(isTreeDirty(dir), false);

  // 4. Rejects symlink/junction trustedBinDir
  const symDir = path.join(os.tmpdir(), 'shipde-196-sym-' + Date.now());
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(externalTrusted, symDir, linkType);
  const symRes = resolveIsolatedRtkDecision(dir, { enabled: true, trustedBinDir: symDir }, {});
  assert.equal(symRes.enabled, false);
  assert.equal(symRes.pathPrepend, null);
  assert.equal(symRes.reason, 'rtk_omitted_isolated_untrusted_dir');

  // 5. Fail-closed dirty-tree proof: arbitrary worker-created .shipde-bin/evil.exe INSIDE workerRoot
  // MUST still be reported dirty (even with no activeWorkItemId)
  fs.mkdirSync(path.join(dir, '.shipde-bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.shipde-bin', 'evil.exe'), 'untrusted', 'utf8');
  const status = getTreeStatus(dir, { untracked: 'all' });
  assert.equal(status.isDirty, true);
  assert.deepEqual(status.dirtyPaths, ['.shipde-bin/evil.exe']);
  assert.equal(isTreeDirty(dir), true);

  fs.rmSync(symDir, { recursive: true, force: true });
  fs.rmSync(externalTrusted, { recursive: true, force: true });
  fs.rmSync(parent, { recursive: true, force: true });
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
