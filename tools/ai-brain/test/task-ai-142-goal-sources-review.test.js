'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { candidateKey } = require('../discovery/identity');
const order = require('../probe-order');
const c = {
  harness: 'agy-pool',
  accessPath: 'cli',
  gateway: 'source-a',
  upstream: 'vendor-a',
  accountId: 'account-a',
  quotaScope: 'quota-a',
  modelId: 'vendor-a/model',
};
function combination(patch = {}, evidence = [{ proofLevel: 'WORK_ITEM_PASS' }]) {
  return { ...c, model: c.modelId, ...patch, evidence };
}

test('representative rejections cover arbitrary harness and reason without named lane quotas', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    candidateKey: `bulk::cli::::a::q::m${i}`,
    reason: 'BUDGET',
  }));
  rows.push({ candidateKey: 'new-harness::cli::::a::q::m', reason: 'NEW_FAILURE' });
  const result = order.preferKnownGood({ rejected: rows }, [], { routeHealth: { paths: {} } });
  assert.ok(result.isolatedLaneRejected.some((r) => r.reason === 'NEW_FAILURE'));
});

test('route liveness has configurable freshness, exact evidence identity, and no work proof promotion', () => {
  const routeEvidence = require('../route-evidence');
  const now = Date.parse('2026-10-18T07:43:43.631Z');
  const observation = {
    proofLevel: 'API_PASS',
    observedAt: new Date(now - 10).toISOString(),
    elapsedMs: 17,
  };
  const options = {
    now,
    registry: { sources: [], dispatch: { routeEvidenceMaxAgeMs: 20, probeTimeoutMs: 200 } },
    evidenceData: { combinations: [combination({}, [observation])] },
  };
  assert.equal(routeEvidence.recentRouteSuccess(c, { paths: {} }, options), true);
  assert.equal(routeEvidence.hasPriorWorkPass(c, options.evidenceData.combinations), false);
  assert.equal(routeEvidence.measuredProbeCost(c, { paths: {} }, options), 17);
  assert.equal(
    routeEvidence.recentRouteSuccess({ ...c, harness: 'codex' }, { paths: {} }, options),
    false
  );
  assert.equal(
    routeEvidence.recentRouteSuccess(c, { paths: {} }, { ...options, now: now + 11 }),
    false
  );
  assert.equal(
    routeEvidence.hasPriorWorkPass(c, [
      combination({}, [{ proofLevel: 'WORK_ITEM_PASS', status: 'failed' }]),
    ]),
    false
  );
});
