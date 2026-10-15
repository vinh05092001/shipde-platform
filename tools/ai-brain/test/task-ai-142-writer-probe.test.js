'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../discovery/identity');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'task-ai-142-writer-probe-'));
}

function makeTempRepo() {
  const dir = tmpDir('repo-');
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'worker@shipde.test']);
  git(['config', 'user.name', 'Worker']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'base content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, sha: git(['rev-parse', 'HEAD']).stdout.trim() };
}

function createCandidate(overrides) {
  const c = Object.assign(
    {
      harness: 'opencode',
      accessPath: 'https://gateway.example/v1',
      gateway: 'oc',
      upstream: 'vendor',
      accountId: 'account-1',
      quotaScope: 'account-1',
      modelId: 'vendor/model-1',
      source: 'oc',
      kind: 'agent-cli',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 64000 },
      evidence: [{ status: 'passed', kind: 'WORK_ITEM_PASS', proofLevel: 'WORK_ITEM_PASS' }],
      quality: 90,
      cost: 1,
    },
    overrides || {}
  );
  c.candidateKey = candidateKey(c);
  return c;
}

test('writer refreshes inventory once, skips a successful route with zero quota and reuses the JEV assessment', async (t) => {
  const repo = makeTempRepo();
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  const first = createCandidate({ modelId: 'vendor/first', quality: 99 });
  const second = createCandidate({ modelId: 'vendor/second', quality: 90 });
  const launched = [];
  const probed = [];
  let listings = 0;
  const assessments = [];
  const result = await runOrchestration('fixture inventory and quota', {
    isolatedWorker: true,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.sha,
    sha: repo.sha,
    decisionDir: path.join(repo.dir, 'decisions'),
    evidenceDir: path.join(repo.dir, 'evidence'),
    candidates: [first, second],
    refreshWriterModels: true,
    accounts: [{ id: 'account-1', provider: 'oc', capabilities: { contextWindow: 64000 } }],
    env: { TEST_KEY: 'fixture-only' },
    registry: {
      sources: [
        {
          id: 'oc',
          kind: 'router',
          harness: 'opencode',
          endpoint: 'https://gateway.example/v1',
          credential: { type: 'api-key', env: 'TEST_KEY' },
        },
      ],
      dispatch: { providers: { oc: { harness: 'opencode-direct', provider: 'opencode' } } },
    },
    fetchModels: async (url) => {
      assert.equal(url, 'https://gateway.example/v1/models');
      listings++;
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'vendor/first' }, { id: 'vendor/second' }, { id: 'vendor/new-listed' }],
        }),
      };
    },
    jevAsk: async (question) => {
      assessments.push(question.state.role);
      throw Error('fixture JEV unavailable');
    },
    specs: [{ id: 'TASK-AI-142', files: ['a.js'], acceptanceCriteria: ['done'], qualityFloor: 0 }],
    routeProbe: async (c) => {
      probed.push(c.modelId);
      return {
        ok: true,
        status: 200,
        quota: { status: c.modelId === 'vendor/first' ? 'exhausted' : 'unknown' },
      };
    },
    run: (job) => {
      launched.push(job.candidateKey);
      return {
        exitCode: 0,
        stdout: '{"sessionID":"fixture-session","tokens":{"input":10,"output":5}}',
        stderr: '',
        completionNonce: 'fixture-nonce',
        workerSha: repo.sha,
      };
    },
    reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
    tests: () => ({ pass: true }),
    hostGate: () => ({ pass: true, failures: [] }),
    ranking: { priors: { ranking: [] } },
  });
  assert.equal(listings, 1);
  assert.equal(assessments.filter((role) => role === 'writer').length, 1);
  assert.deepEqual(probed, ['vendor/first', 'vendor/second']);
  assert.deepEqual(launched, [second.candidateKey]);
  assert.equal(result.status, 'COMPLETED');
});

