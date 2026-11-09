'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { classifyFailure, Cause, Scope, DEFAULT_COOLDOWNS } = require('../failure-classifier');
const { dispatchCommand } = require('../cli');
const routeHealthApi = require('../route-health');

describe('TASK-AI-171 Item 1: 9Router gateway error classification', () => {
  it('classifies "No active credentials for provider: <p>" without HTTP status as UPSTREAM_CREDENTIAL and UPSTREAM scope', () => {
    const res = classifyFailure({
      stderr: 'No active credentials for provider: ag',
    });
    assert.equal(res.cause, Cause.UPSTREAM_CREDENTIAL);
    assert.equal(res.scope, Scope.UPSTREAM);
    assert.equal(res.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDENTIAL]);
  });

  it('classifies "No active credentials for provider: <p>" with HTTP status as UPSTREAM_CREDENTIAL and UPSTREAM scope', () => {
    const res = classifyFailure({
      httpStatus: 401,
      stderr: 'No active credentials for provider: ag',
      accountId: 'test-account-id',
    });
    assert.equal(res.cause, Cause.UPSTREAM_CREDENTIAL);
    assert.equal(res.scope, Scope.UPSTREAM);
    assert.equal(res.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDENTIAL]);
  });

  it('classifies "<model> has reached its concurrency capacity" without HTTP status as GENUINE_CAPACITY and UPSTREAM scope', () => {
    const res = classifyFailure({
      stderr: 'mock-model has reached its concurrency capacity',
    });
    assert.equal(res.cause, Cause.GENUINE_CAPACITY);
    assert.equal(res.scope, Scope.UPSTREAM);
    assert.equal(res.cooldownMs, DEFAULT_COOLDOWNS[Cause.GENUINE_CAPACITY]);
  });

  it('classifies "concurrency capacity" with HTTP status as GENUINE_CAPACITY and UPSTREAM scope', () => {
    const res = classifyFailure({
      httpStatus: 503,
      stderr: 'concurrency capacity',
    });
    assert.equal(res.cause, Cause.GENUINE_CAPACITY);
    assert.equal(res.scope, Scope.UPSTREAM);
    assert.equal(res.cooldownMs, DEFAULT_COOLDOWNS[Cause.GENUINE_CAPACITY]);
  });

  it('preserves ACCOUNT_AUTH_FAILED for unrelated "credentials stored" error (no regression)', () => {
    const res = classifyFailure({
      stderr: 'no credentials stored for account test-account-id',
    });
    assert.equal(res.cause, Cause.ACCOUNT_AUTH_FAILED);
    assert.equal(res.scope, Scope.ACCOUNT);
  });
});

describe('TASK-AI-171 Item 2: failed launch records to route-health', () => {
  it('records route-health with future nextCheckAt for failed model+route and leaves other provider untouched', async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-171-'));
    t.after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const routeHealthFile = path.join(tempDir, 'model-route-health.json');
    const decisionDir = path.join(tempDir, 'decisions');
    const evidenceDir = path.join(tempDir, 'evidence');
    const quotaStateFile = path.join(tempDir, 'quota-state.json');

    const candidateA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'mock-scope-a',
      quotaScope: 'mock-scope-a',
      modelId: 'm-alpha',
      qualifiedRoles: ['author.foundation'],
      cost: 1,
      quality: 90,
    };
    candidateA.candidateKey = [
      candidateA.harness,
      candidateA.accessPath,
      candidateA.gateway,
      candidateA.upstream,
      candidateA.accountId,
      candidateA.quotaScope,
      candidateA.modelId,
    ].join('\u241f');

    const candidateB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'other-provider',
      accountId: 'mock-scope-b',
      quotaScope: 'mock-scope-b',
      modelId: 'm-beta',
      qualifiedRoles: ['author.foundation'],
      cost: 2,
      quality: 80,
    };
    candidateB.candidateKey = [
      candidateB.harness,
      candidateB.accessPath,
      candidateB.gateway,
      candidateB.upstream,
      candidateB.accountId,
      candidateB.quotaScope,
      candidateB.modelId,
    ].join('\u241f');

    const now = Date.now();
    let exitCode = -1;

    dispatchCommand(
      { execute: true, item: 'TASK-AI-171-TEST' },
      {
        candidates: [candidateA, candidateB],
        quotaStateFile,
        decisionDir,
        evidenceDir,
        routeHealthFile,
        now,
        run: () => ({
          exitCode: 1,
          stderr: 'No active credentials for provider: ag',
          elapsedMs: 150,
        }),
        home: tempDir,
        exit: (code) => {
          exitCode = code;
        },
        log: () => {},
        maxAttempts: 1,
        concurrency: 1,
      }
    );

    assert.equal(exitCode, 1);

    const store = routeHealthApi.loadStore(routeHealthFile);
    assert.ok(store.paths, 'route health store must have paths');

    const recA = store.paths['m-alpha|ag'];
    assert.ok(recA, 'failed model+route record must exist in route health');
    assert.notEqual(recA.status, 'AVAILABLE', 'status must not be AVAILABLE');
    assert.ok(
      Date.parse(recA.nextCheckAt) > now,
      `nextCheckAt (${recA.nextCheckAt}) must be in the future (after ${now})`
    );

    const recB = store.paths['m-beta|other-provider'];
    assert.strictEqual(
      recB,
      undefined,
      'different model on another provider must remain untouched'
    );
  });
});
