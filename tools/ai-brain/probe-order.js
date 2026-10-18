'use strict';

const health = require('./route-health');
const { candidateKey } = require('./discovery/identity');

// Availability is shared by a gateway/upstream route, not by a harness key.
// This is a probe-order hint only; account eligibility remains independently gated.
function recentRouteSuccess(candidate, store, options) {
  if (!store || !candidate) return false;
  const o = options || {};
  const sources = o.registry?.sources || [];
  const endpoint = (id) => {
    const source = sources.find((s) => s.id === id);
    const value = source?.endpoint || source?.sourceEndpoint;
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
      return url.href.replace(/\/$/, '');
    } catch {
      return null;
    }
  };
  const gateway = candidate.gateway || candidate.sourceId || candidate.source;
  const upstreamModel = (value) =>
    String(value || '')
      .trim()
      .replace(/^ninerouter\//i, '')
      .toLowerCase();
  const model = upstreamModel(candidate.modelId || candidate.model);
  const rows = Object.values(store.paths || {}).filter((record) => {
    const route = typeof record.routeId === 'object' ? record.routeId.id : record.routeId;
    return (
      upstreamModel(record.modelId) === model &&
      (route === gateway || (endpoint(gateway) && endpoint(route) === endpoint(gateway)))
    );
  });
  // A newer failure supersedes older success for the same upstream route.
  rows.sort((a, b) => Date.parse(b.lastCheckedAt) - Date.parse(a.lastCheckedAt));
  const record = rows[0];
  // A route success cannot override a newer shared provider/account refusal.
  if (health.probeCooldown(candidate, { ...o, routeHealth: store })) return false;
  const age = (o.now ?? Date.now()) - Date.parse(record?.lastCheckedAt);
  if (record?.status === 'AVAILABLE' && age >= 0 && age <= 24 * 3600000) return true;
  const identity = health.probeIdentity(candidate);
  const directRecord = health.getPathRecord(store, identity.model, identity.route);
  if (directRecord?.status === 'AVAILABLE') {
    const directAge = (o.now ?? Date.now()) - Date.parse(directRecord.lastCheckedAt);
    if (directAge >= 0 && directAge <= 24 * 3600000) return true;
  }
  const evData =
    o.evidenceData || (o.evidenceDir ? require('./evidence').loadEvidence(o.evidenceDir) : null);
  if (evData && Array.isArray(evData.combinations)) {
    const hasEv = evData.combinations.some((combo) => {
      if (!combo) return false;
      const matchGateway =
        !candidate.gateway ||
        !combo.gateway ||
        candidate.gateway === combo.gateway ||
        candidate.sourceId === combo.gateway;
      const matchModel =
        combo.model === candidate.modelId ||
        combo.modelId === candidate.modelId ||
        (candidate.modelId && String(candidate.modelId).endsWith('/' + combo.model)) ||
        (combo.model &&
          candidate.modelId &&
          String(candidate.modelId).split('/').pop() === String(combo.model).split('/').pop());
      if (matchGateway && matchModel) {
        const evs = Array.isArray(combo.evidence) ? combo.evidence : [];
        return evs.some(
          (e) =>
            e &&
            (e.proofLevel === 'WORK_ITEM_PASS' ||
              (e.status === 'passed' &&
                (e.level === 3 || e.level === 2 || e.level === 1 || e.level === 'API')) ||
              (e.proofLevel === 'API_PASS' && !e.cause))
        );
      }
      return false;
    });
    if (hasEv) return true;
  }
  return false;
}

// Only reorder the ranking returned by the quality/eligibility gates.
function preferKnownGood(result, candidates, options) {
  const o = options || {};
  const now = o.now ?? Date.now();
  const store =
    o.routeHealth ||
    health.loadStore(
      o.routeHealthFile || require('path').join(__dirname, 'data', 'model-route-health.json'),
      { allowMissing: true }
    );
  const byKey = new Map(candidates.map((c) => [candidateKey(c), c]));
  result.knownGoodRejected = (result.rejected || []).filter((row) => {
    const c = byKey.get(row.candidateKey);
    return (
      c &&
      (recentRouteSuccess(c, store, { ...o, now }) ||
        (require('./capability-probe').hasPriorWorkPass &&
          require('./capability-probe').hasPriorWorkPass(
            c,
            (o.evidenceData && o.evidenceData.combinations) ||
              (o.evidenceDir && require('./evidence').loadEvidence(o.evidenceDir)?.combinations)
          )))
    );
  });
  const harnessOf = (row) => {
    const c = byKey.get(row.candidateKey) || row;
    return c?.harness || (row.candidateKey && row.candidateKey.split('::')[0]) || '';
  };
  result.isolatedLaneRejected = (result.rejected || []).filter((row) => {
    const h = harnessOf(row);
    return ['agy-pool', 'codex', 'opencode-direct'].includes(h);
  });
  const codex = [];
  const agyPool = [];
  const opencodeDirect = [];
  for (const row of result.isolatedLaneRejected) {
    const h = harnessOf(row);
    if (h === 'codex') codex.push(row);
    else if (h === 'agy-pool') agyPool.push(row);
    else if (h === 'opencode-direct') opencodeDirect.push(row);
  }
  const reasonScore = (row) =>
    row.reason && row.reason !== 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET' ? 0 : 1;
  codex.sort((a, b) => reasonScore(a) - reasonScore(b));
  agyPool.sort((a, b) => reasonScore(a) - reasonScore(b));
  opencodeDirect.sort((a, b) => reasonScore(a) - reasonScore(b));

  // Guarantee representative slots in top 10 for all 3 isolated harnesses:
  // Codex first (priority launcher lane), agy-pool next, followed by opencode-direct.
  const top = [];
  if (codex.length > 0) top.push(...codex.slice(0, 2));
  if (agyPool.length > 0) top.push(...agyPool.slice(0, 4));
  if (opencodeDirect.length > 0) top.push(...opencodeDirect.slice(0, 4));

  const seen = new Set(top);
  const remaining = [];
  for (const row of [...codex, ...agyPool, ...opencodeDirect]) {
    if (!seen.has(row)) {
      seen.add(row);
      remaining.push(row);
    }
  }
  result.isolatedLaneRejected = [...top, ...remaining];
  if (!result.chosen || !result.ranking?.length) return result;
  const sourcesApi = require('./sources');
  const priority = (row) => {
    const c = byKey.get(row.candidateKey) || row;
    // Isolated CLI lanes qualify through their launcher/quota, never HTTP.
    if (c.harness === 'codex') return -1;
    if (c.harness === 'agy-pool') {
      return sourcesApi.isAgyPoolWriterEnabled(o.registry, o) ? -1 : 1;
    }
    return recentRouteSuccess(c, store, { ...o, now }) ? 0 : 1;
  };
  result.ranking = result.ranking
    .map((row, index) => ({ row, index, priority: priority(row) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ row }) => row);
  result.chosen = result.ranking[0].candidateKey;
  result.top3 = result.ranking.slice(0, 3);
  result.reason =
    'PROBE_ORDER_KNOWN_GOOD: recent successful routes and isolated CLI lanes before unknown routes';
  return result;
}

module.exports = { preferKnownGood, recentRouteSuccess };