test('(a) 60 dead routes taking 8 seconds and a live route ranked last fit the 180 second concurrent budget', async (t) => {
  const repo = makeTempRepo();
  const decisionDir = tmpDir('dec-a-');
  const evidenceDir = tmpDir('evi-a-');
  t.after(() => {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(decisionDir, { recursive: true, force: true });
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });

  const candidates = [];
  for (let i = 0; i < 60; i++) {
    candidates.push(
      createCandidate({
        accessPath: `https://gw-${i}.example/v1`,
        gateway: `gw-${i}`,
        accountId: `acc-${i}`,
        quotaScope: `acc-${i}`,
        modelId: `vendor/model-${i}`,
        quality: 100 - i * 0.5,
      })
    );
  }
  const liveCandidate = createCandidate({
    accessPath: 'https://gw-live.example/v1',
    gateway: 'gw-live',
    accountId: 'acc-live',
    quotaScope: 'acc-live',
    modelId: 'vendor/model-live',
    quality: 70,
  });
  candidates.push(liveCandidate);

  const registry = {
    sources: [
      ...candidates.map((c) => ({
        id: c.gateway,
        endpoint: c.accessPath,
        credential: { env: 'TEST_KEY' },
      })),
      {
        id: 'oc',
        endpoint: 'https://gateway.example/v1',
        credential: { env: 'TEST_KEY' },
      },
    ],
    dispatch: {
      providers: {
        oc: { harness: 'opencode-direct', provider: 'opencode' },
      },
    },
  };

  const probedKeys = [];
  const routeProbe = async (probeCandidate) => {
    probedKeys.push(probeCandidate.modelId);
    if (probeCandidate.modelId === 'vendor/model-live') {
      return { ok: true, status: 200, body: 'OK' };
    }
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return { ok: false, status: 400, body: 'alias_mismatch' };
  };

  const options = {
    isolatedWorker: true,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.sha,
    sha: repo.sha,
    decisionDir,
    evidenceDir,
    candidates,
    registry,
    specs: [{ id: 'TASK-AI-142', files: ['a.js'], acceptanceCriteria: ['done'], qualityFloor: 0 }],
    routeProbe,
    run: () => ({
      exitCode: 0,
      stdout: '{"sessionID":"ses_a","tokens":{"input":10,"output":5}}',
      stderr: '',
      completionNonce: 'nonce-a',
      workerSha: repo.sha,
    }),
    reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
    tests: () => ({ pass: true }),
    hostGate: () => ({ pass: true, failures: [] }),
    ranking: { priors: { ranking: [] } },
  };

  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const startedAt = Date.now();
  let settled = false;
  const pending = runOrchestration('test 60 delayed dead candidates', options);
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  while (!settled && Date.now() - startedAt < 180000) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(8000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(settled, 'selection must finish inside the wall-clock budget');
  const result = await pending;
  assert.equal(probedKeys.length, 61, 'all 60 dead routes and the last live route are probed');
  assert.ok(Date.now() - startedAt < 180000);
  const records = fs
    .readdirSync(decisionDir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) =>
      fs.readFileSync(path.join(decisionDir, name), 'utf8').trim().split('\n').map(JSON.parse)
    );
  const rejections = records
    .flatMap((record) => record.rejected || [])
    .filter((entry) => String(entry.reason).startsWith('WRITER_ROUTE_PROBE_FAILED'));
  assert.equal(rejections.length, 60, 'writer rejections land in the injected intake decision dir');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.sessions[0].candidateKey, liveCandidate.candidateKey);
});

