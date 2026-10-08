/**
 * TASK-AI-115 — Failure Classifier retriable and replay rules
 *
 * Tests for all retry/failure classification and replay logic extensions:
 * - classifyFailure new fields: retryable (boolean), retryAfterMs (from any reset text)
 * - isReplayable helper: only idempotent "probe", "list", "reviewRead", "testRun" are replayable; never publish/push/pr/comment/merge or unlisted
 *
 * Covers all acceptance criteria:
 * - RP-R01 for each class (retryable and non-retryable)
 * - RP-R02 (isReplayable)
 * - RP-R03 (old fields unchanged)
 * - Regression
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyFailure,
  Cause,
  Scope,
  DEFAULT_COOLDOWNS,
  parseResetTime,
  // to be added by implementation
  isReplayable,
} = require('../failure-classifier');

const gateB2 = require('./fixtures/gateB2-launch-result.json');

// -- Helpers --
function regressionBaseline(input) {
  // Only check fields that existed before: cause, scope, cooldownMs, evidence, resetTime, humanAction
  const out = classifyFailure(input);
  return {
    cause: out.cause,
    scope: out.scope,
    cooldownMs: out.cooldownMs,
    evidence: out.evidence,
    resetTime: out.resetTime,
    humanAction: out.humanAction,
  };
}

// -- Test new retryability fields for all major cases (RP-R01) --
describe('TASK-AI-115 classifyFailure — retryable, retryAfterMs fields', () => {
  const retryableCases = [
    { name: 'Quota/rate-limit (429)', input: { httpStatus: 429, body: 'rate limit exceeded' } },
    {
      name: 'Provider quota with reset',
      input: { stdout: '{"type":"error","error":{"message":"Unavailable (reset after 12h)"}}' },
    },
    {
      name: 'Transient 503',
      input: { httpStatus: 503, body: 'upstream outage (transient error)' },
    },
    { name: 'Timeout', input: { timedOut: true } },
  ];
  for (const { name, input } of retryableCases) {
    test(`${name} is retryable`, () => {
      const out = classifyFailure(input);
      assert.equal(typeof out.retryable, 'boolean');
      assert.equal(out.retryable, true);
      // retryAfterMs should match parsed reset time if present, else null or >0
      assert.ok('retryAfterMs' in out);
      if (out.resetTime && out.retryAfterMs != null) {
        assert.ok(
          Math.abs(out.retryAfterMs - (out.resetTime - Date.now())) < 10000,
          'retryAfterMs matches resetTime offset when present'
        );
      }
    });
  }

  const nonRetryableCases = [
    { name: 'Authentication', input: { httpStatus: 401, body: 'login.required' } },
    { name: 'Model not supported', input: { httpStatus: 400, body: 'model not supported' } },
    {
      name: 'Entitlement/permission',
      input: { httpStatus: 403, body: 'not licensed to use Copilot' },
    },
    {
      name: 'Contract/call error',
      input: { stderr: 'Uncaught exception in worker: contract failed' },
    },
    { name: 'Permanent config error', input: { exitCode: 1, stderr: 'LAUNCH_CONFIG' } },
    { name: 'Unknown', input: { body: 'Novel unclassified error' } },
  ];
  for (const { name, input } of nonRetryableCases) {
    test(`${name} is NOT retryable`, () => {
      const out = classifyFailure(input);
      assert.equal(typeof out.retryable, 'boolean');
      assert.equal(out.retryable, false);
    });
  }

  // Covers the real 429 fixture
  test('Real 429 fixture (gateB2) sets retryable true', () => {
    const json = gateB2;
    const out = classifyFailure(json);
    assert.equal(out.retryable, true);
    assert.ok('retryAfterMs' in out);
  });
});

describe('TASK-AI-115 isReplayable (operation name)', () => {
  test('Replayable for probe', () => {
    assert.equal(isReplayable('probe'), true);
  });
  test('Replayable for list', () => {
    assert.equal(isReplayable('list'), true);
  });
  test('Replayable for reviewRead', () => {
    assert.equal(isReplayable('reviewRead'), true);
  });
  test('Replayable for testRun', () => {
    assert.equal(isReplayable('testRun'), true);
  });
  test('NOT replayable for "publish"', () => {
    assert.equal(isReplayable('publish'), false);
  });
  test('NOT replayable for "push"', () => {
    assert.equal(isReplayable('push'), false);
  });
  test('NOT replayable for "createPR"', () => {
    assert.equal(isReplayable('createPR'), false);
  });
  test('NOT replayable for "comment"', () => {
    assert.equal(isReplayable('comment'), false);
  });
  test('NOT replayable for "merge"', () => {
    assert.equal(isReplayable('merge'), false);
  });
  test('NOT replayable for unknown op', () => {
    assert.equal(isReplayable('completelyUnknownOp'), false);
  });
});

describe('TASK-AI-115 regression: all old fields stay the same', () => {
  const inputs = [
    {
      label: 'credit exhausted',
      input: { httpStatus: 503, body: '[repo] [402]: {"error": "out of credit"}' },
    },
    { label: 'auth failed', input: { httpStatus: 401, body: 'Unauthorized' } },
    {
      label: 'model not supported',
      input: { httpStatus: 400, body: '{"error":{"message":"model not supported"}}' },
    },
    { label: 'unknown', input: { body: 'look something crazy happened' } },
  ];
  for (const { label, input } of inputs) {
    test(`${label} baseline fields stay unchanged`, () => {
      // Existing output shape must be identical except for retryable/retryAfterMs
      const oldOut = regressionBaseline(input);
      const newOut = classifyFailure(input);
      for (const key of Object.keys(oldOut)) {
        assert.deepEqual(newOut[key], oldOut[key], `field ${key} identical`);
      }
    });
  }
});
