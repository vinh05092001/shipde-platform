'use strict';

/**
 * Ship Dễ — Scoped Health & Failure Classification (PATCH 1)
 *
 * Implements strict fault scoping without cross-contamination:
 * - Error classes:
 *     AUTH, PERMISSION, QUOTA_CREDIT, RATE_LIMIT, MODEL_NOT_FOUND,
 *     NO_CHANNEL, NETWORK_DNS, TIMEOUT, TASK_FAILURE, GATEWAY_DOWN
 * - Scopes:
 *     gateway, account, quota_scope, model, route, network, local
 *
 * Rules enforced:
 * 1. Scope accuracy:
 *    - Model/no-channel: applies only to the specific route/model.
 *    - Account auth: applies only to the specific account.
 *    - Quota: applies to the defined quota scope (shared across linked accounts).
 *    - Gateway connection refused: applies to the gateway, never killing direct upstreams.
 * 2. DNS/network errors NEVER become AUTH or require login.
 * 3. Expired resetAt NEVER magically resets quota to 100% full (marked RESET_ELAPSED_PROBE_NEEDED).
 * 4. Expired modelLock (now > lockedUntil) is cleared immediately.
 * 5. Two accounts sharing a model are isolated: Account A's failure never bans Account B.
 */

const ErrorCategory = Object.freeze({
  AUTH: 'AUTH',
  PERMISSION: 'PERMISSION',
  QUOTA_CREDIT: 'QUOTA_CREDIT',
  RATE_LIMIT: 'RATE_LIMIT',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  NO_CHANNEL: 'NO_CHANNEL',
  NETWORK_DNS: 'NETWORK_DNS',
  TIMEOUT: 'TIMEOUT',
  TASK_FAILURE: 'TASK_FAILURE',
  GATEWAY_DOWN: 'GATEWAY_DOWN',
  UNKNOWN: 'UNKNOWN',
});

const HealthScope = Object.freeze({
  GATEWAY: 'gateway',
  ACCOUNT: 'account',
  QUOTA_SCOPE: 'quota_scope',
  MODEL: 'model',
  ROUTE: 'route',
  NETWORK: 'network',
  LOCAL: 'local',
});

/**
 * Classifies a failure input into its true category, scope, and cooldown policy.
 */