for (const providerCause of ['upstream_credit_exhausted', '[credit.exhausted']) {
  test(`(b) provider failure body ${providerCause} exhausts account A and chooses B`, async (t) => {
    const { PROVIDER_LEVEL_FAILURE_CAUSES } = require('../hermes-session');
    const addedCause = !PROVIDER_LEVEL_FAILURE_CAUSES.has(providerCause);
    PROVIDER_LEVEL_FAILURE_CAUSES.add(providerCause);
    t.after(() => {
      if (addedCause) PROVIDER_LEVEL_FAILURE_CAUSES.delete(providerCause);
    });
    const health = require('../route-health');
    const remembered = [];
    const rememberProbe = health.rememberProbe;
    t.mock.method(health, 'rememberProbe', (candidate, result, options) => {
      remembered.push(candidate.candidateKey);
      return rememberProbe(candidate, result, options);
    });
    const repo = makeTempRepo();
    const decisionDir = tmpDir('dec-b-');
    const evidenceDir = tmpDir('evi-b-');
    t.after(() => {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    });

    const candA1 = createCandidate({
      accessPath: 'https://gw-a.example/v1',
      gateway: 'gw-a',
      accountId: 'acc-a',
      quotaScope: 'acc-a',
      modelId: 'vendor/model-a1',
      quality: 99,
    });
    const candA2 = createCandidate({
      accessPath: 'https://gw-a.example/v1',
      gateway: 'gw-a',
      accountId: 'acc-a',
      quotaScope: 'acc-a',
      modelId: 'vendor/model-a2',
      quality: 98,
    });
    const candA3 = createCandidate({
      accessPath: 'https://gw-a.example/v1',
      gateway: 'gw-a',
      accountId: 'acc-a',
      quotaScope: 'acc-a',
      modelId: 'vendor/model-a3',
      quality: 97,
    });
    const candB = createCandidate({
      accessPath: 'https://gw-b.example/v1',
      gateway: 'gw-b',
      accountId: 'acc-b',
      quotaScope: 'acc-b',
      modelId: 'vendor/model-b',
      quality: 90,
    });

    const candidates = [candA1, candA2, candA3, candB];
    const registry = {
      sources: [
        { id: 'gw-a', endpoint: 'https://gw-a.example/v1', credential: { env: 'TEST_KEY' } },
        { id: 'gw-b', endpoint: 'https://gw-b.example/v1', credential: { env: 'TEST_KEY' } },
        { id: 'oc', endpoint: 'https://gateway.example/v1', credential: { env: 'TEST_KEY' } },
      ],
      dispatch: {
        providers: {
          oc: { harness: 'opencode-direct', provider: 'opencode' },
        },
      },
    };

    const probedModels = [];
    const routeProbe = async (probeCandidate) => {
      probedModels.push(probeCandidate.modelId);
      if (probeCandidate.modelId === 'vendor/model-a1') {
        return { ok: false, body: `Provider failure: ${providerCause.toUpperCase()}` };
      }
      if (probeCandidate.modelId === 'vendor/model-b') {
        return { ok: true, status: 200, body: 'OK' };
      }
      return { ok: false, status: 400, body: 'unexpected' };
    };

    const options = {
      isolatedWorker: true,
      cwd: repo.dir,
      workerRoot: repo.dir,
      baseSha: repo.sha,
      sha: repo.sha,
      decisionDir,
      evidenceDir,
      candidates,
      registry,
      specs: [{ id: 'TASK-AI-142', files: ['a.js'], acceptanceCriteria: ['done'] }],
      routeProbe,
      run: () => ({
        exitCode: 0,
        stdout: '{"sessionID":"ses_b","tokens":{"input":10,"output":5}}',
        stderr: '',
        completionNonce: 'nonce-b',
        workerSha: repo.sha,
      }),
      reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
      tests: () => ({ pass: true }),
      hostGate: () => ({ pass: true, failures: [] }),
      ranking: { priors: { ranking: [] } },
    };

    const result = await runOrchestration('test exhausted account skipping', options);
    assert.deepEqual(
      probedModels,
      ['vendor/model-a1', 'vendor/model-b'],
      'exactly 2 probes must happen'
    );
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.sessions[0].candidateKey, candB.candidateKey);
    assert.equal(
      remembered.filter((key) => key === candB.candidateKey).length,
      2,
      'both primary and cached fallback probe paths record route health'
    );
  });
}

