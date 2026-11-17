'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { dispatchCommand: realDispatchCommand } = require('../cli');
const { candidateKey } = require('../discovery/identity');
const health = require('../route-health');
const decisions = require('../decisions');

const FAKE_BASE_SHA = '0123456789abcdef0123456789abcdef01234567';

test('review: frozen CLI refuses a decision-dir override before consulting any claim store', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  t.mock.method(decisions, 'writerFor', () => {
    throw new Error('CLAIM_STORE_MUST_NOT_BE_READ');
  });
  const result = await dispatchCommand(
    { 'execute-frozen': env.manifestPath, 'decision-dir': path.join(env.root, 'override') },
    deps
  );
  assert.equal(result.error, 'CONFLICTING_FLAGS_IN_EXECUTE_FROZEN_MODE');
  assert.equal(fs.existsSync(path.join(env.root, 'override')), false);
  assert.equal(fs.existsSync(deps.storePath), false);
});

test('review: frozen execution checks the same default claim store as normal dispatch', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  delete deps.decisionDir;
  deps.rootDir = env.root;
  t.mock.method(decisions, 'writerFor', (_id, options) =>
    options.dir === undefined ? { sessionId: 'existing-normal-dispatch-writer' } : null
  );
  let calls = 0;
  deps.run = () => {
    calls++;
    return { exitCode: 0, stdout: 'response' };
  };
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(result.error, 'ALREADY_CLAIMED');
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(deps.storePath), false);
});

test('review: frozen quota loading retains the canonical file default rather than process cwd', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  let options;
  t.mock.method(require('../quota-scan'), 'loadQuotaState', (value) => {
    options = value;
    return {
      scopes: {
        [env.candidate.quotaScope]: {
          code: 'QUOTA',
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        },
      },
    };
  });
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(result.exitCode, 1);
  assert.equal(options.rootDir, undefined);
  assert.equal(fs.existsSync(deps.storePath), false);
});

test('review: a checkpoint-failed frozen pin is refused without retry or store writes', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const checkpoint = JSON.parse(fs.readFileSync(env.checkpointPath, 'utf8'));
  checkpoint.failedCandidates = [env.candidate.candidateKey];
  fs.writeFileSync(env.checkpointPath, JSON.stringify(checkpoint));
  const deps = reviewDeps(env);
  let calls = 0;
  deps.run = () => {
    calls++;
    return { exitCode: 0, stdout: 'response' };
  };
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(result.exitCode, 1);
  assert.equal(result.error, 'FROZEN_CANDIDATE_PREVIOUSLY_FAILED');
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(deps.storePath), false);
});

test('review: frozen selection cannot hide a different model or account behind its candidate key', async (t) => {
  for (const field of ['modelId', 'accountId']) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const selection = JSON.parse(fs.readFileSync(env.selectionPath, 'utf8'));
    selection.chosen[field] = 'different-identity';
    fs.writeFileSync(env.selectionPath, JSON.stringify(selection));
    const result = await dispatchCommand(
      { freeze: env.requestPath, output: env.manifestPath },
      reviewDeps(env)
    );
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /SELECTION_IDENTITY_MISMATCH/);
    assert.equal(fs.existsSync(env.manifestPath), false);
  }
});

