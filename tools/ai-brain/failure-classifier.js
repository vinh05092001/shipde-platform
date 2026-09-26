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
 * Extracts innermost HTTP status code from text or nested structures.
 * Matches bracketed status patterns like "[402]: ...", "[404]: ...", "(400)"
 * as well as JSON fields like "code": 404, "status": 400.
 */
function extractInnerStatus(text) {
  if (!text) return null;
  const s = String(text);

  const statuses = [];

  // Match all bracketed statuses like [400], [402], [404], [410], [429], [503], etc.
  const bracketMatches = s.matchAll(/[\[(]\s*([45]\d{2})\s*[\])]/g);
  for (const m of bracketMatches) {
    statuses.push(parseInt(m[1], 10));
  }

  // Parse nested JSON if present to check for numeric HTTP codes
  let current = s;
  for (let i = 0; i < 5; i++) {
    const start = current.indexOf('{');
    const end = current.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const obj = JSON.parse(current.slice(start, end + 1));
        if (typeof obj.code === 'number' && obj.code >= 400 && obj.code < 600) {
          statuses.push(obj.code);
        }
        if (typeof obj.status === 'number' && obj.status >= 400 && obj.status < 600) {
          statuses.push(obj.status);
        }
        if (obj.error && typeof obj.error === 'object') {
          if (typeof obj.error.code === 'number' && obj.error.code >= 400 && obj.error.code < 600) {
            statuses.push(obj.error.code);
          }
          if (
            typeof obj.error.status === 'number' &&
            obj.error.status >= 400 &&
            obj.error.status < 600
          ) {
            statuses.push(obj.error.status);
          }
        }

        const rawMeta =
          (obj.error && obj.error.metadata && typeof obj.error.metadata.raw === 'string'
            ? obj.error.metadata.raw
            : null) ||
          (obj.metadata && typeof obj.metadata.raw === 'string' ? obj.metadata.raw : null);

        if (rawMeta) {
          current = rawMeta;
          continue;
        }

        if (
          obj.error &&
          typeof obj.error === 'object' &&
          typeof obj.error.message === 'string' &&
          obj.error.message.includes('{')
        ) {
          current = obj.error.message;
          continue;
        }
        if (typeof obj.message === 'string' && obj.message.includes('{')) {
          current = obj.message;
          continue;
        }
      } catch (_) {}
    }
    break;
  }

  return statuses.length > 0 ? statuses[statuses.length - 1] : null;
}

/**
 * Unwraps nested error strings and JSON to collect all textual representations,
 * error codes, error types, and messages.
 */
function unwrapErrorText(text) {
  if (!text) return '';
  const parts = [String(text)];

  let current = String(text);
  for (let i = 0; i < 5; i++) {
    const start = current.indexOf('{');
    const end = current.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const obj = JSON.parse(current.slice(start, end + 1));
        if (obj.code) parts.push(String(obj.code));
        if (obj.type) parts.push(String(obj.type));
        if (obj.reason) parts.push(String(obj.reason));
        if (obj.message) parts.push(String(obj.message));
        if (obj.msg) parts.push(String(obj.msg));
        if (obj.status) parts.push(String(obj.status));

        let nextCurrent = null;

        if (obj.error) {
          if (typeof obj.error === 'string') {
            parts.push(obj.error);
            if (obj.error.includes('{')) nextCurrent = obj.error;
          } else if (typeof obj.error === 'object') {
            if (obj.error.code) parts.push(String(obj.error.code));
            if (obj.error.type) parts.push(String(obj.error.type));
            if (obj.error.status) parts.push(String(obj.error.status));
            if (obj.error.message) parts.push(String(obj.error.message));
            if (obj.error.msg) parts.push(String(obj.error.msg));
            if (obj.error.data) {
              if (obj.error.data.code) parts.push(String(obj.error.data.code));
              if (obj.error.data.msg) parts.push(String(obj.error.data.msg));
            }
            if (typeof obj.error.message === 'string' && obj.error.message.includes('{')) {
              nextCurrent = obj.error.message;
            }
          }
        }
        if (obj.errors && Array.isArray(obj.errors)) {
          for (const e of obj.errors) {
            if (typeof e === 'string') parts.push(e);
            else if (e && e.message) parts.push(String(e.message));
          }
        }

        const rawMeta =
          (obj.error && obj.error.metadata && typeof obj.error.metadata.raw === 'string'
            ? obj.error.metadata.raw
            : null) ||
          (obj.metadata && typeof obj.metadata.raw === 'string' ? obj.metadata.raw : null);

        if (rawMeta) {
          parts.push(rawMeta);
          nextCurrent = rawMeta;
        }

        if (nextCurrent) {
          current = nextCurrent;
          continue;
        }

        if (typeof obj.message === 'string' && obj.message.includes('{')) {
          current = obj.message;
          continue;
        }
      } catch (_) {}
    }
    break;
  }

  return parts.join('\n');
}

