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
 *
 * `local` is the one scope that blames nothing outside this machine's own
 * launch configuration (e.g. a base commit the launcher cannot check out).
 * A local failure must never add a candidate or a failure domain to an
 * exclusion set (TASK-AI-120 RI-R03).
 */
const Scope = {
  MODEL: 'model',
  UPSTREAM: 'upstream',
  ACCOUNT: 'account',
  ACCESS_PATH: 'access_path',
  GATEWAY: 'gateway',
  HARNESS: 'harness',
  LOCAL: 'local',
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
 * The operator action that clears an unusable isolation verdict: the verdict
 * file only exists again after the isolation checks are re-run.
 */
const ISOLATION_VERDICT_HUMAN_ACTION = 'run scripts/ai/isolation/Test-WorkerIsolation.ps1';

/**
 * Launch infrastructure errors: the isolated launcher itself could not start
 * the worker. These are this machine's launch configuration, never a model,
 * account, gateway or harness fault (TASK-AI-121 LF-R01):
 *
 *   ISOLATION_VERDICT_STALE / _MISSING / _INVALID / _NOT_CLOSED — the boundary
 *   attestation is unusable; ISOLATION_CHECKOUT_FAILED and the pinned base-SHA
 *   errors; PROVISION_BASE_MISMATCH; a worker-root removal that failed with
 *   EPERM/EBUSY; and the clone failure the launcher reports verbatim.
 *
 * Only the launcher's own stderr is read here — worker stdout never widens or
 * narrows the rule.
 */
function isLaunchInfraFailure(text) {
  const s = String(text || '');
  return (
    /ISOLATION_VERDICT_(STALE|MISSING|INVALID|NOT_CLOSED)/.test(s) ||
    /ISOLATION_CHECKOUT_FAILED|ISOLATION_BASE_SHA_MISSING|ISOLATION_BASE_SHA_INVALID/.test(s) ||
    /PROVISION_BASE_MISMATCH/.test(s) ||
    /Failed to clone repository/.test(s) ||
    /\b(EPERM|EBUSY)\b[^\n]{0,120}(unlink|rmdir|operation not permitted|resource busy or locked)/.test(
      s
    ) ||
    /(unlink|rmdir)[^\n]{0,120}\b(EPERM|EBUSY)\b/.test(s)
  );
}

/**
 * The verdict errors that make every candidate fail identically, so the run
 * must stop instead of walking the rest of the list (LF-R02). Returns the
 * reason code to report, or null when the failure is not one of them.
 */
function isolationVerdictBlockReason(text) {
  const s = String(text || '');
  if (/ISOLATION_VERDICT_STALE/.test(s)) return 'ISOLATION_VERDICT_STALE';
  if (/ISOLATION_VERDICT_MISSING/.test(s)) return 'ISOLATION_VERDICT_MISSING';
  return null;
}

/**
 * Operations that are replayable (read-only or idempotent).
 */
const REPLAYABLE_OPERATIONS = new Set(['probe', 'list', 'reviewRead', 'testRun']);

/**
 * Operations that are NEVER replayable (mutating external effects).
 */
const NON_REPLAYABLE_OPERATIONS = new Set(['publish', 'push', 'createPR', 'comment', 'merge']);

/**
 * Determines if an operation can be safely replayed.
 * Only read-only or idempotent operations are replayable.
 * Mirrors the AGENTS.md rule against blind retries of external effects.
 *
 * @param {string} operation - The operation name
 * @returns {boolean} True if the operation is replayable
 */
function isReplayable(operation) {
  if (typeof operation !== 'string' || !operation) return false;
  if (REPLAYABLE_OPERATIONS.has(operation)) return true;
  if (NON_REPLAYABLE_OPERATIONS.has(operation)) return false;
  return false;
}

/**
 * Determines if a cause is retryable based on its classification.
 */
function causeRetryable(cause) {
  switch (cause) {
    case Cause.TIMEOUT:
    case Cause.QUOTA_EXHAUSTED:
    case Cause.UPSTREAM_RATE_LIMIT:
    case Cause.UPSTREAM_CREDIT_EXHAUSTED:
    case Cause.UPSTREAM_MONTHLY_LIMIT:
    case Cause.ACCOUNT_QUOTA_EXHAUSTED:
    case Cause.GENUINE_CAPACITY:
    case Cause.EXHAUSTION_HIDING:
      return true;
    case Cause.UPSTREAM_ENTITLEMENT:
    case Cause.UPSTREAM_CREDENTIAL:
    case Cause.ACCOUNT_AUTH_FAILED:
    case Cause.MODEL_UNSUPPORTED:
    case Cause.ALIAS_MISMATCH:
    case Cause.LAUNCH_CONFIG:
    case Cause.HARNESS_FAILED:
    case Cause.UNKNOWN:
    default:
      return false;
  }
}

/**
 * Adds retryable and retryAfterMs fields to a classification result.
 */
function addRetryFields(result) {
  const retryable = causeRetryable(result.cause);
  result.retryable = retryable;
  if (result.retryAfterMs === undefined) {
    result.retryAfterMs = result.resetTime ? Math.max(0, result.resetTime - Date.now()) : null;
  }
  return result;
}

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
  return parseStreamEvents(stdout)
    .filter((entry) => entry.event && (entry.event.type === 'error' || entry.event.error))
    .map((entry) => entry.event);
}