test('review: frozen native pool admission uses current local models and quota groups without discovery calls', async (t) => {
  for (const blockQuota of [false, true]) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const runs = path.join(env.root, 'runs');
    const lane = path.join(runs, 'agy01');
    fs.mkdirSync(lane, { recursive: true });
    fs.writeFileSync(path.join(lane, 'models-out.txt'), 'gemini-3.8-flash-high\tGemini Flash High');
    const quota = {
      response: 'Gemini Models\tWeekly Limit Remaining\t95%\t2099-01-01T00:00:00Z',
      command: {
        data: {
          groups: [
            {
              name: 'Gemini Models',
              description: 'Models within this group: Gemini Flash, Gemini Pro',
            },
          ],
        },
      },
    };
    fs.writeFileSync(path.join(lane, 'out.txt'), JSON.stringify(quota));
    const factory = require('../candidates').poolAccountCandidates;
    const native = factory({
      fakeRunsDir: runs,
      models: ['gemini-3.8-flash-high'],
      keepExhausted: true,
    }).find((c) => c.accountId === 'agy01' && c.modelId === 'gemini-3.8-flash-high');
    assert.ok(native);
    assert.equal(native.blocked, false);
    const selection = JSON.parse(fs.readFileSync(env.selectionPath, 'utf8'));
    selection.chosen = native;
    fs.writeFileSync(env.selectionPath, JSON.stringify(selection));
    const checkpoint = JSON.parse(fs.readFileSync(env.checkpointPath, 'utf8'));
    checkpoint.selectedCandidate = native;
    fs.writeFileSync(env.checkpointPath, JSON.stringify(checkpoint));
    fs.writeFileSync(path.join(env.root, 'discovery', 'catalogue.jsonl'), '');
    const deps = { ...reviewDeps(env), fakeRunsDir: runs };
    let calls = 0;
    const actualAdapter = require('../harness').getHarness('agy-pool');
    deps.harnessAdapter = {
      ...actualAdapter,
      launch: (job) => actualAdapter.launch(job, { fakeRunsDir: runs }),
      onLaunchFailed: (job, result) =>
        actualAdapter.onLaunchFailed(job, result, { fakeRunsDir: runs }),
    };
    deps.run = () => {
      calls++;
      return { exitCode: 0, stdout: 'scheduler accepted' };
    };
    const receipt = await dispatchCommand(
      { freeze: env.requestPath, output: env.manifestPath },
      deps
    );
    assert.equal(receipt.exitCode, 0);
    if (blockQuota) {
      quota.command.data.groups[0].description = 'Models within this group: Unrelated Model';
      fs.writeFileSync(path.join(lane, 'out.txt'), JSON.stringify(quota));
    }
    const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
    assert.equal(result.exitCode, blockQuota ? 1 : 0);
    assert.equal(calls, blockQuota ? 0 : 1);
    if (!blockQuota) {
      const report = JSON.parse(fs.readFileSync(env.manifestPath + '.usage.json', 'utf8'));
      const job = JSON.parse(fs.readFileSync(path.join(lane, 'job.json'), 'utf8'));
      assert.equal(report.accountId, 'agy01');
      assert.equal(report.nativeJobId, job.jobId);
      assert.equal(report.launchHandle, 'agy01/' + job.jobId);
      assert.equal(result.outcome.status, 'launched');
      assert.equal(decisions.openWritersDetailed({ dir: env.decisionDir }).writers.length, 1);
      const records = decisions.readDecisionsDetailed({ dir: env.decisionDir }).records;
      assert.ok(
        records.some(
          (record) =>
            record.stage === decisions.Stage.LAUNCHED && record.sessionId === report.launchHandle
        )
      );
      assert.equal(
        records.some((record) => record.stage === decisions.Stage.COMPLETED),
        false
      );
    }
  }
});

test('review: ambiguous frozen background launch retains an open claim and reservation', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  let calls = 0;
  deps.harnessAdapter = {
    backgroundLaunch: true,
    launch: () => [],
    sessionIdFromResult: () => null,
  };
  deps.run = () => {
    calls++;
    return { exitCode: -1, stdout: '', stderr: '' };
  };
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(result.outcome.status, 'unknown');
  assert.equal(calls, 1);
  assert.equal(decisions.openWritersDetailed({ dir: env.decisionDir }).writers.length, 1);
  assert.ok(Object.keys(require('../quota-store').getReservations(deps)).length > 0);
  const second = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(second.exitCode, 1);
  assert.equal(calls, 1);
});

test('review: mid-flight manifest drift releases only its owned reservation before any adapter call', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  const quota = require('../quota-store');
  quota.recordReservation('OTHER-TASK', 'writer', 'other-account', 'other-key', 1, deps);
  const before = quota.getReservations(deps);
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const reserve = quota.recordReservation;
  t.mock.method(quota, 'recordReservation', (...args) => {
    const result = reserve(...args);
    const manifest = JSON.parse(fs.readFileSync(env.manifestPath, 'utf8'));
    manifest.target.branch = 'feat/changed-after-reserve';
    fs.writeFileSync(env.manifestPath, JSON.stringify(manifest));
    return result;
  });
  let calls = 0;
  deps.harnessAdapter = {
    launch: () => {
      calls++;
      return [];
    },
  };
  deps.run = () => {
    calls++;
    return { exitCode: 0, stdout: '{}' };
  };
  const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /MANIFEST_DIGEST_MISMATCH/);
  assert.equal(calls, 0);
  assert.deepEqual(quota.getReservations(deps), before);
  assert.equal(decisions.openWritersDetailed({ dir: env.decisionDir }).writers.length, 0);
});

test('review: frozen background adapters receive a durable usage-report path without overrides', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  let report;
  deps.harnessAdapter = {
    backgroundLaunch: true,
    requiresUsageReport: true,
    launch: (job) => {
      report = job.usageFile;
      return [];
    },
    sessionIdFromResult: () => 'owned-background-handle',
  };
  deps.run = () => ({ exitCode: 0, stdout: '' });
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.outcome.status, 'launched');
  assert.equal(report, env.manifestPath + '.usage.json');
});

