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
  t.mock.method(cp, 'spawnSync', (cmd, args) => {
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
  t.mock.method(cp, 'spawnSync', (cmd, args) => {
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
  const dirsInDeps = fs.readdirSync(depsBase);
  assert.equal(dirsInDeps.length, 1, 'One hash directory created');
  assert.equal(dirsInDeps[0], expectedDepsHash(workerRoot), 'hash derived from the lockfiles');
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
    fs.readdirSync(depsBase),
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
  // A stale real node_modules left in the worker root must become a junction.
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
    fs.existsSync(path.join(depNm, 'credentials.js')),
    'real dependency modules survive the secret filter'
  );
  for (const secret of ['.env', '.npmrc', 'token.json', 'id_rsa', 'server.pem']) {
    assert.ok(!fs.existsSync(path.join(depNm, secret)), secret + ' NOT copied');
  }
  assert.ok(
    !fs.existsSync(path.join(workerRoot, 'node_modules', 'stale.txt')),
    'stale real node_modules replaced by the junction'
  );
  assert.ok(
    fs.lstatSync(path.join(workerRoot, 'node_modules')).isSymbolicLink(),
    'root node_modules is a junction'
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

test('WD-R04: isolated worker prompts carry the runnable commands (author, repair and cli paths)', async (t) => {
  const { compilePrompt, ISOLATED_WORKER_VERIFICATION_NOTE } = require('../prompt-compiler');
  const { defaultPrompt, resumePrompt } = require('../executor');
  const area = tmpDir('area-prompt-');

  const item = {
    id: 'TASK-AI-127',
    allowedPaths: ['tools/ai-brain/isolation-launcher.js'],
    acceptanceCriteria: ['isolated workers can run the repo tools'],
    verification: { command: 'node --test tools/ai-brain/test/task-ai-127.test.js' },
    roleRequirement: { role: 'author.foundation' },
  };
  const assignment = {
    workItemId: 'TASK-AI-127',
    branch: 'feat/task-ai-127-worker-deps',
  };
  const phrases = [
    'pnpm lint',
    'pnpm typecheck',
    'pnpm format:check',
    'prettier --write',
    'API supertests skip without a database',
  ];

  // (a) compilePrompt — the compiler behind orchestrate author + repair.
  const compiled = compilePrompt(item, {
    goal: 'isolated workers can run the repo tools',
    isolatedWorker: true,
    branch: 'feat/task-ai-127-worker-deps',
  });
  for (const phrase of phrases) {
    assert.ok(compiled.includes(phrase), 'compilePrompt must carry: ' + phrase);
  }
  assert.ok(compiled.includes(ISOLATED_WORKER_VERIFICATION_NOTE));
  assert.ok(
    !compilePrompt(item, { goal: 'g' }).includes('pnpm lint'),
    'non-isolated prompts carry no worker tools note'
  );

  // (b) executor prompts — the compilers behind the cli dispatch path.
  for (const prompt of [
    defaultPrompt(assignment, { isolatedWorker: true }),
    resumePrompt(assignment, { isolatedWorker: true }),
  ]) {
    for (const phrase of phrases) {
      assert.ok(prompt.includes(phrase), 'executor prompt must carry: ' + phrase);
    }
  }
  assert.ok(!defaultPrompt(assignment).includes('pnpm lint'), 'no opts, no note');

  const isoMod = require('../isolation-launcher');

  // (c) cli dispatch path: defaultPrompt(item) is called with real opts.
  const cliCandidate = {
    harness: 'paseo',
    accessPath: 'http://127.0.0.1:20128/v1',
    gateway: '9router',
    upstream: 'gh',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: 'gh/gpt-4o',
    qualifiedRoles: ['author.foundation'],
    cost: 10,
    quality: 80,
  };
  let cliArgs = null;
  t.mock.method(isoMod, 'getIsolatedLauncher', () => (adapter, args) => {
    cliArgs = args;
    return { exitCode: 0, stdout: '{"id":"sess-1","status":"running"}' };
  });
  const { dispatchCommand } = require('../cli');
  const cliRes = dispatchCommand(
    { execute: true, item: 'TASK-AI-127', 'isolated-worker': true },
    {
      candidates: [cliCandidate],
      evidenceDir: path.join(area, 'evidence'),
      home: path.join(area, 'home'),
      decisionDir: path.join(area, 'cli-decisions'),
      exit: () => {},
      log: () => {},
    }
  );
  assert.ok(cliRes, 'dispatch must produce a result');
  assert.ok(cliArgs, 'isolated dispatch must reach the isolated launcher');
  const cliText = JSON.stringify(cliArgs);
  for (const phrase of phrases) {
    assert.ok(cliText.includes(phrase), 'cli dispatch prompt must carry: ' + phrase);
  }

  // (d) orchestrate author path: compilePrompt is reached with isolatedWorker.
  const orch = require('../orchestrate');
  t.mock.method(isoMod, 'getIsolatedLauncher', () => () => ({
    exitCode: 0,
    stdout: 'opencode finished',
    completionNonce: 'nonce-127',
  }));
  t.mock.method(isoMod, 'isWorkerPath', () => true);
  const authorCandidate = {
    harness: 'paseo',
    source: '9router',
    modelId: 'ag/gemini-3.1-pro-low',
    gateway: '9router',
    upstream: 'ag',
    accountId: 'codex',
  };
  const authorLog = await orch.runOrchestration('isolated workers can run the repo tools', {
    specs: [item],
    candidates: [authorCandidate],
    isolatedWorker: true,
    cwd: path.join(area, 'ai127-host'),
    decisionDir: path.join(area, 'orch-decisions'),
  });
  assert.ok(
    authorLog && Array.isArray(authorLog.prompts) && authorLog.prompts.length > 0,
    'author prompt must be compiled'
  );
  for (const phrase of phrases) {
    assert.ok(
      authorLog.prompts[0].prompt.includes(phrase),
      'orchestrate author prompt must carry: ' + phrase
    );
  }

  // (e) orchestrate repair path: the repair round prompt carries the note too.
  const { candidateKey } = require('../candidates');
  const sourcesApi = require('../sources');
  const repairCandidate = {
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: '9router',
    upstream: 'ag',
    accountId: 'codex',
    quotaScope: 'codex',
    modelId: 'ag/gemini-3.1-pro-low',
    source: '9router',
    kind: 'router',
  };
  repairCandidate.candidateKey = candidateKey(repairCandidate);
  let repairJob = null;
  const repairLauncher = async (job) => {
    repairJob = job;
    return { exitCode: 0, stdout: 'fixed', completionNonce: 'nonce-repair' };
  };
  const baseSha = 'b'.repeat(40);
  const headSha = 'c'.repeat(40);
  const repairFn = orch.repairRound(
    { specs: [item], baseSha, isolatedWorker: true },
    item,
    { candidateKey: repairCandidate.candidateKey, baseSha },
    { goal: 'isolated workers can run the repo tools' },
    { dir: path.join(area, 'repair-decisions') },
    repairLauncher,
    path.join(area, 'usage'),
    Date.now(),
    [repairCandidate],
    {},
    sourcesApi.loadSources()
  );
  await repairFn(
    [
      {
        id: 'FORMAT_CHECK_FAILED',
        open: true,
        detail: 'unformatted files; offending paths: tools/ai-brain/isolation-launcher.js',
        dirtyPaths: ['tools/ai-brain/isolation-launcher.js'],
        headSha,
        baseSha,
      },
    ],
    headSha
  );
  assert.ok(repairJob, 'repair launcher must be invoked');
  for (const phrase of phrases) {
    assert.ok(repairJob.prompt.includes(phrase), 'orchestrate repair prompt must carry: ' + phrase);
  }
});
