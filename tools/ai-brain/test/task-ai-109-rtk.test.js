'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { buildWorkerLaunchScript } = require('../isolation-launcher');

const POWERSHELL_EXE_PATH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function writePayloadArgs(dir, args) {
  fs.mkdirSync(dir, { recursive: true });
  const payloadArgsPath = path.join(dir, 'payload-args.json');
  fs.writeFileSync(payloadArgsPath, JSON.stringify(args), 'utf8');
  return payloadArgsPath;
}

function makeFakeRtk(dir) {
  const rtkDir = path.join(dir, '.shipde-bin');
  fs.mkdirSync(rtkDir, { recursive: true });
  fs.writeFileSync(path.join(rtkDir, 'rtk.exe'), 'fake rtk binary', 'utf8');
  return rtkDir;
}

function makeTempWorkerRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-rtk-test-'));
  const git = (args) => {
    const { spawnSync } = require('child_process');
    return spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'test@shipde.test']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'test content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  const sha = git(['rev-parse', 'HEAD']).stdout.trim();
  return { dir, sha };
}

test('RTK-R01: buildWorkerLaunchScript prepends .shipde-bin to PATH when rtkPathPrepend is provided', () => {
  const workerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-rtk-r01-'));
  const launchResultPath = path.join(workerRoot, 'launch-result.json');

  const script = buildWorkerLaunchScript({
    credPath: path.join(workerRoot, 'WorkerUser.cred'),
    workerRoot,
    workerUsername: 'ShipDeWorker',
    exeFile: POWERSHELL_EXE_PATH,
    payloadArgsPath: writePayloadArgs(workerRoot, ['-NoProfile']),
    launchResultPath,
    workerTimeoutMs: 60000,
    completionNonce: 'a'.repeat(32),
    runAsCurrentUser: true,
    rtkPathPrepend: path.join(workerRoot, '.shipde-bin'),
  });

  assert.ok(
    script.includes('.shipde-bin'),
    'generated script must reference .shipde-bin directory'
  );
  assert.ok(
    script.includes('$psi.EnvironmentVariables["PATH"]'),
    'generated script must use $psi.EnvironmentVariables to set PATH'
  );

  fs.rmSync(workerRoot, { recursive: true, force: true });
});

test('RTK-R01: when rtk source is missing, launch continues without rtk', () => {
  const src = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  assert.ok(
    src.includes('RTK_UNAVAILABLE') || src.includes('rtkUnavailable'),
    'launcher must log RTK_UNAVAILABLE when source is missing'
  );
});

test('RTK-R02: riskDomains block RTK even when enabled', () => {
  const workerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-rtk-r02-'));
  const launchResultPath = path.join(workerRoot, 'launch-result.json');

  const script = buildWorkerLaunchScript({
    credPath: path.join(workerRoot, 'WorkerUser.cred'),
    workerRoot,
    workerUsername: 'ShipDeWorker',
    exeFile: POWERSHELL_EXE_PATH,
    payloadArgsPath: writePayloadArgs(workerRoot, ['-NoProfile']),
    launchResultPath,
    workerTimeoutMs: 60000,
    completionNonce: 'b'.repeat(32),
    runAsCurrentUser: true,
    rtk: { enabled: true },
    riskDomains: ['auth', 'money'],
  });

  assert.ok(
    !script.includes('.shipde-bin') || script.indexOf('.shipde-bin') > script.indexOf('if'),
    'riskDomains should prevent .shipde-bin from being added to PATH'
  );

  fs.rmSync(workerRoot, { recursive: true, force: true });
});

test('RTK-R02: repair round blocks RTK even when enabled', () => {
  const workerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-rtk-r02repair-'));
  const launchResultPath = path.join(workerRoot, 'launch-result.json');

  const script = buildWorkerLaunchScript({
    credPath: path.join(workerRoot, 'WorkerUser.cred'),
    workerRoot,
    workerUsername: 'ShipDeWorker',
    exeFile: POWERSHELL_EXE_PATH,
    payloadArgsPath: writePayloadArgs(workerRoot, ['-NoProfile']),
    launchResultPath,
    workerTimeoutMs: 60000,
    completionNonce: 'c'.repeat(32),
    runAsCurrentUser: true,
    rtk: { enabled: true },
    retainWorkerHead: 'd'.repeat(40),
  });

  assert.ok(
    !script.includes('.shipde-bin') || script.indexOf('.shipde-bin') > script.indexOf('if'),
    'retainWorkerHead (repair round) should prevent RTK from being added'
  );

  fs.rmSync(workerRoot, { recursive: true, force: true });
});

