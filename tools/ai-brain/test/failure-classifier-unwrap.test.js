/**
 * Ship Dễ — Failure Classifier Wrapped Inner Cause Tests
 *
 * Tests unwrapping of inner causes from any outer status (400, 403, 429, 500, 502, 503),
 * gateway bracket notations, nested JSON bodies, and message-only indicators.
 * Each fixture from diagnose-batch3.jsonl represents a distinct failure family and fails at c956913.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  Cause,
  Scope,
  HumanAction,
  DEFAULT_COOLDOWNS,
  classifyFailure,
} = require('../failure-classifier');

describe('Wrapped inner cause from diagnose-batch3.jsonl fixtures', () => {
  test('L1: ag (outer 503, inner 404 NOT_FOUND) -> MODEL_UNSUPPORTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[antigravity/gemini-3.5-flash-high] [404]: {\\n  \\"error\\": {\\n    \\"code\\": 404,\\n    \\"message\\": \\"Requested entity was not found.\\",\\n    \\"status\\": \\"NOT_FOUND\\"\\n  }\\n}\\n (reset after 2m)"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
    assert.equal(result.scope, Scope.MODEL);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, null);
  });

  test('L2: alims-intl (outer 400, inner 400 Arrearage) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 400,
      body: '{"error":{"message":"[400]: {\\"error\\":{\\"message\\":\\"Access denied, please make sure your account is in good standing...\\",\\"type\\":\\"Arrearage\\"}}","type":"invalid_request_error"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L3: bpm (outer 400, inner 400 InvalidSubscription) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 400,
      body: '{"error":{"message":"[400]: {\\"error\\":{\\"code\\":\\"InvalidSubscription\\",\\"message\\":\\"Your account (3004770794) does not have a valid CodingPlan subscription\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L4: cbai (outer 503, inner 429 Credits exhausted) -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[codebuddy-intl/glm-5.2] [429]: {\\"error\\":{\\"data\\":{\\"code\\":14018,\\"msg\\":\\"Credits exhausted...\\"}}}}"}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED]);
  });

  test('L5: cc (outer 503, inner 403 OAuth not allowed) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[claude/claude-opus-5-5] [403]: {\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"permission_error\\",\\"message\\":\\"OAuth authentication is currently not allowed\\"}}}}"}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L6: cerebras (outer 503, inner 402 Payment required) -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[cerebras/gpt-oss-120b] [402]: {\\"message\\":\\"Payment required to access this resource...\\"\\"}}"}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED]);
  });

  test('L7: cf (outer 410, inner 410 Model has been deprecated) -> MODEL_UNSUPPORTED', () => {
    const input = {
      httpStatus: 410,
      body: '{"error":{"message":"[410]: {\\"errors\\":[{\\"message\\":\\"Model has been deprecated...\\"}]}}}"}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
    assert.equal(result.scope, Scope.MODEL);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, null);
  });

  test('L9: groq (outer 503, inner 404 does not exist) -> MODEL_UNSUPPORTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[groq/llama-3.3-70b-versatile] [404]: {\\"error\\":{\\"message\\":\\"The model does not exist or you do not have access\\"}}}}"}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
    assert.equal(result.scope, Scope.MODEL);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, null);
  });

  test('L10: kc (outer 503, inner 402 Paid Model - Credits Required) -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[kilocode/anthropic/claude-sonnet-4-20250514] [402]: {\\"error\\":{\\"title\\":\\"Paid Model - Credits Required\\",\\"balance\\":-0.00004}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED]);
  });

  test('L12: kimchi (outer 503, inner 402 exhausted its credits) -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[kimchi/kimi-k3] [402]: {\\"error\\": \\"the provider for model kimi-k3 has exhausted its credits\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED]);
  });

  test('L13: llm7 (outer 503, inner 402 Insufficient balance) -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[llm7/gpt-5.5] [402]: {\\"error\\":{\\"message\\":\\"Insufficient balance...\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED]);
  });

  test('L14: mistral (outer 503, inner 403 subscription tier) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[mistral/mistral-large-latest] [403]: {\\"object\\":\\"error\\",\\"message\\":\\"This model is not available in your subscription tier\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L15: ocg (outer 400, inner 400 requires Global regions) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 400,
      body: '{"error":{"message":"[400]: {\\"error\\":{\\"message\\":\\"This Go model requires Global regions...\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L16: ocz (outer 503, inner 403 Model access is disabled) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[opencode-zen/claude-fable-5] [403]: {\\"error\\":{\\"message\\":\\"Model access is disabled\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L17: ollama (outer 410, inner 410 retired) -> MODEL_UNSUPPORTED', () => {
    const input = {
      httpStatus: 410,
      body: '{"error":{"message":"[410]: {\\"error\\":\\"kimi-k2.5 was retired at 2026-07-31...\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
    assert.equal(result.scope, Scope.MODEL);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, null);
  });

  test('L18: openrouter (outer 400, inner 400 decisions model) -> MODEL_UNSUPPORTED', () => {
    const input = {
      httpStatus: 400,
      body: '{"error":{"message":"[400]: {\\"error\\":{\\"message\\":\\"typesafe/jev-1.13 is a decisions model and cannot be used with the chat/completions endpoint...\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
    assert.equal(result.scope, Scope.MODEL);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, null);
  });

  test('L19: qd (outer 503, inner 403 pricingUrl) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[qoder/qmodel_38max] [403]: {\\"error\\":{\\"message\\":\\"pricingUrl...\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L20: siliconflow (outer 503, inner 402 account balance is insufficient) -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[siliconflow/deepseek-ai/DeepSeek-V4-Pro] [402]: {\\"code\\":30001,\\"message\\":\\"account balance is insufficient\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED]);
  });

  test('L21: tokenrouter (outer 503, inner 403 Terms Of Service) -> UPSTREAM_ENTITLEMENT', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[tokenrouter/anthropic/claude-opus-4.8-fast] [403]: {\\"error\\":{\\"message\\":\\"prohibited due to violation of provider Terms Of Service\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
    assert.equal(result.cooldownMs, null);
  });

  test('L33: groq (outer 503, inner 404 wrong model ID format) -> MODEL_UNSUPPORTED', () => {
    const input = {
      httpStatus: 503,
      body: '{"error":{"message":"[groq/groq/openai/gpt-oss-120b] [404]: {\\"error\\":{\\"message\\":\\"The model does not exist...\\"}}"}}',
    };
    const result = classifyFailure(input);
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
    assert.equal(result.scope, Scope.MODEL);
    assert.equal(result.humanAction, HumanAction.NONE);
    assert.equal(result.cooldownMs, null);
  });
});

describe('Message-only and unwrapping edge cases', () => {
  test('insufficient_credits in body without 402 status -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const result = classifyFailure({
      httpStatus: 400,
      body: '{"error": {"code": "insufficient_credits", "message": "You do not have enough credits"}}',
    });
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('gift balance in body -> UPSTREAM_CREDIT_EXHAUSTED', () => {
    const result = classifyFailure({
      httpStatus: 400,
      body: '{"error": {"message": "gift balance exhausted"}}',
    });
    assert.equal(result.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('request limit in body with outer 429 -> UPSTREAM_RATE_LIMIT', () => {
    const result = classifyFailure({
      httpStatus: 503,
      body: '[tokenrouter/deepseek/deepseek-v4-pro] [429]: {"error":{"code":"","message":"You have reached the request limit: Maximum 5 requests per minute"}}',
    });
    assert.equal(result.cause, Cause.UPSTREAM_RATE_LIMIT);
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('MONTHLY_REQUEST_COUNT in outer 500 body -> UPSTREAM_MONTHLY_LIMIT', () => {
    const result = classifyFailure({
      httpStatus: 500,
      body: '{"message": "Quota exceeded", "reason": "MONTHLY_REQUEST_COUNT"}',
    });
    assert.equal(result.cause, Cause.UPSTREAM_MONTHLY_LIMIT);
    assert.equal(result.scope, Scope.UPSTREAM);
  });

  test('OAuth not allowed in outer 500 body -> UPSTREAM_ENTITLEMENT', () => {
    const result = classifyFailure({
      httpStatus: 500,
      body: '{"error": "OAuth not allowed for this workspace"}',
    });
    assert.equal(result.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(result.scope, Scope.UPSTREAM);
    assert.equal(result.humanAction, HumanAction.REQUIRED);
  });

  test('no HTTP response -> no httpStatus in evidence', () => {
    const result = classifyFailure({
      exitCode: 1,
      stderr: 'connect ECONNREFUSED 127.0.0.1:20128',
    });
    assert.equal(result.cause, Cause.UNKNOWN);
    assert.equal(result.evidence.httpStatus, undefined);
  });

  test('httpStatus 0 (no HTTP response) -> no httpStatus in evidence', () => {
    const result = classifyFailure({
      httpStatus: 0,
      exitCode: 1,
      stderr: 'connect ECONNREFUSED 127.0.0.1:20128',
    });
    assert.equal(result.cause, Cause.UNKNOWN);
    assert.equal(result.evidence.httpStatus, undefined);
  });

  test('read timeout with no HTTP status -> UNKNOWN and no httpStatus in evidence', () => {
    const result = classifyFailure({
      body: 'READ_TIMEOUT: Gateway response headers timed out',
    });
    assert.equal(result.cause, Cause.UNKNOWN);
    assert.equal(result.evidence.httpStatus, undefined);
  });

  test('nested JSON raw metadata -> MODEL_UNSUPPORTED', () => {
    const result = classifyFailure({
      httpStatus: 400,
      body: '{"error":{"message":"Provider returned error","code":400,"metadata":{"raw":"{\\n  \\"error\\": {\\n    \\"code\\": 404,\\n    \\"message\\\": \\"The model does not exist\\"\\n  }\\n}"}}}',
    });
    assert.equal(result.cause, Cause.MODEL_UNSUPPORTED);
    assert.equal(result.scope, Scope.MODEL);
  });
});
