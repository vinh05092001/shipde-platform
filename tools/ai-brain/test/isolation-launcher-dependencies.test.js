'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const supervisor = require('../supervisor');
const decisions = require('../decisions');
const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');

function writeFile(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function directoryLink(root, rel, target) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(path.join(root, target), file, process.platform === 'win32' ? 'junction' : 'dir');
}

function snapshot(root) {
  const entries = {};
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      const rel = path.relative(root, file);
      entries[rel] = stat.isSymbolicLink()
        ? { link: fs.readlinkSync(file), mtime: stat.mtimeMs }
        : stat.isDirectory()
          ? { directory: true, mtime: stat.mtimeMs }
          : { content: fs.readFileSync(file).toString('base64'), mtime: stat.mtimeMs };
      if (stat.isDirectory()) walk(file);
    }
  }
  walk(root);
  return entries;
}

function fixture(t) {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-local-deps-'));
  t.after(() => fs.rmSync(area, { recursive: true, force: true }));
  t.mock.method(os, 'tmpdir', () => area);
  const localAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = area;
  t.after(() => {
    if (localAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = localAppData;
  });
  const host = path.join(area, 'host');
  const workers = ['worker-a', 'worker-b'].map((name) => path.join(area, name));
  const manifests = {
    'pnpm-lock.yaml': 'fixture lock',
    'package.json': JSON.stringify({ private: true }),
    'apps/web/package.json': JSON.stringify({ private: true }),
    'packages/contracts/package.json': JSON.stringify({ name: '@shipde/contracts' }),
  };
  for (const root of [host, ...workers]) {
    for (const [rel, content] of Object.entries(manifests)) writeFile(root, rel, content);
  }
  for (const worker of workers) {
    writeFile(worker, 'packages/contracts/index.js', `module.exports = ${JSON.stringify(worker)};`);
  }
  const hash = crypto.createHash('sha256');
  for (const rel of Object.keys(manifests).sort()) {
    hash.update(rel).update('\0').update(manifests[rel]).update('\0');
  }
  const cache = path.join(area, 'deps', hash.digest('hex').substring(0, 16));
  writeFile(cache, '.shipde-deps-ready', 'ready');
  writeFile(cache, 'packages/contracts/index.js', 'module.exports = "shared-cache";');
  const consumer = 'node_modules/.pnpm/consumer/node_modules/consumer';
  writeFile(cache, `${consumer}/index.js`, 'module.exports = require("@shipde/contracts");');
  for (const rel of ['node_modules/consumer', 'apps/web/node_modules/consumer']) {
    directoryLink(cache, rel, consumer);
  }
  for (const rel of [
    'node_modules/@shipde/contracts',
    'node_modules/.pnpm/node_modules/@shipde/contracts',
    'apps/web/node_modules/@shipde/contracts',
    'packages/contracts/node_modules/@shipde/contracts',
  ]) {
    directoryLink(cache, rel, 'packages/contracts');
  }
  const before = snapshot(cache);
  const baseSha = 'a'.repeat(40);
  const realRm = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (target, options) => {
    if (workers.includes(target)) return;
    return realRm(target, options);
  });
  t.mock.method(supervisor, 'withCleanGitEnv', (dir, callback) => callback('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: baseSha }));
  t.mock.method(cp, 'spawnSync', (command, args) => {
    assert.ok(!String(command).includes('pnpm'), 'ready cache must not be installed again');
    if (command === 'git' && args.some((arg) => String(arg).startsWith('refs/shipde/carry/'))) {
      return { status: 1, stdout: '' };
    }
    if (command === 'powershell.exe') {
      assert.equal(
        path.dirname(args[args.length - 1]),
        area,
        'launch script uses the OS temp directory'
      );
      const script = fs.readFileSync(args[args.length - 1], 'utf8');
      const nonce = script.match(/\$completionNonce = "([^"]+)"/)[1];
      const output = script.match(/\$output \| ConvertTo-Json.*Out-File "([^"]+)"/)[1];
      fs.writeFileSync(
        output,
        JSON.stringify({
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          completed: true,
          completionNonce: nonce,
        })
      );
      return { status: 0, stdout: 'ok' };
    }
    assert.equal(command, 'git', 'no real worker or external command may run');
    return { status: 0, stdout: baseSha };
  });
  const verdictPath = path.join(host, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: host,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: getFolderHash(path.join(host, 'scripts/ai/isolation')),
      sid: 'fixture-sid',
      details: { boundary: 'PASS' },
    })
  );
  const decisionDir = path.join(area, 'decisions');
  function provision(workerRoot) {
    const result = getIsolatedLauncher()({ id: 'dummy', command: 'node' }, [], {
      cwd: host,
      workerRoot,
      baseSha,
      verdictPath,
      decisionDir,
      getWorkerSid: () => 'fixture-sid',
      verifyBoundary: () => true,
      isolatedWorker: true,
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      decisions
        .readDecisionsDetailed({ dir: decisionDir })
        .records.filter((record) => record.warning === 'WORKER_DEPS_UNAVAILABLE'),
      []
    );
  }
  return { workers, cache, before, provision };
}