/**
 * Classifies a failure based on the provided signals.
 *
 * @param {Object} input
 * @param {number} [input.exitCode] - Process exit code
 * @param {number} [input.httpStatus] - HTTP status code
 * @param {string} [input.body] - Response body text
 * @param {string} [input.stderr] - Stderr output
 * @returns {Object} Classification result
 */
function classifyFailure(input) {
  const { exitCode, httpStatus, body = '', stderr = '' } = input || {};
  const rawText = [String(body || ''), String(stderr || '')].filter(Boolean).join('\n');
  const fullText = unwrapErrorText(rawText);

  // Preserve exact evidence; no HTTP response -> no httpStatus
  const evidence = {
    exitCode,
    httpStatus:
      input && 'httpStatus' in input && typeof input.httpStatus === 'number' && input.httpStatus > 0
        ? input.httpStatus
        : undefined,
    body: String(body || '').slice(0, 500),
    stderr: String(stderr || '').slice(0, 500),
  };

  // Unwrap innermost HTTP status from any outer status (400, 403, 429, 500, 502, 503)
  const innerStatus = extractInnerStatus(rawText);
  const effectiveStatus = innerStatus ?? (httpStatus > 0 ? httpStatus : undefined);

  // Case 7: alias mismatch (Paseo/OpenCode "Model not found" with "Did you mean")
  if (/model not found/i.test(fullText) && /did you mean/i.test(fullText)) {
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
  if (exitCode === 3 && /limit reached|quota exhausted|usage limit/i.test(fullText)) {
    const resetMs = parseResetTime(fullText);
    return {
      cause: Cause.ACCOUNT_QUOTA_EXHAUSTED,
      scope: Scope.ACCOUNT,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.ACCOUNT_QUOTA_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 10: account auth failed (agy CLI "authentication failed" / "login required" / not logged in)
  if (
    /login.required|not logged in|requires login/i.test(fullText) ||
    (/authentication failed/i.test(fullText) && !effectiveStatus)
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

  // Case 2: upstream monthly limit (MONTHLY_REQUEST_COUNT or "monthly limit" / "monthly request")
  if (
    /MONTHLY_REQUEST_COUNT/i.test(fullText) ||
    ((effectiveStatus === 402 || effectiveStatus === 429) &&
      /monthly.{0,10}limit|monthly.{0,10}request/i.test(fullText))
  ) {
    const resetMs = parseResetTime(fullText);
    return {
      cause: Cause.UPSTREAM_MONTHLY_LIMIT,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_MONTHLY_LIMIT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 1: upstream credit exhausted
  // Matches 402 with credit/balance indicators, or any status where body names credit/balance exhaustion:
  // e.g. "insufficient_credits", "insufficient_quota", "out of credit", "exhausted its credits",
  // "Credits exhausted", "Paid Model - Credits Required", "Payment required", "gift balance", "account balance is insufficient"
  const isCreditPattern =
    /out of credit|credit.{0,20}exhaust|exhaust.{0,20}credit|insufficient.*credit|insufficient_credit/i.test(
      fullText
    ) ||
    /provider.{0,20}credit|paid model.*credit.*required|credits? required/i.test(fullText) ||
    /payment required/i.test(fullText) ||
    /insufficient.*balance|balance.*insufficient|insufficient_quota/i.test(fullText) ||
    /add usage credits|not included in your free usage/i.test(fullText) ||
    /gift balance/i.test(fullText);

  if (isCreditPattern || (effectiveStatus === 402 && !/MONTHLY_REQUEST_COUNT/i.test(fullText))) {
    const resetMs = parseResetTime(fullText);
    return {
      cause: Cause.UPSTREAM_CREDIT_EXHAUSTED,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 11: exhaustion hiding (Paseo "running" status or provider reports unavailable with long reset >= 1h)
  if (
    (/running/i.test(fullText) &&
      /unavailable|unavailable.*reset|reset after.*[0-9]+h/i.test(fullText)) ||
    (/unavailable/i.test(fullText) && /reset after\s+\d+h/i.test(fullText))
  ) {
    const resetMs = parseResetTime(fullText);
    return {
      cause: Cause.EXHAUSTION_HIDING,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.EXHAUSTION_HIDING],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 5: upstream credential problem (401 unauthorized / invalid token)
  if (
    effectiveStatus === 401 ||
    ((effectiveStatus === 403 || httpStatus === 503) &&
      /invalid.*token|invalid.*api.?key|invalid.*credential/i.test(fullText))
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

  // Case 4: upstream rate limit (429 with rate limit indicators, or "request limit")
  if (
    effectiveStatus === 429 ||
    /rate.?limit|too many requests|user_global_rate_limited|request limit/i.test(fullText)
  ) {
    const resetMs = parseResetTime(fullText);
    return {
      cause: Cause.UPSTREAM_RATE_LIMIT,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_RATE_LIMIT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 3: upstream entitlement (Arrearage, InvalidSubscription, OAuth not allowed, 403 forbidden/tier/pricing)
  const isEntitlementPattern =
    /Arrearage/i.test(fullText) ||
    /InvalidSubscription/i.test(fullText) ||
    /OAuth.*not allowed/i.test(fullText) ||
    /subscription tier|subscription.*required|active.*subscription/i.test(fullText) ||
    /only available to subscribers/i.test(fullText) ||
    /requires Global regions|trains on request data/i.test(fullText) ||
    /model access is disabled|\bmodel disabled\b/i.test(fullText) ||
    /pricingUrl/i.test(fullText) ||
    /violation of.*Terms Of Service|\bTerms Of Service\b/i.test(fullText) ||
    (effectiveStatus === 403 &&
      /unauthorized|not licensed|entitlement|forbidden|permission_error/i.test(fullText));

  if (isEntitlementPattern || (effectiveStatus === 403 && !/rate.?limit/i.test(fullText))) {
    return {
      cause: Cause.UPSTREAM_ENTITLEMENT,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_ENTITLEMENT],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    };
  }

  // Case 6: model not supported (404, 410, decisions model on chat endpoint, deprecated, retired, not supported)
  const isModelUnsupportedPattern =
    effectiveStatus === 404 ||
    effectiveStatus === 410 ||
    /model.{0,20}not.{0,10}support|not.{0,10}support.{0,10}model/i.test(fullText) ||
    /model.{0,20}not.{0,10}(?:found|exist)|not.{0,10}(?:found|exist).{0,10}model/i.test(fullText) ||
    /Requested entity was not found|\bNOT_FOUND\b/i.test(fullText) ||
    /UnsupportedModel/i.test(fullText) ||
    /archived and unavailable/i.test(fullText) ||
    /model_not_found|no available channel for this model/i.test(fullText) ||
    /model has been deprecated|was deprecated/i.test(fullText) ||
    /was retired at|\bretired\b/i.test(fullText) ||
    /decisions model and cannot be used with the chat\/completions endpoint|decisions model/i.test(
      fullText
    ) ||
    /\bmodel_unavailable\b|model.{0,40}unavailable/i.test(fullText);

  if (isModelUnsupportedPattern) {
    return {
      cause: Cause.MODEL_UNSUPPORTED,
      scope: Scope.MODEL,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.MODEL_UNSUPPORTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    };
  }

  // Case 9: genuine capacity (503 with "no capacity available" or overloaded)
  if (
    (effectiveStatus === 503 || exitCode !== 0) &&
    /no capacity available|capacity.{0,10}unavailable|server.{0,10}capacity|overloaded|server is currently overloaded/i.test(
      fullText
    )
  ) {
    const resetMs = parseResetTime(fullText);
    return {
      cause: Cause.GENUINE_CAPACITY,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.GENUINE_CAPACITY],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Unknown cause — scope UNKNOWN means no fault location can be inferred.
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
