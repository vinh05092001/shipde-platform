'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../discovery/identity');

const VALID_40_HEX = '0123456789abcdef0123456789abcdef01234567';

function makeCandidate(
  modelId = 'test-model',
  upstream = 'test-provider',
  accountId = 'test-account'
) {
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'test-gateway',
    upstream,
    accountId,
    quotaScope: accountId,
    modelId,
    cost: 1,
    quality: 90,
    qualifiedRoles: ['author.foundation'],
  };
  c.candidateKey = candidateKey(c);
  return c;
}

function createHarnessEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lopts-'));
  const pFile = path.join(dir, 'prompt.md');
  const qFile = path.join(dir, 'quota.json');
  const hFile = path.join(dir, 'health.json');
  fs.writeFileSync(pFile, 'Test prompt for launch options\n');
  fs.writeFileSync(qFile, '{}');
  fs.writeFileSync(hFile, JSON.stringify({ version: 1, paths: {}, events: [] }));

  const cand = makeCandidate();
  let capturedLaunchJob = null;
  const fakeAdapter = {
    id: 'test-harness',
    command: 'test-cmd',
    launch: (job) => {
      capturedLaunchJob = job;
      return ['fake-harness-run', job.prompt];
    },
    sessionIdFrom: () => 'fake-session-123',
  };

  let exitCode = null;
  const getDeps = (extra = {}) => ({
    candidates: [cand],
    now: Date.now(),
    maxAttempts: 1,
    concurrency: 1,
    quotaStateFile: qFile,
    routeHealthFile: hFile,
    home: dir,
    decisionDir: dir,
    evidenceDir: dir,
    // TASK-AI-171 R2: inject internal seams so resolveExecuteTarget does not
    // call real git on a temp dir that is not a git repository.
    gitRoot: () => dir,
    commitExists: () => true,
    log: () => {},
    error: () => {},
    exit: (code) => {
      exitCode = code;
    },
    ...extra,
  });

  const getArgs = (extra = {}) => ({
    execute: true,
    json: true,
    cwd: dir,
    'prompt-file': pFile,
    item: 'TASK-AI-171-OPTS',
    ...extra,
  });

  return {
    dir,
    fakeAdapter,
    getCapturedJob: () => capturedLaunchJob,
    getDeps,
    getArgs,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

describe('TASK-AI-171: Launch options, mode, base SHA, and enforcement status', () => {
  test('1. Request tokenBudget, outputCeiling, and workerTimeoutMs are forwarded to adapter and launcher; enforcement status is recorded', () => {
    const env = createHarnessEnv();
    try {
      let runnerOpts = null;
      const runner = (adapter, launchArgs, opts) => {
        runnerOpts = opts;
        return {
          exitCode: 0,
          stdout: JSON.stringify({ status: 'completed', session_id: 'fake-session-123' }),
        };
      };

      const budget = { maxTokens: 15000, maxTurns: 5 };
      const req = {
        tokenBudget: budget,
        outputCeiling: 2048,
        workerTimeoutMs: 45000,
      };

      const deps = env.getDeps({
        run: runner,
        request: req,
        harnessAdapter: env.fakeAdapter,
        baseSha: VALID_40_HEX,
      });

      // Hook harness registry so our fakeAdapter is returned
      const harnessMod = require('../harness');
      const origGetHarness = harnessMod.getHarness;
      harnessMod.registerHarness?.('test-harness', env.fakeAdapter);

      const res = dispatchCommand(env.getArgs(), deps);

      assert.equal(res.exitCode, 0);
      assert.ok(runnerOpts, 'launcher must be invoked');
      assert.deepEqual(runnerOpts.tokenBudget, budget, 'tokenBudget must be forwarded to runner');
      assert.equal(runnerOpts.outputCeiling, 2048, 'outputCeiling must be forwarded to runner');
      assert.equal(
        runnerOpts.workerTimeoutMs,
        45000,
        'workerTimeoutMs must be forwarded to runner'
      );

      const job = env.getCapturedJob();
      assert.ok(job, 'adapter.launch must be called');
      assert.deepEqual(job.tokenBudget, budget, 'tokenBudget must be forwarded to adapter');
      assert.equal(job.outputCeiling, 2048, 'outputCeiling must be forwarded to adapter');
      assert.equal(job.workerTimeoutMs, 45000, 'workerTimeoutMs must be forwarded to adapter');

      // Verify enforcement status recorded in decision record
      const decisionsMod = require('../decisions');
      const records = decisionsMod.readDecisions({ dir: env.dir, now: deps.now });
      const launchRecord = records.find((r) => r.stage === 'launched');
      assert.ok(launchRecord, 'launch record must be present');
      assert.ok(
        launchRecord.limitsEnforcement || launchRecord.enforcement,
        'enforcement status must be recorded'
      );
      const enf = launchRecord.limitsEnforcement || launchRecord.enforcement;
      assert.equal(enf.tokenBudget, 'advisory');
      assert.equal(enf.outputCeiling, 'advisory');
      assert.equal(enf.workerTimeoutMs, 'advisory');
    } finally {
      env.cleanup();
    }
  });

  test('1b. Explicit args/deps timeout takes precedence over request-level workerTimeoutMs', () => {
    const env = createHarnessEnv();
    try {
      let runnerOpts = null;
      const runner = (adapter, launchArgs, opts) => {
        runnerOpts = opts;
        return { exitCode: 0, stdout: JSON.stringify({ status: 'completed' }) };
      };

      const deps = env.getDeps({
        run: runner,
        request: { workerTimeoutMs: 60000 },
        harnessAdapter: env.fakeAdapter,
        baseSha: VALID_40_HEX,
      });

      const res = dispatchCommand(env.getArgs({ 'timeout-ms': 99000 }), deps);
      assert.equal(res.exitCode, 0);
      assert.equal(runnerOpts?.workerTimeoutMs, 99000, 'explicit timeout-ms takes precedence');
      assert.equal(
        env.getCapturedJob()?.workerTimeoutMs,
        99000,
        'adapter receives explicit timeout'
      );
    } finally {
      env.cleanup();
    }
  });

  test('2. Selected mode is passed to adapter.launch and runner options (e.g. mode auto)', () => {
    const env = createHarnessEnv();
    try {
      let runnerOpts = null;
      const runner = (adapter, launchArgs, opts) => {
        runnerOpts = opts;
        return { exitCode: 0, stdout: JSON.stringify({ status: 'completed' }) };
      };

      const deps = env.getDeps({
        run: runner,
        request: { mode: 'auto' },
        harnessAdapter: env.fakeAdapter,
        baseSha: VALID_40_HEX,
      });

      const res = dispatchCommand(env.getArgs(), deps);
      assert.equal(res.exitCode, 0);
      assert.equal(env.getCapturedJob()?.mode, 'auto', 'adapter receives request mode auto');
      assert.equal(runnerOpts?.mode, 'auto', 'runner receives mode auto');
    } finally {
      env.cleanup();
    }
  });

  test('3a. Unresolvable base commit is refused with BASE_SHA_UNRESOLVED and zero launcher calls', () => {
    const env = createHarnessEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };

      const deps = env.getDeps({
        run: runner,
        baseSha: null, // explicitly unresolvable
        revParse: () => null,
      });

      const res = dispatchCommand(env.getArgs({ 'base-sha': null, root: env.dir }), deps);

      assert.equal(launcherCalls, 0, 'zero launcher calls on unresolvable base');
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.status === 'refused' ||
        res.outcome?.status === 'refused' ||
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'must be refused with BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('3b. Resolved 40-hex base commit SHA is passed to both adapter base and runner baseSha', () => {
    const env = createHarnessEnv();
    try {
      let runnerOpts = null;
      const runner = (adapter, launchArgs, opts) => {
        runnerOpts = opts;
        return { exitCode: 0, stdout: JSON.stringify({ status: 'completed' }) };
      };

      const deps = env.getDeps({
        run: runner,
        baseSha: VALID_40_HEX,
        harnessAdapter: env.fakeAdapter,
      });

      const res = dispatchCommand(env.getArgs(), deps);
      assert.equal(res.exitCode, 0);

      const job = env.getCapturedJob();
      assert.ok(job, 'adapter.launch must be called');
      assert.equal(job.base, VALID_40_HEX, 'adapter base must equal the resolved 40-hex SHA');
      assert.equal(
        runnerOpts?.baseSha,
        VALID_40_HEX,
        'runner baseSha must equal the resolved 40-hex SHA'
      );
      assert.equal(
        job.base,
        runnerOpts?.baseSha,
        'both adapter base and runner baseSha must be identical'
      );
    } finally {
      env.cleanup();
    }
  });
});
