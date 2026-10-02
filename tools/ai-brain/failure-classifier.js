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
  HARNESS_FAILED: 'harness_failed',
  LAUNCH_CONFIG: 'launch_config',
  UNKNOWN: 'unknown',
  TIMEOUT: 'timeout',
  QUOTA_EXHAUSTED: 'quota_exhausted',
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
 * Maximum cooldown allowed for parsed reset hints (30 days in ms).
 */
const MAX_RESET_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Parses a reset time from text like "reset after 1m 59s", "Resets in 62h28m31s",
 * or "reset after 151h 23m". Returns milliseconds from now, bounded by MAX_RESET_MS,
 * or null if not found.
 */
function parseResetTime(text) {
  if (!text) return null;
  const s = String(text);

  let resultMs = null;

  // Pattern: "Resets in 62h28m31s"
  const inMatch = s.match(/(?:resets?|try\s+again)\s+(?:in|after)\s*(\d+)h\s*(\d+)m\s*(\d+)s/i);
  if (inMatch) {
    const hours = parseInt(inMatch[1], 10);
    const minutes = parseInt(inMatch[2], 10);
    const seconds = parseInt(inMatch[3], 10);
    resultMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  } else {
    // Pattern: "reset after 151h 23m", "reset after 116h", "reset after 2 hours", "Try again in 15h 27m"
    const afterMatch = s.match(
      /(?:resets?|try\s+again)\s+(?:after|in)\s+(\d+)\s*(?:h|hr|hours?)(?:\s*(\d+)\s*(?:m|min|minutes?)?)?(?:\s*(\d+)\s*(?:s|sec|seconds?)?)?/i
    );
    if (afterMatch) {
      const hours = parseInt(afterMatch[1], 10);
      const minutes = parseInt(afterMatch[2] || '0', 10);
      const seconds = parseInt(afterMatch[3] || '0', 10);
      resultMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
    } else {
      // Pattern: "reset after 1m 59s" (no hours)
      const afterMatchShort = s.match(
        /(?:resets?|try\s+again)\s+(?:after|in)\s+(\d+)\s*(?:m|min|minutes?)(?:\s*(\d+)\s*(?:s|sec|seconds?)?)?/i
      );
      if (afterMatchShort) {
        const minutes = parseInt(afterMatchShort[1], 10);
        const seconds = parseInt(afterMatchShort[2] || '0', 10);
        resultMs = (minutes * 60 + seconds) * 1000;
      } else {
        // Pattern: "reset after 30s" (seconds only)
        const afterMatchSec = s.match(
          /(?:resets?|try\s+again)\s+(?:after|in)\s+(\d+)\s*(?:s|sec|seconds?)/i
        );
        if (afterMatchSec) {
          const seconds = parseInt(afterMatchSec[1], 10);
          resultMs = seconds * 1000;
        }
      }
    }
  }

  if (resultMs === null || !Number.isFinite(resultMs)) return null;
  return Math.min(Math.max(resultMs, 0), MAX_RESET_MS);
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
  [Cause.HARNESS_FAILED]: 5 * 60 * 1000, // 5 minutes
  [Cause.LAUNCH_CONFIG]: 5 * 60 * 1000, // 5 minutes (finite cooldown)
  [Cause.UNKNOWN]: 5 * 60 * 1000, // 5 minutes
  [Cause.TIMEOUT]: 10 * 60 * 1000, // 10 minutes
  [Cause.QUOTA_EXHAUSTED]: 60 * 60 * 1000, // 1 hour
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
 * Extracts structured provider error text from stdout JSON lines or formatted error messages.
 * Untrusted worker text (normal test output, console.log, file listings) is ignored.
 */
function extractProviderErrorText(stdout) {
  if (!stdout) return '';
  const s = String(stdout);
  const errorLines = [];
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('{') && trimmed.includes('}')) {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, end + 1));
          if (parsed && (parsed.type === 'error' || parsed.error)) {
            if (parsed.error && parsed.error.data) {
              if (parsed.error.data.message) errorLines.push(String(parsed.error.data.message));
              if (parsed.error.data.responseBody) {
                const rb = parsed.error.data.responseBody;
                errorLines.push(typeof rb === 'string' ? rb : JSON.stringify(rb));
              }
            } else {
              const msg =
                (parsed.error && (parsed.error.message || parsed.error.name)) ||
                (typeof parsed.error === 'string' ? parsed.error : '') ||
                parsed.message ||
                '';
              if (msg) errorLines.push(String(msg));
            }
          }
        } catch (_) {}
      }
    }
    const errorMatch = trimmed.match(/(?:^|\b)(?:Error|HTTP \d+):\s*.+/i);
    if (errorMatch) {
      errorLines.push(errorMatch[0]);
    } else if (/Unavailable\s*\([^)]*reset after/i.test(trimmed)) {
      errorLines.push(trimmed);
    }
  }
  return errorLines.join('\n');
}

