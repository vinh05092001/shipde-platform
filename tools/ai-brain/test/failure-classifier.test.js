/**
 * Ship Dễ — Failure Classifier Test Suite
 *
 * Tests the 11 real failure cases collected on this machine, plus an
 * unrecognised string and a scope test proving a 402 on one upstream
 * leaves the others eligible.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  Cause,
  Scope,
  HumanAction,
  parseResetTime,
  MAX_RESET_MS,
  classifyFailure,
  DEFAULT_COOLDOWNS,
} = require('../failure-classifier');

describe('parseResetTime', () => {
  test('parses "reset after 1m 59s"', () => {
    const ms = parseResetTime('reset after 1m 59s');
    assert.equal(ms, 119000);
  });

  test('parses "reset after 151h 23m"', () => {
    const ms = parseResetTime('reset after 151h 23m');
    assert.equal(ms, (151 * 3600 + 23 * 60) * 1000);
  });

  test('caps reset hints exceeding MAX_RESET_MS (30 days)', () => {
    const ms = parseResetTime('reset after 999999h');
    assert.equal(ms, MAX_RESET_MS);
    assert.equal(MAX_RESET_MS, 30 * 24 * 60 * 60 * 1000);
  });

  test('parses "Resets in 62h28m31s"', () => {
    const ms = parseResetTime('Resets in 62h28m31s');
    assert.equal(ms, (62 * 3600 + 28 * 60 + 31) * 1000);
  });

  test('parses "reset after 5m"', () => {
    const ms = parseResetTime('reset after 5m');
    assert.equal(ms, 5 * 60 * 1000);
  });

  test('returns null for text without reset time', () => {
    assert.equal(parseResetTime('some random error'), null);
    assert.equal(parseResetTime(''), null);
    assert.equal(parseResetTime(null), null);
  });
});

describe('Case 1: upstream credit exhausted', () => {
  const input = {
    httpStatus: 503,
    body: '[kimchi/kimi-k3] [402]: {"error": "the provider for model kimi-k3 has ... out of credit"}',
  };
  const result = classifyFailure(input);

  test('cause is UPSTREAM_CREDIT_EXHAUSTED', () => {
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
  });

  test('scope is UPSTREAM', () => {
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown uses default (no reset time in text)', () => {
    assert.equal(result.cooldownMs, 24 * 60 * 60 * 1000);
  });

  test('evidence preserved', () => {
    assert.ok(result.evidence.body.includes('out of credit'));
  });
});

describe('Case 2: upstream monthly limit with reset hint', () => {
  const input = {
    httpStatus: 503,
    body: '[kiro/claude-sonnet-4.5-agentic] [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"} (reset after 1m 59s)',
  };
  const result = classifyFailure(input);

  test('cause is UPSTREAM_MONTHLY_LIMIT', () => {
    assert.equal(result.cause, Cause.UPSTREAM_MONTHLY_LIMIT);
  });

  test('scope is UPSTREAM', () => {
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown uses parsed reset time (1m 59s = 119s)', () => {
    assert.equal(result.cooldownMs, 119000);
  });

  test('resetTime is set', () => {
    assert.ok(result.resetTime !== null);
  });
});

describe('Case 3: upstream entitlement problem', () => {
  const input = {
    httpStatus: 503,
    body: '[github/gpt-4.1] [403]: unauthorized: not licensed to use Copilot',
  };
  const result = classifyFailure(input);

  test('cause is UPSTREAM_ENTITLEMENT', () => {
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
  });

  test('scope is UPSTREAM', () => {
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('humanAction is REQUIRED', () => {
    assert.equal(result.humanAction, HumanAction.REQUIRED);
  });

  test('cooldown is null (never recovers)', () => {
    assert.equal(result.cooldownMs, null);
  });

  test('resetTime is null', () => {
    assert.equal(result.resetTime, null);
  });
});

describe('Case 4: upstream rate limit', () => {
  const input = {
    httpStatus: 503,
    body: '[github/gpt-4.1] [429]: ... "code":"user_global_rate_limited:edu"',
  };
  const result = classifyFailure(input);

  test('cause is UPSTREAM_RATE_LIMIT', () => {
    assert.equal(result.cause, Cause.UPSTREAM_RATE_LIMIT);
  });

  test('scope is UPSTREAM', () => {
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown uses default (5 minutes)', () => {
    assert.equal(result.cooldownMs, 5 * 60 * 1000);
  });
});

describe('Case 5: upstream credential problem (scoped to one upstream)', () => {
  const input = {
    httpStatus: 503,
    body: '[cl/z-ai/glm-5.3-prime] [401]: {"error":"Unauthorized: ..."}',
  };
  const result = classifyFailure(input);

  test('cause is UPSTREAM_CREDENTIAL', () => {
    assert.equal(result.cause, Cause.UPSTREAM_CREDENTIAL);
  });

  test('scope is UPSTREAM (not account, not model)', () => {
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown is 1 hour default', () => {
    assert.equal(result.cooldownMs, 60 * 60 * 1000);
  });
});

describe('Case 6: model not supported', () => {
  const input = {
    httpStatus: 400,
    body: '{"error":{"message":"The requested model is not supported."}}',
  };
  const result = classifyFailure(input);

  test('cause is MODEL_UNSUPPORTED', () => {
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
  });

  test('scope is MODEL', () => {
    assert.equal(result.scope, Scope.MODEL);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown is null (permanent until catalogue changes)', () => {
    assert.equal(result.cooldownMs, null);
  });
});

describe('Case 7: alias mismatch (access path issue)', () => {
  const input = {
    stderr:
      'Paseo/OpenCode: Model not found: ninerouter/gh/gpt-4.1-2025-04-14. Did you mean: gh/gpt-4.1, groq/openai/gpt-oss-120b?',
  };
  const result = classifyFailure(input);

  test('cause is ALIAS_MISMATCH', () => {
    assert.equal(result.cause, Cause.ALIAS_MISMATCH);
  });

  test('scope is MODEL - corrected to contract 6.4 per final review fdd95a5be1007af230f3b5d315c4353d6c26a856-codex', () => {
    assert.equal(result.scope, Scope.MODEL);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown is null (config fix required)', () => {
    assert.equal(result.cooldownMs, null);
  });
});

describe('Case 8: account quota exhausted with exact reset', () => {
  const input = {
    exitCode: 3,
    stderr: 'agy CLI: exit 3, "limit reached ... Resets in 62h28m31s"',
  };
  const result = classifyFailure(input);

  test('cause is ACCOUNT_QUOTA_EXHAUSTED', () => {
    assert.equal(result.cause, Cause.ACCOUNT_QUOTA_EXHAUSTED);
  });

  test('scope is ACCOUNT', () => {
    assert.equal(result.scope, Scope.ACCOUNT);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown uses parsed reset time (62h28m31s)', () => {
    const expected = (62 * 3600 + 28 * 60 + 31) * 1000;
    assert.equal(result.cooldownMs, expected);
  });
});

describe('Case 9: genuine capacity (not quota)', () => {
  const input = {
    httpStatus: 503,
    stderr: 'agy CLI: 503 "No capacity available for model claude-opus-4-6-thinking on the server"',
  };
  const result = classifyFailure(input);

  test('cause is GENUINE_CAPACITY', () => {
    assert.equal(result.cause, Cause.GENUINE_CAPACITY);
  });

  test('scope is UPSTREAM', () => {
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown uses default (10 minutes)', () => {
    assert.equal(result.cooldownMs, 10 * 60 * 1000);
  });
});

describe('Case 10: account auth failed (operator must fix)', () => {
  const input = {
    stderr: 'agy CLI: "authentication failed or timed out" / login-required',
  };
  const result = classifyFailure(input);

  test('cause is ACCOUNT_AUTH_FAILED', () => {
    assert.equal(result.cause, Cause.ACCOUNT_AUTH_FAILED);
  });

  test('scope is ACCOUNT', () => {
    assert.equal(result.scope, Scope.ACCOUNT);
  });

  test('humanAction is REQUIRED', () => {
    assert.equal(result.humanAction, HumanAction.REQUIRED);
  });

  test('cooldown is null (never recovers without operator)', () => {
    assert.equal(result.cooldownMs, null);
  });
});

describe('Case 11: exhaustion hiding behind healthy session', () => {
  const input = {
    body: 'Paseo reported status `running` for an hour while the provider retried "[antigravity/claude-sonnet-4-6] Unavailable (reset after 151h 23m)"',
  };
  const result = classifyFailure(input);

  test('cause is EXHAUSTION_HIDING', () => {
    assert.equal(result.cause, Cause.EXHAUSTION_HIDING);
  });

  test('scope is UPSTREAM', () => {
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown uses parsed reset time (151h 23m)', () => {
    const expected = (151 * 3600 + 23 * 60) * 1000;
    assert.equal(result.cooldownMs, expected);
  });
});

describe('Unrecognised failure returns UNKNOWN', () => {
  const input = {
    httpStatus: 500,
    body: 'Internal server error: something completely unexpected happened',
  };
  const result = classifyFailure(input);

  test('cause is UNKNOWN', () => {
    assert.equal(result.cause, Cause.UNKNOWN);
  });

  test('scope is UNKNOWN (no fault location inferred)', () => {
    assert.equal(result.scope, Scope.UNKNOWN);
  });

  test('humanAction is NONE', () => {
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('cooldown uses default (5 minutes)', () => {
    assert.equal(result.cooldownMs, 5 * 60 * 1000);
  });

  test('evidence preserved', () => {
    assert.ok(result.evidence.body.includes('unexpected'));
  });

  test('unrecognised body does not produce harness-wide scope', () => {
    // Scope.HARNESS would imply the local harness is at fault.
    // An unrecognised upstream body is as likely to be a novel upstream
    // error, so the scope must not claim a fault location.
    const unrecognised = classifyFailure({
      httpStatus: 502,
      body: 'Bad gateway: upstream returned something completely novel',
    });
    assert.notEqual(unrecognised.scope, Scope.HARNESS);
    assert.equal(unrecognised.scope, Scope.UNKNOWN);
  });
});

describe('Scope test: 402 on one upstream leaves others eligible', () => {
  // upstream-a: genuine 402 credit-exhausted failure
  const upstream1 = {
    httpStatus: 503,
    body: '[upstream-a/model-x] [402]: {"error": "out of credit"}',
  };
  // upstream-b: a different upstream that returns an unrecognised body —
  // it should be classified independently, unaffected by upstream-a's 402
  const upstream2 = {
    httpStatus: 503,
    body: '[upstream-b/model-x] [200]: {"ok": true}',
  };

  const result1 = classifyFailure(upstream1);
  const result2 = classifyFailure(upstream2);

  test('upstream-a is UPSTREAM_CREDIT_EXHAUSTED with UPSTREAM scope', () => {
    assert.equal(result1.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result1.scope, Scope.UPSTREAM);
  });

  test('upstream-b is not classified as UPSTREAM_CREDIT_EXHAUSTED', () => {
    // result2 is the classification of upstream-b independently.
    // upstream-a's 402 must not bleed into upstream-b's result.
    assert.notEqual(result2.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.notEqual(result2.scope, Scope.UPSTREAM);
  });

  test("upstream-b's scope is independent of upstream-a's", () => {
    // The two calls are independent: upstream-a's UPSTREAM scope must not
    // determine upstream-b's scope. An unrecognised body produces UNKNOWN,
    // not UPSTREAM or ACCOUNT.
    assert.notEqual(result2.scope, result1.scope);
    assert.notEqual(result2.scope, Scope.ACCOUNT);
    assert.notEqual(result2.scope, Scope.MODEL);
  });
});

describe('Additional edge cases', () => {
  test('401 with generic text still matches credential', () => {
    const result = classifyFailure({
      httpStatus: 401,
      body: 'Unauthorized',
    });
    assert.equal(result.cause, Cause.UPSTREAM_CREDENTIAL);
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('429 without rate limit text still matches if status is 429', () => {
    const result = classifyFailure({
      httpStatus: 429,
      body: 'rate limit exceeded',
    });
    assert.equal(result.cause, Cause.UPSTREAM_RATE_LIMIT);
  });

  test('empty input returns UNKNOWN', () => {
    const result = classifyFailure({});
    assert.equal(result.cause, Cause.UNKNOWN);
  });

  test('null input returns UNKNOWN', () => {
    const result = classifyFailure(null);
    assert.equal(result.cause, Cause.UNKNOWN);
  });
});

describe('Case 13: harness / launch config error', () => {
  test('OpenCode Unexpected server error in stdout classifies as LAUNCH_CONFIG with HARNESS scope, finite cooldown, and records stdout in evidence', () => {
    const result = classifyFailure({
      exitCode: 1,
      stdout:
        '{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}',
    });
    assert.equal(result.cause, Cause.LAUNCH_CONFIG);
    assert.equal(result.scope, Scope.HARNESS);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, 5 * 60 * 1000);
    assert.ok(result.evidence.stdout.includes('Unexpected server error'));
  });

  test('provider resolution error classifies as LAUNCH_CONFIG with HARNESS scope', () => {
    const result = classifyFailure({
      exitCode: 1,
      stderr: 'Error: cannot resolve provider "ninerouter"',
    });
    assert.equal(result.cause, Cause.LAUNCH_CONFIG);
    assert.equal(result.scope, Scope.HARNESS);
  });

  test('explicit HARNESS_FAILED cause is preserved with HARNESS scope and finite cooldown', () => {
    const result = classifyFailure({
      exitCode: 1,
      cause: 'HARNESS_FAILED',
    });
    assert.equal(result.cause, Cause.HARNESS_FAILED);
    assert.equal(result.scope, Scope.HARNESS);
    assert.equal(result.cooldownMs, 5 * 60 * 1000);
  });

  test('upstream HTTP 500/502 error with unexpected server error body is not classified as LAUNCH_CONFIG', () => {
    const result = classifyFailure({
      exitCode: 1,
      httpStatus: 500,
      body: 'Unexpected server error. Check server logs for details.',
    });
    assert.notEqual(result.cause, Cause.LAUNCH_CONFIG);
    assert.equal(result.cause, Cause.UNKNOWN);
    assert.equal(result.scope, Scope.UNKNOWN);
  });

  test('LAUNCH_CONFIG and HARNESS_FAILED have finite default cooldowns', () => {
    assert.equal(DEFAULT_COOLDOWNS[Cause.LAUNCH_CONFIG], 5 * 60 * 1000);
    assert.equal(DEFAULT_COOLDOWNS[Cause.HARNESS_FAILED], 5 * 60 * 1000);
  });

  test('UNKNOWN_HARNESS in stderr classifies as LAUNCH_CONFIG with HARNESS scope and finite cooldown', () => {
    const result = classifyFailure({
      exitCode: 1,
      stderr: 'Error: UNKNOWN_HARNESS: opencode',
    });
    assert.equal(result.cause, Cause.LAUNCH_CONFIG);
    assert.equal(result.scope, Scope.HARNESS);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, 5 * 60 * 1000);
    assert.ok(result.evidence.stderr.includes('UNKNOWN_HARNESS: opencode'));
  });

  test('HARNESS_UNKNOWN in stderr also classifies as LAUNCH_CONFIG with HARNESS scope', () => {
    const result = classifyFailure({
      exitCode: 1,
      stderr: 'Error: HARNESS_UNKNOWN: opencode',
    });
    assert.equal(result.cause, Cause.LAUNCH_CONFIG);
    assert.equal(result.scope, Scope.HARNESS);
  });

  test('UNKNOWN_HARNESS failure does not block other candidates in the upstream failure domain', () => {
    const { sameFailureDomain } = require('../cli');
    const classification = classifyFailure({
      exitCode: 1,
      stderr: 'UNKNOWN_HARNESS: opencode',
    });
    const failedCandidate = {
      harness: 'opencode',
      gateway: '9router',
      upstream: 'cl',
      accountId: 'codex',
      modelId: 'ninerouter/cl/deepseek/deepseek-v4-flash',
    };
    const otherCandidate = {
      harness: 'paseo',
      gateway: '9router',
      upstream: 'cl',
      accountId: 'codex',
      modelId: 'ninerouter/cl/deepseek/deepseek-v4-flash',
    };
    assert.equal(
      sameFailureDomain(otherCandidate, failedCandidate, classification),
      false,
      'harness config failure must not avoid the upstream failure domain'
    );
  });
});

describe('Case 14: launcher timeout and upstream quota exhaustion (Defect M)', () => {
  const { sameFailureDomain } = require('../cli');

  test('launcher timeout with timedOut: true classifies as TIMEOUT with UPSTREAM scope and finite cooldown', () => {
    const result = classifyFailure({
      exitCode: -1,
      timedOut: true,
      stderr: 'some stderr before kill',
    });
    assert.equal(result.cause, Cause.TIMEOUT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.TIMEOUT]);
    assert.equal(DEFAULT_COOLDOWNS[Cause.TIMEOUT], 10 * 60 * 1000);
    assert.ok(result.resetTime !== null);
  });

  test('launcher timeout with ISOLATION_LAUNCHER message in stderr classifies as TIMEOUT with UPSTREAM scope', () => {
    const result = classifyFailure({
      exitCode: -1,
      stderr: '[ISOLATION_LAUNCHER] worker timed out after 1800000 ms and was killed',
    });
    assert.equal(result.cause, Cause.TIMEOUT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
  });

  test('upstream Unavailable with reset hint classifies as QUOTA_EXHAUSTED with UPSTREAM scope and cooldown from reset hint', () => {
    const result = classifyFailure({
      exitCode: 1,
      stdout: '{"type":"error","error":{"message":"Unavailable (reset after 116h)"}}',
    });
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, 116 * 3600 * 1000);
    assert.ok(result.evidence.stdout.includes('Unavailable (reset after 116h)'));
  });

  test('upstream 429 with FreeUsageLimit in body/stderr classifies as QUOTA_EXHAUSTED with UPSTREAM scope', () => {
    const result = classifyFailure({
      exitCode: 1,
      httpStatus: 429,
      stderr: 'HTTP 429: FreeUsageLimit exceeded, please upgrade or wait',
    });
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.QUOTA_EXHAUSTED]);
  });

  test('launcher timeout takes precedence over worker stdout error and classifies as TIMEOUT with 10m cooldown', () => {
    const result = classifyFailure({
      exitCode: -1,
      timedOut: true,
      stdout: 'OpenCode worker retrying... Error: Unavailable (reset after 116h)',
      stderr: '[ISOLATION_LAUNCHER] worker timed out after 1800000 ms and was killed',
    });
    assert.equal(result.cause, Cause.TIMEOUT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.TIMEOUT]);
    assert.equal(result.cooldownMs, 10 * 60 * 1000);
  });

  test('Finding F1: real launcher timeout with 429 in timestamps and quota in test listings classifies as TIMEOUT, not quota_exhausted', () => {
    const realisticStdout = [
      'OpenCode starting session...',
      'PASS tools/ai-brain/test/agy-quota.test.js',
      'PASS tools/ai-brain/test/quota-store.test.js',
      'PASS tools/ai-brain/test/refresh-quota.test.js',
      '{"type":"step_start","step":1,"timestamp":1790885714291,"eventId":"event-429-start"}',
      '{"type":"tool_call","name":"exec","id":"call-429-001"}',
      'duration: 429ms',
    ].join('\n');
    const result = classifyFailure({
      exitCode: -1,
      timedOut: true,
      stdout: realisticStdout,
      stderr: '\r\n[ISOLATION_LAUNCHER] worker timed out after 1800000 ms and was killed',
    });
    assert.equal(result.cause, Cause.TIMEOUT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.TIMEOUT]);
    assert.equal(result.cooldownMs, 10 * 60 * 1000);
  });

  test('Finding F1: realistic multi-line OpenCode session with provider error event killed by launcher timeout classifies as TIMEOUT', () => {
    const realisticStdout = [
      'OpenCode starting session...',
      '{"type":"step_start","step":1}',
      '{"type":"tool_call","name":"exec","id":"call-1"}',
      '{"type":"error","error":{"message":"Unavailable (reset after 116h)"}}',
      '{"type":"status","status":"retrying"}',
      'OpenCode worker waiting for retry...',
    ].join('\n');
    const result = classifyFailure({
      exitCode: -1,
      timedOut: true,
      stdout: realisticStdout,
      stderr: '[ISOLATION_LAUNCHER] worker timed out after 1800000 ms and was killed',
    });
    assert.equal(result.cause, Cause.TIMEOUT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.TIMEOUT]);
    assert.equal(result.cooldownMs, 10 * 60 * 1000);
  });

  test('Finding F2: untrusted worker stdout printing quota exceeded in test failure does not widen to QUOTA_EXHAUSTED', () => {
    const realisticBuildFailureStdout = [
      'yarn run test',
      'FAIL src/quota/quota-manager.spec.ts',
      '  ● QuotaManager › should handle quota exceeded',
      '    AssertionError: expected status 429 to equal 200',
      '      at Object.<anonymous> (src/quota/quota-manager.spec.ts:42:9)',
      '429 Too Many Requests: quota exceeded resets in 1h',
      'Tests: 1 failed, 10 passed, 11 total',
    ].join('\n');
    const result = classifyFailure({
      exitCode: 1,
      stdout: realisticBuildFailureStdout,
    });
    assert.notEqual(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.notEqual(result.scope, Scope.UPSTREAM);
  });

  test('Finding F2: untrusted worker adding 429 quota to stdout cannot widen harness launch_config failure to upstream quota', () => {
    const honestHarnessStdout = [
      '{"type":"step_start","step":1}',
      '{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}',
    ].join('\n');
    const spoofedStdout =
      honestHarnessStdout + '\n429 Too Many Requests: quota exceeded resets in 1h';

    const result = classifyFailure({
      exitCode: 1,
      stdout: spoofedStdout,
    });
    assert.equal(result.cause, Cause.LAUNCH_CONFIG);
    assert.equal(result.scope, Scope.HARNESS);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.LAUNCH_CONFIG]);

    // Candidate on same upstream but different model must NOT be blocked
    const cand1 = {
      harness: 'opencode-direct',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      modelId: 'ag/m1',
    };
    const cand2 = {
      harness: 'opencode-direct',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      modelId: 'ag/m2',
    };
    assert.equal(sameFailureDomain(cand2, cand1, result), false);
  });

  test('Finding F2: attacker-chosen unbounded reset hint is capped at MAX_RESET_MS', () => {
    const result = classifyFailure({
      exitCode: 1,
      stdout: '{"type":"error","error":{"message":"Unavailable (reset after 999999h)"}}',
    });
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.cooldownMs, MAX_RESET_MS);
    assert.equal(MAX_RESET_MS, 30 * 24 * 60 * 60 * 1000);
  });

  test('Finding F3: real quota error with OpenCode status: running event stream classifies as QUOTA_EXHAUSTED with parsed reset cooldown', () => {
    const stdout = [
      '{"type":"status","status":"running"}',
      '{"type":"step_start","step":1}',
      '{"type":"error","error":{"message":"Unavailable (reset after 116h)"}}',
    ].join('\n');
    const result = classifyFailure({
      exitCode: 1,
      stdout,
    });
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.cooldownMs, 116 * 3600 * 1000);
  });

  test('Finding F3: FreeUsageLimit with OpenCode status: running event stream classifies as QUOTA_EXHAUSTED', () => {
    const stdout = ['{"type":"status","status":"running"}', '{"type":"step_start","step":1}'].join(
      '\n'
    );
    const result = classifyFailure({
      exitCode: 1,
      httpStatus: 429,
      stdout,
      stderr: 'HTTP 429: FreeUsageLimit exceeded, please upgrade or wait',
    });
    assert.equal(result.cause, Cause.QUOTA_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.QUOTA_EXHAUSTED]);
  });

  test('untrusted worker stderr printing "worker timed out" without launcher signal does not trigger TIMEOUT', () => {
    const result = classifyFailure({
      exitCode: 1,
      stderr: 'worker timed out internally while doing something',
    });
    assert.notEqual(result.cause, Cause.TIMEOUT);
  });

  test('TIMEOUT failure domain matches only candidates with same upstream and allows other upstreams on the same gateway', () => {
    const classification = classifyFailure({
      exitCode: -1,
      timedOut: true,
      stderr: '[ISOLATION_LAUNCHER] worker timed out after 1800000 ms and was killed',
    });
    const failedCandidate = {
      harness: 'opencode-direct',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      modelId: 'ninerouter/ag/gemini-3.7-flash-medium',
    };
    const sameUpstreamCandidate = {
      harness: 'opencode-direct',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'ninerouter',
      modelId: 'ninerouter/ag/gemini-3.1-pro-low',
    };
    const differentUpstreamCandidate = {
      harness: 'opencode-direct',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'codex',
      modelId: 'ninerouter/gh/gpt-5.3-codex',
    };
    assert.equal(
      sameFailureDomain(sameUpstreamCandidate, failedCandidate, classification),
      true,
      'candidates on the same upstream (ag) must share the failure domain'
    );
    assert.equal(
      sameFailureDomain(differentUpstreamCandidate, failedCandidate, classification),
      false,
      'candidates on another upstream (gh) must NOT be blocked, enabling loop fallback'
    );
  });

  test('QUOTA_EXHAUSTED failure domain matches only candidates with same upstream and allows other upstreams on the same gateway', () => {
    const classification = classifyFailure({
      exitCode: 1,
      stdout: 'Unavailable (reset after 116h)',
    });
    const failedCandidate = {
      harness: 'opencode-direct',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      modelId: 'ninerouter/ag/gemini-3.7-flash-medium',
    };
    const otherUpstreamCandidate = {
      harness: 'opencode-direct',
      gateway: '9router',
      upstream: 'cl',
      accountId: 'codex',
      modelId: 'ninerouter/cl/deepseek/deepseek-v4-flash',
    };
    assert.equal(
      sameFailureDomain(otherUpstreamCandidate, failedCandidate, classification),
      false,
      'alternate upstream (cl) must remain eligible when upstream (ag) quota is exhausted'
    );
  });
});
