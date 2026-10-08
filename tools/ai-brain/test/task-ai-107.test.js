'use strict';

/**
 * TASK-AI-107 — Rate limits are classified as quota, not harness failures.
 *
 * FC-R01: live Gate B run 2 (2026-10-06 04:53) ended its isolated worker
 * stdout with a structured APIError 429 / FreeUsageLimitError event and was
 * classified cause launch_config scope harness, which blocked every candidate
 * on that harness and ended the run with NO_ALTERNATE_FAILURE_DOMAIN. The
 * classifier must read the structured error events in the worker stdout.
 *
 * Tests replay the recorded launch result from fixtures (a copy of
 * gateB2-launch-result.json) and use synthetic structured events only. No
 * network, no real GitHub.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { classifyFailure, Cause, Scope } = require('../failure-classifier');
const { sameFailureDomain } = require('../cli');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gateB2-launch-result.json');

function loadLaunchResult() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function classifyLaunchResult(extra) {
  const launchResult = loadLaunchResult();
  return classifyFailure({
    exitCode: launchResult.exitCode,
    stdout: launchResult.stdout,
    stderr: launchResult.stderr,
    ...extra,
  });
}

function errorEvent(message, statusCode, isRetryable, name) {
  const data = { message };
  if (statusCode !== undefined) data.statusCode = statusCode;
  if (isRetryable !== undefined) data.isRetryable = isRetryable;
  return JSON.stringify({
    type: 'error',
    timestamp: 1791237213848,
    sessionID: 'ses_fixture',
    error: { name: name || 'APIError', data },
  });
}

function modelStepEvent() {
  return JSON.stringify({
    type: 'step_start',
    timestamp: 1791237213000,
    sessionID: 'ses_fixture',
    part: { type: 'step-start', stepID: 'stp_fixture' },
  });
}

describe('TASK-AI-107: rate limits classify as quota, not harness failures', () => {
  test('FC-R01/FC-R02/FC-R04: recorded Gate B launch result classifies as quota_exhausted at upstream scope with cooldown hints kept', () => {
    const result = classifyLaunchResult();
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.notEqual(result.scope, Scope.HARNESS);
    assert.equal(
      result.cause !== Cause.LAUNCH_CONFIG && result.cause !== Cause.HARNESS_FAILED,
      true
    );
    assert.equal(result.cooldownMs, 64 * 1000, 'reset-after 1m 4s hint must become the cooldown');
    assert.ok(result.resetTime !== null, 'reset hint must be kept as cooldown data');
    assert.equal(result.retryable, true, 'isRetryable hint must be kept as cooldown data');
  });

  test('FC-R04: quota blocks the failed upstream only; a candidate on another upstream of the same harness stays selectable', () => {
    const result = classifyLaunchResult();
    assert.equal(result.scope, Scope.UPSTREAM, 'quota must be scoped upstream, not harness');
    const failedCandidate = {
      harness: 'harness-a',
      gateway: 'gw-a',
      upstream: 'up-a',
      accountId: 'acct-a',
      modelId: 'up-a/model-a',
    };
    const sameUpstreamOtherHarness = {
      harness: 'harness-b',
      gateway: 'gw-a',
      upstream: 'up-a',
      accountId: 'acct-b',
      modelId: 'up-a/model-b',
    };
    const otherUpstreamSameHarness = {
      harness: 'harness-a',
      gateway: 'gw-a',
      upstream: 'up-b',
      accountId: 'acct-a',
      modelId: 'up-b/model-c',
    };
    assert.equal(
      sameFailureDomain(sameUpstreamOtherHarness, failedCandidate, result),
      true,
      'the exhausted upstream domain is shared regardless of harness'
    );
    assert.equal(
      sameFailureDomain(otherUpstreamSameHarness, failedCandidate, result),
      false,
      'a candidate on another upstream of the same harness must stay selectable'
    );
  });

  test('FC-R02: every quota signal in a structured error event classifies as quota_exhausted, never harness', () => {
    const signals = [
      '[prov/model] [429]: upstream says slow down',
      '[prov/model] FreeUsageLimitError: free usage limit reached',
      '[prov/model] Rate limit exceeded. Please try again later.',
      '[prov/model] quota exceeded for this account window',
      '[prov/model] insufficient credits on the provider account',
      '[prov/model] daily cap reached for this model',
      '[prov/model] INFERENCE_CAP_ERROR: Error 429: daily free limit reached',
    ];
    for (const message of signals) {
      const result = classifyFailure({
        exitCode: 1,
        stdout: errorEvent(message, 503, true),
        stderr: '',
      });
      assert.equal(result.cause, Cause.QUOTA_EXHAUSTED, `signal "${message}" must be quota`);
      assert.equal(result.scope, Scope.UPSTREAM, `signal "${message}" must scope upstream`);
      assert.equal(result.retryable, true);
    }
  });

  test('FC-R02: structured error event with bare 429 status code classifies as quota_exhausted, never harness', () => {
    for (const payload of [
      errorEvent('[prov/model] upstream throttled the request', 429, true),
      errorEvent('[prov/model] [429]: upstream throttled the request', 503, true),
    ]) {
      const result = classifyFailure({ exitCode: 1, stdout: payload, stderr: '' });
      assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
      assert.equal(result.scope, Scope.UPSTREAM);
    }
  });

  test('FC-R02: quota scopes account when the cause names an account', () => {
    const result = classifyFailure({
      exitCode: 1,
      stdout: errorEvent('[prov/model] [429]: Rate limit exceeded', 503, true),
      stderr: '',
      cause: 'account_quota_exhausted',
    });
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.ACCOUNT);
  });

  test('FC-R02: a quota signal in a structured error event never becomes harness even when the worker stream mentions launch_config', () => {
    const stdout = [
      modelStepEvent(),
      errorEvent('[prov/model] [429]: Rate limit exceeded (reset after 1m 4s)', 503, true),
      JSON.stringify({
        type: 'tool_use',
        sessionID: 'ses_fixture',
        part: { type: 'tool', tool: 'bash', state: { status: 'completed' } },
        output: 'read failure-classifier.js with launch_config markers',
      }),
    ].join('\n');
    const result = classifyFailure({ exitCode: 1, stdout, stderr: '' });
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.cooldownMs, 64 * 1000);
  });

  test('FC-R03: launch_config is refused when the worker already started a model step', () => {
    const stdout = [
      modelStepEvent(),
      errorEvent(
        'Unexpected server error. Check server logs for details.',
        undefined,
        true,
        'UnknownError'
      ),
    ].join('\n');
    const result = classifyFailure({ exitCode: 1, stdout, stderr: '' });
    assert.notEqual(result.cause, Cause.LAUNCH_CONFIG);
    assert.notEqual(result.cause, Cause.HARNESS_FAILED);
    assert.notEqual(result.scope, Scope.HARNESS);
  });

  test('FC-R03: launch_config stays assigned when no model step started and the launcher reports a configuration error', () => {
    const result = classifyFailure({
      exitCode: 1,
      stdout: errorEvent(
        'Unexpected server error. Check server logs for details.',
        undefined,
        true,
        'UnknownError'
      ),
      stderr: '',
    });
    assert.equal(result.cause, Cause.LAUNCH_CONFIG);
    assert.equal(result.scope, Scope.HARNESS);
    const viaLauncherSignal = classifyFailure({
      exitCode: 1,
      stdout: '',
      stderr: '[ISOLATION_LAUNCHER] configuration error: cannot resolve provider for launch',
    });
    assert.equal(viaLauncherSignal.cause, Cause.LAUNCH_CONFIG);
    assert.equal(viaLauncherSignal.scope, Scope.HARNESS);
  });
});
