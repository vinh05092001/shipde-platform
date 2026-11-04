'use strict';

/**
 * Ship Dễ — Scoped Health & Failure Classification
 *
 * Implements strict fault scoping without cross-contamination:
 * - Error classes:
 *     AUTH, PERMISSION, QUOTA_CREDIT, RATE_LIMIT, MODEL_NOT_FOUND,
 *     NO_CHANNEL, NETWORK_DNS, TIMEOUT, TASK_FAILURE, GATEWAY_DOWN
 * - Scopes:
 *     gateway, account, quota_scope, model, route, network, local
 */

const {
  ErrorCategory,
  HealthScope,
  classifyError,
  parseRetryAfter,
  parseResetHint,
} = require('./scoped-health-classifier');

const {
  accountHealthKey,
  quotaHealthKey,
  modelLockHealthKey,
  accountModelHealthKey,
  evaluateCandidateAccounts,
} = require('./scoped-health-eval');

class ScopedHealthRegistry {
  constructor() {
    this.gateways = new Map();
    this.accounts = new Map();
    this.quotaScopes = new Map();
    this.catalogueModels = new Map();
    this.accountModels = new Map();
    this.routes = new Map();
    this.modelLocks = new Map();
  }

  recordFailure(routeIdentity, failureInput, now = Date.now()) {
    const identity = routeIdentity || {};
    const classification = classifyError(failureInput, now);

    switch (classification.scope) {
      case HealthScope.GATEWAY:
        if (
          identity.gatewayId &&
          identity.gatewayId !== 'direct' &&
          identity.gatewayId !== 'none'
        ) {
          this.gateways.set(identity.gatewayId, {
            category: classification.category,
            resetsAt: classification.resetsAt,
            reason: classification.reason,
            recordedAt: now,
          });
        }
        break;

      case HealthScope.ACCOUNT: {
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
      }

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

    // Check Multi-account Combo Candidate Accounts
    const candidateAccountsResult = evaluateCandidateAccounts(this, id, now);
    if (candidateAccountsResult && !candidateAccountsResult.healthy) {
      return candidateAccountsResult;
    }

    // 3. Check Quota Scope
    if (id.quotaScopeId && id.quotaScopeId !== 'UNKNOWN') {
      const qRec = this.quotaScopes.get(quotaHealthKey(id));
      if (qRec && qRec.exhausted) {
        if (qRec.resetsAt && now > qRec.resetsAt) {
          quotaProbeNeeded = true;
          quotaResetAt = qRec.resetsAt;
        } else {
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
    if (
      accModelRec &&
      (accModelRec.isPermanent || (accModelRec.resetsAt && now < accModelRec.resetsAt))
    ) {
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
    const lockKey = modelLockHealthKey(id.upstreamProviderId, id.outboundModelId, id.connectionId);
    const wildcardKey = modelLockHealthKey(id.upstreamProviderId, id.outboundModelId, '*');

    let connLockUntil = this.modelLocks.get(lockKey);
    if (connLockUntil && now > connLockUntil) {
      this.modelLocks.delete(lockKey);
      connLockUntil = null;
    }
    let wildcardLockUntil = this.modelLocks.get(wildcardKey);
    if (wildcardLockUntil && now > wildcardLockUntil) {
      this.modelLocks.delete(wildcardKey);
      wildcardLockUntil = null;
    }

    const activeLockUntil =
      (connLockUntil && now <= connLockUntil ? connLockUntil : null) ||
      (wildcardLockUntil && now <= wildcardLockUntil ? wildcardLockUntil : null);

    if (activeLockUntil) {
      return {
        healthy: false,
        blockedBy: 'model_lock',
        category: ErrorCategory.RATE_LIMIT,
        reason: 'MODEL_LOCK_ACTIVE',
        resetsAt: activeLockUntil,
      };
    }

    // 8. If quota reset elapsed, candidate requires probe before dispatch
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
    const key = modelLockHealthKey(upstreamProviderId, outboundModelId, connectionId);
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
