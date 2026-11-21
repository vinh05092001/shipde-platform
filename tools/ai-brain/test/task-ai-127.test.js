'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const supervisor = require('../supervisor');
const decisions = require('../decisions');

const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');

const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
const dirs = [];
function tmpDir(prefix) {
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const BASE_SHA = 'a'.repeat(40);

/** The WD-R01 hash, recomputed the way the launcher derives it. */
function expectedDepsHash(workerRoot) {
  const rels = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name === 'package.json') {
        rels.push(path.relative(workerRoot, path.join(dir, entry.name)).split(path.sep).join('/'));
      }
    }
  };
  walk(workerRoot);
  const entries = ['pnpm-lock.yaml', ...rels].sort();
  const hash = crypto.createHash('sha256');
  for (const rel of entries) {
    hash.update(rel, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(fs.readFileSync(path.join(workerRoot, rel)));
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex').substring(0, 16);
}

function writeVerdict(hostCwd) {
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
  return verdictPath;
}

/**
 * Fake harness plumbing: PowerShell writes a passing launch result, git
 * answers with the pinned base SHA, and the pre-clone delete of workerRoot is
 * skipped (the test planted the worker's base files there). Deletes outside
 * the protected worker roots run for real.
 */
function installLaunchMocks(t, workerRoots) {
  const protectedRoots = new Set(workerRoots.map((p) => path.resolve(String(p)).toLowerCase()));
  const realRmSync = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (p, o) => {
    if (protectedRoots.has(path.resolve(String(p)).toLowerCase())) return undefined;
    return realRmSync(p, o);
  });
  t.mock.method(cp, 'spawnSync', (cmd, args, options) => {
    // This dependency fixture has no private carry-over ref.
    if (cmd === 'git' && args.some((arg) => String(arg).startsWith('refs/shipde/carry/')))
      return { status: 1, stdout: '' };
    if (
      (String(cmd).toLowerCase().endsWith('pnpm.exe') || cmd === 'pnpm.cmd' || cmd === 'pnpm') &&
      args[0] === 'install'
    ) {
      fs.mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'root-dep.js'), 'root');
      fs.mkdirSync(path.join(options.cwd, 'apps', 'web', 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'apps', 'web', 'node_modules', 'web-dep.js'), 'web');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'powershell.exe') {
      const tempScript = args[args.length - 1];
      const content = fs.readFileSync(tempScript, 'utf8');
      const nonceMatch = content.match(/\$completionNonce = "([^"]+)"/);
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
    return { status: 0, stdout: BASE_SHA };
  });
  t.mock.method(supervisor, 'withCleanGitEnv', (dir, cb) => cb('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: BASE_SHA }));
}

function launchOptions(hostCwd, workerRoot, verdictPath, decisionDir, extra) {
  return Object.assign(
    {
      verdictPath,
      cwd: hostCwd,
      workerRoot,
      baseSha: BASE_SHA,
      decisionDir,
      getWorkerSid: () => 'mock-sid',
      verifyBoundary: () => true,
      isolatedWorker: true,
    },
    extra || {}
  );
}

test('WD-R01, WD-R02, WD-R03, WD-R04 dependencies provisioning', (t) => {
  const area = tmpDir('area-');
  const hostCwd = path.join(area, 'host');
  const workerRoot = path.join(area, 'worker');
  fs.mkdirSync(hostCwd, { recursive: true });
  fs.mkdirSync(workerRoot, { recursive: true });

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
  fs.mkdirSync(path.join(hostCwd, 'apps', 'web'), { recursive: true });
  fs.copyFileSync(path.join(workerRoot, 'pnpm-lock.yaml'), path.join(hostCwd, 'pnpm-lock.yaml'));
  fs.copyFileSync(path.join(workerRoot, 'package.json'), path.join(hostCwd, 'package.json'));
  fs.copyFileSync(
    path.join(workerRoot, 'apps', 'web', 'package.json'),
    path.join(hostCwd, 'apps', 'web', 'package.json')
  );

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

  t.mock.method(fs, 'rmSync', () => {});
  t.mock.method(cp, 'spawnSync', (cmd, args, options) => {
    if (
      (String(cmd).toLowerCase().endsWith('pnpm.exe') || cmd === 'pnpm.cmd' || cmd === 'pnpm') &&
      args[0] === 'install'
    ) {
      fs.mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'root-dep.js'), 'root');
      fs.mkdirSync(path.join(options.cwd, 'apps', 'web', 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'apps', 'web', 'node_modules', 'web-dep.js'), 'web');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'powershell.exe') {
      // Stub PowerShell, write the fake launch result so the launcher doesn't block/fail
      const tempScript = args[args.length - 1];
      const content = fs.readFileSync(tempScript, 'utf8');
      const nonceMatch = content.match(/\$completionNonce = "([^"]+)"/);
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
    return { status: 0, stdout: BASE_SHA };
  });

  t.mock.method(supervisor, 'withCleanGitEnv', (dir, cb) => cb('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: BASE_SHA }));

  const launcher = getIsolatedLauncher();

  const opts = {
    verdictPath,
    cwd: hostCwd,
    workerRoot,
    baseSha: BASE_SHA,
    getWorkerSid: () => 'mock-sid',
    verifyBoundary: () => true,
    isolatedWorker: true,
  };

  const res = launcher({ id: 'dummy', command: 'node' }, [], opts);
  assert.equal(res.exitCode, 0);

  // Verify WD-R01: Shared deps dir is created and populated under the
  // per-run worker area, named by the lockfile hash.
  const WORKER_ROOT = path.dirname(workerRoot);
  const depsBase = path.join(WORKER_ROOT, 'deps');
  const dirsInDeps = fs.readdirSync(depsBase).filter((name) => !name.includes('.staging-'));
  assert.equal(dirsInDeps.length, 1, 'One hash directory created');
  assert.equal(dirsInDeps[0], expectedDepsHash(workerRoot), 'hash derived from the lockfiles');
  const depsDir = path.join(depsBase, dirsInDeps[0]);

  assert.ok(fs.existsSync(path.join(depsDir, 'node_modules', 'root-dep.js')), 'root dep copied');
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

test('WD-R01: the shared deps directory name is the sha256 of pnpm-lock.yaml + package.json files', (t) => {
  const area = tmpDir('area-hash-');
  const hostCwd = path.join(area, 'host');
  fs.mkdirSync(path.join(hostCwd, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(hostCwd, 'node_modules', 'root-dep.js'), 'root');

  const makeWorker = (name, rootPkg, webPkg) => {
    const workerRoot = path.join(area, name);
    fs.mkdirSync(path.join(workerRoot, 'apps', 'web'), { recursive: true });
    fs.writeFileSync(path.join(workerRoot, 'pnpm-lock.yaml'), 'lock');
    fs.writeFileSync(path.join(workerRoot, 'package.json'), rootPkg);
    fs.writeFileSync(path.join(workerRoot, 'apps', 'web', 'package.json'), webPkg);
    fs.mkdirSync(path.join(hostCwd, 'apps', 'web'), { recursive: true });
    fs.copyFileSync(path.join(workerRoot, 'pnpm-lock.yaml'), path.join(hostCwd, 'pnpm-lock.yaml'));
    fs.copyFileSync(path.join(workerRoot, 'package.json'), path.join(hostCwd, 'package.json'));
    fs.copyFileSync(
      path.join(workerRoot, 'apps', 'web', 'package.json'),
      path.join(hostCwd, 'apps', 'web', 'package.json')
    );
    return workerRoot;
  };

  const workerA = makeWorker('worker-a', 'pkg', 'pkg-web');
  const workerB = makeWorker('worker-b', 'pkg', 'pkg-web-changed');
  // Same total bytes as worker A, distributed differently across files.
  const workerC = makeWorker('worker-c', 'pkg-web', 'pkg');

  installLaunchMocks(t, [workerA, workerB, workerC]);
  const verdictPath = writeVerdict(hostCwd);
  const decisionDir = path.join(area, 'decisions');
  const launcher = getIsolatedLauncher();

  const launch = (workerRoot) =>
    launcher(
      { id: 'dummy', command: 'node' },
      [],
      launchOptions(hostCwd, workerRoot, verdictPath, decisionDir)
    );

  const hashA = expectedDepsHash(workerA);
  const hashB = expectedDepsHash(workerB);
  const hashC = expectedDepsHash(workerC);
  assert.match(hashA, /^[0-9a-f]{16}$/, 'first 16 hex of the sha256');
  assert.notEqual(hashA, hashB, 'changing a package.json must change the hash');
  assert.notEqual(
    hashA,
    hashC,
    'identical bytes in different files must not produce the same hash'
  );

  assert.equal(launch(workerA).exitCode, 0);
  const depsBase = path.join(area, 'deps');
  assert.deepEqual(
    fs.readdirSync(depsBase).filter((name) => !name.includes('.staging-')),
    [hashA],
    'the dir the launcher created is exactly the lockfile hash'
  );

  assert.equal(launch(workerB).exitCode, 0);
  assert.deepEqual(fs.readdirSync(depsBase).sort(), [hashA, hashB].sort());
});

test('WD-R01: shared deps are copied once, then reused via the ready marker', (t) => {
  const area = tmpDir('area-reuse-');
  const hostCwd = path.join(area, 'host');
  const workerRoot = path.join(area, 'worker');

  fs.mkdirSync(path.join(hostCwd, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(hostCwd, 'node_modules', 'root-dep.js'), 'root');
  fs.writeFileSync(path.join(hostCwd, 'node_modules', 'credentials.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(hostCwd, 'node_modules', '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(hostCwd, 'node_modules', '.npmrc'), '//registry:_authToken=x');
  fs.writeFileSync(path.join(hostCwd, 'node_modules', 'token.json'), '{"token":"x"}');
  fs.writeFileSync(path.join(hostCwd, 'node_modules', 'id_rsa'), 'PRIVATE KEY');
  fs.writeFileSync(path.join(hostCwd, 'node_modules', 'server.pem'), 'CERTIFICATE');
  fs.mkdirSync(path.join(hostCwd, 'apps', 'web', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(hostCwd, 'apps', 'web', 'node_modules', 'web-dep.js'), 'web');

  fs.mkdirSync(path.join(workerRoot, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(workerRoot, 'pnpm-lock.yaml'), 'lock');
  fs.writeFileSync(path.join(workerRoot, 'package.json'), 'pkg');
  fs.writeFileSync(path.join(workerRoot, 'apps', 'web', 'package.json'), 'pkg-web');
  fs.mkdirSync(path.join(hostCwd, 'apps', 'web'), { recursive: true });
  fs.copyFileSync(path.join(workerRoot, 'pnpm-lock.yaml'), path.join(hostCwd, 'pnpm-lock.yaml'));
  fs.copyFileSync(path.join(workerRoot, 'package.json'), path.join(hostCwd, 'package.json'));
  fs.copyFileSync(
    path.join(workerRoot, 'apps', 'web', 'package.json'),
    path.join(hostCwd, 'apps', 'web', 'package.json')
  );
  // Replace a stale node_modules with the worker-owned dependency graph.
  fs.mkdirSync(path.join(workerRoot, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(workerRoot, 'node_modules', 'stale.txt'), 'stale');

  installLaunchMocks(t, [workerRoot]);
  const verdictPath = writeVerdict(hostCwd);
  const decisionDir = path.join(area, 'decisions');
  const launcher = getIsolatedLauncher();
  const launch = () =>
    launcher(
      { id: 'dummy', command: 'node' },
      [],
      launchOptions(hostCwd, workerRoot, verdictPath, decisionDir, {
        workItemId: 'TASK-AI-127',
        branch: 'feat/task-ai-127-worker-deps',
      })
    );

  assert.equal(launch().exitCode, 0);

  const depsDir = path.join(area, 'deps', expectedDepsHash(workerRoot));
  const depNm = path.join(depsDir, 'node_modules');
  assert.ok(fs.existsSync(path.join(depsDir, '.shipde-deps-ready')), 'marker exists');
  assert.ok(fs.existsSync(path.join(depNm, 'root-dep.js')), 'root dep copied');
  assert.ok(
    !fs.existsSync(path.join(workerRoot, 'node_modules', 'stale.txt')),
    'stale real node_modules replaced by the worker-owned dependency graph'
  );
  assert.ok(
    !fs.lstatSync(path.join(workerRoot, 'node_modules')).isSymbolicLink(),
    'root node_modules is worker-owned so transitive resolution cannot escape into the cache'
  );
  assert.ok(
    fs.existsSync(path.join(workerRoot, 'apps', 'web', 'node_modules', 'web-dep.js')),
    'web junction works'
  );

  // Copy once: a marker-gated second launch must reuse, not re-copy.
  const sentinel = path.join(depNm, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'survives reuse');
  assert.equal(launch().exitCode, 0);
  assert.ok(fs.existsSync(sentinel), 'marked cache is reused, never re-copied');
  assert.ok(fs.existsSync(path.join(depsDir, '.shipde-deps-ready')), 'marker kept');

  // No marker: the cache is not ready and must be rebuilt from scratch.
  fs.rmSync(path.join(depsDir, '.shipde-deps-ready'));
  assert.equal(launch().exitCode, 0);
  assert.ok(!fs.existsSync(sentinel), 'unmarked cache is re-populated');
  assert.ok(fs.existsSync(path.join(depsDir, '.shipde-deps-ready')), 'marker restored');
  assert.ok(fs.existsSync(path.join(depNm, 'root-dep.js')), 'deps rebuilt');
});

test('WD-R03: a deps failure warns WORKER_DEPS_UNAVAILABLE in the decision log and never blocks the launch', (t) => {
  const area = tmpDir('area-warn-');
  const hostCwd = path.join(area, 'host');
  const workerRoot = path.join(area, 'worker');
  fs.mkdirSync(hostCwd, { recursive: true });
  // No host node_modules on purpose: provisioning cannot succeed.
  fs.mkdirSync(path.join(workerRoot, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(workerRoot, 'pnpm-lock.yaml'), 'lock');
  fs.writeFileSync(path.join(workerRoot, 'package.json'), 'pkg');
  fs.writeFileSync(path.join(workerRoot, 'apps', 'web', 'package.json'), 'pkg-web');

  installLaunchMocks(t, [workerRoot]);
  const verdictPath = writeVerdict(hostCwd);
  const decisionDir = path.join(area, 'decisions');
  const res = getIsolatedLauncher()(
    { id: 'dummy', command: 'node' },
    [],
    launchOptions(hostCwd, workerRoot, verdictPath, decisionDir, {
      workItemId: 'TASK-AI-127',
      branch: 'feat/task-ai-127-worker-deps',
    })
  );

  assert.equal(res.exitCode, 0, 'WD-R03: the launch must not be blocked');

  const read = decisions.readDecisionsDetailed({ dir: decisionDir });
  assert.equal(read.readable, true);
  const warnings = read.records.filter((r) => r.warning === 'WORKER_DEPS_UNAVAILABLE');
  assert.equal(warnings.length, 1, 'exactly one WORKER_DEPS_UNAVAILABLE warning');
  assert.equal(warnings[0].stage, 'warning');
  assert.match(String(warnings[0].detail), /failed to copy dependencies/);
  assert.equal(warnings[0].workItemId, 'TASK-AI-127');
  assert.equal(warnings[0].branch, 'feat/task-ai-127-worker-deps');

  const depsBase = path.join(area, 'deps');
  if (fs.existsSync(depsBase)) {
    assert.deepEqual(fs.readdirSync(depsBase), [], 'a failed copy leaves no half-populated cache');
  }
  assert.ok(!fs.existsSync(path.join(workerRoot, 'node_modules')), 'no junction after failure');
});