test('provisioning preserves a symlinked directory dependency and resolves its workspace dependency', (t) => {
  const {
    workers: [worker],
    cache,
    before,
    provision,
  } = fixture(t);
  provision(worker);
  const dependency = path.join(worker, 'apps/web/node_modules/consumer');
  assert.ok(fs.lstatSync(dependency).isSymbolicLink());
  assert.ok(fs.statSync(dependency).isDirectory());
  assert.equal(createRequire(path.join(worker, 'apps/web/index.js'))('consumer'), worker);
  assert.deepEqual(snapshot(cache), before, 'provisioning must not mutate shared cache');
});

test('sequential worker provisioning isolates root, workspace and pnpm transitive resolutions', (t) => {
  const {
    workers: [workerA, workerB],
    cache,
    before,
    provision,
  } = fixture(t);
  const resolveFrom = (worker, rel, dependency) => {
    const requireFrom = createRequire(path.join(worker, rel, 'entry.js'));
    assert.equal(requireFrom(dependency), worker);
    assert.ok(requireFrom.resolve(dependency).startsWith(worker + path.sep));
  };
  provision(workerA);
  resolveFrom(workerA, '.', 'consumer');
  // A retained worker can still have the old root junction into the cache.
  fs.symlinkSync(
    path.join(cache, 'node_modules'),
    path.join(workerB, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  provision(workerB);
  for (const worker of [workerA, workerB]) {
    resolveFrom(worker, '.', '@shipde/contracts');
    resolveFrom(worker, 'apps/web', 'consumer');
    resolveFrom(worker, 'node_modules/.pnpm/node_modules', '@shipde/contracts');
    const consumerFile = createRequire(path.join(worker, 'entry.js')).resolve('consumer');
    assert.equal(createRequire(consumerFile)('@shipde/contracts'), worker);
    assert.ok(fs.realpathSync(consumerFile).startsWith(worker + path.sep));
    for (const [rel, entry] of Object.entries(snapshot(worker))) {
      if (entry.link) {
        assert.ok(
          fs.realpathSync(path.join(worker, rel)).startsWith(worker + path.sep),
          `${rel} must resolve inside its own checkout`
        );
      }
    }
  }
  writeFile(
    workerA,
    'node_modules/.pnpm/consumer/node_modules/consumer/index.js',
    'changed locally'
  );
  assert.match(
    fs.readFileSync(
      path.join(cache, 'node_modules/.pnpm/consumer/node_modules/consumer/index.js'),
      'utf8'
    ),
    /require/
  );
  assert.match(
    fs.readFileSync(
      path.join(workerB, 'node_modules/.pnpm/consumer/node_modules/consumer/index.js'),
      'utf8'
    ),
    /require/
  );
  assert.deepEqual(snapshot(cache), before, 'both launches and worker edits leave cache immutable');
});
