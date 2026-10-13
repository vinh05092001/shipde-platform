'use strict';

const health = require('./route-health');
const { candidateKey } = require('./discovery/identity');

// Only reorder the ranking returned by the quality/eligibility gates.
function preferKnownGood(result, candidates, options) {
  const o = options || {};
  if (!result.chosen || !result.ranking?.length) return result;
  const now = o.now ?? Date.now();
  const store =
    o.routeHealth ||
    health.loadStore(
      o.routeHealthFile || require('path').join(__dirname, 'data', 'model-route-health.json'),
      { allowMissing: true }
    );
  const priority = (row) => {
    const c = candidates.find((candidate) => candidateKey(candidate) === row.candidateKey) || row;
    // Isolated CLI lanes qualify through their launcher/quota, never HTTP.
    if (['agy-pool', 'codex'].includes(c.harness)) return -1;
    const record = health.getPathRecord(
      store,
      String(c.modelId || c.model || '').replace(/^ninerouter\//i, ''),
      { id: c.gateway || c.sourceId || c.source, accountId: c.accountId }
    );
    const age = now - Date.parse(record?.lastCheckedAt);
    return record?.status === 'AVAILABLE' && age >= 0 && age <= 24 * 3600000 ? 0 : 1;
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

module.exports = { preferKnownGood };