test('review: frozen adapter preparation refusal never reaches the runner', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  let calls = 0;
  deps.harnessAdapter = { launch: () => ({ refusal: 'LANE_BUSY' }), sessionIdFrom: () => null };
  deps.run = () => {
    calls++;
    return { exitCode: 0, stdout: '{}' };
  };
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(result.exitCode, 1);
  assert.equal(calls, 0);
  assert.equal(decisions.openWritersDetailed({ dir: env.decisionDir }).writers.length, 0);
});

test('review: frozen admission refuses an unproven route and real persisted quota blocks', async (t) => {
  for (const mode of ['unproven', 'quota']) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const deps = reviewDeps(env);
    let calls = 0;
    deps.run = () => {
      calls++;
      return { exitCode: 0, stdout: '{}' };
    };
    const receipt = await dispatchCommand(
      { freeze: env.requestPath, output: env.manifestPath },
      deps
    );
    assert.equal(receipt.exitCode, 0);
    if (mode === 'unproven')
      health.saveStore(env.routeHealthPath, { version: 1, paths: {}, events: [] });
    else {
      deps.quotaStateFile = path.join(env.root, 'quota-state.json');
      fs.writeFileSync(
        deps.quotaStateFile,
        JSON.stringify({
          scopes: {
            [env.candidate.quotaScope || env.candidate.accountId]: {
              code: 'QUOTA',
              reason: 'QUOTA_EXHAUSTED',
              expiresAt: new Date(Date.now() + 600000).toISOString(),
            },
          },
        })
      );
    }
    const result = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
    assert.equal(result.exitCode, 1, mode);
    assert.equal(calls, 0, mode);
    assert.equal(fs.existsSync(deps.storePath), false, mode);
  }
});

test('review: execution without a valid trusted digest refuses before reading inputs', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  for (const digest of [undefined, true, '', 'not-a-digest']) {
    const args = { 'execute-frozen': env.manifestPath };
    if (digest !== undefined) args['manifest-sha256'] = digest;
    const result = await realDispatchCommand(args, reviewDeps(env));
    assert.equal(result.exitCode, 1);
    assert.equal(
      result.error,
      digest === undefined ? 'MANIFEST_DIGEST_REQUIRED' : 'MANIFEST_DIGEST_INVALID'
    );
    assert.equal(fs.existsSync(env.manifestPath), false);
    assert.equal(fs.existsSync(path.join(env.root, 'quota.json')), false);
  }
});

// Model the caller retaining the original freeze receipt, never re-hashing a
// potentially edited manifest when supplying the trusted execution digest.
const sealedDigests = new Map();
async function dispatchCommand(args, deps) {
  const manifest = args['execute-frozen'] || args.executeFrozen;
  if (
    manifest &&
    !Object.hasOwn(args, 'manifest-sha256') &&
    !Object.hasOwn(args, 'manifestSha256') &&
    sealedDigests.has(manifest)
  ) {
    args = { ...args, 'manifest-sha256': sealedDigests.get(manifest) };
  }
  const result = await realDispatchCommand(args, deps);
  if (args.freeze && result.exitCode === 0) sealedDigests.set(args.output, result.manifestSha256);
  return result;
}

function reviewDeps(env, errors = []) {
  return {
    log: () => {},
    error: (value) => errors.push(value),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
    home: env.root,
    decisionDir: env.decisionDir,
    storePath: path.join(env.root, 'quota.json'),
    routeHealthFile: env.routeHealthPath,
    run: () => ({ exitCode: 0, stdout: 'Hermes response text', stderr: '' }),
  };
}

