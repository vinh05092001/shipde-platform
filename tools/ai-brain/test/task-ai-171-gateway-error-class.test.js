'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { classifyFailure, Cause, Scope, DEFAULT_COOLDOWNS } = require('../failure-classifier');
const { sameFailureDomain } = require('../cli');
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
