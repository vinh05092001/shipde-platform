'use strict';

// A user or global pnpm config can set virtualStoreDir to another checkout.
// The shared worker deps cache must still keep pnpm's virtual store inside
// itself, or every isolated launch loses its dependencies with
// WORKER_DEPS_LINK_OUTSIDE_CACHE.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const supervisor = require('../supervisor');
const decisions = require('../decisions');
const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');

const BASE_SHA = 'a'.repeat(40);
const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
const dirs = [];
test.after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tmpDir(prefix) {
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}

/**
 * Fake pnpm that places its virtual store the way pnpm does: the
 * --virtual-store-dir argument wins over config, and config (here the
 * pnpm_config_virtual_store_dir variable) wins over the node_modules/.pnpm
 * default. node_modules/dep links into that store.
 */
function fakePnpmInstall(args, cwd) {
  const flag = args.find((arg) => String(arg).startsWith('--virtual-store-dir='));
  const store = flag
    ? path.resolve(cwd, flag.slice('--virtual-store-dir='.length))
    : process.env.pnpm_config_virtual_store_dir || path.join(cwd, 'node_modules', '.pnpm');
  const pkg = path.join(store, 'dep@1.0.0', 'node_modules', 'dep');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'index.js'), 'module.exports = 1;');
  fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
  fs.symlinkSync(pkg, path.join(cwd, 'node_modules', 'dep'), 'junction');
  return { status: 0, stdout: '', stderr: '' };
}

function installMocks(t, workerRoot) {
  const realRmSync = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (p, o) =>
    path.resolve(String(p)).toLowerCase() === path.resolve(workerRoot).toLowerCase()
      ? undefined
      : realRmSync(p, o)
  );
  t.mock.method(cp, 'spawnSync', (cmd, args, options) => {
    if (cmd === 'git' && args.some((arg) => String(arg).startsWith('refs/shipde/carry/')))
      return { status: 1, stdout: '' };
    if (/pnpm(\.exe|\.cmd)?$/i.test(String(cmd)) && args[0] === 'install')
      return fakePnpmInstall(args, options.cwd);
    if (cmd === 'powershell.exe') {
      const content = fs.readFileSync(args[args.length - 1], 'utf8');
      const nonce = content.match(/\$completionNonce = "([^"]+)"/)[1];
      const resPath = content.match(/\$output \| ConvertTo-Json.*Out-File "([^"]+)"/)[1];
      fs.writeFileSync(
        resPath,
        JSON.stringify({
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          completed: true,
          completionNonce: nonce,
        }),
        'utf8'
      );
      return { status: 0, stdout: 'ok' };
    }
    return { status: 0, stdout: BASE_SHA };
  });
  t.mock.method(supervisor, 'withCleanGitEnv', (dir, cb) => cb('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: BASE_SHA }));
}

test('worker deps keep the pnpm virtual store inside the cache when config points elsewhere', (t) => {
  const area = tmpDir('area-vstore-');
  const hostCwd = path.join(area, 'host');
  const workerRoot = path.join(area, 'worker');
  const foreignStore = path.join(area, 'other-checkout', 'node_modules', '.pnpm');
  for (const root of [hostCwd, workerRoot]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lock');
    fs.writeFileSync(path.join(root, 'package.json'), 'pkg');
  }
  const verdictPath = path.join(hostCwd, 'verdict.json');
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

  const previous = process.env.pnpm_config_virtual_store_dir;
  process.env.pnpm_config_virtual_store_dir = foreignStore;
  t.after(() => {
    if (previous === undefined) delete process.env.pnpm_config_virtual_store_dir;
    else process.env.pnpm_config_virtual_store_dir = previous;
  });
  installMocks(t, workerRoot);

  const decisionDir = path.join(area, 'decisions');
  const res = getIsolatedLauncher()({ id: 'dummy', command: 'node' }, [], {
    verdictPath,
    cwd: hostCwd,
    workerRoot,
    baseSha: BASE_SHA,
    decisionDir,
    getWorkerSid: () => 'mock-sid',
    verifyBoundary: () => true,
    isolatedWorker: true,
  });
  assert.equal(res.exitCode, 0);

  const warnings = decisions
    .readDecisionsDetailed({ dir: decisionDir })
    .records.filter((r) => r.warning === 'WORKER_DEPS_UNAVAILABLE');
  assert.deepEqual(
    warnings.map((w) => w.detail),
    [],
    'dependencies must be provisioned, not dropped'
  );
  const depFile = path.join(workerRoot, 'node_modules', 'dep', 'index.js');
  assert.ok(fs.existsSync(depFile), 'the worker resolves its dependency');
  const real = fs.realpathSync(depFile);
  assert.ok(
    !path.relative(workerRoot, real).startsWith('..'),
    'the dependency resolves inside the worker checkout, not ' + real
  );
  assert.ok(!fs.existsSync(foreignStore), 'nothing is written to the foreign virtual store');
});
