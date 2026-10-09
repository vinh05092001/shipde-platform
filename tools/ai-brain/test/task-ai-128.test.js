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
      worktree: workerRoot,
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

  const logs = decisions.readDecisionsSafe({ dir: decisionDir });
  const adoptionLog = logs.find((l) => l.stage === 'adopted_repair_head');
  assert.ok(adoptionLog, 'Should record adopted_repair_head decision');
  assert.strictEqual(adoptionLog.adoptedSha, repairSha);
  assert.strictEqual(adoptionLog.requestedSha, baseSha);
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

  const { classifyFailure } = require('../failure-classifier');
  const classification = classifyFailure({
    exitCode: 1,
    refusal: err.message,
    stderr: err.message,
  });
  assert.strictEqual(classification.scope, 'local');

  // A local failure does not write evidence, and its cooldown is 0
  assert.strictEqual(
    require('../routing').sameFailureDomain(classification, classification),
    false
  );
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

  const { classifyFailure } = require('../failure-classifier');
  const classification = classifyFailure({
    exitCode: 1,
    refusal: err.message,
    stderr: err.message,
  });
  assert.strictEqual(classification.scope, 'local');

  // A local failure does not write evidence, and its cooldown is 0
  assert.strictEqual(
    require('../routing').sameFailureDomain(classification, classification),
    false
  );
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

  const { classifyFailure } = require('../failure-classifier');
  const classification = classifyFailure({
    exitCode: 1,
    refusal: err.message,
    stderr: err.message,
  });
  assert.strictEqual(classification.scope, 'local');

  // A local failure does not write evidence, and its cooldown is 0
  assert.strictEqual(
    require('../routing').sameFailureDomain(classification, classification),
    false
  );
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

  const { classifyFailure } = require('../failure-classifier');
  const classification = classifyFailure({
    exitCode: 1,
    refusal: err.message,
    stderr: err.message,
  });
  assert.strictEqual(classification.scope, 'local');

  // A local failure does not write evidence, and its cooldown is 0
  assert.strictEqual(
    require('../routing').sameFailureDomain(classification, classification),
    false
  );
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

  const logOpts = { dir: path.join(TMP, 'decisions_rh_r03') };
  fs.mkdirSync(logOpts.dir, { recursive: true });

  const launcher = (job) => {
    cp.execSync('git config user.name "Test"', { cwd: job.cwd });
    cp.execSync('git config user.email "test@example.com"', { cwd: job.cwd });
    fs.writeFileSync(path.join(job.cwd, 'file.txt'), 'repaired');
    cp.execSync('git add file.txt', { cwd: job.cwd });
    cp.execSync('git commit -m "repair 1"', { cwd: job.cwd });
    // LEAVE THE TREE DIRTY to test the early return!
    fs.writeFileSync(path.join(job.cwd, 'dirty.txt'), 'dirty');
    return { exitCode: 0, stdout: '', stderr: '', refusal: null };
  };

  const usageDir = path.join(TMP, 'usage');
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

  let checkpointCalled = false;
  let persistedSha = null;

  // Use the PRODUCTION persistStep logic inside a mock!
  const checkpointPath = path.join(TMP, 'checkpoint_rh_r03.json');
  let checkpointOnDisk = { schemaVersion: 1, liveSteps: {} };
  cli.writeJsonFile(checkpointPath, checkpointOnDisk);

  const persistStep = (workItemId, stage, fields) => {
    // Mimic exactly what the real persistStep does
    const diskContent = cli.readCheckpoint(checkpointPath);
    let liveSteps = diskContent.liveSteps || {};
    const previous = liveSteps[workItemId] || { workItemId, failures: [] };
    const nextStep = Object.assign({}, previous, fields || {}, {
      workItemId,
      stage,
      updatedAt: new Date().toISOString(),
    });
    liveSteps[workItemId] = nextStep;
    const next = Object.assign({}, diskContent, { schemaVersion: 1, liveSteps });
    cli.writeJsonFile(checkpointPath, next);
    checkpointCalled = true;
    if (fields.repair && fields.repair.sha) {
      persistedSha = fields.repair.sha;
    }
  };

  const repairFn = orchestrate.repairRound(
    o,
    item,
    session,
    { stage: () => {}, goal: 'fix' },
    logOpts,
    launcher,
    usageDir,
    Date.now(),
    candidates,
    { effectiveCooldownMs: () => 1000, markOutcome: () => {} },
    { getTool: () => null, serializeSpec: () => 'spec', sources: [] },
    { onCheckpoint: (stage, data) => persistStep(item.id, stage, data) }
  );

  const r = await repairFn('error', baseSha);

  routing.rankForProfile = originalRank;
  executor.resolveRoute = originalResolveRoute;
  executor.readSessionId = originalReadSessionId;

  // Because the tree was left dirty, r.sha will be baseSha!
  assert.strictEqual(r.sha, baseSha);

  // But the checkpoint MUST be written anyway!
  assert.strictEqual(checkpointCalled, true, 'Checkpoint should be written even if tree is dirty');

  const finalCheckpoint = cli.readCheckpoint(checkpointPath);
  const repairedSha = finalCheckpoint.liveSteps['FEAT-1'].repair.sha;
  assert.notStrictEqual(repairedSha, baseSha);
  assert.strictEqual(repairedSha, persistedSha);

  // AND the decision MUST carry sha!
  const logs = decisions.readDecisionsSafe(logOpts);
  const repairDecision = logs.find((l) => l.detail && l.detail.startsWith('REPAIR_ROUND:'));
  assert.ok(repairDecision);
  assert.strictEqual(repairDecision.sha, repairedSha);
});

