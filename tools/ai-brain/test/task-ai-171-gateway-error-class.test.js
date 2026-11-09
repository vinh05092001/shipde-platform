'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { classifyFailure, Cause, Scope, DEFAULT_COOLDOWNS } = require('../failure-classifier');
const { dispatchCommand, sameFailureDomain } = require('../cli');
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

  it('classifies "<model> has reached its concurrency capacity" as GENUINE_CAPACITY and MODEL scope', () => {
    const res = classifyFailure({
      stderr: 'dahl/zai-org/GLM-5.3-Flash has reached its concurrency capacity',
    });
    assert.equal(res.cause, Cause.GENUINE_CAPACITY);
    assert.equal(res.scope, Scope.MODEL);
    assert.equal(res.cooldownMs, DEFAULT_COOLDOWNS[Cause.GENUINE_CAPACITY]);
  });

  it('negative test (a): generic text "server concurrency capacity is high today" is not GENUINE_CAPACITY', () => {
    const resWithoutStatus = classifyFailure({
      body: 'server concurrency capacity is high today',
    });
    assert.notEqual(resWithoutStatus.cause, Cause.GENUINE_CAPACITY);

    const res503 = classifyFailure({
      httpStatus: 503,
      body: 'server concurrency capacity is high today',
    });
    assert.notEqual(res503.cause, Cause.GENUINE_CAPACITY);
  });

  it('negative test (b): concurrency capacity is scoped to model and leaves a different model on the same upstream eligible', () => {
    const modelA = 'dahl/zai-org/GLM-5.3-Flash';
    const modelB = 'dahl/zai-org/GLM-4';
    const route = '9router';

    const res = classifyFailure({
      stderr: `${modelA} has reached its concurrency capacity`,
    });
    assert.equal(res.cause, Cause.GENUINE_CAPACITY);
    assert.equal(res.scope, Scope.MODEL);

    const store = { version: 1, paths: {}, events: [] };
    routeHealthApi.recordExecutionResult(store, modelB, route, 'success', { persist: false });
    routeHealthApi.recordExecutionResult(store, modelA, route, {
      ok: false,
      status: 503,
      message: `${modelA} has reached its concurrency capacity`,
      persist: false,
    });

    assert.notEqual(
      routeHealthApi.healthKey(modelA, route),
      routeHealthApi.healthKey(modelB, route)
    );
    assert.equal(routeHealthApi.isEligible(store, modelA, route), false);
    assert.equal(routeHealthApi.isEligible(store, modelB, route), true);
  });

  it('preserves ACCOUNT_AUTH_FAILED for unrelated "credentials stored" error (no regression)', () => {
    const res = classifyFailure({
      stderr: 'no credentials stored for account test-account-id',
    });
    assert.equal(res.cause, Cause.ACCOUNT_AUTH_FAILED);
    assert.equal(res.scope, Scope.ACCOUNT);

    const res404 = classifyFailure({
      httpStatus: 404,
      body: 'No active credentials for provider: azure',
    });
    assert.equal(res404.cause, Cause.ALIAS_MISMATCH);
    assert.equal(res404.scope, Scope.MODEL);
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

  it('feedback path: model concurrency capacity cools only that model while credential failure cools upstream provider', () => {
    const modelA = 'dahl/zai-org/GLM-5.3-Flash';
    const modelB = 'dahl/zai-org/GLM-4';
    const route = '9router';
    const now = Date.now();

    const candidateA = {
      harness: 'hermes',
      gateway: '9router',
      upstream: '9router',
      modelId: modelA,
    };
    const candidateB = {
      harness: 'hermes',
      gateway: '9router',
      upstream: '9router',
      modelId: modelB,
    };

    // 1. Classification of concurrency capacity produces MODEL scope
    const rawError = `${modelA} has reached its concurrency capacity`;
    const capClass = classifyFailure({
      exitCode: 1,
      httpStatus: 503,
      stderr: rawError,
    });
    assert.equal(capClass.cause, Cause.GENUINE_CAPACITY);
    assert.equal(capClass.scope, Scope.MODEL);

    // 2. Feedback via route-health.recordExecutionResult (as cli.js does after failed launch)
    const store = { version: 1, paths: {}, events: [] };
    routeHealthApi.recordExecutionResult(store, modelB, route, 'success', { now, persist: false });
    routeHealthApi.recordExecutionResult(
      store,
      modelA,
      route,
      {
        status: 503,
        ok: false,
        timedOut: false,
        reason: rawError,
        classification: capClass,
      },
      { now, persist: false }
    );

    // 3. Selection eligibility: modelA is cooled; modelB on same route is still eligible
    assert.equal(routeHealthApi.isEligible(store, modelA, route, now), false);
    assert.equal(routeHealthApi.isEligible(store, modelB, route, now), true);
    assert.equal(routeHealthApi.probeCooldown(candidateB, { routeHealth: store, now }), null);
    assert.strictEqual(routeHealthApi.getProviderRecord(store, '9router', 'dahl'), null);
    assert.equal(sameFailureDomain(candidateB, candidateA, capClass), false);

    // 4. Exact 9Router credential message still cools upstream provider as designed
    const credError = 'No active credentials for provider: azure';
    const credClass = classifyFailure({ exitCode: 1, stderr: credError });
    assert.equal(credClass.cause, Cause.UPSTREAM_CREDENTIAL);
    assert.equal(credClass.scope, Scope.UPSTREAM);

    const azureCandA = { gateway: '9router', upstream: 'azure', modelId: 'azure/model-a' };
    const azureCandB = { gateway: '9router', upstream: 'azure', modelId: 'azure/model-b' };
    assert.equal(sameFailureDomain(azureCandB, azureCandA, credClass), true);

    routeHealthApi.rememberProbe(
      azureCandA,
      { ok: false, status: 404, body: credError },
      { routeHealth: store, persistRouteHealth: false, now }
    );
    const credCooldown = routeHealthApi.probeCooldown(azureCandB, { routeHealth: store, now });
    assert.ok(credCooldown);
    assert.match(credCooldown, /PROVIDER_UNAVAILABLE/);
    assert.equal(routeHealthApi.isEligible(store, azureCandB.modelId, '9router', now), false);
  });
});