function setupEnvironment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-171-frozen-'));
  const targetCwd = path.join(root, 'target-worktree');
  fs.mkdirSync(targetCwd, { recursive: true });

  const discoveryDir = path.join(root, 'discovery');
  fs.mkdirSync(discoveryDir, { recursive: true });

  const candidate = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'test-gateway',
    upstream: 'test-upstream',
    accountId: 'test-account',
    account: 'test-account',
    quotaScope: 'test-account',
    modelId: 'test-model',
    quality: 90,
    cost: 1,
    qualifiedRoles: ['writer'],
  };
  candidate.candidateKey = candidateKey(candidate);

  fs.writeFileSync(
    path.join(discoveryDir, 'catalogue.jsonl'),
    JSON.stringify({
      key: candidate.candidateKey,
      modelId: candidate.modelId,
      gateway: candidate.gateway,
      upstream: candidate.upstream,
      accountId: candidate.accountId,
      account: candidate.accountId,
      quotaScope: candidate.quotaScope,
      harness: candidate.harness,
      accessPath: candidate.accessPath,
    }) + '\n'
  );
  fs.writeFileSync(
    path.join(discoveryDir, 'freshness.json'),
    JSON.stringify({
      lastSuccessfulAt: new Date().toISOString(),
      sources: [{ id: 'test-upstream', lastAttemptAt: new Date().toISOString() }],
    })
  );

  const ticketPath = path.join(root, 'ticket.md');
  const ticketContent = [
    '# TASK-AI-171: Freeze and execute',
    'GOAL (AC): Test frozen execution',
    'VERIFY: node --test',
    'ALLOWED FILES: tools/ai-brain/cli.js, tools/ai-brain/frozen-dispatch.js',
  ].join('\n');
  fs.writeFileSync(ticketPath, ticketContent);

  const promptPath = path.join(root, 'prompt.md');
  fs.writeFileSync(promptPath, 'System prompt for frozen execution');

  const selectionPath = path.join(root, 'selection.json');
  fs.writeFileSync(
    selectionPath,
    JSON.stringify({
      chosen: candidate,
      profile: {
        taskId: 'TASK-AI-171',
        role: 'writer',
        allowedFiles: ['tools/ai-brain/cli.js', 'tools/ai-brain/frozen-dispatch.js'],
        acceptanceCriteria: ['Test frozen execution', 'node --test'],
      },
    })
  );

  const checkpointPath = path.join(root, 'checkpoint.json');
  fs.writeFileSync(
    checkpointPath,
    JSON.stringify({
      schemaVersion: 1,
      workItemId: 'TASK-AI-171',
      step: 'ranked',
      selectedCandidate: candidate,
      failedCandidates: [],
    })
  );

  const requestPath = path.join(root, 'request.json');
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      selection: 'selection.json',
      ticket: 'ticket.md',
      prompt: 'prompt.md',
      checkpoint: 'checkpoint.json',
      discoveryDir: 'discovery',
      target: {
        cwd: targetCwd,
        branch: 'feat/frozen-test',
        baseSha: FAKE_BASE_SHA,
      },
      workerTimeoutMs: 60000,
    })
  );

  const manifestPath = path.join(root, 'manifest.json');

  const routeHealthPath = path.join(root, 'route-health.json');
  health.saveStore(routeHealthPath, {
    version: 1,
    paths: {
      [health.healthKey(candidate.modelId, candidate.gateway)]: {
        modelId: candidate.modelId,
        routeId: candidate.gateway,
        status: 'AVAILABLE',
        classifierVersion: 2,
      },
    },
    events: [],
  });

  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(decisionDir, { recursive: true });

  const realHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  return {
    root,
    targetCwd,
    discoveryDir,
    candidate,
    ticketPath,
    promptPath,
    selectionPath,
    checkpointPath,
    requestPath,
    manifestPath,
    routeHealthPath,
    decisionDir,
    realHeadSha,
  };
}

test('TASK-AI-171: freeze produces valid manifest and rejects conflicting flags or existing output', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  const logged = [];
  const errors = [];
  const deps = {
    log: (msg) => logged.push(msg),
    error: (msg) => errors.push(msg),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
  };

  // 1. Conflicting flags in freeze mode
  const conflictRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath, execute: true },
    deps
  );
  assert.equal(conflictRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /CONFLICTING_FLAGS_IN_FREEZE_MODE/);

  // 2. Missing output flag
  const missingOutRes = await dispatchCommand({ freeze: env.requestPath }, deps);
  assert.equal(missingOutRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /FREEZE_OUTPUT_REQUIRED/);

  // 3. Mutually exclusive modes
  const mutexRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath, 'execute-frozen': env.manifestPath },
    deps
  );
  assert.equal(mutexRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /MODES_MUTUALLY_EXCLUSIVE/);

  // 4. Successful pure freeze
  const res = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath, json: true },
    deps
  );
  assert.equal(res.exitCode, 0);
  assert.ok(fs.existsSync(env.manifestPath));

  const manifest = JSON.parse(fs.readFileSync(env.manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'shipde.frozen-ticket-launch');
  assert.equal(manifest.producer.codeSha, env.realHeadSha);
  assert.equal(manifest.target.cwd, env.targetCwd);
  assert.equal(manifest.target.branch, 'feat/frozen-test');
  assert.equal(manifest.target.baseSha, FAKE_BASE_SHA);
  assert.equal(manifest.workerTimeoutMs, 60000);
  assert.equal(manifest.selection.file, 'selection.json');
  assert.ok(manifest.selection.sha256);
  assert.equal(manifest.ticket.file, 'ticket.md');
  assert.ok(manifest.ticket.sha256);
  assert.equal(manifest.prompt.file, 'prompt.md');
  assert.ok(manifest.prompt.sha256);
  assert.equal(manifest.checkpoint.file, 'checkpoint.json');
  assert.ok(manifest.checkpoint.sha256);
  assert.equal(manifest.discovery.directory, 'discovery');
  assert.ok(manifest.discovery.catalogueSha256);
  assert.ok(manifest.discovery.freshnessSha256);

  // 5. Output already exists refuses
  errors.length = 0;
  const existsRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    deps
  );
  assert.equal(existsRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /REFUSE_OUTPUT_EXISTS/);
});