test('RH-R01 continuation: format gate re-runs against adopted HEAD, then review', async () => {
  const { dir: hostCwd, baseSha } = createGitRepo(path.join(TMP, 'host5'));
  const workerRoot = path.join(TMP, 'worker5');
  fs.mkdirSync(workerRoot, { recursive: true });
  cp.execSync(`git clone ${hostCwd} .`, { cwd: workerRoot });
  cp.execSync('git config user.name "Test"', { cwd: workerRoot });
  cp.execSync('git config user.email "test@example.com"', { cwd: workerRoot });

  fs.writeFileSync(path.join(workerRoot, 'file.js'), 'edit1');
  cp.execSync('git add file.js', { cwd: workerRoot });
  cp.execSync('git commit -m "repair 1"', { cwd: workerRoot });
  const repairSha = cp.execSync('git rev-parse HEAD', { cwd: workerRoot }).toString().trim();

  const decisionDir = path.join(TMP, 'decisions5');
  fs.mkdirSync(decisionDir, { recursive: true });

  decisions.recordDecision(
    {
      stage: decisions.Stage.LAUNCHED,
      workItemId: 'FEAT-1',
      sha: repairSha,
      detail: 'REPAIR_ROUND: repairs FEAT-1',
      worktree: workerRoot,
    },
    { dir: decisionDir }
  );

  const checkpointPath = path.join(TMP, 'checkpoint5.json');
  cli.writeJsonFile(checkpointPath, {
    schemaVersion: 1,
    liveSteps: {
      'FEAT-1': {
        workItemId: 'FEAT-1',
        launch: { workerSha: baseSha, exitCode: 0, candidateKey: 'test-key' },
        repair: { sha: baseSha },
      },
    },
  });

  const verdictPath = path.join(TMP, 'verdict5.json');
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

  const item = {
    id: 'FEAT-1',
    workItemId: 'FEAT-1',
    branch: 'main',
    roleRequirement: { role: 'writer' },
    verification: { command: 'npm test' },
  };

  const o = {
    cwd: hostCwd,
    workerRoot: workerRoot,
    isolatedWorker: false,
    formatCheck: true,
    baseSha: baseSha,
    decisionDir: decisionDir,
    checkpointFile: checkpointPath,
    verdictPath: verdictPath,
    specs: [item],
    getWorkerSid: () => 'SID-1',
    verifyBoundary: () => true,
  };

  // Test continuation!
  try {
    const { getIsolatedLauncher } = require('../isolation-launcher');
    const launcher = getIsolatedLauncher();

    // 1. Run the launcher with retainWorkerHead to trigger adoption!
    await launcher({ id: 'test' }, null, {
      baseSha: baseSha,
      retainWorkerHead: baseSha,
      cwd: hostCwd,
      workerRoot: workerRoot,
      decisionDir: decisionDir,
      workItemId: 'FEAT-1',
      checkpoint: checkpointPath,
      verdictPath: verdictPath,
      getWorkerSid: () => 'SID-1',
      verifyBoundary: () => true,
    });

    // 2. Now call reviewLane on the adopted checkpoint!
    const updatedDisk = cli.readCheckpoint(checkpointPath);
    const session = {
      headSha: updatedDisk.liveSteps['FEAT-1'].repair.sha,
      worktree: workerRoot,
    };
    const logObj = { stage: () => {}, formatChecks: [] };
    const result = await orchestrate.reviewItem(
      o,
      item,
      session,
      logObj,
      { dir: decisionDir },
      launcher,
      path.join(TMP, 'usage'),
      Date.now(),
      [cand('test-reviewer', 'reviewer')],
      { effectiveCooldownMs: () => 0, markOutcome: () => {} },
      { getTool: () => null }
    );
    // Export logObj to check later
    global.testLogObj = logObj;
  } catch (err) {
    // ignore
  }

  const logs = decisions.readDecisionsSafe({ dir: decisionDir });
  const adoptionLog = logs.find((l) => l.stage === 'adopted_repair_head');
  assert.ok(adoptionLog, 'Should record adopted_repair_head decision');
  assert.strictEqual(adoptionLog.adoptedSha, repairSha);

  const formatLog = global.testLogObj.formatChecks[0];
  assert.ok(formatLog, 'Format gate should be run against adopted HEAD');
  assert.strictEqual(formatLog.sha, repairSha, 'Format check should be for adopted HEAD');
});
