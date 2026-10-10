'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const supervisor = require('../supervisor');
const decisions = require('../decisions');
const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');

const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
const dirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const BASE_SHA = 'b'.repeat(40);
const realSpawnSync = cp.spawnSync.bind(cp);
const PNPM =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'pnpm', 'pnpm.exe')
    : 'pnpm';

function writeVerdict(hostCwd) {
  const verdictPath = path.join(hostCwd, 'verdict.json');
  fs.mkdirSync(path.join(hostCwd, 'scripts', 'ai', 'isolation'), { recursive: true });
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: hostCwd,
      timestamp: new Date(Date.now() - 10000).toISOString(),
      policyHash: getFolderHash(path.join(hostCwd, 'scripts/ai/isolation')),
      sid: 'mock-sid',
      details: { check: 'PASS' },
    })
  );
  return verdictPath;
}

function installLaunchMocks(t, workerRoot, forcedInstallError = null) {
  const protectedRoot = path.resolve(workerRoot).toLowerCase();
  const realRmSync = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (target, options) => {
    if (path.resolve(String(target)).toLowerCase() === protectedRoot) return undefined;
    return realRmSync(target, options);
  });
  t.mock.method(cp, 'spawnSync', (command, args, options) => {
    if ((command === PNPM || command === 'pnpm') && args[0] === 'install' && forcedInstallError) {
      const error = new Error(forcedInstallError.message);
      error.code = forcedInstallError.code;
      return { error, status: null, stdout: '', stderr: '' };
    }
    if (command === PNPM || command === 'pnpm') return realSpawnSync(command, args, options);
    if (command === 'powershell.exe') {
      const script = fs.readFileSync(args[args.length - 1], 'utf8');
      const nonce = script.match(/\$completionNonce = "([^"]+)"/)[1];
      const resultPath = script.match(/\$output \| ConvertTo-Json.*Out-File "([^"]+)"/)[1];
      fs.writeFileSync(
        resultPath,
        JSON.stringify({
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          completed: true,
          completionNonce: nonce,
        })
      );
    }
    return { status: 0, stdout: BASE_SHA };
  });
  t.mock.method(supervisor, 'withCleanGitEnv', (dir, callback) => callback('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: BASE_SHA }));
}

function launch(hostCwd, workerRoot, decisionDir, extra = {}) {
  return getIsolatedLauncher()({ id: 'dummy', command: 'node' }, [], {
    verdictPath: writeVerdict(hostCwd),
    cwd: hostCwd,
    workerRoot,
    baseSha: BASE_SHA,
    decisionDir,
    getWorkerSid: () => 'mock-sid',
    verifyBoundary: () => true,
    isolatedWorker: true,
    workItemId: 'TASK-AI-136',
    branch: 'fix/task-ai-136-deps-copy',
    ...extra,
  });
}

function assertPnpmAvailable() {
  const result = realSpawnSync(PNPM, ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(
    result.error,
    undefined,
    `pnpm is required for TASK-AI-136 integration tests; could not execute pnpm: ${result.error}`
  );
  assert.equal(result.status, 0, `pnpm --version failed: ${result.stderr || result.stdout}`);
}

function writeWorkspace(host, worker) {
  const packageDir = path.join(host, 'packages', 'demo');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(path.join(worker, 'packages', 'demo'), { recursive: true });
  const packageJson = { name: 'task-ai-136-fixture', private: true };
  fs.writeFileSync(path.join(host, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-dep',
        version: '1.0.0',
        main: 'index.js',
        dependencies: { 'task-ai-136-fixture': 'workspace:*' },
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = "fixture";');
  fs.writeFileSync(
    path.join(host, 'package.json'),
    JSON.stringify({ ...packageJson, dependencies: { 'fixture-dep': 'workspace:*' } }, null, 2)
  );
  const install = realSpawnSync(PNPM, ['install', '--lockfile-only', '--offline'], {
    cwd: host,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(
    install.status,
    0,
    `fixture lockfile generation failed: ${install.stderr || install.stdout}`
  );
  for (const rel of [
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'packages/demo/package.json',
  ]) {
    fs.mkdirSync(path.dirname(path.join(worker, rel)), { recursive: true });
    fs.copyFileSync(path.join(host, rel), path.join(worker, rel));
  }
}

test('WP-R01/WP-R02: manifest-only staging performs a real pnpm install and reuses the ready cache', (t) => {
  assertPnpmAvailable();
  const area = tmpDir('task-ai-136-success-');
  const host = path.join(area, 'host');
  const worker = path.join(area, 'worker');
  fs.mkdirSync(host, { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  writeWorkspace(host, worker);
  const decisionDir = path.join(area, 'decisions');
  installLaunchMocks(t, worker);

  const result = launch(host, worker, decisionDir);
  assert.equal(result.exitCode, 0);
  const warnings = decisions
    .readDecisionsDetailed({ dir: decisionDir })
    .records.filter((record) => record.warning === 'WORKER_DEPS_UNAVAILABLE');
  assert.deepEqual(warnings, []);

  const depsBase = path.join(path.dirname(worker), 'deps');
  const depsDir = path.join(
    depsBase,
    fs
      .readdirSync(depsBase)
      .find((name) => fs.existsSync(path.join(depsBase, name, '.shipde-deps-ready')))
  );
  const depsNodeModules = path.join(depsDir, 'node_modules');
  assert.ok(fs.existsSync(path.join(depsNodeModules, '.pnpm')));
  assert.ok(fs.existsSync(path.join(depsDir, 'pnpm-workspace.yaml')));
  assert.ok(fs.existsSync(path.join(depsDir, 'packages', 'demo', 'package.json')));
  assert.ok(fs.existsSync(path.join(depsNodeModules, '.pnpm')));
  assert.ok(
    fs.lstatSync(path.join(worker, 'node_modules')).isSymbolicLink(),
    'worker root uses a junction/symlink to shared dependencies'
  );
  assert.ok(
    fs.lstatSync(path.join(worker, 'packages', 'demo', 'node_modules')).isSymbolicLink(),
    'workspace node_modules uses a junction/symlink'
  );

  const stamp = fs.statSync(path.join(depsDir, 'packages', 'demo', 'package.json')).mtimeMs;
  const secondWorker = path.join(area, 'worker-2');
  fs.mkdirSync(secondWorker, { recursive: true });
  for (const rel of [
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'packages/demo/package.json',
  ]) {
    fs.mkdirSync(path.dirname(path.join(secondWorker, rel)), { recursive: true });
    fs.copyFileSync(path.join(worker, rel), path.join(secondWorker, rel));
  }
  launch(host, secondWorker, path.join(area, 'decisions-2'));
  assert.equal(fs.statSync(path.join(depsDir, 'packages', 'demo', 'package.json')).mtimeMs, stamp);
});

test('WP-R01: pnpm install failure records the error code and relative path without blocking', (t) => {
  const area = tmpDir('task-ai-136-error-');
  const host = path.join(area, 'host');
  const worker = path.join(area, 'worker');
  fs.mkdirSync(host, { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  fs.writeFileSync(path.join(host, 'pnpm-lock.yaml'), 'lock');
  fs.writeFileSync(path.join(host, 'package.json'), '{"name":"host"}');
  fs.copyFileSync(path.join(host, 'package.json'), path.join(worker, 'package.json'));
  fs.copyFileSync(path.join(host, 'pnpm-lock.yaml'), path.join(worker, 'pnpm-lock.yaml'));
  const decisionDir = path.join(area, 'decisions');
  installLaunchMocks(t, worker, { code: 'EACCES', message: 'forced install failure' });

  const result = launch(host, worker, decisionDir);
  assert.equal(result.exitCode, 0, 'dependency provisioning failure must not block launch');
  const warnings = decisions
    .readDecisionsDetailed({ dir: decisionDir })
    .records.filter((record) => record.warning === 'WORKER_DEPS_UNAVAILABLE');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].detail, /code=EACCES/);
  assert.match(warnings[0].detail, /message=forced install failure/);
  assert.match(warnings[0].detail, /path=node_modules/);
  assert.ok(!warnings[0].detail.includes(area), 'warning does not expose an absolute host path');
});
