const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const { getIsolatedLauncher } = require('../isolation-launcher');
const orchestrate = require('../orchestrate');
const cli = require('../cli');
const decisions = require('../decisions');

const TMP = path.join(__dirname, '..', '..', '..', '.upstream-tmp', 'task-ai-128-test');
if (fs.existsSync(TMP)) {
  fs.rmSync(TMP, { recursive: true, force: true });
}
fs.mkdirSync(TMP, { recursive: true });

function createGitRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  cp.execSync('git init', { cwd: dir });
  cp.execSync('git config user.name "Test"', { cwd: dir });
  cp.execSync('git config user.email "test@example.com"', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'base');
  cp.execSync('git add file.txt', { cwd: dir });
  cp.execSync('git commit -m "base"', { cwd: dir });
  const baseSha = cp.execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
  return { dir, baseSha };
}

test('RH-R01: adopt a descendant repair HEAD', async () => {
  const { dir: hostCwd, baseSha } = createGitRepo(path.join(TMP, 'host1'));
  const workerRoot = path.join(TMP, 'worker1');
  fs.mkdirSync(workerRoot, { recursive: true });
  cp.execSync(`git clone ${hostCwd} .`, { cwd: workerRoot });
  cp.execSync('git config user.name "Test"', { cwd: workerRoot });
  cp.execSync('git config user.email "test@example.com"', { cwd: workerRoot });

  // Make a commit in worker root
  fs.writeFileSync(path.join(workerRoot, 'file.txt'), 'edit1');
  cp.execSync('git add file.txt', { cwd: workerRoot });
  cp.execSync('git commit -m "repair 1"', { cwd: workerRoot });
  const repairSha = cp.execSync('git rev-parse HEAD', { cwd: workerRoot }).toString().trim();

  const decisionDir = path.join(TMP, 'decisions1');
  fs.mkdirSync(decisionDir, { recursive: true });

  decisions.recordDecision(
    {
      stage: decisions.Stage.LAUNCHED,
      workItemId: 'FEAT-1',
      sha: repairSha,
      detail: 'REPAIR_ROUND: repairs FEAT-1',
    },
    { dir: decisionDir }
  );

  const checkpointPath = path.join(TMP, 'checkpoint1.json');
  cli.writeJsonFile(checkpointPath, {
    schemaVersion: 1,
    liveSteps: { 'FEAT-1': { launch: { workerSha: baseSha }, repair: { sha: baseSha } } },
  });

  const opts = {
    baseSha: baseSha,
    retainWorkerHead: baseSha,
    cwd: hostCwd,
    workerRoot: workerRoot,
    decisionDir: decisionDir,
    workItemId: 'FEAT-1',
    checkpoint: checkpointPath,
    getWorkerSid: () => 'SID-1',
    verifyBoundary: () => true,
  };

  const launcher = getIsolatedLauncher();
  const verdictPath = path.join(TMP, 'verdict1.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: hostCwd,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: require('../isolation-launcher').getFolderHash(
        path.join(hostCwd, 'scripts/ai/isolation')
      ),
      sid: 'SID-1',
      details: { Test: 'PASS' },
    })
  );

  opts.verdictPath = verdictPath;

  // It should NOT throw!
  let threw = false;
  try {
    await launcher({ id: 'test' }, null, opts);
  } catch (err) {
    threw = true;
    console.error(err);
  }
  assert.strictEqual(threw, false, 'Launcher should adopt HEAD and not throw');

  const checkpoint = cli.readCheckpoint(checkpointPath);
  assert.strictEqual(checkpoint.liveSteps['FEAT-1'].launch.workerSha, repairSha);
  assert.strictEqual(checkpoint.liveSteps['FEAT-1'].repair.sha, repairSha);
});

test('RH-R02: refuse a non-descendant or dirty HEAD as local with no cooldown', async () => {
  const { dir: hostCwd, baseSha } = createGitRepo(path.join(TMP, 'host2'));
  const workerRoot = path.join(TMP, 'worker2');
  fs.mkdirSync(workerRoot, { recursive: true });
  cp.execSync(`git clone ${hostCwd} .`, { cwd: workerRoot });

  fs.writeFileSync(path.join(workerRoot, 'file.txt'), 'dirty');

  const opts = {
    baseSha: baseSha,
    retainWorkerHead: baseSha,
    cwd: hostCwd,
    workerRoot: workerRoot,
    getWorkerSid: () => 'SID-1',
    verifyBoundary: () => true,
  };

  const launcher = getIsolatedLauncher();
  const verdictPath = path.join(TMP, 'verdict2.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: hostCwd,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: require('../isolation-launcher').getFolderHash(
        path.join(hostCwd, 'scripts/ai/isolation')
      ),
      sid: 'SID-1',
      details: { Test: 'PASS' },
    })
  );
  opts.verdictPath = verdictPath;

  let err;
  try {
    await launcher({ id: 'test' }, null, opts);
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.strictEqual(err.code, 'WORKER_HEAD_MISMATCH');

  const { isLaunchInfraFailure } = require('../failure-classifier');
  assert.strictEqual(isLaunchInfraFailure(err.message), true);
});

