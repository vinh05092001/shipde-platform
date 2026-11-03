'use strict';

/**
 * Ship Dễ — Scoped Health & Failure Classification (PATCH 1 - Fixed per Codex Review)
 *
 * Implements strict fault scoping without cross-contamination:
 * - Error classes:
 *     AUTH, PERMISSION, QUOTA_CREDIT, RATE_LIMIT, MODEL_NOT_FOUND,
 *     NO_CHANNEL, NETWORK_DNS, TIMEOUT, TASK_FAILURE, GATEWAY_DOWN
 * - Scopes:
 *     gateway, account, quota_scope, model, route, network, local
 *
 * Fixes for Codex Review:
 * - Rate limits (429) scoped to specific account/connection on that model, preventing
 *   Account A's 429 from blocking Account B on the same model.
 * - Elapsed quota reset (now > resetsAt) does NOT return healthy: true early;
 *   it completes model/route/lock checks and marks candidate as requiresProbe: true,
 *   preventing unverified dispatch without telemetry.
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

  // 7. RATE_LIMIT: Transient 429 (scoped to model/account)
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
 */
function accountHealthKey(id) {
  const realAccount = id.metadata?.realAccountRef;
  const account = realAccount && realAccount !== 'UNKNOWN' ? realAccount : id.accountRef;
  const observed = account && account !== 'UNKNOWN' ? account : id.connectionId;
  return JSON.stringify([id.upstreamProviderId, observed && observed !== 'UNKNOWN' ? observed : id.candidateKey]);
}

function quotaHealthKey(id) {
  return JSON.stringify([id.upstreamProviderId, id.quotaScopeId]);
}

function accountModelHealthKey(id) {
  return JSON.stringify([accountHealthKey(id), id.outboundModelId]);
}

class ScopedHealthRegistry {
  constructor() {
    this.gateways = new Map(); // gatewayId -> { category, resetsAt, reason }
    this.accounts = new Map(); // provider-qualified account -> { category, resetsAt, reason }
    this.quotaScopes = new Map(); // provider-qualified quotaScopeId -> { status, resetsAt, reason, exhausted }
    this.catalogueModels = new Map(); // upstreamProviderId::outboundModelId -> { category, resetsAt, reason } (global catalogue 404)
    this.accountModels = new Map(); // provider/account/model tuple -> { category, resetsAt, reason, isPermanent }
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
        const acc = accountHealthKey(identity);
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
          this.quotaScopes.set(quotaHealthKey(identity), {
            exhausted: true,
            status: 'EXHAUSTED',
            resetsAt: classification.resetsAt,
            reason: classification.reason,
            recordedAt: now,
          });
        }
        break;

      case HealthScope.MODEL:
        this.accountModels.set(accountModelHealthKey(identity), {
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
      case HealthScope.LOCAL:
        if (identity.candidateKey && classification.cooldownMs > 0) {
          this.routes.set(identity.candidateKey, {
            category: classification.category,
            resetsAt: classification.resetsAt,
            reason: classification.reason,
            recordedAt: now,
          });
        }
        break;

      default:
        break;
    }

    return classification;
  }

  evaluateHealth(routeIdentity, now = Date.now()) {
    const id = routeIdentity || {};
    let quotaProbeNeeded = false;
    let quotaResetAt = null;

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
    const acc = accountHealthKey(id);
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
      const qRec = this.quotaScopes.get(quotaHealthKey(id));
      if (qRec && qRec.exhausted) {
        if (qRec.resetsAt && now > qRec.resetsAt) {
          // Reset time has elapsed: mark probe needed, DO NOT return early healthy!
          // We must still check Model and Lock!
          quotaProbeNeeded = true;
          quotaResetAt = qRec.resetsAt;
        } else {
          // Actively exhausted
          return {
            healthy: false,
            blockedBy: HealthScope.QUOTA_SCOPE,
            category: ErrorCategory.QUOTA_CREDIT,
            reason: qRec.reason,
            resetsAt: qRec.resetsAt,
          };
        }
      }
    }

    // 4. Check Catalogue Model (global model not found)
    const baseModelKey = `${id.upstreamProviderId || 'unknown'}::${id.outboundModelId || 'unknown'}`;
    const catRec = this.catalogueModels.get(baseModelKey);
    if (catRec && (catRec.isPermanent || (catRec.resetsAt && now < catRec.resetsAt))) {
      return {
        healthy: false,
        blockedBy: HealthScope.MODEL,
        category: catRec.category,
        reason: catRec.reason,
        resetsAt: catRec.resetsAt,
      };
    }

    // 5. Check Account-scoped Model (rate limits on this specific account)
    const accModelRec = this.accountModels.get(accountModelHealthKey(id));
    if (accModelRec && (accModelRec.isPermanent || (accModelRec.resetsAt && now < accModelRec.resetsAt))) {
      return {
        healthy: false,
        blockedBy: HealthScope.MODEL,
        category: accModelRec.category,
        reason: accModelRec.reason,
        resetsAt: accModelRec.resetsAt,
      };
    }

    // 6. Check Specific Route
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

    // 7. Check Model Lock
    const lockKey = `${baseModelKey}::${id.connectionId || '*'}`;
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
      this.modelLocks.delete(lockKey);
    }

    // 8. If quota reset elapsed, candidate requires probe before dispatch!
    if (quotaProbeNeeded) {
      return {
        healthy: false,
        requiresProbe: true,
        quotaStatus: 'RESET_ELAPSED_PROBE_NEEDED',
        staleQuota: true,
        resetsAt: quotaResetAt,
        reason: 'QUOTA_RESET_ELAPSED_REQUIRES_FRESH_TELEMETRY',
      };
    }

    return { healthy: true, status: 'AVAILABLE' };
  }

  setModelLock(upstreamProviderId, outboundModelId, connectionId, lockedUntilMs) {
    const key = `${upstreamProviderId}::${outboundModelId}::${connectionId || '*'}`;
    this.modelLocks.set(key, lockedUntilMs);
  }

  getStateHash() {
    const state = {
      gateways: [...this.gateways.entries()],
      accounts: [...this.accounts.entries()],
      quotaScopes: [...this.quotaScopes.entries()],
      catalogueModels: [...this.catalogueModels.entries()],
      accountModels: [...this.accountModels.entries()],
      routes: [...this.routes.entries()],
      modelLocks: [...this.modelLocks.entries()],
    };
    return JSON.stringify(state);
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