function classifyError(input, now = Date.now()) {
  const i = input || {};
  const status = Number(i.httpStatus || i.status || 0);
  const code = String(i.code || '').trim().toUpperCase();
  const text = [
    String(i.message || ''),
    String(i.error || ''),
    String(i.stderr || ''),
    String(i.body || ''),
    String(i.cause || ''),
  ]
    .filter(Boolean)
    .join('\n');

  const lowerText = text.toLowerCase();

  // 1. GATEWAY_DOWN: Gateway process down / connection refused on port 20128
  if (
    code === 'ECONNREFUSED' &&
    (lowerText.includes('20128') || String(i.endpoint || '').includes('20128') || i.gatewayId === '9router')
  ) {
    return {
      category: ErrorCategory.GATEWAY_DOWN,
      scope: HealthScope.GATEWAY,
      cooldownMs: 60 * 1000,
      resetsAt: now + 60 * 1000,
      isPermanent: false,
      reason: 'GATEWAY_CONNECTION_REFUSED_PORT_20128',
    };
  }

  // 2. NETWORK_DNS: DNS resolution, socket drops, network drops
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    /getaddrinfo (enotfound|eai_again)|dns resolution failed|socket hang up|read econnreset/i.test(text)
  ) {
    return {
      category: ErrorCategory.NETWORK_DNS,
      scope: HealthScope.NETWORK,
      cooldownMs: 30 * 1000,
      resetsAt: now + 30 * 1000,
      isPermanent: false,
      reason: 'NETWORK_OR_DNS_TRANSIENT_FAILURE',
    };
  }

  // 3. TIMEOUT: Launcher or HTTP request timeout
  if (
    i.timedOut === true ||
    status === 504 ||
    code === 'ETIMEDOUT' ||
    /timed? ?out|request timed out|gateway timeout/i.test(text)
  ) {
    return {
      category: ErrorCategory.TIMEOUT,
      scope: HealthScope.LOCAL,
      cooldownMs: 5 * 60 * 1000,
      resetsAt: now + 5 * 60 * 1000,
      isPermanent: false,
      reason: 'REQUEST_OR_LAUNCHER_TIMEOUT',
    };
  }

  // 4. AUTH: Account authentication invalid / unauthorized
  if (
    status === 401 ||
    /invalid_api_key|invalid_token|authentication failed|unauthorized|bad credentials|token expired|login required/i.test(
      text
    )
  ) {
    return {
      category: ErrorCategory.AUTH,
      scope: HealthScope.ACCOUNT,
      cooldownMs: null,
      resetsAt: null,
      isPermanent: true,
      reason: 'ACCOUNT_AUTHENTICATION_FAILED',
    };
  }

  // 5. PERMISSION: 403 Forbidden / Access denied
  if (
    status === 403 &&
    !/unsupported model|model not found|no channel/i.test(text)
  ) {
    return {
      category: ErrorCategory.PERMISSION,
      scope: HealthScope.ACCOUNT,
      cooldownMs: null,
      resetsAt: null,
      isPermanent: true,
      reason: 'ACCOUNT_PERMISSION_DENIED',
    };
  }

  // 6. QUOTA_CREDIT: Out of credits, balance exhausted, monthly quota
  if (
    status === 402 ||
    (status === 400 && /credit insufficient|balance=0|insufficient balance|balance is zero/i.test(text)) ||
    /quota exceeded|quota reached|usage limit exceeded|insufficient_quota|monthly limit exceeded|out of credits|balance=0/i.test(
      text
    )
  ) {
    const parsedReset = parseResetHint(text, now) || (i.retryAfter ? parseRetryAfter(i.retryAfter, now) : null);
    const cooldownMs = parsedReset ? Math.max(0, parsedReset - now) : 60 * 60 * 1000;
    return {
      category: ErrorCategory.QUOTA_CREDIT,
      scope: HealthScope.QUOTA_SCOPE,
      cooldownMs,
      resetsAt: parsedReset || now + cooldownMs,
      isPermanent: false,
      reason: 'QUOTA_OR_CREDIT_EXHAUSTED',
    };
  }

  // 7. RATE_LIMIT: Transient 429
  if (status === 429) {
    const parsedReset = parseResetHint(text, now) || (i.retryAfter ? parseRetryAfter(i.retryAfter, now) : null);
    const cooldownMs = parsedReset ? Math.max(0, parsedReset - now) : 5 * 60 * 1000;
    return {
      category: ErrorCategory.RATE_LIMIT,
      scope: HealthScope.MODEL,
      cooldownMs,
      resetsAt: parsedReset || now + cooldownMs,
      isPermanent: false,
      reason: 'MODEL_RATE_LIMIT_HIT',
    };
  }

  // 8. MODEL_NOT_FOUND: 404 Model does not exist
  if (status === 404 || /model not found|model does not exist|unsupported model/i.test(text)) {
    return {
      category: ErrorCategory.MODEL_NOT_FOUND,
      scope: HealthScope.MODEL,
      cooldownMs: null,
      resetsAt: null,
      isPermanent: true,
      reason: 'MODEL_NOT_FOUND_IN_CATALOGUE',
    };
  }

  // 9. NO_CHANNEL: 503 No channel available for this route right now
  if (status === 503 && /no channel|channel not serving|no available channel/i.test(text)) {
    return {
      category: ErrorCategory.NO_CHANNEL,
      scope: HealthScope.ROUTE,
      cooldownMs: 10 * 60 * 1000,
      resetsAt: now + 10 * 60 * 1000,
      isPermanent: false,
      reason: 'ROUTE_NO_AVAILABLE_CHANNEL',
    };
  }

  // 10. TASK_FAILURE: Worker code error / exit failure
  if (i.exitCode !== undefined && Number(i.exitCode) !== 0 && !status && !code) {
    return {
      category: ErrorCategory.TASK_FAILURE,
      scope: HealthScope.LOCAL,
      cooldownMs: 0,
      resetsAt: null,
      isPermanent: false,
      reason: 'WORKER_TASK_EXECUTION_FAILURE',
    };
  }

  return {
    category: ErrorCategory.UNKNOWN,
    scope: HealthScope.LOCAL,
    cooldownMs: 60 * 1000,
    resetsAt: now + 60 * 1000,
    isPermanent: false,
    reason: 'UNRECOGNIZED_FAILURE_SAFE_DEFAULT',
  };
}