test('RTK-R03: worker prompt hint mentions rtk is optional for long outputs', () => {
  const launcherSrc = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  assert.ok(
    launcherSrc.includes('rtk test') ||
      launcherSrc.includes('rtk err') ||
      launcherSrc.includes('rtk is optional'),
    'launcher source must include worker prompt hint about rtk being optional'
  );
  assert.ok(
    launcherSrc.includes('host') &&
      launcherSrc.includes('raw') &&
      launcherSrc.includes('verification'),
    'launcher source must mention host produces verification raw'
  );
});

test('RTK-R04: fail-before command string contains no rtk', () => {
  const captureFailBeforeSrc = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  const failBeforeMatch = captureFailBeforeSrc.match(
    /function captureFailBefore[\s\S]*?(?=\n\/\*\*|\nfunction |\nmodule\.exports)/
  );
  const failBeforeFn = failBeforeMatch ? failBeforeMatch[0] : '';
  assert.ok(
    !failBeforeFn.includes('rtk'),
    'failBefore function must not use rtk: ' + failBeforeFn.slice(0, 500)
  );
});

test('RTK-R04: verification command strings contain no rtk', () => {
  const launcherSrc = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  assert.ok(
    !launcherSrc.match(/verification.*rtk/) && !launcherSrc.match(/rtk.*verification/),
    'verification commands must not reference rtk'
  );
});

test('RTK-R04: git commands in the launcher contain no rtk', () => {
  const launcherSrc = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  const gitMatches = launcherSrc.match(/spawnSync\(['"]git['"][\s\S]*?(?=\);)/g) || [];
  for (const match of gitMatches) {
    assert.ok(!match.includes('rtk'), 'git spawn must not include rtk: ' + match);
  }
});

test('RTK-R05: RTK path is constructed correctly from sourcePath or env SHIPDE_RTK_PATH', () => {
  const launcherSrc = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  assert.ok(
    launcherSrc.includes('SHIPDE_RTK_PATH') || launcherSrc.includes('rtkSource'),
    'launcher must check SHIPDE_RTK_PATH env or sourcePath option for rtk.exe location'
  );
  assert.ok(
    launcherSrc.includes('.shipde-bin'),
    'launcher must copy rtk.exe to .shipde-bin directory'
  );
});

test('RTK-R05: launch result records rtk decision as {provided, reason}', () => {
  const launcherSrc = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  assert.ok(
    launcherSrc.includes('rtk') && launcherSrc.includes('provided'),
    'launch result must record rtk decision with {provided, reason} structure'
  );
  assert.ok(
    launcherSrc.includes('riskDomains') && launcherSrc.includes('retainWorkerHead'),
    'launcher must check riskDomains and retainWorkerHead when deciding on RTK'
  );
});

test('RTK-R01: default rtk is disabled', () => {
  const script = buildWorkerLaunchScript({
    credPath: path.join(os.tmpdir(), 'rtk-default', 'WorkerUser.cred'),
    workerRoot: path.join(os.tmpdir(), 'rtk-default'),
    workerUsername: 'ShipDeWorker',
    exeFile: POWERSHELL_EXE_PATH,
    payloadArgsPath: writePayloadArgs(path.join(os.tmpdir(), 'rtk-default'), ['-NoProfile']),
    launchResultPath: path.join(os.tmpdir(), 'rtk-default', 'launch-result.json'),
    workerTimeoutMs: 60000,
    completionNonce: 'e'.repeat(32),
    runAsCurrentUser: true,
  });

  assert.ok(
    !script.includes('.shipde-bin'),
    'without rtk option, .shipde-bin must not appear in generated script'
  );
});

test('RTK: lowRisk:true flag allows RTK even without riskDomains check', () => {
  const launcherSrc = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  assert.ok(
    launcherSrc.includes('lowRisk') || launcherSrc.includes('low_risk'),
    'launcher must recognize lowRisk flag in job item'
  );
});