/**
 * Parses every structured JSON event line in the worker stdout stream.
 * Each entry keeps the raw line so trusted detection can match against the
 * event envelope the launch stack emitted.
 */
function parseStreamEvents(stdout) {
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
          if (parsed && typeof parsed === 'object') {
            events.push({ raw: trimmed.slice(start, end + 1), event: parsed });
          }
        } catch (_) {}
      }
    }
  }
  return events;
}

/**
 * True when a stream event proves the worker started a model step: a genuine
 * step_start/tool_use event (a step-start or tool part payload, or the event
 * envelope's session/message identity). Bare synthetic markers without that
 * envelope are not proof the worker ran.
 */
function isModelStepEvent(ev) {
  if (!ev || typeof ev !== 'object') return false;
  const partType = ev.part && ev.part.type;
  if (partType === 'step-start' || partType === 'tool') return true;
  return (
    (ev.type === 'step_start' || ev.type === 'tool_use') && Boolean(ev.sessionID || ev.messageID)
  );
}

/**
 * The provider payload text of a structured error event.
 */
function eventPayloadText(ev) {
  const err = ev && ev.error;
  const data = err && err.data;
  return [
    err && err.name,
    err && err.type,
    err && err.message,
    data && data.message,
    typeof (data && data.responseBody) === 'string'
      ? data.responseBody
      : JSON.stringify((data && data.responseBody) || ''),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * True when a structured provider error event carries a quota signal:
 * 429, FreeUsageLimitError, rate limit, quota, insufficient credits, daily cap
 * or INFERENCE_CAP_ERROR (FC-R02). Read only from structured error events,
 * never from arbitrary worker text.
 */
function hasQuotaSignal(ev) {
  const data = ev && ev.error && ev.error.data;
  const payloadText = eventPayloadText(ev);
  const inner = extractInnerStatus(payloadText);
  if (inner === 429) return true;
  if (data && Number(data.statusCode) === 429) return true;
  return (
    /FreeUsageLimit/i.test(payloadText) ||
    /INFERENCE_CAP_ERROR/i.test(payloadText) ||
    /(?:daily\s+)?free\s+limit\s+reached/i.test(payloadText) ||
    /Unavailable\s*\([^)]*reset after/i.test(payloadText) ||
    /\brate[\s_-]*limit\b/i.test(payloadText) ||
    /\bquota\b/i.test(payloadText) ||
    /insufficient\s+credits?/i.test(payloadText) ||
    /daily\s+cap/i.test(payloadText)
  );
}

/**
 * The isRetryable hint from structured error events, or undefined when the
 * events did not report one. Kept as cooldown data (FC-R02).
 */
function structuredRetryableHint(providerEvents) {
  for (const ev of providerEvents || []) {
    const data = ev && ev.error && ev.error.data;
    if (data && data.isRetryable !== undefined && data.isRetryable !== null) {
      return Boolean(data.isRetryable);
    }
  }
  return undefined;
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
    return addRetryFields({
      cause: Cause.TIMEOUT,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.TIMEOUT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: Date.now() + DEFAULT_COOLDOWNS[Cause.TIMEOUT],
    });
  }

  // TASK-AI-120 RI-R03 / TASK-AI-121 LF-R01: a launch that cannot provision its
  // worker (a stale or unusable isolation verdict, a failed checkout of its
  // pinned base commit, a provisioned-HEAD mismatch, an EPERM/EBUSY worker-root
  // removal or a failed clone) is a local provisioning failure, not a model,
  // account or failure-domain fault. The signal is the launcher's own stderr —
  // worker output never widens (or narrows) it — and Scope.LOCAL must keep
  // every exclusion set clean: no candidate key and no failure domain is to
  // blame.
  if (isLaunchInfraFailure(String(stderr || ''))) {
    return addRetryFields({
      cause: Cause.LAUNCH_CONFIG,
      scope: Scope.LOCAL,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.LAUNCH_CONFIG],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    });
  }

  const providerEvents = extractStructuredProviderEvents(stdout);

  // FC-R02: a quota signal inside a structured provider error event is
  // quota_exhausted at upstream (or account when the cause names an account)
  // scope — never a harness failure. Reset-after and isRetryable hints are kept
  // as cooldown data.
  const quotaEvent = providerEvents.find((ev) => hasQuotaSignal(ev));
  if (quotaEvent) {
    const resetMs = parseResetTime(eventPayloadText(quotaEvent) || text);
    const retryable = structuredRetryableHint(providerEvents);
    return addRetryFields({
      cause: Cause.QUOTA_EXHAUSTED,
      scope: /account/i.test(input?.cause || '') ? Scope.ACCOUNT : Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.QUOTA_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
  }

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
    return addRetryFields({
      cause: Cause.UPSTREAM_MONTHLY_LIMIT,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_MONTHLY_LIMIT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
  }

  // Case 1: upstream credit exhausted (402 with "out of credit" / provider credit, or generic 402)
  if (effectiveStatus === 402 || effectiveStatus === 504) {
    const resetMs = parseResetTime(errorPayloadText || text);
    return addRetryFields({
      cause: Cause.UPSTREAM_CREDIT_EXHAUSTED,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDIT_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
  }

  // 810002 rate limit (HTTP 403 + body code 810002). Must precede generic 403->entitlement.
  if (effectiveStatus === 403 && (/"code"\s*:\s*810002\b/.test(errorPayloadText || text) || /code=810002\b/.test(errorPayloadText || text) || /Error 810002\b/.test(errorPayloadText || text))) {
    return addRetryFields({
      cause: Cause.UPSTREAM_RATE_LIMIT,
      scope: Scope.UPSTREAM,
      cooldownMs: 120000,
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: Date.now() + 120000,
      retryAfterMs: 120000,
    });
  }

  // Case 3: upstream entitlement (403 unauthorized / not licensed)
  if (effectiveStatus === 403 || /not licensed to use Copilot/i.test(errorPayloadText || text)) {
    return addRetryFields({
      cause: Cause.UPSTREAM_ENTITLEMENT,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_ENTITLEMENT],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    });
  }

  // Case 13: Harness / launch config failure (e.g. OpenCode provider/config resolution error before model call)
  // Gated on absence of HTTP status (no model HTTP call) and non-zero exit status or explicit harness cause.
  // Must take precedence over worker-controlled stdout to prevent domain widening (F2).
  // FC-R03: launch_config is only assigned when the worker never started a
  // model step (no step_start/tool_use events) and the launcher reports a
  // configuration error. Configuration errors are read from trusted channels —
  // explicit cause, launcher stderr/body and structured error events — never
  // from raw worker stdout text (FC-R01: tool output that merely mentions
  // launch markers must not widen to harness).
  const workerStartedModelStep = parseStreamEvents(stdout).some((entry) =>
    isModelStepEvent(entry.event)
  );
  const configErrorText = [
    String(
      body ||
        input?.cause ||
        (typeof input?.error === 'string' ? input.error : '') ||
        input?.message ||
        ''
    ),
    parseStreamEvents(stdout)
      .filter((entry) => entry.event && (entry.event.type === 'error' || entry.event.error))
      .map((entry) => entry.raw)
      .join('\n'),
    String(stderr || ''),
    String(input?.failureReason || ''),
  ]
    .filter(Boolean)
    .join('\n');
  const hasHttpStatus =
    (httpStatus !== undefined && httpStatus !== null && Number(httpStatus) > 0) ||
    (envelopeStatus !== null && envelopeStatus > 0);
  const isExplicitHarness =
    input?.cause === 'LAUNCH_CONFIG' ||
    input?.cause === 'HARNESS_FAILED' ||
    input?.cause === 'UNKNOWN_HARNESS' ||
    input?.cause === 'HARNESS_UNKNOWN' ||
    /LAUNCH_CONFIG|HARNESS_FAILED|UNKNOWN_HARNESS|HARNESS_UNKNOWN/i.test(configErrorText);

  if (
    !workerStartedModelStep &&
    (!hasHttpStatus || isExplicitHarness) &&
    (isExplicitHarness ||
      (exitCode !== 0 &&
        (/UnknownError.*Unexpected server error|Unexpected server error.*UnknownError/i.test(
          configErrorText
        ) ||
          /(?:\"name\"|\bname\b)\s*:\s*\"UnknownError\"/i.test(configErrorText) ||
          /provider.{0,30}(?:not found|not registered|cannot resolve|failed to resolve|unknown)/i.test(
            configErrorText
          ) ||
          /(?:cannot|failed to|unable to|could not)\s+resolve\s+provider/i.test(configErrorText) ||
          /(?:unknown|unresolved|invalid|missing).{0,20}(?:provider|harness)/i.test(
            configErrorText
          ) ||
          /@ai-sdk\/openai-compatible/i.test(configErrorText) ||
          /(?:harness|launch).{0,15}config(?:uration)?.{0,15}error/i.test(configErrorText))))
  ) {
    const isHarnessFailed =
      /HARNESS_FAILED|harness_failed/i.test(configErrorText) &&
      !/LAUNCH_CONFIG|launch_config/i.test(configErrorText);
    const cause = isHarnessFailed ? Cause.HARNESS_FAILED : Cause.LAUNCH_CONFIG;
    return addRetryFields({
      cause,
      scope: Scope.HARNESS,
      cooldownMs: DEFAULT_COOLDOWNS[cause] !== undefined ? DEFAULT_COOLDOWNS[cause] : 5 * 60 * 1000,
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    });
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
    return addRetryFields({
      cause: Cause.EXHAUSTION_HIDING,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.EXHAUSTION_HIDING],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
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
    return addRetryFields({
      cause: Cause.QUOTA_EXHAUSTED,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.QUOTA_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
  }

  // Case 4: upstream rate limit (429 with rate limit indicators, or plain 429)
  if (
    effectiveStatus === 429 ||
    /rate.?limit|too many requests|user_global_rate_limited/i.test(errorPayloadText)
  ) {
    const resetMs = parseResetTime(errorPayloadText || text);
    return addRetryFields({
      cause: Cause.UPSTREAM_RATE_LIMIT,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.UPSTREAM_RATE_LIMIT],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
  }

  // Account auth failure on 401 or auth text with account
  if (
    (effectiveStatus === 401 && accountId && accountId !== '*') ||
    /authentication failed|login.required|not logged in|requires login/i.test(text)
  ) {
    return addRetryFields({
      cause: Cause.ACCOUNT_AUTH_FAILED,
      scope: Scope.ACCOUNT,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.ACCOUNT_AUTH_FAILED],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    });
  }

  // Case 5: upstream credential problem (401 unauthorized on upstream)
  if (effectiveStatus === 401 || /invalid.*token|invalid.*credential/i.test(text)) {
    return addRetryFields({
      cause: Cause.UPSTREAM_CREDENTIAL,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UPSTREAM_CREDENTIAL],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    });
  }

  // Case 6: model not supported (400 with "model not supported")
  if (
    httpStatus === 400 &&
    /model.{0,20}not.{0,10}support|not.{0,10}support.{0,10}model/i.test(text)
  ) {
    return addRetryFields({
      cause: Cause.MODEL_UNSUPPORTED,
      scope: Scope.MODEL,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.MODEL_UNSUPPORTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    });
  }

  // Case 7: alias mismatch / model not found (access path issue)
  if (
    effectiveStatus === 404 ||
    (/model not found|Model not found/i.test(text) &&
      (/did you mean/i.test(text) || effectiveStatus === 404))
  ) {
    return addRetryFields({
      cause: Cause.ALIAS_MISMATCH,
      scope: Scope.MODEL,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.ALIAS_MISMATCH],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    });
  }

  // Case 8: account quota exhausted (agy CLI exit 3 with "limit reached" and reset time)
  if (exitCode === 3 && /limit reached|quota exhausted|usage limit/i.test(text)) {
    const resetMs = parseResetTime(text);
    return addRetryFields({
      cause: Cause.ACCOUNT_QUOTA_EXHAUSTED,
      scope: Scope.ACCOUNT,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.ACCOUNT_QUOTA_EXHAUSTED],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
  }

  // Case 9: genuine capacity (503 with "no capacity available")
  if (
    (effectiveStatus === 503 || exitCode !== 0) &&
    /no capacity available|capacity.{0,10}unavailable|server.{0,10}capacity/i.test(text)
  ) {
    const resetMs = parseResetTime(text);
    return addRetryFields({
      cause: Cause.GENUINE_CAPACITY,
      scope: Scope.UPSTREAM,
      cooldownMs: resetMs ?? DEFAULT_COOLDOWNS[Cause.GENUINE_CAPACITY],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: resetMs ? Date.now() + resetMs : null,
    });
  }

  // Case 10: account auth failed (agy CLI "authentication failed" / "login required")
  if (/authentication failed|login.required|not logged in|requires login/i.test(text)) {
    return addRetryFields({
      cause: Cause.ACCOUNT_AUTH_FAILED,
      scope: Scope.ACCOUNT,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.ACCOUNT_AUTH_FAILED],
      humanAction: HumanAction.REQUIRED,
      evidence,
      resetTime: null,
    });
  }

  // Case: transient upstream 5xx (retryable)
  if (
    httpStatus >= 500 &&
    httpStatus <= 599 &&
    /transient|outage|unavailable|temporarily|try.*again|busy|service unavailable/i.test(text)
  ) {
    return addRetryFields({
      cause: Cause.GENUINE_CAPACITY,
      scope: Scope.UPSTREAM,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.GENUINE_CAPACITY],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    });
  }

  // Case 12: HTTP process failure means gateway or access path failure
  if (
    httpStatus === 0 ||
    (exitCode !== 0 && /ECONNREFUSED|ENOTFOUND|gateway unreachable/i.test(text))
  ) {
    return addRetryFields({
      cause: Cause.UNKNOWN,
      scope: Scope.GATEWAY,
      cooldownMs: DEFAULT_COOLDOWNS[Cause.UNKNOWN],
      humanAction: HumanAction.NONE,
      evidence,
      resetTime: null,
    });
  }

  // Unknown cause — scope UNKNOWN means no fault location can be inferred.
  // Callers must apply the 5-minute cooldown to the (upstream, model)
  // combination that produced the signal, not to the harness globally.
  return addRetryFields({
    cause: Cause.UNKNOWN,
    scope: Scope.UNKNOWN,
    cooldownMs: DEFAULT_COOLDOWNS[Cause.UNKNOWN],
    humanAction: HumanAction.NONE,
    evidence,
    resetTime: null,
  });
}

module.exports = {
  Cause,
  Scope,
  HumanAction,
  ISOLATION_VERDICT_HUMAN_ACTION,
  isLaunchInfraFailure,
  isolationVerdictBlockReason,
  parseResetTime,
  MAX_RESET_MS,
  DEFAULT_COOLDOWNS,
  requiresHumanAction,
  classifyFailure,
  isReplayable,
};
