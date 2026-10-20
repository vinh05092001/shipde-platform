'use strict';

const health = require('./route-health');
const path = require('path');
const { candidateKey } = require('./discovery/identity');
const { sampleRepresentative } = require('./decisions');
const routeEvidence = require('./route-evidence');
const { recentRouteSuccess } = routeEvidence;

// Availability changes probe order only, never eligibility or quality scores.
function preferKnownGood(result, candidates, options = {}) {
  const store =
    options.routeHealth ||
    health.loadStore(
      options.routeHealthFile || path.join(__dirname, 'data', 'model-route-health.json'),
      { allowMissing: true }
    );
  const byKey = new Map(candidates.map((c) => [c.candidateKey || candidateKey(c), c]));
  const data = routeEvidence.evidenceData(options);
  const context = { ...options, evidenceData: data };
  result.knownGoodRejected = (result.rejected || []).filter((row) => {
    const c = byKey.get(row.candidateKey);
    return (
      c &&
      (recentRouteSuccess(c, store, context) ||
        routeEvidence.hasPriorWorkPass(c, data.combinations))
    );
  });
  // Every transport and reason follows the same sampling rule, without lane quotas.
  result.isolatedLaneRejected = sampleRepresentative(result.rejected || []);
  if (!result.chosen || !result.ranking?.length) return result;

  const quotaScan = require('./quota-scan');
  const quotaState = options.quotaState || quotaScan.loadQuotaState(options);
  const now = options.now ?? Date.now();
  if (result.ranking?.length) {
    const valid = [];
    result.rejected = result.rejected || [];
    for (const row of result.ranking) {
      const c = byKey.get(row.candidateKey) || row;
      const scopeState = quotaScan.getQuotaScopeState(c, quotaState);
      if (scopeState && quotaScan.isScopeBlocked(scopeState, now)) {
        result.rejected.push({
          candidateKey: row.candidateKey,
          reasonCode: `QUOTA_SCOPE_${scopeState.code}`,
          reason: `QUOTA_SCOPE_${scopeState.code}: ${scopeState.scope || scopeState.source}`,
          score: row.score,
        });
      } else {
        valid.push(row);
      }
    }
    result.ranking = valid;
    if (!result.ranking.length) {
      result.chosen = null;
      result.top3 = [];
      return result;
    }
  }
  result.ranking = result.ranking
    .map((row, index) => {
      const c = byKey.get(row.candidateKey) || row;
      return {
        row,
        index,
        live: recentRouteSuccess(c, store, context),
        work: routeEvidence.hasPriorWorkPass(c, data.combinations),
      };
    })
    .sort(
      (a, b) =>
        Number(b.work) - Number(a.work) || Number(b.live) - Number(a.live) || a.index - b.index
    )
    .map(({ row }) => row);
  result.chosen = result.ranking[0].candidateKey;
  result.top3 = result.ranking.slice(0, 3);
  result.reason = 'PROBE_ORDER_KNOWN_GOOD: exact work/route evidence, preserving candidate rank';
  return result;
}

module.exports = { preferKnownGood, recentRouteSuccess };