test('(c) one model with 3 routes, first 2 fail, 3rd live: the 3rd route is used (proves no 2-routes-per-model cap)', async (t) => {
  const repo = makeTempRepo();
  const decisionDir = tmpDir('dec-c-');
  const evidenceDir = tmpDir('evi-c-');
  t.after(() => {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(decisionDir, { recursive: true, force: true });
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });

  const candR1 = createCandidate({
    accessPath: 'https://gw-1.example/v1',
    gateway: 'gw-1',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: 'shared-vendor/target-model',
    quality: 99,
  });
  const candR2 = createCandidate({
    accessPath: 'https://gw-2.example/v1',
    gateway: 'gw-2',
    accountId: 'acc-2',
    quotaScope: 'acc-2',
    modelId: 'shared-vendor/target-model',
    quality: 98,
  });
  const candR3 = createCandidate({
    accessPath: 'https://gw-3.example/v1',
    gateway: 'gw-3',
    accountId: 'acc-3',
    quotaScope: 'acc-3',
    modelId: 'shared-vendor/target-model',
    quality: 97,
  });

  const candidates = [candR1, candR2, candR3];
  const registry = {
    sources: [
      { id: 'gw-1', endpoint: 'https://gw-1.example/v1', credential: { env: 'TEST_KEY' } },
      { id: 'gw-2', endpoint: 'https://gw-2.example/v1', credential: { env: 'TEST_KEY' } },
      { id: 'gw-3', endpoint: 'https://gw-3.example/v1', credential: { env: 'TEST_KEY' } },
      { id: 'oc', endpoint: 'https://gateway.example/v1', credential: { env: 'TEST_KEY' } },
    ],
    dispatch: {
      providers: {
        oc: { harness: 'opencode-direct', provider: 'opencode' },
      },
    },
  };

  const probedAccounts = [];
  const routeProbe = async (probeCandidate) => {
    probedAccounts.push(probeCandidate.accessPath);
    if (probeCandidate.accessPath === 'https://gw-1.example/v1') {
      return { ok: false, status: 500, body: 'server error' };
    }
    if (probeCandidate.accessPath === 'https://gw-2.example/v1') {
      return { ok: false, status: 500, body: 'server error' };
    }
    if (probeCandidate.accessPath === 'https://gw-3.example/v1') {
      return { ok: true, status: 200, body: 'OK' };
    }
    return { ok: false, status: 400, body: 'unexpected' };
  };

  const options = {
    isolatedWorker: true,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.sha,
    sha: repo.sha,
    decisionDir,
    evidenceDir,
    candidates,
    registry,
    specs: [{ id: 'TASK-AI-142', files: ['a.js'], acceptanceCriteria: ['done'] }],
    routeProbe,
    run: () => ({
      exitCode: 0,
      stdout: '{"sessionID":"ses_c","tokens":{"input":10,"output":5}}',
      stderr: '',
      completionNonce: 'nonce-c',
      workerSha: repo.sha,
    }),
    reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
    tests: () => ({ pass: true }),
    hostGate: () => ({ pass: true, failures: [] }),
    ranking: { priors: { ranking: [] } },
  };

  const result = await runOrchestration('test 3 routes same model', options);
  assert.deepEqual(
    probedAccounts,
    ['https://gw-1.example/v1', 'https://gw-2.example/v1', 'https://gw-3.example/v1'],
    'all 3 routes of the model must be probed until success'
  );
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.sessions[0].candidateKey, candR3.candidateKey);
});