test('TASK-AI-171: freeze rejects mismatched checkpoint key and dirty tree', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  const errors = [];
  const deps = {
    log: () => {},
    error: (msg) => errors.push(msg),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
  };

  // Mismatched checkpoint key
  fs.writeFileSync(
    env.checkpointPath,
    JSON.stringify({
      schemaVersion: 1,
      workItemId: 'TASK-AI-171',
      selectedCandidate: 'different-candidate-key',
    })
  );

  const mismatchRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    deps
  );
  assert.equal(mismatchRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /CHECKPOINT_CANDIDATE_MISMATCH/);

  // Restore matching checkpoint
  fs.writeFileSync(
    env.checkpointPath,
    JSON.stringify({
      schemaVersion: 1,
      workItemId: 'TASK-AI-171',
      selectedCandidate: env.candidate,
    })
  );

  // Dirty tree rejects
  errors.length = 0;
  const dirtyDeps = { ...deps, gitStatus: ' M tools/ai-brain/cli.js' };
  const dirtyRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    dirtyDeps
  );
  assert.equal(dirtyRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /DIRTY_WORKTREE/);
});

test('TASK-AI-171: execute-frozen validation and single attempt execution round trip', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  const errors = [];
  const logged = [];
  let launchedArgsCaptured = null;
  const deps = {
    log: (msg) => logged.push(msg),
    error: (msg) => errors.push(msg),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
    routeHealthFile: env.routeHealthPath,
    decisionDir: env.decisionDir,
    storePath: path.join(env.root, 'quota.json'),
    run: (adapter, launchArgs, runnerContext) => {
      launchedArgsCaptured = { launchArgs, runnerContext };
      return { exitCode: 0, stdout: JSON.stringify({ status: 'completed' }), stderr: '' };
    },
  };

  // 1. Freeze first
  const freezeRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    deps
  );
  assert.equal(freezeRes.exitCode, 0);

  // 2. Reject conflicting flags in execute-frozen mode
  errors.length = 0;
  const conflictRes = await dispatchCommand(
    { 'execute-frozen': env.manifestPath, ticket: env.ticketPath },
    deps
  );
  assert.equal(conflictRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /CONFLICTING_FLAGS_IN_EXECUTE_FROZEN_MODE/);

  // 3. Reject max-attempts != 1
  errors.length = 0;
  const attemptsRes = await dispatchCommand(
    { 'execute-frozen': env.manifestPath, 'max-attempts': 3 },
    deps
  );
  assert.equal(attemptsRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /MAX_ATTEMPTS_MUST_BE_ONE/);

  // 4. Successful execute-frozen execution
  errors.length = 0;
  const execRes = await dispatchCommand({ 'execute-frozen': env.manifestPath, json: true }, deps);
  assert.equal(execRes.exitCode, 0);
  assert.ok(launchedArgsCaptured, 'runner should have been invoked');
  assert.equal(launchedArgsCaptured.runnerContext.candidateKey, env.candidate.candidateKey);
  assert.equal(launchedArgsCaptured.runnerContext.baseSha, FAKE_BASE_SHA);
  assert.equal(launchedArgsCaptured.runnerContext.cwd, env.targetCwd);
  assert.equal(launchedArgsCaptured.runnerContext.branch, 'feat/frozen-test');
  assert.equal(launchedArgsCaptured.runnerContext.workerTimeoutMs, 60000);

  // Check that checkpoint on disk was mutated by execution
  const mutatedCheckpoint = JSON.parse(fs.readFileSync(env.checkpointPath, 'utf8'));
  assert.equal(mutatedCheckpoint.dryRunDispatch?.executeTouched, true);

  // 5. Mutated checkpoint replay: second execute-frozen of that manifest refuses on hash drift!
  errors.length = 0;
  const replayRes = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(replayRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /DRIFT_DETECTED: checkpoint hash mismatch/);
});

