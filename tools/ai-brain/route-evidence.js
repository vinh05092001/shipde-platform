'use strict';

const { candidateKey, parseCandidateKey } = require('./discovery/identity');
const health = require('./route-health');
const evidence = require('./evidence');
const sources = require('./sources');

// Work proof is bound to the entire transport identity. Missing fields are not wildcards.
function matchesCandidate(candidate, combination) {
  if (!candidate || !combination) return false;
  const cand =
    typeof candidate.candidateKey === 'string'
      ? parseCandidateKey(candidate.candidateKey)
      : candidate;
  const identity =
    typeof combination.candidateKey === 'string'
      ? parseCandidateKey(combination.candidateKey)
      : combination;
  if (!cand || !identity || candidateKey(cand) !== candidateKey(identity)) return false;
  const source = (value) => value.sourceId || value.source || value.gateway || '';
  return (!combination.sourceId && !combination.source) || source(cand) === source(combination);
}

function hasPriorWorkPass(candidate, combinations) {
  if (!candidate || !['agy-pool', 'codex'].includes(candidate.harness)) return false;
  if (!Array.isArray(combinations)) return false;
  return (combinations || []).some(
    (combo) =>
      matchesCandidate(candidate, combo) &&
      (combo.evidence || []).some(
        (e) =>
          e &&
          e.status !== 'failed' &&
          !e.cause &&
          (e.proofLevel === 'WORK_ITEM_PASS' ||
            (e.status === 'passed' && (e.level === 2 || e.level === 3)))
      )
  );
}

function evidenceData(options = {}) {
  return (
    options.evidenceData ||
    (options.evidenceDir
      ? evidence.loadEvidence(options.evidenceDir)
      : options.capabilityEvidence || {})
  );
}

function routeRecord(candidate, store) {
  const id = health.probeIdentity(candidate);
  // Do not borrow another account's observation via getPathRecord fallback.
  const record = store?.paths?.[health.healthKey(id.model, id.route)];
  if (record?.candidateKey && record.candidateKey !== candidateKey(candidate)) return undefined;
  return record;
}

function recentRouteSuccess(candidate, store, options = {}) {
  if (health.probeCooldown(candidate, { ...options, routeHealth: store || { paths: {} } }))
    return false;
  const record = routeRecord(candidate, store);
  const id = health.probeIdentity(candidate);
  const gateway = store?.paths?.[health.healthKey(id.model, id.route.id)];
  if (
    gateway &&
    gateway.status !== 'AVAILABLE' &&
    Date.parse(gateway.lastCheckedAt) > Date.parse(record?.lastCheckedAt)
  )
    return false;
  const age = (options.now ?? Date.now()) - Date.parse(record?.lastCheckedAt);
  const maxAgeMs = sources.getDispatchConfig(options.registry, options).routeEvidenceMaxAgeMs;
  if (
    Number.isFinite(maxAgeMs) &&
    maxAgeMs > 0 &&
    record?.status === 'AVAILABLE' &&
    age >= 0 &&
    age <= maxAgeMs
  )
    return true;
  return (evidenceData(options).combinations || []).some(
    (combo) =>
      matchesCandidate(candidate, combo) &&
      (combo.evidence || []).some(
        (e) =>
          e &&
          (e.proofLevel === 'API_PASS' ||
            e.proofLevel === 'WORK_ITEM_PASS' ||
            (e.status === 'passed' && [1, 2, 3, 'API'].includes(e.level))) &&
          !e.cause &&
          (options.now ?? Date.now()) >= Date.parse(e.observedAt || e.timestamp || e.at || e.ts) &&
          (options.now ?? Date.now()) - Date.parse(e.observedAt || e.timestamp || e.at || e.ts) <=
            sources.getDispatchConfig(options.registry, options).routeEvidenceMaxAgeMs
      )
  );
}

function measuredProbeCost(candidate, store, options = {}) {
  const data = evidenceData(options);
  const record = routeRecord(candidate, store);
  const proofs = data.capabilityProbes?.[candidateKey(candidate)] || {};
  const measurements = [
    candidate.elapsedMs,
    record?.elapsedMs,
    ...Object.values(proofs).map((p) => p?.elapsedMs),
    ...(data.combinations || [])
      .filter((c) => matchesCandidate(candidate, c))
      .flatMap((c) => (c.evidence || []).map((e) => e.elapsedMs)),
  ];
  return (
    measurements.find((n) => Number.isFinite(n) && n > 0) ??
    sources.getDispatchConfig(options.registry, options).probeTimeoutMs
  );
}