test('failed concurrent pre-probes are never selected when no route succeeds', async (t) => {
  const repo = makeTempRepo();
  const decisionDir = tmpDir('dec-c-');
  const evidenceDir = tmpDir('evi-c-');
  t.after(() => {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(decisionDir, { recursive: true, force: true });
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });

  const candidates = [createCandidate()];
  const registry = {
    sources: candidates.map((candidate) => ({
      id: candidate.gateway,
      endpoint: candidate.accessPath,
      credential: { env: 'TEST_KEY' },
    })),
    dispatch: { providers: { oc: { harness: 'opencode-direct', provider: 'opencode' } } },
  };

  const probedAccounts = [];
  const routeProbe = async (probeCandidate) => {
    probedAccounts.push(probeCandidate.accessPath);
    return { ok: false, status: 500, body: 'server error' };
  };
  let launches = 0;

  const options = {
    isolatedWorker: true,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.sha,
    sha: repo.sha,
    decisionDir,
    evidenceDir,
    candidates,
    registry,
    specs: [{ id: 'TASK-AI-142', files: ['a.js'], acceptanceCriteria: ['done'] }],
    routeProbe,
    run: () => {
      launches += 1;
      throw new Error('A failed pre-probe route must never launch');
    },
    reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
    tests: () => ({ pass: true }),
    hostGate: () => ({ pass: true, failures: [] }),
    ranking: { priors: { ranking: [] } },
  };

  const result = await runOrchestration('test failed concurrent pre-probe exclusion', options);
  assert.deepEqual(
    probedAccounts,
    candidates.map((candidate) => candidate.accessPath)
  );
  assert.equal(launches, 0);
  assert.notEqual(result.status, 'COMPLETED');
  const records = fs
    .readdirSync(decisionDir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) =>
      fs.readFileSync(path.join(decisionDir, name), 'utf8').trim().split('\n').map(JSON.parse)
    );
  for (const candidate of candidates) {
    assert.ok(
      records.some((record) =>
        (record.rejected || []).some(
          (entry) =>
            entry.candidateKey === candidate.candidateKey &&
            String(entry.reason).startsWith('WRITER_ROUTE_PROBE_FAILED')
        )
      )
    );
    const refusalIndex = records.findIndex((record) =>
      (record.rejected || []).some(
        (entry) =>
          entry.candidateKey === candidate.candidateKey &&
          String(entry.reason).startsWith('WRITER_ROUTE_PROBE_FAILED')
      )
    );
    assert.ok(
      records.slice(refusalIndex + 1).every((record) => record.chosen !== candidate.candidateKey)
    );
  }
});