test('TASK-AI-171: zero side effects on early refusal and reservation cleanup on pre-launch drift', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  const errors = [];
  const deps = {
    log: () => {},
    error: (msg) => errors.push(msg),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
    routeHealthFile: env.routeHealthPath,
    decisionDir: env.decisionDir,
    storePath: path.join(env.root, 'quota.json'),
  };

  // 1. Freeze
  const freezeRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    deps
  );
  assert.equal(freezeRes.exitCode, 0);

  // Mutate ticket file to induce drift before execute-frozen runs
  fs.writeFileSync(env.ticketPath, 'MODIFIED TICKET CONTENT');

  let adapterCalled = false;
  const execDeps = {
    ...deps,
    run: () => {
      adapterCalled = true;
      return { exitCode: 0, stdout: '{}' };
    },
  };

  const driftRes = await dispatchCommand({ 'execute-frozen': env.manifestPath }, execDeps);
  assert.equal(driftRes.exitCode, 1);
  assert.equal(adapterCalled, false, 'adapter must NOT be called on drift refusal');
  assert.match(errors[errors.length - 1], /DRIFT_DETECTED: ticket hash mismatch/);

  // Verify zero side effects: no decision records created
  const detail = decisions.openWritersDetailed({ dir: env.decisionDir });
  assert.equal(
    detail.writers.length,
    0,
    'zero decision records should be written on early refusal'
  );
});

test('TASK-AI-171: ineligible pin (route unhealthy or quota exhausted) refuses with no fallback', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  const errors = [];
  const deps = {
    log: () => {},
    error: (msg) => errors.push(msg),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
    routeHealthFile: env.routeHealthPath,
    decisionDir: env.decisionDir,
    storePath: path.join(env.root, 'quota.json'),
  };

  // Freeze valid manifest
  const freezeRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    deps
  );
  assert.equal(freezeRes.exitCode, 0);

  // Mark candidate route unhealthy (UNAVAILABLE)
  health.saveStore(env.routeHealthPath, {
    version: 1,
    paths: {
      [health.healthKey(env.candidate.modelId, env.candidate.gateway)]: {
        modelId: env.candidate.modelId,
        routeId: env.candidate.gateway,
        status: 'UNAVAILABLE',
        classifierVersion: 2,
      },
    },
    events: [],
  });

  let adapterCalled = false;
  const execDeps = {
    ...deps,
    run: () => {
      adapterCalled = true;
      return { exitCode: 0, stdout: '{}' };
    },
  };

  const unhealthyRes = await dispatchCommand({ 'execute-frozen': env.manifestPath }, execDeps);
  assert.equal(unhealthyRes.exitCode, 1);
  assert.equal(adapterCalled, false);
  assert.match(errors[errors.length - 1], /OFFERING_NOT_ELIGIBLE/);

  // Quota exhausted check
  health.saveStore(env.routeHealthPath, {
    version: 1,
    paths: {
      [health.healthKey(env.candidate.modelId, env.candidate.gateway)]: {
        modelId: env.candidate.modelId,
        routeId: env.candidate.gateway,
        status: 'AVAILABLE',
        classifierVersion: 2,
      },
    },
    events: [],
  });

  const quotaDeps = {
    ...execDeps,
    quotaState: {
      scopes: {
        'test-account': { code: 'QUOTA', expiresAt: new Date(Date.now() + 600000).toISOString() },
      },
    },
  };
  errors.length = 0;
  const quotaRes = await dispatchCommand({ 'execute-frozen': env.manifestPath }, quotaDeps);
  assert.equal(quotaRes.exitCode, 1);
  assert.equal(adapterCalled, false);
  assert.match(errors[errors.length - 1], /OFFERING_NOT_ELIGIBLE/);
});

test('TASK-AI-171: spies prove zero onboarding, probes, or live advisor calls during execute-frozen', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  let onboardingCalled = false;
  let probeCalled = false;
  let adviserCalled = false;

  const deps = {
    log: () => {},
    error: () => {},
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
    routeHealthFile: env.routeHealthPath,
    decisionDir: env.decisionDir,
    storePath: path.join(env.root, 'quota.json'),
    run: () => ({ exitCode: 0, stdout: JSON.stringify({ status: 'completed' }), stderr: '' }),
    onboardSource: () => {
      onboardingCalled = true;
    },
    probeRoute: () => {
      probeCalled = true;
    },
    adviser: () => {
      adviserCalled = true;
    },
  };

  const freezeRes = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    deps
  );
  assert.equal(freezeRes.exitCode, 0);

  const execRes = await dispatchCommand({ 'execute-frozen': env.manifestPath }, deps);
  assert.equal(execRes.exitCode, 0);
  assert.equal(onboardingCalled, false, 'onboarding must not be called');
  assert.equal(probeCalled, false, 'probeRoute must not be called');
  assert.equal(adviserCalled, false, 'adviser must not be called');
});

