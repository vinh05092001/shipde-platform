'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getTreeStatus, isTreeDirty } = require('../orchestrate/writer-loop');
const { orchestrateCommand } = require('../cli/commands');

function initTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-196-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@shipde.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('TASK-AI-196 AC1: getTreeStatus and isTreeDirty ignore untracked .shipde-bin/rtk.exe but still flag other dirty files', () => {
  const dir = initTempGitRepo();
  fs.mkdirSync(path.join(dir, '.shipde-bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.shipde-bin', 'rtk.exe'), 'fake-rtk-binary', 'utf8');

  const statusOnlyRtk = getTreeStatus(dir, { untracked: 'all' });
  assert.equal(statusOnlyRtk.isDirty, false);
  assert.deepEqual(statusOnlyRtk.dirtyPaths, []);
  assert.equal(isTreeDirty(dir), false);

  // Any real untracked file outside .shipde-bin MUST still be flagged dirty
  fs.writeFileSync(path.join(dir, 'rogue.txt'), 'outside allowed paths', 'utf8');
  const statusWithRogue = getTreeStatus(dir, { untracked: 'all' });
  assert.equal(statusWithRogue.isDirty, true);
  assert.deepEqual(statusWithRogue.dirtyPaths, ['rogue.txt']);
  assert.equal(isTreeDirty(dir), true);
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