test('RH-R04: missing worker root', async () => {
  const { dir: hostCwd, baseSha } = createGitRepo(path.join(TMP, 'host3'));
  const workerRoot = path.join(TMP, 'worker_missing');

  const opts = {
    baseSha: baseSha,
    retainWorkerHead: baseSha,
    cwd: hostCwd,
    workerRoot: workerRoot,
    getWorkerSid: () => 'SID-1',
    verifyBoundary: () => true,
  };

  const launcher = getIsolatedLauncher();
  const verdictPath = path.join(TMP, 'verdict3.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: hostCwd,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: require('../isolation-launcher').getFolderHash(
        path.join(hostCwd, 'scripts/ai/isolation')
      ),
      sid: 'SID-1',
      details: { Test: 'PASS' },
    })
  );
  opts.verdictPath = verdictPath;

  let err;
  try {
    await launcher({ id: 'test' }, null, opts);
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.strictEqual(err.code, 'WORKER_ROOT_MISSING');

  const { isLaunchInfraFailure } = require('../failure-classifier');
  assert.strictEqual(isLaunchInfraFailure(err.message), true);
});

test('RH-R02: refuse a non-descendant HEAD as local with no cooldown', async () => {
  const { dir: hostCwd, baseSha } = createGitRepo(path.join(TMP, 'host2a'));
  const workerRoot = path.join(TMP, 'worker2a');
  fs.mkdirSync(workerRoot, { recursive: true });
  cp.execSync(`git clone ${hostCwd} .`, { cwd: workerRoot });
  cp.execSync('git config user.name "Test"', { cwd: workerRoot });
  cp.execSync('git config user.email "test@example.com"', { cwd: workerRoot });

  // Make a commit in host and worker separately so they diverge
  fs.writeFileSync(path.join(hostCwd, 'file.txt'), 'host edit');
  cp.execSync('git add file.txt', { cwd: hostCwd });
  cp.execSync('git commit -m "host 1"', { cwd: hostCwd });
  const newBaseSha = cp.execSync('git rev-parse HEAD', { cwd: hostCwd }).toString().trim();

  fs.writeFileSync(path.join(workerRoot, 'file.txt'), 'worker edit');
  cp.execSync('git add file.txt', { cwd: workerRoot });
  cp.execSync('git commit -m "worker 1"', { cwd: workerRoot });

  const opts = {
    baseSha: newBaseSha,
    retainWorkerHead: newBaseSha,
    cwd: hostCwd,
    workerRoot: workerRoot,
    getWorkerSid: () => 'SID-1',
    verifyBoundary: () => true,
  };

  const launcher = getIsolatedLauncher();
  const verdictPath = path.join(TMP, 'verdict2a.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: hostCwd,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: require('../isolation-launcher').getFolderHash(
        path.join(hostCwd, 'scripts/ai/isolation')
      ),
      sid: 'SID-1',
      details: { Test: 'PASS' },
    })
  );
  opts.verdictPath = verdictPath;

  let err;
  try {
    await launcher({ id: 'test' }, null, opts);
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.strictEqual(err.code, 'WORKER_HEAD_MISMATCH');

  const { isLaunchInfraFailure } = require('../failure-classifier');
  assert.strictEqual(isLaunchInfraFailure(err.message), true);
});

test('RH-R02: refuse unattributed commits as local with no cooldown', async () => {
  const { dir: hostCwd, baseSha } = createGitRepo(path.join(TMP, 'host2b'));
  const workerRoot = path.join(TMP, 'worker2b');
  fs.mkdirSync(workerRoot, { recursive: true });
  cp.execSync(`git clone ${hostCwd} .`, { cwd: workerRoot });
  cp.execSync('git config user.name "Test"', { cwd: workerRoot });
  cp.execSync('git config user.email "test@example.com"', { cwd: workerRoot });

  fs.writeFileSync(path.join(workerRoot, 'file.txt'), 'edit1');
  cp.execSync('git add file.txt', { cwd: workerRoot });
  cp.execSync('git commit -m "unattributed 1"', { cwd: workerRoot });
  const repairSha = cp.execSync('git rev-parse HEAD', { cwd: workerRoot }).toString().trim();

  const decisionDir = path.join(TMP, 'decisions2b');
  fs.mkdirSync(decisionDir, { recursive: true });
  // Do NOT record the decision, so it's unattributed.

  const checkpointPath = path.join(TMP, 'checkpoint2b.json');
  cli.writeJsonFile(checkpointPath, {
    schemaVersion: 1,
    liveSteps: { 'FEAT-1': { launch: { workerSha: baseSha }, repair: { sha: baseSha } } },
  });

  const opts = {
    baseSha: baseSha,
    retainWorkerHead: baseSha,
    cwd: hostCwd,
    workerRoot: workerRoot,
    decisionDir: decisionDir,
    workItemId: 'FEAT-1',
    checkpoint: checkpointPath,
    getWorkerSid: () => 'SID-1',
    verifyBoundary: () => true,
  };

  const launcher = getIsolatedLauncher();
  const verdictPath = path.join(TMP, 'verdict2b.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: hostCwd,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: require('../isolation-launcher').getFolderHash(
        path.join(hostCwd, 'scripts/ai/isolation')
      ),
      sid: 'SID-1',
      details: { Test: 'PASS' },
    })
  );
  opts.verdictPath = verdictPath;

  let err;
  try {
    await launcher({ id: 'test' }, null, opts);
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.strictEqual(err.code, 'WORKER_HEAD_MISMATCH');

  const { isLaunchInfraFailure } = require('../failure-classifier');
  assert.strictEqual(isLaunchInfraFailure(err.message), true);
});