test('TASK-AI-171: freeze rejects credentials, directory traversal, and never writes partial output', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  const errors = [];
  const deps = {
    log: () => {},
    error: (msg) => errors.push(msg),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
  };

  // 1. Credentials in request
  const credsRequestPath = path.join(env.root, 'creds-request.json');
  fs.writeFileSync(
    credsRequestPath,
    JSON.stringify({
      selection: 'selection.json',
      ticket: 'ticket.md',
      prompt: 'prompt.md',
      checkpoint: 'checkpoint.json',
      discoveryDir: 'discovery',
      target: { cwd: env.targetCwd, branch: 'feat/test', baseSha: FAKE_BASE_SHA },
      workerTimeoutMs: 60000,
      apiKey: 'x',
    })
  );
  const out1 = path.join(env.root, 'out1.json');
  const credsRes = await dispatchCommand({ freeze: credsRequestPath, output: out1 }, deps);
  assert.equal(credsRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /CREDENTIALS_PROHIBITED/);
  assert.equal(fs.existsSync(out1), false, 'partial manifest must not be published');

  // 2. Directory traversal in metadata ref
  errors.length = 0;
  const traversalRequestPath = path.join(env.root, 'traversal-request.json');
  fs.writeFileSync(
    traversalRequestPath,
    JSON.stringify({
      selection: '../selection.json',
      ticket: 'ticket.md',
      prompt: 'prompt.md',
      checkpoint: 'checkpoint.json',
      discoveryDir: 'discovery',
      target: { cwd: env.targetCwd, branch: 'feat/test', baseSha: FAKE_BASE_SHA },
      workerTimeoutMs: 60000,
    })
  );
  const out2 = path.join(env.root, 'out2.json');
  const traversalRes = await dispatchCommand({ freeze: traversalRequestPath, output: out2 }, deps);
  assert.equal(traversalRes.exitCode, 1);
  assert.match(errors[errors.length - 1], /INVALID_RELATIVE_PATH/);
  assert.equal(fs.existsSync(out2), false, 'partial manifest must not be published');
});

test('review: freeze requires a non-empty selection profile task ID', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const selection = JSON.parse(fs.readFileSync(env.selectionPath, 'utf8'));
  delete selection.profile.taskId;
  fs.writeFileSync(env.selectionPath, JSON.stringify(selection));
  const result = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    reviewDeps(env)
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /SELECTION_PROFILE_ID_REQUIRED/);
  assert.equal(fs.existsSync(env.manifestPath), false);
});

test('review: bare max-attempts is refused before executing a frozen decision', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const deps = reviewDeps(env);
  await dispatchCommand({ freeze: env.requestPath, output: env.manifestPath }, deps);
  const result = await dispatchCommand(
    { 'execute-frozen': env.manifestPath, 'max-attempts': true },
    deps
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.error, 'MAX_ATTEMPTS_MUST_BE_ONE');
});

test('review: malformed JSON never echoes its content through refusal errors', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  fs.writeFileSync(env.selectionPath, 'ECHO_TOKEN');
  const errors = [];
  const result = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    reviewDeps(env, errors)
  );
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(JSON.stringify({ result, errors }), /ECHO_TOKEN/);
});

test('review: validated prompt payload is the same buffer whose hash was checked', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const frozen = require('../frozen-dispatch');
  const deps = reviewDeps(env);
  const { manifest, manifestSha256 } = frozen.freeze(env.requestPath, env.manifestPath, {}, deps);
  const originalRead = fs.readFileSync;
  let changed = false;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const bytes = originalRead.call(this, file, ...args);
    if (!changed && typeof file === 'string' && path.resolve(file) === env.promptPath) {
      changed = true;
      fs.writeFileSync(env.promptPath, 'different prompt after the hash read');
    }
    return bytes;
  });
  const context = frozen.validateFrozenManifest(env.manifestPath, { manifestSha256 }, deps);
  assert.equal(changed, true);
  assert.equal(frozen.computeSha256(context.promptText), manifest.prompt.sha256);
});

test('review: freeze hashes the selection buffer it actually parsed', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const frozen = require('../frozen-dispatch');
  const originalRead = fs.readFileSync;
  const captured = originalRead(env.selectionPath);
  let changed = false;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const bytes = originalRead.call(this, file, ...args);
    if (!changed && typeof file === 'string' && path.resolve(file) === env.selectionPath) {
      changed = true;
      const altered = JSON.parse(captured.toString('utf8'));
      altered.chosen = null;
      fs.writeFileSync(env.selectionPath, JSON.stringify(altered));
    }
    return bytes;
  });
  const { manifest } = frozen.freeze(env.requestPath, env.manifestPath, {}, reviewDeps(env));
  assert.equal(changed, true);
  assert.equal(manifest.selection.sha256, frozen.computeSha256(captured));
});

