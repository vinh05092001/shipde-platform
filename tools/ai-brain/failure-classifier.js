'use strict';

/**
 * Ship Dễ — Failure Classifier
 *
 * Classifies a provider failure by its real cause and determines how long
 * that cause should keep the combination out of the running.
 *
 * The classifier looks at the INNERMOST cause. An outer 503 means nothing
 * by itself. An unrecognised failure returns `unknown` with its evidence —
 * never a default class, and `unknown` must not be treated as either safe
 * or fatal.
 */

/**
 * Failure cause classes.
 */
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

/**
 * Scope of the failure — what is affected.
 */
const Scope = {
  MODEL: 'model',
  UPSTREAM: 'upstream',
  ACCOUNT: 'account',
  ACCESS_PATH: 'access_path',
  GATEWAY: 'gateway',
  HARNESS: 'harness',
  UNKNOWN: 'unknown',
};

/**
 * Human action required.
 */
const HumanAction = {
  NONE: 'none',
  REQUIRED: 'required',
};

/**
 * Parses a reset time from text like "reset after 1m 59s", "Resets in 62h28m31s",
 * or "reset after 151h 23m". Returns milliseconds from now, or null if not found.
 */
function parseResetTime(text) {
  if (!text) return null;
  const s = String(text);

  // Pattern: "reset after 1m 59s" or "reset after 151h 23m"
  const afterMatch = s.match(/reset after\s+(\d+)h\s*(\d*)m?(?:\s*(\d+)s?)?/i);
  if (afterMatch) {
    const hours = parseInt(afterMatch[1], 10);
    const minutes = parseInt(afterMatch[2] || '0', 10);
    const seconds = parseInt(afterMatch[3] || '0', 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  // Pattern: "reset after 1m 59s" (no hours)
  const afterMatchShort = s.match(/reset after\s+(\d+)m\s*(\d*)s?/i);
  if (afterMatchShort) {
    const minutes = parseInt(afterMatchShort[1], 10);
    const seconds = parseInt(afterMatchShort[2] || '0', 10);
    return (minutes * 60 + seconds) * 1000;
  }

  // Pattern: "Resets in 62h28m31s"
  const inMatch = s.match(/resets? in\s+(\d+)h(\d+)m(\d+)s/i);
  if (inMatch) {
    const hours = parseInt(inMatch[1], 10);
    const minutes = parseInt(inMatch[2], 10);
    const seconds = parseInt(inMatch[3], 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  // Pattern: "Resets in 5m30s" or "Resets in 30s"
  const inMatchShort = s.match(/resets? in\s+(\d+)m?(\d*)s?/i);
  if (inMatchShort) {
    const minutes = parseInt(inMatchShort[1], 10);
    const seconds = parseInt(inMatchShort[2] || '0', 10);
    return (minutes * 60 + seconds) * 1000;
  }

  return null;
}

/**
 * Default cooldowns per cause class (in milliseconds).
 * Used when no reset time is found in the error text.
 */
const DEFAULT_COOLDOWNS = {
  [Cause.UPSTREAM_CREDIT_EXHAUSTED]: 24 * 60 * 60 * 1000, // 24 hours
  [Cause.UPSTREAM_MONTHLY_LIMIT]: 30 * 24 * 60 * 60 * 1000, // 30 days
  [Cause.UPSTREAM_ENTITLEMENT]: null, // never recovers
  [Cause.UPSTREAM_RATE_LIMIT]: 5 * 60 * 1000, // 5 minutes
  [Cause.UPSTREAM_CREDENTIAL]: 60 * 60 * 1000, // 1 hour
  [Cause.MODEL_UNSUPPORTED]: null, // never recovers
  [Cause.ALIAS_MISMATCH]: null, // never recovers (config fix)
  [Cause.ACCOUNT_QUOTA_EXHAUSTED]: 60 * 60 * 1000, // 1 hour
  [Cause.GENUINE_CAPACITY]: 10 * 60 * 1000, // 10 minutes
  [Cause.ACCOUNT_AUTH_FAILED]: null, // never recovers
  [Cause.EXHAUSTION_HIDING]: 60 * 60 * 1000, // 1 hour
  [Cause.UNKNOWN]: 5 * 60 * 1000, // 5 minutes
};

/**
 * Determines if human action is required for a cause.
 */
function requiresHumanAction(cause) {
  return cause === Cause.UPSTREAM_ENTITLEMENT || cause === Cause.ACCOUNT_AUTH_FAILED;
}

/**
 * Extracts inner HTTP status code from body text like "[402]: ...", "[403]: ...", "[404]: ...".
 */
function extractInnerStatus(text) {
  if (!text) return null;
  const match = String(text).match(/[\[(]\s*(401|402|403|404|429)\s*[\])]/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Classifies a failure based on the provided signals.
 *
 * @param {Object} input
 * @param {number} [input.exitCode] - Process exit code
 * @param {number} [input.httpStatus] - HTTP status code
 * @param {string} [input.body] - Response body text
 * @param {string} [input.stderr] - Stderr output
 * @param {string} [input.accountId] - Associated account id
 * @returns {Object} Classification result
 */
function classifyFailure(input) {
  const { exitCode, httpStatus, body = '', stderr = '', accountId } = input || {};
  const text = [
    String(
      body ||
        input?.cause ||
        (typeof input?.error === 'string' ? input.error : '') ||
        input?.message ||
        ''
    ),
    String(stderr || ''),
  ]
    .filter(Boolean)
    .join('\n');
  const evidence = {
    exitCode,
    httpStatus,
    body: String(
      body ||
        input?.cause ||
        (typeof input?.error === 'string' ? input.error : '') ||
        input?.message ||
        ''
    ).slice(0, 500),
    stderr: String(stderr || '').slice(0, 500),
  };
  if (evidence.httpStatus === undefined || evidence.httpStatus === null) {
    delete evidence.httpStatus;
  }
  if (evidence.exitCode === undefined || evidence.exitCode === null) {
    delete evidence.exitCode;
  }

  // If outer status is 503, look for inner status in body (gateway pattern: "[402]: ...")
  const innerStatus = extractInnerStatus(text);
  const effectiveStatus =
    httpStatus === 503 ? (innerStatus ?? httpStatus) : (innerStatus ?? httpStatus);

  // Case 2: upstream monthly limit (402 with MONTHLY_REQUEST_COUNT or "monthly limit")
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

  // Case 1: upstream credit exhausted (402 with "out of credit" / provider credit, or generic 402)
  if (effectiveStatus === 402) {
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

  // Case 3: upstream entitlement (403 unauthorized / not licensed)
  if (effectiveStatus === 403 || /not licensed to use Copilot/i.test(text)) {
    return {
      cause: Cause.UPSTREAM_ENTITLEMENT,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_ENTITLEMENT],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    };
  }

  // Case 4: upstream rate limit (429 with rate limit indicators)
  if (
    effectiveStatus === 429 ||
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

  // Account auth failure on 401 or auth text with account
  if (
    (effectiveStatus === 401 && accountId && accountId !== '*') ||
    /authentication failed|login.required|not logged in|requires login/i.test(text)
  ) {
    return {
      cause: Cause.ACCOUNT_AUTH_FAILED,
      scope: Scope.ACCOUNT,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.ACCOUNT_AUTH_FAILED],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    };
  }

  // Case 5: upstream credential problem (401 unauthorized on upstream)
  if (effectiveStatus === 401 || /invalid.*token|invalid.*credential/i.test(text)) {
    return {
      cause: Cause.UPSTREAM_CREDENTIAL,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDENTIAL],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    };
  }

  // Case 6: model not supported (400 with "model not supported")
  if (
    httpStatus === 400 &&
    /model.{0,20}not.{0,10}support|not.{0,10}support.{0,10}model/i.test(text)
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

  // Case 7: alias mismatch / model not found (access path issue)
  if (
    effectiveStatus === 404 ||
    (/model not found|Model not found/i.test(text) &&
      (/did you mean/i.test(text) || effectiveStatus === 404))
  ) {
    return {
      cause: Cause.ALIAS_MISMATCH,
      scope: Scope.ACCESS_PATH,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.ALIAS_MISMATCH],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    };
  }

  // Case 8: account quota exhausted (agy CLI exit 3 with "limit reached" and reset time)
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

  // Case 9: genuine capacity (503 with "no capacity available")
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

  // Case 10: account auth failed (agy CLI "authentication failed" / "login required")
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

  // Case 11: exhaustion hiding (Paseo "running" status but provider reports unavailable with long reset)
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

  // Unknown cause — scope UNKNOWN means no fault location can be inferred.
  // Callers must apply the 5-minute cooldown to the (upstream, model)
  // combination that produced the signal, not to the harness globally.
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
  classifyFailure,
};
