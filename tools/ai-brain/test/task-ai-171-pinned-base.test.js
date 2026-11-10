'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../discovery/identity');
const { headSha } = require('../facts');

const FAKE_40_HEX = '0123456789abcdef0123456789abcdef01234567';

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

function createTargetRepoEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-base-repo-'));
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'initial commit content\n');
  execFileSync('git', ['-C', dir, 'add', 'file.txt'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'Initial commit in target repo'], {
    stdio: 'ignore',
  });
  const realSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  const pFile = path.join(dir, 'prompt.md');
  const qFile = path.join(dir, 'quota.json');
  const hFile = path.join(dir, 'health.json');
  fs.writeFileSync(pFile, 'Test prompt for pinned base\n');
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
    root: dir,
    cwd: dir,
    'prompt-file': pFile,
    item: 'TASK-AI-171-PINNED-BASE',
    ...extra,
  });

  return {
    dir,
    realSha,
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

describe('TASK-AI-171: Immutable local base commit pinning and target worktree resolution', () => {
  test('1. Branch name supplied as base is refused with BASE_SHA_UNRESOLVED before any launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': 'main' }), deps);

      assert.equal(launcherCalls, 0, 'zero launcher calls when branch name supplied as base');
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('2. Fake 40-hex SHA absent from target repo is refused with BASE_SHA_UNRESOLVED before any launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': FAKE_40_HEX }), deps);

      assert.equal(launcherCalls, 0, 'zero launcher calls when fake 40-hex SHA supplied');
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('3. Real commit in target repo is accepted and equals both adapter base and runner baseSha', () => {
    const env = createTargetRepoEnv();
    try {
      let runnerOpts = null;
      const runner = (adapter, launchArgs, opts) => {
        runnerOpts = opts;
        return { exitCode: 0, stdout: JSON.stringify({ status: 'completed' }) };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': env.realSha }), deps);

      assert.equal(res.exitCode, 0);
      const job = env.getCapturedJob();
      assert.ok(job, 'adapter.launch must be called');
      assert.equal(job.base, env.realSha, 'adapter base must equal real commit in target repo');
      assert.equal(
        runnerOpts?.baseSha,
        env.realSha,
        'runner baseSha must equal real commit in target repo'
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

  test('4. Tool-repo-only commit absent from target repo is refused with BASE_SHA_UNRESOLVED with no fallback to tool repo', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const toolRepoSha = headSha('HEAD', process.cwd());
      assert.ok(
        toolRepoSha && /^[0-9a-f]{40}$/i.test(toolRepoSha),
        'tool repo must have a valid commit'
      );
      assert.notEqual(
        toolRepoSha,
        env.realSha,
        'tool repo commit must differ from target repo commit'
      );

      // 4a: Explicit tool repo SHA supplied to dispatch targeting target repo -> refused
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': toolRepoSha }), deps);

      assert.equal(
        launcherCalls,
        0,
        'zero launcher calls when tool repo SHA is supplied for target repo'
      );
      assert.equal(res.exitCode, 1);
      const isRefusedExplicit =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefusedExplicit, 'refusal reason must be BASE_SHA_UNRESOLVED');

      // 4b: No explicit base supplied, target repo has no origin/main -> must NOT fall back to tool repo
      const resNoBase = dispatchCommand(env.getArgs(), deps);
      assert.equal(launcherCalls, 0, 'zero launcher calls when target repo has no resolvable base');
      assert.equal(resNoBase.exitCode, 1);
      const isRefusedNoFallback =
        resNoBase.refusal === 'BASE_SHA_UNRESOLVED' ||
        resNoBase.reason === 'BASE_SHA_UNRESOLVED' ||
        resNoBase.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(
        isRefusedNoFallback,
        'refusal reason must be BASE_SHA_UNRESOLVED when target repo lacks base'
      );
    } finally {
      env.cleanup();
    }
  });

  test('5. Execute with branch feat/offline-replay and no base is refused with BASE_SHA_UNRESOLVED before any launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ branch: 'feat/offline-replay' }), deps);

      assert.equal(
        launcherCalls,
        0,
        'zero launcher calls when branch feat/offline-replay supplied with no base'
      );
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('6. Execute with branch task-ai-171-offline-replay and injected discoveryCatalogue without valid base is refused before launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const cand = makeCandidate();
      const deps = env.getDeps({
        run: runner,
        harnessAdapter: env.fakeAdapter,
        discoveryCatalogue: { candidates: [cand] },
      });
      const res = dispatchCommand(
        env.getArgs({ branch: 'task-ai-171-offline-replay' }),
        deps
      );

      assert.equal(
        launcherCalls,
        0,
        'zero launcher calls when branch task-ai-171-offline-replay has no real commit in repo'
      );
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });
});
