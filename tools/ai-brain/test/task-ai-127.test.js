'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const supervisor = require('../supervisor');

const { getIsolatedLauncher } = require('../isolation-launcher');

const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
const dirs = [];
function tmpDir(prefix) {
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test('WD-R01, WD-R02, WD-R03, WD-R04 dependencies provisioning', (t) => {
  const hostCwd = tmpDir('host-');
  const workerRoot = tmpDir('worker-');

  // Set up host node_modules and workspaces
  fs.mkdirSync(path.join(hostCwd, 'node_modules'));
  fs.writeFileSync(path.join(hostCwd, 'node_modules', 'root-dep.js'), 'root');

  fs.mkdirSync(path.join(hostCwd, 'apps', 'web', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(hostCwd, 'apps', 'web', 'node_modules', 'web-dep.js'), 'web');

  // Should exclude .env
  fs.writeFileSync(path.join(hostCwd, 'node_modules', '.env'), 'secret');

  // Set up base files in workerRoot (pnpm-lock.yaml)
  fs.writeFileSync(path.join(workerRoot, 'pnpm-lock.yaml'), 'lock');
  fs.writeFileSync(path.join(workerRoot, 'package.json'), 'pkg');
  fs.mkdirSync(path.join(workerRoot, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(workerRoot, 'apps', 'web', 'package.json'), 'pkg-web');

  const verdictPath = path.join(hostCwd, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: hostCwd,
      timestamp: new Date(Date.now() - 10000).toISOString(),
      policyHash:
        require('../isolation-launcher').getFolderHash(
          path.join(hostCwd, 'scripts/ai/isolation')
        ) || 'hash',
      sid: 'mock-sid',
      details: { check: 'PASS' },
    })
  );

  const baseSha = 'a'.repeat(40);

  t.mock.method(fs, 'rmSync', () => {});
  t.mock.method(cp, 'spawnSync', (cmd, args) => {
    if (cmd === 'powershell.exe') {
      // Stub PowerShell, write the fake launch result so the launcher doesn't block/fail
      const tempScript = args[args.length - 1];
      const content = fs.readFileSync(tempScript, 'utf8');
      const markerPathMatch = content.match(/\$markerPath = "([^"]+)"/);
      const nonceMatch = content.match(/\$completionNonce = "([^"]+)"/);
      const resPathMatch = content.match(/Out-File "\${launchResultPath}"/); // Wait, this doesn't help find the path
      // we can extract launchResultPath from the script
      const resPath = content.match(/\$output \| ConvertTo-Json.*Out-File "([^"]+)"/)[1];

      fs.writeFileSync(
        resPath,
        JSON.stringify({
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          completed: true,
          completionNonce: nonceMatch[1],
        }),
        'utf8'
      );

      return { status: 0, stdout: 'ok' };
    }
    return { status: 0, stdout: baseSha };
  });

  t.mock.method(supervisor, 'withCleanGitEnv', (dir, cb) => cb('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: baseSha }));

  const launcher = getIsolatedLauncher();

  const opts = {
    verdictPath,
    cwd: hostCwd,
    workerRoot,
    baseSha,
    getWorkerSid: () => 'mock-sid',
    verifyBoundary: () => true,
    isolatedWorker: true,
  };

  const res = launcher({ id: 'dummy', command: 'node' }, [], opts);

  // Verify WD-R01: Shared deps dir is created and populated
  const hash = crypto.createHash('sha256').update('lock').update('pkg-web').update('pkg'); // alphabetical sort of absolute paths -> package.json, pnpm-lock.yaml... Wait, exact hash depends on absolute paths in my findPackageJsons implementation!
  // It's easier to just find the deps dir by searching WORKER_ROOT/deps

  const WORKER_ROOT = path.dirname(workerRoot);
  const depsBase = path.join(WORKER_ROOT, 'deps');
  const dirsInDeps = fs.readdirSync(depsBase);
  assert.equal(dirsInDeps.length, 1, 'One hash directory created');
  const depsDir = path.join(depsBase, dirsInDeps[0]);

  assert.ok(fs.existsSync(path.join(depsDir, 'node_modules', 'root-dep.js')), 'root dep copied');
  assert.ok(!fs.existsSync(path.join(depsDir, 'node_modules', '.env')), '.env NOT copied');
  assert.ok(
    fs.existsSync(path.join(depsDir, 'apps', 'web', 'node_modules', 'web-dep.js')),
    'web dep copied'
  );

  assert.ok(fs.existsSync(path.join(depsDir, '.shipde-deps-ready')), 'marker exists');

  // Verify WD-R02: Junctions
  assert.ok(
    fs.existsSync(path.join(workerRoot, 'node_modules', 'root-dep.js')),
    'root junction works'
  );
  assert.ok(
    fs.existsSync(path.join(workerRoot, 'apps', 'web', 'node_modules', 'web-dep.js')),
    'web junction works'
  );

  const excludeData = fs.readFileSync(path.join(workerRoot, '.git', 'info', 'exclude'), 'utf8');
  assert.ok(excludeData.includes('node_modules/'), 'root nm excluded');
  assert.ok(excludeData.includes('apps/web/node_modules/'), 'web nm excluded');
});