/**
 * Extracts structured provider error events from stdout JSON lines.
 */
function extractStructuredProviderEvents(stdout) {
  if (!stdout) return [];
  const s = String(stdout);
  const events = [];
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('{') && trimmed.includes('}')) {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, end + 1));
          if (parsed && (parsed.type === 'error' || parsed.error)) {
            events.push(parsed);
          }
        } catch (_) {}
      }
    }
  }
  return events;
}

/**
 * Classifies a failure based on the provided signals.
 *
 * @param {Object} input
 * @param {number} [input.exitCode] - Process exit code
 * @param {number} [input.httpStatus] - HTTP status code
 * @param {string} [input.body] - Response body text
 * @param {string} [input.stdout] - Stdout output
 * @param {string} [input.stderr] - Stderr output
 * @param {string} [input.accountId] - Associated account id
 * @returns {Object} Classification result
 */
function classifyFailure(input) {
  const { exitCode, httpStatus, body = '', stderr = '', stdout = '', accountId } = input || {};
  const text = [
    String(
      body ||
        input?.cause ||
        (typeof input?.error === 'string' ? input.error : '') ||
        input?.message ||
        ''
    ),
    String(stdout || input?.stdout || ''),
    String(stderr || ''),
  ]
    .filter(Boolean)
    .join('\n');
  const { scrubText } = require('./decisions');
  const scrubbedStdout = scrubText(String(stdout || input?.stdout || '')).slice(0, 500);
  const evidence = {
    exitCode,
    httpStatus,
    body: scrubText(
      String(
        body ||
          input?.cause ||
          (typeof input?.error === 'string' ? input.error : '') ||
          input?.message ||
          ''
      )
    ).slice(0, 500),
    stdout: scrubbedStdout,
    stderr: scrubText(String(stderr || '')).slice(0, 500),
  };
  if (evidence.httpStatus === undefined || evidence.httpStatus === null) {
    delete evidence.httpStatus;
  }
  if (evidence.exitCode === undefined || evidence.exitCode === null) {
    delete evidence.exitCode;
  }
  if (!evidence.stdout) {
    delete evidence.stdout;
  }

  // Launcher timeout: authentic signal from launcher (structured timedOut flag, Cause.TIMEOUT, or launcher stderr prefix)
  // Launcher timeout takes precedence over all worker output and quota errors (F1)
  const isTimedOut = Boolean(
    input?.timedOut === true ||
    input?.cause === Cause.TIMEOUT ||
    input?.cause === 'TIMEOUT' ||
    input?.cause === 'timeout' ||
    /\[ISOLATION_LAUNCHER\] worker timed out/i.test(stderr) ||
    /\[ISOLATION_LAUNCHER\] worker timed out/i.test(input?.failureReason || '')
  );

  if (isTimedOut) {
    return {
      cause: Cause.TIMEOUT,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.TIMEOUT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: Date.now() + DEFAULT_COOLDOWNS[Cause.TIMEOUT],
    };
  }

  const providerEvents = extractStructuredProviderEvents(stdout);
  let envelopeStatus = null;
  let envelopeInnerStatus = null;
  let isStructuredEnvelopeQuota = false;

  for (const ev of providerEvents) {
    const err = ev.error;
    const data = err?.data;
    if (data && Number.isFinite(Number(data.statusCode))) {
      envelopeStatus = Number(data.statusCode);
    }
    const innerMsg = extractInnerStatus(data?.message);
    const innerBody = extractInnerStatus(
      typeof data?.responseBody === 'string'
        ? data.responseBody
        : JSON.stringify(data?.responseBody || '')
    );
    if (innerMsg || innerBody) {
      envelopeInnerStatus = innerMsg || innerBody;
    }
    const eventText = [
      err?.name,
      err?.message,
      data?.message,
      typeof data?.responseBody === 'string'
        ? data.responseBody
        : JSON.stringify(data?.responseBody || ''),
    ]
      .filter(Boolean)
      .join('\n');
    if (
      /INFERENCE_CAP_ERROR/i.test(eventText) ||
      /(?:daily\s+)?free\s+limit\s+reached/i.test(eventText) ||
      /FreeUsageLimit/i.test(eventText) ||
      /Unavailable\s*\([^)]*reset after/i.test(eventText)
    ) {
      isStructuredEnvelopeQuota = true;
    }
  }

  const rawBodyText = String(
    body || (typeof input?.error === 'string' ? input.error : '') || input?.message || ''
  );

  // If outer status is 503, look for inner status in body or structured error envelope
  // Status extraction is strictly anchored to body or structured status line, never raw worker stdout (F2)
  const innerStatus = extractInnerStatus(rawBodyText) || envelopeInnerStatus;
  const outerStatus =
    httpStatus !== undefined && httpStatus !== null ? Number(httpStatus) : envelopeStatus;
  let effectiveStatus =
    outerStatus === 503 ? (innerStatus ?? outerStatus) : (innerStatus ?? outerStatus);
  if (effectiveStatus === undefined || effectiveStatus === null) {
    if (/\bHTTP\s+429\b/i.test(stderr) || /\bstatus\s*:\s*429\b/i.test(stderr)) {
      effectiveStatus = 429;
    }
  }

  const providerErrorText = extractProviderErrorText(stdout);
  const errorPayloadText = [rawBodyText, stderr, providerErrorText].filter(Boolean).join('\n');

  // Case 2: upstream monthly limit (402 with MONTHLY_REQUEST_COUNT or "monthly limit")
  if (
    effectiveStatus === 402 &&
    /MONTHLY_REQUEST_COUNT|monthly.{0,10}limit|monthly.{0,10}request/i.test(
      errorPayloadText || text
    )
  ) {
    const resetMs = parseResetTime(errorPayloadText || text);
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
  if (effectiveStatus === 402 || effectiveStatus === 504) {
    const resetMs = parseResetTime(errorPayloadText || text);
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
  if (effectiveStatus === 403 || /not licensed to use Copilot/i.test(errorPayloadText || text)) {
    return {
      cause: Cause.UPSTREAM_ENTITLEMENT,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_ENTITLEMENT],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    };
  }

  // Case 13: Harness / launch config failure (e.g. OpenCode provider/config resolution error before model call)
  // Gated on absence of HTTP status (no model HTTP call) and non-zero exit status or explicit harness cause.
  // Must take precedence over worker-controlled stdout to prevent domain widening (F2).
  const hasHttpStatus =
    (httpStatus !== undefined && httpStatus !== null && Number(httpStatus) > 0) ||
    (envelopeStatus !== null && envelopeStatus > 0);
  const isExplicitHarness =
    input?.cause === 'LAUNCH_CONFIG' ||
    input?.cause === 'HARNESS_FAILED' ||
    input?.cause === 'UNKNOWN_HARNESS' ||
    input?.cause === 'HARNESS_UNKNOWN' ||
    /LAUNCH_CONFIG|HARNESS_FAILED|UNKNOWN_HARNESS|HARNESS_UNKNOWN/i.test(text);

  if (
    (!hasHttpStatus || isExplicitHarness) &&
    (isExplicitHarness ||
      (exitCode !== 0 &&
        (/UnknownError.*Unexpected server error|Unexpected server error.*UnknownError/i.test(
          text
        ) ||
          /(?:\"name\"|\bname\b)\s*:\s*\"UnknownError\"/i.test(text) ||
          /provider.{0,30}(?:not found|not registered|cannot resolve|failed to resolve|unknown)/i.test(
            text
          ) ||
          /(?:cannot|failed to|unable to|could not)\s+resolve\s+provider/i.test(text) ||
          /(?:unknown|unresolved|invalid|missing).{0,20}(?:provider|harness)/i.test(text) ||
          /@ai-sdk\/openai-compatible/i.test(text) ||
          /(?:harness|launch).{0,15}config(?:uration)?.{0,15}error/i.test(text))))
  ) {
    const isHarnessFailed =
      /HARNESS_FAILED|harness_failed/i.test(text) && !/LAUNCH_CONFIG|launch_config/i.test(text);
    const cause = isHarnessFailed ? Cause.HARNESS_FAILED : Cause.LAUNCH_CONFIG;
    return {
      cause,
      scope: Scope.HARNESS,
      cooldownMs: DEFAULT_COOLDOWNS[cause] !== undefined ? DEFAULT_COOLDOWNS[cause] : 5 * 60 * 1000,
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    };
  }

  // Case 11: exhaustion hiding (Paseo "running" status but provider reports unavailable with long reset)
  // Scoped strictly to session status signal so normal worker event streams are not blocked (F3)
  const isExhaustionHiding = Boolean(
    (input?.sessionStatus === 'running' ||
      /Paseo reported status\s*[`"']?running[`"']?/i.test(text) ||
      /session\s+status\s*[`"']?running[`"']?/i.test(text) ||
      /status\s*[`"']?running[`"']?\s*for an hour/i.test(text)) &&
    /unavailable|unavailable.*reset|reset after.*[0-9]+h/i.test(text)
  );

  if (isExhaustionHiding) {
    const resetMs = parseResetTime(errorPayloadText || text);
    return {
      cause: Cause.EXHAUSTION_HIDING,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.EXHAUSTION_HIDING],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Upstream quota exhausted (e.g. "Unavailable (reset after ...)", FreeUsageLimit, HTTP 429 quota indicators)
  // Derived only from structured signals or provider error envelopes, never arbitrary worker text (F1, F2)
  const isExplicitQuota =
    input?.cause === Cause.QUOTA_EXHAUSTED ||
    input?.cause === 'QUOTA_EXHAUSTED' ||
    input?.cause === 'quota_exhausted';

  const isStructured429Quota =
    effectiveStatus === 429 &&
    /quota|usage.?limit|free.?tier|free.?limit|inference.?cap|resource.?exhausted|unavailable|resets?\s+(?:in|after)|try\s+again\s+(?:in|after)/i.test(
      errorPayloadText
    );

  const isEnvelopeQuota =
    isStructuredEnvelopeQuota ||
    /FreeUsageLimit/i.test(errorPayloadText) ||
    /Unavailable\s*\([^)]*reset after/i.test(errorPayloadText) ||
    /unavailable.*reset after/i.test(errorPayloadText);

  const isUpstreamQuota =
    !isExhaustionHiding &&
    (isExplicitQuota || isStructured429Quota || isEnvelopeQuota) &&
    exitCode !== 3 &&
    !/account/i.test(input?.cause || '');

  if (isUpstreamQuota) {
    const resetMs = parseResetTime(errorPayloadText || text);
    return {
      cause: Cause.QUOTA_EXHAUSTED,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.QUOTA_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    };
  }

  // Case 4: upstream rate limit (429 with rate limit indicators, or plain 429)
  if (
    effectiveStatus === 429 ||
    /rate.?limit|too many requests|user_global_rate_limited/i.test(errorPayloadText)
  ) {
    const resetMs = parseResetTime(errorPayloadText || text);
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
      scope: Scope.MODEL,
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

  // Case 12: HTTP process failure means gateway or access path failure
  if (
    httpStatus === 0 ||
    (exitCode !== 0 && /ECONNREFUSED|ENOTFOUND|gateway unreachable/i.test(text))
  ) {
    return {
      cause: Cause.UNKNOWN,
      scope: Scope.GATEWAY,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UNKNOWN],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
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
  MAX_RESET_MS,
  DEFAULT_COOLDOWNS,
  requiresHumanAction,
  classifyFailure,
};
