'use strict';

const { candidateKey, parseCandidateKey } = require('./discovery/identity');
const health = require('./route-health');
const evidence = require('./evidence');
const sources = require('./sources');

// Work proof is bound to the entire transport identity. Missing fields are not wildcards.
function matchesCandidate(candidate, combination) {
  if (!candidate || !combination) return false;
  const identity =
    typeof combination.candidateKey === 'string'
      ? parseCandidateKey(combination.candidateKey)
      : combination;
  if (!identity || candidateKey(candidate) !== candidateKey(identity)) return false;
  const source = (value) => value.sourceId || value.source || value.gateway || '';
  return (
    (!combination.sourceId && !combination.source) || source(candidate) === source(combination)
  );
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
  if (
    record?.status === 'AVAILABLE' &&
    age >= 0 &&
    age <= sources.getDispatchConfig(options.registry, options).routeEvidenceMaxAgeMs
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
          (options.now ?? Date.now()) >= Date.parse(e.observedAt || e.timestamp || e.at) &&
          (options.now ?? Date.now()) - Date.parse(e.observedAt || e.timestamp || e.at) <=
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

module.exports = {
  matchesCandidate,
  hasPriorWorkPass,
  evidenceData,
  routeRecord,
  recentRouteSuccess,
  measuredProbeCost,
};
