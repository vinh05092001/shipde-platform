'use strict';

/**
 * Ship Dễ — Failure Classifier Adapter for Probe Runner
 *
 * Implements the contract defined in origin/feat/brain-failure-classes.
 * If tools/ai-brain/failure-classifier.js exists on base, it delegates to it;
 * otherwise it provides the authoritative implementation with innermost status
 * extraction for 401, 402, 403, 404, and 429.
 */

const fs = require('fs');
const path = require('path');

const Cause = {
  UPSTREAM_CREDIT_EXHAUSTED: 'upstream_credit_exhausted',
  UPSTREAM_MONTHLY_LIMIT: 'upstream_monthly_limit',
  UPSTREAM_ENTITLEMENT: 'upstream_entitlement',
  UPSTREAM_RATE_LIMIT: 'upstream_rate_limit',
  UPSTREAM_CREDENTIAL: 'upstream_credential',
  MODEL_UNSUPPORTED: 'model_unsupported',
  ALIAS_MISMATCH: 'alias_mismatch',
  ACCOUNT_QUOTA_EXHAUSTED: 'account_quota_exhausted',
  GENUINE_CAPACITY: 'genuine_capacity',
  ACCOUNT_AUTH_FAILED: 'account_auth_failed',
  EXHAUSTION_HIDING: 'exhaustion_hiding',
  UNKNOWN: 'unknown',
};

const Scope = {
  MODEL: 'model',
  UPSTREAM: 'upstream',
  ACCOUNT: 'account',
  ACCESS_PATH: 'access_path',
  HARNESS: 'harness',
  UNKNOWN: 'unknown',
};

const HumanAction = {
  NONE: 'none',
  REQUIRED: 'required',
};

const DEFAULT_COOLDOWNS = {
  [Cause.UPSTREAM_CREDIT_EXHAUSTED]: 24 * 60 * 60 * 1000,
  [Cause.UPSTREAM_MONTHLY_LIMIT]: 30 * 24 * 60 * 60 * 1000,
  [Cause.UPSTREAM_ENTITLEMENT]: null,
  [Cause.UPSTREAM_RATE_LIMIT]: 5 * 60 * 1000,
  [Cause.UPSTREAM_CREDENTIAL]: 60 * 60 * 1000,
  [Cause.MODEL_UNSUPPORTED]: null,
  [Cause.ALIAS_MISMATCH]: null,
  [Cause.ACCOUNT_QUOTA_EXHAUSTED]: 60 * 60 * 1000,
  [Cause.GENUINE_CAPACITY]: 10 * 60 * 1000,
  [Cause.ACCOUNT_AUTH_FAILED]: null,
  [Cause.EXHAUSTION_HIDING]: 60 * 60 * 1000,
  [Cause.UNKNOWN]: 5 * 60 * 1000,
};

function requiresHumanAction(cause) {
  return cause === Cause.UPSTREAM_ENTITLEMENT || cause === Cause.ACCOUNT_AUTH_FAILED;
}