function parseRetryAfter(val, now = Date.now()) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d+$/.test(s)) {
    return now + Number(s) * 1000;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResetHint(text, now = Date.now()) {
  if (!text) return null;
  // Match "resets in 62h28m31s" or "reset after 5m" or "try again in 15h 27m"
  const m = text.match(/(?:resets? (?:in|after)|try again in)\s+([0-9hms\s]+)/i);
  if (!m) return null;
  const str = m[1];
  let totalMs = 0;
  const hours = str.match(/(\d+)\s*h/i);
  const minutes = str.match(/(\d+)\s*m/i);
  const seconds = str.match(/(\d+)\s*s/i);

  if (hours) totalMs += Number(hours[1]) * 3600 * 1000;
  if (minutes) totalMs += Number(minutes[1]) * 60 * 1000;
  if (seconds) totalMs += Number(seconds[1]) * 1000;

  return totalMs > 0 ? now + totalMs : null;
}

/**
 * Scoped Health Registry.
 * Holds scoped health observations in memory without touching real operational logs.
 */
class ScopedHealthRegistry {
  constructor() {
    this.gateways = new Map(); // gatewayId -> { category, resetsAt, reason }
    this.accounts = new Map(); // accountRef / connectionId -> { category, resetsAt, reason }
    this.quotaScopes = new Map(); // quotaScopeId -> { status, resetsAt, reason, exhausted }
    this.models = new Map(); // upstreamProviderId::outboundModelId -> { category, resetsAt, reason }
    this.routes = new Map(); // candidateKey -> { category, resetsAt, reason }
    this.modelLocks = new Map(); // upstreamProviderId::outboundModelId::connectionId -> lockedUntil
  }

  recordFailure(routeIdentity, failureInput, now = Date.now()) {
    const identity = routeIdentity || {};
    const classification = classifyError(failureInput, now);

    switch (classification.scope) {
      case HealthScope.GATEWAY:
        if (identity.gatewayId && identity.gatewayId !== 'direct' && identity.gatewayId !== 'none') {
          this.gateways.set(identity.gatewayId, {
            category: classification.category,
            resetsAt: classification.resetsAt,
            reason: classification.reason,
            recordedAt: now,
          });
        }
        break;

      case HealthScope.ACCOUNT:
        const acc = identity.accountRef !== 'UNKNOWN' ? identity.accountRef : identity.connectionId;
        if (acc && acc !== 'UNKNOWN') {
          this.accounts.set(acc, {
            category: classification.category,
            resetsAt: classification.resetsAt,
            reason: classification.reason,
            isPermanent: classification.isPermanent,
            recordedAt: now,
          });
        }
        break;

      case HealthScope.QUOTA_SCOPE:
        if (identity.quotaScopeId && identity.quotaScopeId !== 'UNKNOWN') {
          this.quotaScopes.set(identity.quotaScopeId, {
            exhausted: true,
            status: 'EXHAUSTED',
            resetsAt: classification.resetsAt,
            reason: classification.reason,
            recordedAt: now,
          });
        }
        break;

      case HealthScope.MODEL:
        const modelKey = `${identity.upstreamProviderId || 'unknown'}::${identity.outboundModelId || 'unknown'}`;
        this.models.set(modelKey, {
          category: classification.category,
          resetsAt: classification.resetsAt,
          reason: classification.reason,
          isPermanent: classification.isPermanent,
          recordedAt: now,
        });
        break;

      case HealthScope.ROUTE:
        if (identity.candidateKey) {
          this.routes.set(identity.candidateKey, {
            category: classification.category,
            resetsAt: classification.resetsAt,
            reason: classification.reason,
            recordedAt: now,
          });
        }
        break;

      case HealthScope.NETWORK:
        // Transient network drops do not penalize account, model or quota!
        break;

      case HealthScope.LOCAL:
      default:
        // Local task failures do not penalize infrastructure
        break;
    }

    return classification;
  }

  evaluateHealth(routeIdentity, now = Date.now()) {
    const id = routeIdentity || {};

    // 1. Check Gateway
    if (id.gatewayId && id.gatewayId !== 'direct' && id.gatewayId !== 'none') {
      const gRec = this.gateways.get(id.gatewayId);
      if (gRec && gRec.resetsAt && now < gRec.resetsAt) {
        return {
          healthy: false,
          blockedBy: HealthScope.GATEWAY,
          category: gRec.category,
          reason: gRec.reason,
          resetsAt: gRec.resetsAt,
        };
      }
    }

    // 2. Check Account
    const acc = id.accountRef !== 'UNKNOWN' ? id.accountRef : id.connectionId;
    if (acc && acc !== 'UNKNOWN') {
      const aRec = this.accounts.get(acc);
      if (aRec) {
        if (aRec.isPermanent || (aRec.resetsAt && now < aRec.resetsAt)) {
          return {
            healthy: false,
            blockedBy: HealthScope.ACCOUNT,
            category: aRec.category,
            reason: aRec.reason,
            resetsAt: aRec.resetsAt,
          };
        }
      }
    }

    // 3. Check Quota Scope
    if (id.quotaScopeId && id.quotaScopeId !== 'UNKNOWN') {
      const qRec = this.quotaScopes.get(id.quotaScopeId);
      if (qRec && qRec.exhausted) {
        if (qRec.resetsAt && now > qRec.resetsAt) {
          // Rule 5: Qua resetAt KHÔNG tự đặt quota đầy!
          return {
            healthy: true,
            quotaStatus: 'RESET_ELAPSED_PROBE_NEEDED',
            staleQuota: true,
            resetsAt: qRec.resetsAt,
            note: 'Reset time has elapsed; requires fresh telemetry before full budget can be assumed.',
          };
        }
        // Still actively exhausted
        return {
          healthy: false,
          blockedBy: HealthScope.QUOTA_SCOPE,
          category: ErrorCategory.QUOTA_CREDIT,
          reason: qRec.reason,
          resetsAt: qRec.resetsAt,
        };
      }
    }

    // 4. Check Model
    const modelKey = `${id.upstreamProviderId || 'unknown'}::${id.outboundModelId || 'unknown'}`;
    const mRec = this.models.get(modelKey);
    if (mRec) {
      if (mRec.isPermanent || (mRec.resetsAt && now < mRec.resetsAt)) {
        return {
          healthy: false,
          blockedBy: HealthScope.MODEL,
          category: mRec.category,
          reason: mRec.reason,
          resetsAt: mRec.resetsAt,
        };
      }
    }

    // 5. Check Specific Route
    if (id.candidateKey) {
      const rRec = this.routes.get(id.candidateKey);
      if (rRec && rRec.resetsAt && now < rRec.resetsAt) {
        return {
          healthy: false,
          blockedBy: HealthScope.ROUTE,
          category: rRec.category,
          reason: rRec.reason,
          resetsAt: rRec.resetsAt,
        };
      }
    }

    // 6. Check Model Lock (e.g. from 9router providerConnections)
    const lockKey = `${modelKey}::${id.connectionId || '*'}`;
    const lockUntil = this.modelLocks.get(lockKey);
    if (lockUntil) {
      if (now <= lockUntil) {
        return {
          healthy: false,
          blockedBy: 'model_lock',
          category: ErrorCategory.RATE_LIMIT,
          reason: 'MODEL_LOCK_ACTIVE',
          resetsAt: lockUntil,
        };
      }
      // Rule 5: Model lock expired is NO LONGER locked!
      this.modelLocks.delete(lockKey);
    }

    return { healthy: true, status: 'AVAILABLE' };
  }

  setModelLock(upstreamProviderId, outboundModelId, connectionId, lockedUntilMs) {
    const key = `${upstreamProviderId}::${outboundModelId}::${connectionId || '*'}`;
    this.modelLocks.set(key, lockedUntilMs);
  }
}

module.exports = {
  ErrorCategory,
  HealthScope,
  classifyError,
  parseRetryAfter,
  parseResetHint,
  ScopedHealthRegistry,
};