function cand(id, role, over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-' + id,
      gateway: 'gw-' + id,
      provider: 'test-prov',
      name: id,
      score: 1,
      cost: 0,
      domain: 'test-prov',
      roles: { [role]: {} },
    },
    over || {}
  );
}

function cand(id, role, over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-' + id,
      gateway: 'gw-' + id,
      provider: 'test-prov',
      name: id,
      score: 1,
      cost: 0,
      domain: 'test-prov',
      roles: { [role]: {} },
    },
    over || {}
  );
}

test('RH-R03: repair commit is recorded in checkpoint', async () => {
  const { dir: hostCwd, baseSha } = createGitRepo(path.join(TMP, 'host4'));
  const workerRoot = path.join(TMP, 'worker4');
  fs.mkdirSync(workerRoot, { recursive: true });
  cp.execSync(`git clone ${hostCwd} .`, { cwd: workerRoot });

  const item = {
    id: 'FEAT-1',
    workItemId: 'FEAT-1',
    branch: 'main',
    roleRequirement: { role: 'writer' },
  };
  const o = { cwd: hostCwd, workerRoot: workerRoot, specs: [item] };
  const session = {
    headSha: baseSha,
    repair: {
      findingsFile: path.join(hostCwd, 'findings.md'),
      findings: 'error',
    },
  };
  fs.writeFileSync(session.repair.findingsFile, 'error');

  const log = { stage: () => {}, goal: 'fix' };
  const logOpts = { dir: path.join(TMP, 'decisions_rh_r03') };
  fs.mkdirSync(logOpts.dir, { recursive: true });

  const launcher = (job) => {
    cp.execSync('git config user.name "Test"', { cwd: job.cwd });
    cp.execSync('git config user.email "test@example.com"', { cwd: job.cwd });
    fs.writeFileSync(path.join(job.cwd, 'file.txt'), 'repaired');
    cp.execSync('git add file.txt', { cwd: job.cwd });
    cp.execSync('git commit -m "repair 1"', { cwd: job.cwd });
    return { exitCode: 0, stdout: '', stderr: '', refusal: null };
  };

  const usageDir = path.join(TMP, 'usage');
  const now = Date.now();
  const candidates = [cand('test-model', 'writer')];
  const { candidateKey } = require('../candidates');
  const chosenKey = candidateKey(candidates[0]);

  const routing = require('../routing');
  const executor = require('../executor');
  const originalRank = routing.rankForProfile;
  routing.rankForProfile = () => {
    return { chosen: chosenKey, top3: [], ranking: [], rejected: [] };
  };
  const originalResolveRoute = executor.resolveRoute;
  executor.resolveRoute = () => ({ harnessName: 'hermes', provider: 'test', model: 'test' });
  const originalReadSessionId = executor.readSessionId;
  executor.readSessionId = () => ({ id: 'mock-session-id' });

  const evidenceData = { effectiveCooldownMs: () => 1000, markOutcome: () => {} };
  const registry = {
    getTool: () => null,
    serializeSpec: () => 'spec',
    sources: [],
  };

  let checkpointCalled = false;
  const opts = {
    failedKeys: [],
    workerTimeoutMs: 10000,
    onCheckpoint: (stage, data) => {
      if (stage === 'repair_round_completed' && data.repair.sha !== baseSha) {
        checkpointCalled = true;
      }
    },
  };

  const repairFn = orchestrate.repairRound(
    o,
    item,
    session,
    log,
    logOpts,
    launcher,
    usageDir,
    now,
    candidates,
    evidenceData,
    registry,
    opts
  );

  const r = await repairFn('error', baseSha);
  routing.rankForProfile = originalRank;
  executor.resolveRoute = originalResolveRoute;
  executor.readSessionId = originalReadSessionId;

  assert.strictEqual(checkpointCalled, true);
});
