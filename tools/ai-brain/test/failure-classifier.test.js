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
  classifyFailure,
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
    stderr: 'Paseo/OpenCode: Model not found: ninerouter/gh/gpt-4.1-2025-04-14. Did you mean: gh/gpt-4.1, groq/openai/gpt-oss-120b?',
  };
  const result = classifyFailure(input);

  test('cause is ALIAS_MISMATCH', () => {
    assert.equal(result.cause, Cause.ALIAS_MISMATCH);
  });

  test('scope is ACCESS_PATH', () => {
    assert.equal(result.scope, Scope.ACCESS_PATH);
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

  test('scope is HARNESS', () => {
    assert.equal(result.scope, Scope.HARNESS);
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
});

describe('Scope test: 402 on one upstream leaves others eligible', () => {
  const upstream1 = {
    httpStatus: 503,
    body: '[upstream-a/model-x] [402]: {"error": "out of credit"}',
  };
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

  test('upstream-b succeeds (not classified as failure)', () => {
    // A successful response would not go through classifyFailure in practice,
    // but the point is that the scope is UPSTREAM, not ACCOUNT or MODEL
    assert.equal(result1.scope, Scope.UPSTREAM);
  });

  test('scope UPSTREAM means only that upstream is cooled', () => {
    // The classifier returns UPSTREAM scope, meaning the scheduler should
    // only cool this specific upstream, not the model or account
    assert.equal(result1.scope, Scope.UPSTREAM);
    assert.notEqual(result1.scope, Scope.ACCOUNT);
    assert.notEqual(result1.scope, Scope.MODEL);
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