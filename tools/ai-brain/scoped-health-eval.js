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

    const candLockKey = modelLockHealthKey(
      dummyId.upstreamProviderId,
      dummyId.outboundModelId,
      dummyId.connectionId
    );
    const candWildcardKey = modelLockHealthKey(
      dummyId.upstreamProviderId,
      dummyId.outboundModelId,
      '*'
    );
    let candConnLock = registry.modelLocks.get(candLockKey);
    if (candConnLock && now > candConnLock) {
      registry.modelLocks.delete(candLockKey);
      candConnLock = null;
    }
    let candWildcardLock = registry.modelLocks.get(candWildcardKey);
    if (candWildcardLock && now > candWildcardLock) {
      registry.modelLocks.delete(candWildcardKey);
      candWildcardLock = null;
    }
    const candLockUntil =
      (candConnLock && now <= candConnLock ? candConnLock : null) ||
      (candWildcardLock && now <= candWildcardLock ? candWildcardLock : null);
    const candLockBlocked = Boolean(candLockUntil);

    if (!candBlocked && !candQuotaBlocked && !candModelBlocked && !candLockBlocked) {
      anyHealthy = true;
      break;
    }
    if (candLockBlocked) {
      lastFailure = {
        category: ErrorCategory.RATE_LIMIT,
        scope: 'model_lock',
        reason: 'MODEL_LOCK_ACTIVE',
        resetsAt: candLockUntil,
      };
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
  evaluateCandidateAccounts,
};