function hasFreshOkOrCompletion(candidate, quotaState, options = {}) {
  if (!candidate) return false;
  const now = options.now ?? Date.now();
  const reg =
    options.registry || (options.sources && options.sources.sources ? options.sources : undefined);
  const dispatchConfig =
    options.dispatchConfig ||
    (sources && sources.getDispatchConfig ? sources.getDispatchConfig(reg, options) : {});
  const maxAgeMs = dispatchConfig.routeEvidenceMaxAgeMs;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;

  // 1. Quota-state record check
  const qs = quotaState || options.quotaState;
  try {
    const quotaScan = require('./quota-scan');
    if (qs && quotaScan && typeof quotaScan.getQuotaScopeState === 'function') {
      const scopeState = quotaScan.getQuotaScopeState(candidate, qs, {
        ...options,
        now,
        registry: reg,
      });
      if (scopeState && scopeState.code === 'OK') {
        const candModel = candidate.modelId || candidate.model || '';
        const cleanCandModel = candModel.replace(/^(ninerouter\/|9router\/)/, '');
        const bareCandModel = cleanCandModel.includes('/')
          ? cleanCandModel.split('/').slice(1).join('/')
          : cleanCandModel;

        const isBlanketSource =
          (scopeState.scope === candidate.source ||
            scopeState.scope === candidate.sourceId ||
            scopeState.scope === candidate.gateway) &&
          !scopeState.model;

        let matchesCandidateScope = false;
        if (candModel) {
          matchesCandidateScope =
            scopeState.model === candModel ||
            scopeState.model === cleanCandModel ||
            scopeState.model === bareCandModel ||
            scopeState.scope === candModel ||
            scopeState.scope === cleanCandModel ||
            scopeState.scope === bareCandModel;
        } else {
          matchesCandidateScope =
            !scopeState.model &&
            !isBlanketSource &&
            (scopeState.scope === candidate.quotaScope || scopeState.scope === candidate.accountId);
        }

        if (matchesCandidateScope) {
          const atMs = Date.parse(
            scopeState.at || scopeState.timestamp || scopeState.observedAt || ''
          );
          if (Number.isFinite(atMs) && now >= atMs && now - atMs <= maxAgeMs) {
            return true;
          }
        }
      }
    }
  } catch {}

  // 2. Completion evidence check in candidate or evidenceData
  if (Array.isArray(candidate.evidence)) {
    const hasCompletion = candidate.evidence.some((e) => {
      if (!e || e.cause || (e.status !== 'passed' && e.proofLevel !== 'WORK_ITEM_PASS'))
        return false;
      const atMs = Date.parse(e.observedAt || e.timestamp || e.at || e.ts || '');
      if (Number.isFinite(atMs) && now >= atMs && now - atMs <= maxAgeMs) {
        return true;
      }
      return false;
    });
    if (hasCompletion) return true;
  }

  const evData = options.evidenceData || evidenceData(options);
  if (evData && Array.isArray(evData.combinations)) {
    const hasStoreCompletion = evData.combinations.some((combo) => {
      if (!matchesCandidate(candidate, combo)) return false;
      return (combo.evidence || []).some((e) => {
        if (!e || e.cause) return false;
        const isPass =
          e.proofLevel === 'WORK_ITEM_PASS' ||
          (e.status === 'passed' && (e.level === 2 || e.level === 3 || e.level === 'WORK_ITEM'));
        if (!isPass) return false;
        const atMs = Date.parse(e.observedAt || e.timestamp || e.at || e.ts || '');
        if (Number.isFinite(atMs) && now >= atMs && now - atMs <= maxAgeMs) {
          return true;
        }
        return false;
      });
    });
    if (hasStoreCompletion) return true;
  }

  return false;
}

module.exports = {
  matchesCandidate,
  hasPriorWorkPass,
  evidenceData,
  routeRecord,
  recentRouteSuccess,
  measuredProbeCost,
  hasFreshOkOrCompletion,
};
