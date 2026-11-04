'use strict';

const { hashEmail, getPrivateEmail } = require('./route-identity');
const { ErrorCategory, HealthScope } = require('./scoped-health-classifier');

function accountHealthKey(id) {
  const realAccount = id.metadata?.realAccountRef;
  const fromPrivate =
    (realAccount && realAccount !== 'UNKNOWN' ? getPrivateEmail(realAccount) : null) ||
    (id.accountRef && id.accountRef !== 'UNKNOWN' ? getPrivateEmail(id.accountRef) : null);
  const account =
    fromPrivate || (realAccount && realAccount !== 'UNKNOWN' ? realAccount : id.accountRef);
  const observed = account && account !== 'UNKNOWN' ? account : id.connectionId;
  const safeObserved =
    typeof observed === 'string' && observed.includes('@') ? hashEmail(observed) : observed;
  return JSON.stringify([
    id.upstreamProviderId,
    safeObserved && safeObserved !== 'UNKNOWN' ? safeObserved : id.candidateKey,
  ]);
}

function quotaHealthKey(id) {
  return JSON.stringify([id.upstreamProviderId, id.quotaScopeId]);
}

function modelLockHealthKey(provider, model, connectionId) {
  return JSON.stringify([
    String(provider || 'unknown'),
    String(model || 'unknown'),
    String(connectionId || '*'),
  ]);
}

function accountModelHealthKey(id) {
  return JSON.stringify([accountHealthKey(id), id.outboundModelId]);
}

function checkModelLock(registry, id, now = Date.now()) {
  const lockKey = modelLockHealthKey(id.upstreamProviderId, id.outboundModelId, id.connectionId);
  const wildcardKey = modelLockHealthKey(id.upstreamProviderId, id.outboundModelId, '*');

  let connLockUntil = registry.modelLocks.get(lockKey);
  if (connLockUntil && now > connLockUntil) {
    registry.modelLocks.delete(lockKey);
    connLockUntil = null;
  }
  let wildcardLockUntil = registry.modelLocks.get(wildcardKey);
  if (wildcardLockUntil && now > wildcardLockUntil) {
    registry.modelLocks.delete(wildcardKey);
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
  return null;
}

function checkAccountHealth(registry, id, now = Date.now()) {
  const acc = accountHealthKey(id);
  if (acc && acc !== 'UNKNOWN') {
    const aRec = registry.accounts.get(acc);
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
  return null;
}

function checkQuotaScopeHealth(registry, id, now = Date.now()) {
  if (id.quotaScopeId && id.quotaScopeId !== 'UNKNOWN') {
    const qRec = registry.quotaScopes.get(quotaHealthKey(id));
    if (qRec && qRec.exhausted) {
      if (qRec.resetsAt && now > qRec.resetsAt) {
        return { quotaProbeNeeded: true, quotaResetAt: qRec.resetsAt };
      }
      return {
        healthy: false,
        blockedBy: HealthScope.QUOTA_SCOPE,
        category: ErrorCategory.QUOTA_CREDIT,
        reason: qRec.reason,
        resetsAt: qRec.resetsAt,
      };
    }
  }
  return null;
}

function evaluateCandidateAccounts(registry, id, now = Date.now()) {
  const candidateAccounts = Array.isArray(id.metadata?.candidateAccounts)
    ? id.metadata.candidateAccounts
    : [];
  if (candidateAccounts.length === 0) return null;

  let anyHealthy = false;
  let lastFailure = null;
  for (const cand of candidateAccounts) {
    const dummyId = {
      ...id,
      accountRef: cand.accountRef,
      connectionId: cand.connectionId,
      quotaScopeId: cand.quotaScopeId || id.quotaScopeId,
    };
    const candAccKey = accountHealthKey(dummyId);
    const candRec =
      registry.accounts.get(candAccKey) ||
      (cand.accountRef && cand.accountRef !== 'UNKNOWN'
        ? registry.accounts.get(cand.accountRef)
        : null);
    const candBlocked =
      candRec && (candRec.isPermanent || (candRec.resetsAt && now < candRec.resetsAt));

    const candQuotaKey = quotaHealthKey(dummyId);
    const candQuotaRec =
      registry.quotaScopes.get(candQuotaKey) ||
      (cand.quotaScopeId && cand.quotaScopeId !== 'UNKNOWN'
        ? registry.quotaScopes.get(cand.quotaScopeId)
        : null);
    const candQuotaBlocked = Boolean(candQuotaRec && candQuotaRec.exhausted);

    const candModelKey = accountModelHealthKey(dummyId);
    const candModelRec = registry.accountModels.get(candModelKey);
    const candModelBlocked = Boolean(
      candModelRec &&
      (candModelRec.isPermanent || (candModelRec.resetsAt && now < candModelRec.resetsAt))
    );

    const candLock = checkModelLock(registry, dummyId, now);
    const candLockBlocked = Boolean(candLock);

    if (!candBlocked && !candQuotaBlocked && !candModelBlocked && !candLockBlocked) {
      anyHealthy = true;
      break;
    }
    if (candLockBlocked) {
      lastFailure = candLock;
    } else if (candModelBlocked) {
      lastFailure = candModelRec;
    } else if (
      candQuotaBlocked &&
      candQuotaRec &&
      candQuotaRec.resetsAt &&
      now > candQuotaRec.resetsAt
    ) {
      lastFailure = {
        category: ErrorCategory.QUOTA_CREDIT,
        scope: HealthScope.QUOTA_SCOPE,
        reason: 'RESET_ELAPSED_PROBE_NEEDED',
        resetsAt: null,
      };
    } else {
      lastFailure =
        candRec ||
        (candQuotaBlocked
          ? {
              category: ErrorCategory.QUOTA_CREDIT,
              scope: HealthScope.QUOTA_SCOPE,
              reason: candQuotaRec?.reason || 'QUOTA_EXHAUSTED',
            }
          : null);
    }
  }
  if (!anyHealthy) {
    return {
      healthy: false,
      blockedBy: lastFailure?.scope || HealthScope.ACCOUNT,
      category: lastFailure?.category || ErrorCategory.AUTH,
      reason: lastFailure?.reason || 'ALL_CANDIDATE_ACCOUNTS_UNHEALTHY',
      resetsAt: lastFailure?.resetsAt || null,
    };
  }

  return { healthy: true };
}

module.exports = {
  accountHealthKey,
  quotaHealthKey,
  modelLockHealthKey,
  accountModelHealthKey,
  checkModelLock,
  checkAccountHealth,
  checkQuotaScopeHealth,
  evaluateCandidateAccounts,
};