test('review: trusted manifest digest rejects valid-shaped target edits', async (t) => {
  const frozen = require('../frozen-dispatch');
  for (const field of ['cwd', 'branch', 'baseSha', 'workerTimeoutMs']) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const deps = reviewDeps(env);
    frozen.freeze(env.requestPath, env.manifestPath, {}, deps);
    const trustedDigest = frozen.computeSha256(fs.readFileSync(env.manifestPath));
    const manifest = JSON.parse(fs.readFileSync(env.manifestPath, 'utf8'));
    if (field === 'cwd') {
      manifest.target.cwd = path.join(env.root, 'other-target');
      fs.mkdirSync(manifest.target.cwd);
    }
    if (field === 'branch') manifest.target.branch = 'feat/other-valid-branch';
    if (field === 'baseSha') manifest.target.baseSha = 'abcdef0123456789abcdef0123456789abcdef01';
    if (field === 'workerTimeoutMs') manifest.workerTimeoutMs += 1;
    fs.writeFileSync(env.manifestPath, JSON.stringify(manifest));
    assert.throws(
      () =>
        frozen.validateFrozenManifest(env.manifestPath, { manifestSha256: trustedDigest }, deps),
      /MANIFEST_DIGEST_MISMATCH/,
      field
    );
  }
});

test('review: freeze receipt contains the digest, never inside the manifest', async (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const result = await dispatchCommand(
    { freeze: env.requestPath, output: env.manifestPath },
    { ...reviewDeps(env), items: [] }
  );
  assert.match(result.manifestSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(
    result.manifestSha256,
    require('../frozen-dispatch').computeSha256(fs.readFileSync(env.manifestPath))
  );
  assert.equal(
    Object.hasOwn(JSON.parse(fs.readFileSync(env.manifestPath, 'utf8')), 'manifestSha256'),
    false
  );
});

const frozen = require('../frozen-dispatch');

test('module: local freeze and trusted receipt validate the same captured input bytes', (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const receipt = frozen.freeze(env.requestPath, env.manifestPath, {}, reviewDeps(env));
  assert.equal(receipt.manifestSha256, frozen.computeSha256(fs.readFileSync(env.manifestPath)));
  assert.equal(Object.hasOwn(receipt.manifest, 'manifestSha256'), false);
  const context = frozen.validateFrozenManifest(
    env.manifestPath,
    { manifestSha256: receipt.manifestSha256 },
    reviewDeps(env)
  );
  assert.equal(context.chosenKey, env.candidate.candidateKey);
  assert.equal(context.promptText, fs.readFileSync(env.promptPath, 'utf8'));
});

test('module: missing or invalid trusted digest refuses before manifest access', () => {
  for (const digest of [undefined, true, '', 'invalid']) {
    assert.throws(
      () => frozen.validateFrozenManifest('absent-manifest.json', { manifestSha256: digest }),
      digest === undefined ? /MANIFEST_DIGEST_REQUIRED/ : /MANIFEST_DIGEST_INVALID/
    );
  }
});

test('module: changed manifest and input bytes cannot reuse the trusted receipt', (t) => {
  for (const which of ['manifest', 'prompt']) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const receipt = frozen.freeze(env.requestPath, env.manifestPath, {}, reviewDeps(env));
    if (which === 'manifest') {
      receipt.manifest.target.branch = 'feat/changed';
      fs.writeFileSync(env.manifestPath, JSON.stringify(receipt.manifest));
    } else fs.writeFileSync(env.promptPath, 'changed input');
    assert.throws(
      () =>
        frozen.validateFrozenManifest(
          env.manifestPath,
          { manifestSha256: receipt.manifestSha256 },
          reviewDeps(env)
        ),
      which === 'manifest' ? /MANIFEST_DIGEST_MISMATCH/ : /DRIFT_DETECTED/
    );
  }
});

test('module: missing profile identity and dirty provenance refuse without output', (t) => {
  for (const which of ['profile', 'dirty']) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const deps = reviewDeps(env);
    if (which === 'profile') {
      const selection = JSON.parse(fs.readFileSync(env.selectionPath, 'utf8'));
      delete selection.profile.taskId;
      fs.writeFileSync(env.selectionPath, JSON.stringify(selection));
    } else deps.gitStatus = ' M tools/ai-brain/cli.js';
    assert.throws(
      () => frozen.freeze(env.requestPath, env.manifestPath, {}, deps),
      which === 'profile' ? /SELECTION_PROFILE_ID_REQUIRED/ : /DIRTY_WORKTREE/
    );
    assert.equal(fs.existsSync(env.manifestPath), false);
  }
});