test('(d) next keeps brain decisions in the intake run instead of forwarding its global decision dir', async (t) => {
  const root = tmpDir('writer-intake-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registerPath = path.join(root, 'register.csv');
  const runDir = path.join(root, 'intake');
  fs.mkdirSync(runDir);
  fs.writeFileSync(
    registerPath,
    'delivery_order,work_item_id,status,dependencies\n1,GOAL-WRITER,READY_FOR_AUTHOR,\n'
  );
  let runFiles;
  await require('../next-runner').runNext(
    { rootDir: root, registerPath, decisionDir: path.join(root, 'runner-decisions'), run: true },
    {
      log: () => {},
      config: {},
      runIntake: async (options) => {
        assert.equal(
          options.decisionDir,
          undefined,
          'runner must not override the intake decision dir'
        );
        ({ runFiles } = require('../intake').composeOrchestrateCommand({
          root,
          runDir,
          baseSha: 'a'.repeat(40),
          repoRoot: root,
          decisionDir: options.decisionDir,
        }));
        return { status: 'failed', exitCode: 1, reason: 'dry intake routing check', runFiles };
      },
    }
  );
  assert.equal(runFiles.decisionDir, path.join(runDir, 'decisions'));
});

for (const [failedLaunch, pending] of [
  [false, false],
  [true, false],
  [true, true],
]) {
  test(`known-live probe priority and launch fallback: failed=${failedLaunch}, unprobed=${pending}`, async (t) => {
    const repo = makeTempRepo();
    const decisionDir = tmpDir('dec-a-');
    const evidenceDir = tmpDir('evi-a-');
    t.after(() => {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(decisionDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    });

    const candidates = [];
    for (let i = 0; i < (failedLaunch ? 1 : 500); i++) {
      candidates.push(
        createCandidate({
          accessPath: `https://gw-${i}.example/v1`,
          gateway: `gw-${i}`,
          accountId: `acc-${i}`,
          quotaScope: `acc-${i}`,
          modelId: `vendor/model-${i}`,
          quality: 100,
        })
      );
    }
    const liveCandidate = createCandidate({
      accessPath: 'https://gw-live.example/v1',
      gateway: 'gw-live',
      accountId: 'acc-live',
      quotaScope: 'acc-live',
      modelId: 'vendor/model-live',
      quality: 80,
    });
    candidates.push(liveCandidate);
    const alternate = createCandidate({
      accessPath: 'https://zz-alternate.example/v1',
      gateway: 'zz-alternate-gateway',
      upstream: 'alternate-vendor',
      accountId: 'alternate-account',
      quotaScope: 'alternate-account',
      modelId: 'alternate-vendor/live',
      quality: 70,
    });
    if (pending) {
      Object.assign(alternate, {
        accessPath: liveCandidate.accessPath,
        gateway: liveCandidate.gateway,
        upstream: liveCandidate.upstream,
        accountId: liveCandidate.accountId,
        quotaScope: liveCandidate.quotaScope,
      });
      alternate.candidateKey = candidateKey(alternate);
    }
    if (failedLaunch) candidates.push(alternate);
    const routeHealth = { version: 1, paths: {}, events: [] };
    const health = require('../route-health');
    health.rememberProbe(
      liveCandidate,
      { ok: true, status: 200 },
      { routeHealth, routeHealthFile: path.join(evidenceDir, 'health.json') }
    );
    if (failedLaunch && !pending)
      health.rememberProbe(
        alternate,
        { ok: true, status: 200 },
        { routeHealth, routeHealthFile: path.join(evidenceDir, 'health.json') }
      );

    const registry = {
      sources: [
        ...candidates.map((c) => ({
          id: c.gateway,
          endpoint: c.accessPath,
          credential: { env: 'TEST_KEY' },
        })),
        {
          id: 'oc',
          endpoint: 'https://gateway.example/v1',
          credential: { env: 'TEST_KEY' },
        },
      ],
      dispatch: {
        providers: {
          oc: { harness: 'opencode-direct', provider: 'opencode' },
        },
      },
    };

    const probedKeys = [];
    const routeProbe = async (probeCandidate) => {
      probedKeys.push(probeCandidate.modelId);
      if ([liveCandidate.modelId, alternate.modelId].includes(probeCandidate.modelId)) {
        return { ok: true, status: 200, body: 'OK' };
      }

      return { ok: false, status: 400, body: 'alias_mismatch' };
    };

    const options = {
      routeHealth,
      routeHealthFile: path.join(evidenceDir, 'health.json'),
      isolatedWorker: true,
      cwd: repo.dir,
      workerRoot: repo.dir,
      baseSha: repo.sha,
      sha: repo.sha,
      decisionDir,
      evidenceDir,
      candidates,
      registry,
      specs: [
        { id: 'TASK-AI-142', files: ['a.js'], acceptanceCriteria: ['done'], qualityFloor: 0 },
      ],
      routeProbe,
      run: () => {
        launched.push(true);
        if (failedLaunch && launched.length === 1)
          return { exitCode: 1, httpStatus: 404, stderr: 'unsupported model' };
        return {
          exitCode: 0,
          stdout: '{"sessionID":"ses_a","tokens":{"input":10,"output":5}}',
          stderr: '',
          completionNonce: 'nonce-a',
          workerSha: repo.sha,
        };
      },
      reviewer: () => ({ pass: true, sha: repo.sha, verdict: 'PASS', findings: [] }),
      tests: () => ({ pass: true }),
      hostGate: () => ({ pass: true, failures: [] }),
      ranking: { priors: { ranking: [] } },
    };

    const launched = [];
    const result = await runOrchestration('known live ordering and launch fallback', options);
    assert.equal(probedKeys[0], liveCandidate.modelId);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(launched.length, failedLaunch ? 2 : 1);
    assert.equal(
      result.sessions[0].candidateKey,
      failedLaunch ? alternate.candidateKey : liveCandidate.candidateKey
    );
  });
}

test('probe ordering preserves rank inside each health group', () => {
  const health = require('../route-health');
  const dir = tmpDir();
  try {
    const ranked = Array.from({ length: 6 }, (_, i) =>
      createCandidate({ modelId: `fixture/model-${i}` })
    );
    const options = {
      routeHealth: { version: 1, paths: {}, events: [] },
      routeHealthFile: path.join(dir, 'health.json'),
      now: Date.now(),
    };
    for (const i of [1, 4]) health.rememberProbe(ranked[i], { ok: true }, options);
    for (const i of [0, 3]) health.rememberProbe(ranked[i], { ok: false, status: 404 }, options);
    assert.deepEqual(health.orderProbeRoutes(ranked, options), [
      ranked[1],
      ranked[4],
      ranked[2],
      ranked[5],
      ranked[0],
      ranked[3],
    ]);
    assert.deepEqual(
      ranked.map((c) => c.modelId),
      Array.from({ length: 6 }, (_, i) => `fixture/model-${i}`)
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const reasonCode of ['PROBE_BUDGET_EXHAUSTED', 'PROBE_ROUTE_CONFIGURATION_UNAVAILABLE']) {
  test(`unattempted writer probe ${reasonCode} does not persist a gateway failure`, async (t) => {
    const repo = makeTempRepo();
    t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
    const candidate = createCandidate();
    const checkpointFile = path.join(repo.dir, 'checkpoint.json');
    const decisionDir = path.join(repo.dir, 'decisions');
    const healthFile = path.join(repo.dir, 'health.json');
    let launches = 0;
    const options = {
      isolatedWorker: true,
      cwd: repo.dir,
      workerRoot: repo.dir,
      baseSha: repo.sha,
      checkpointFile,
      decisionDir,
      evidenceDir: path.join(repo.dir, 'evidence'),
      routeHealthFile: healthFile,
      candidates: [candidate],
      registry: {
        sources: [{ id: 'oc', endpoint: candidate.accessPath, credential: { env: 'TEST_KEY' } }],
        dispatch: { providers: { oc: { harness: 'opencode-direct', provider: 'opencode' } } },
      },
      specs: [{ id: 'SKIPPED-PROBE', files: [], qualityFloor: 0 }],
      routeProbe: async () => ({ ok: false, status: 0, reasonCode }),
      run: () => {
        launches += 1;
        return { exitCode: 1 };
      },
      ranking: { priors: { ranking: [] } },
    };
    await runOrchestration('unattempted probe', options);
    assert.equal(launches, 0);
    const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    assert.equal(
      (checkpoint.liveSteps['SKIPPED-PROBE']?.failures || []).some(
        (failure) => failure.failedCandidateKey === candidate.candidateKey
      ),
      false
    );
    assert.equal(fs.existsSync(healthFile), false);
    const records = fs
      .readdirSync(decisionDir)
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) => fs.readFileSync(path.join(decisionDir, f), 'utf8').trim().split('\n'))
      .map((line) => JSON.parse(line));
    assert.ok(records.some((row) => /WRITER_ROUTE_PROBE_SKIPPED/.test(row.detail || '')));
    assert.equal(
      records.some((row) => row.stage === 'failed' && row.chosen === candidate.candidateKey),
      false
    );
    let retried = 0;
    await runOrchestration('unattempted probe', {
      ...options,
      routeProbe: async () => {
        retried += 1;
        return { ok: true, status: 200 };
      },
    });
    assert.equal(retried, 1, 'resume must probe the previously unattempted route');
    assert.equal(launches, 1, 'a successful new probe may launch the writer');
  });
}