function parseResetTime(text) {
  if (!text) return null;
  const s = String(text);

  const afterMatch = s.match(/reset after\s+(\d+)h\s*(\d*)m?(?:\s*(\d+)s?)?/i);
  if (afterMatch) {
    const hours = parseInt(afterMatch[1], 10);
    const minutes = parseInt(afterMatch[2] || '0', 10);
    const seconds = parseInt(afterMatch[3] || '0', 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  const afterMatchShort = s.match(/reset after\s+(\d+)m\s*(\d*)s?/i);
  if (afterMatchShort) {
    const minutes = parseInt(afterMatchShort[1], 10);
    const seconds = parseInt(afterMatchShort[2] || '0', 10);
    return (minutes * 60 + seconds) * 1000;
  }

  const inMatch = s.match(/resets? in\s+(\d+)h(\d+)m(\d+)s/i);
  if (inMatch) {
    const hours = parseInt(inMatch[1], 10);
    const minutes = parseInt(inMatch[2], 10);
    const seconds = parseInt(inMatch[3], 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  const inMatchShort = s.match(/resets? in\s+(\d+)m?(\d*)s?/i);
  if (inMatchShort) {
    const minutes = parseInt(inMatchShort[1], 10);
    const seconds = parseInt(inMatchShort[2] || '0', 10);
    return (minutes * 60 + seconds) * 1000;
  }

  return null;
}

function extractInnerStatus(text) {
  if (!text) return null;
  const match = String(text).match(/[\[(]\s*(401|402|403|404|429)\s*[\])]/);
  return match ? parseInt(match[1], 10) : null;
}

let parentClassifier = null;
const parentPath = path.join(__dirname, '..', 'failure-classifier.js');
if (fs.existsSync(parentPath)) {
  try {
    parentClassifier = require(parentPath);
  } catch (e) {
    parentClassifier = null;
  }
}

function classifyFailure(input) {
  const { exitCode, httpStatus, body = '', stderr = '' } = input || {};
  const text = [String(body || ''), String(stderr || '')].filter(Boolean).join('\n');
  const evidence = {
    exitCode,
    httpStatus,
    body: String(body || '').slice(0, 500),
    stderr: String(stderr || '').slice(0, 500),
  };

  const innerStatus = extractInnerStatus(text);
  const effectiveStatus =
    httpStatus === 503 ? (innerStatus ?? httpStatus) : (innerStatus ?? httpStatus);

  if (parentClassifier && typeof parentClassifier.classifyFailure === 'function') {
    // Check 404 first if parent doesn't handle 404 inner status
    if (effectiveStatus === 404) {
      return {
        cause: Cause.MODEL_UNSUPPORTED,
        scope: Scope.MODEL,
        cooldownMs: DEFAULT_COOLDOWNS[Cause.MODEL_UNSUPPORTED],
        humanAction: HumanAction.NONE,
        evidence,
        resetTime: null,
      };
    }
    const result = parentClassifier.classifyFailure({
      exitCode,
      httpStatus: effectiveStatus,
      body,
      stderr,
    });
    if (result && result.cause !== Cause.UNKNOWN) {
      return result;
    }
  }

  // Case 1: upstream credit exhausted
  if (
    effectiveStatus === 402 &&
    /out of credit|credit.{0,20}exhaust|insufficient.*credit|provider.{0,20}credit/i.test(text)
  ) {
    const resetMs = parseResetTime(text);
    return {
      cause: Cause.UPSTREAM_CREDIT_EXHAUSTED,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 2: upstream monthly limit
  if (
    effectiveStatus === 402 &&
    /MONTHLY_REQUEST_COUNT|monthly.{0,10}limit|monthly.{0,10}request/i.test(text)
  ) {
    const resetMs = parseResetTime(text);
    return {
      cause: Cause.UPSTREAM_MONTHLY_LIMIT,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_MONTHLY_LIMIT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 3: upstream entitlement
  if (effectiveStatus === 403 && /unauthorized|not licensed|entitlement|forbidden/i.test(text)) {
    return {
      cause: Cause.UPSTREAM_ENTITLEMENT,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_ENTITLEMENT],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    };
  }

  // Case 4: upstream rate limit
  if (
    effectiveStatus === 429 &&
    /rate.?limit|too many requests|user_global_rate_limited/i.test(text)
  ) {
    const resetMs = parseResetTime(text);
    return {
      cause: Cause.UPSTREAM_RATE_LIMIT,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_RATE_LIMIT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 5: upstream credential problem
  if (
    effectiveStatus === 401 &&
    /unauthorized|invalid.*token|authentication failed|invalid.*credential/i.test(text)
  ) {
    return {
      cause: Cause.UPSTREAM_CREDENTIAL,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDENTIAL],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    };
  }

  // Case 6: model not supported (400 or 404 or model not supported / not found)
  if (
    effectiveStatus === 404 ||
    (effectiveStatus === 400 &&
      /model.{0,20}not.{0,10}support|not.{0,10}support.{0,10}model/i.test(text)) ||
    (/model not found|not found/i.test(text) && effectiveStatus >= 400 && effectiveStatus < 500)
  ) {
    return {
      cause: Cause.MODEL_UNSUPPORTED,
      scope: Scope.MODEL,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.MODEL_UNSUPPORTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    };
  }

  // Case 7: alias mismatch
  if (/model not found|Model not found/i.test(text) && /did you mean/i.test(text)) {
    return {
      cause: Cause.ALIAS_MISMATCH,
      scope: Scope.ACCESS_PATH,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.ALIAS_MISMATCH],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    };
  }

  // Case 8: account quota exhausted
  if (exitCode === 3 && /limit reached|quota exhausted|usage limit/i.test(text)) {
    const resetMs = parseResetTime(text);
    return {
      cause: Cause.ACCOUNT_QUOTA_EXHAUSTED,
      scope: Scope.ACCOUNT,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.ACCOUNT_QUOTA_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 9: genuine capacity
  if (
    (effectiveStatus === 503 || exitCode !== 0) &&
    /no capacity available|capacity.{0,10}unavailable|server.{0,10}capacity/i.test(text)
  ) {
    const resetMs = parseResetTime(text);
    return {
      cause: Cause.GENUINE_CAPACITY,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.GENUINE_CAPACITY],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 10: account auth failed
  if (/authentication failed|login.required|not logged in|requires login/i.test(text)) {
    return {
      cause: Cause.ACCOUNT_AUTH_FAILED,
      scope: Scope.ACCOUNT,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.ACCOUNT_AUTH_FAILED],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    };
  }

  // Case 11: exhaustion hiding
  if (/running/i.test(text) && /unavailable|unavailable.*reset|reset after.*[0-9]+h/i.test(text)) {
    const resetMs = parseResetTime(text);
    return {
      cause: Cause.EXHAUSTION_HIDING,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.EXHAUSTION_HIDING],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Fallback: unknown
  return {
    cause: Cause.UNKNOWN,
    scope: Scope.UNKNOWN,
    cooldownMs: DEFAULT_COOLDOWNS[Cause.UNKNOWN],
    humanAction: HumanAction.NONE,
    evidence,
    resetTime: null,
  };
}

module.exports = {
  Cause,
  Scope,
  HumanAction,
  parseResetTime,
  DEFAULT_COOLDOWNS,
  requiresHumanAction,
  extractInnerStatus,
  classifyFailure,
};
