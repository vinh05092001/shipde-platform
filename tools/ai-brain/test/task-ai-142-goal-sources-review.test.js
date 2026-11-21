'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { candidateKey } = require('../discovery/identity');
const cap = require('../capability-probe');
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

test('work proof never crosses source, upstream, full model, account, quota, path or harness identity', () => {
  assert.equal(cap.hasPriorWorkPass(c, [combination()]), true);
  for (const patch of [
    { gateway: '' },
    { gateway: 'source-b' },
    { upstream: 'vendor-b' },
    { modelId: 'vendor-b/model', model: 'vendor-b/model' },
    { sourceId: 'different-source' },
    { accountId: '*' },
    { quotaScope: '' },
    { accessPath: 'other' },
    { harness: 'opencode' },
  ]) {
    assert.equal(cap.hasPriorWorkPass(c, [combination(patch)]), false, JSON.stringify(patch));
  }
});

test('API proof cannot short circuit writer capability verification', async () => {
  for (const e of [
    { status: 'passed', level: 1 },
    { status: 'passed', level: 'API' },
    { proofLevel: 'API_PASS' },
  ]) {
    assert.equal(cap.hasPriorWorkPass(c, [combination({}, [e])]), false);
  }
});

test('probe order uses measured elapsed cost and configured fallback independent of harness name', () => {
  const slow = { ...c, elapsedMs: 700 };
  const fast = { ...c, harness: 'unlisted-harness', modelId: 'different', elapsedMs: 30 };
  const unknown = { ...c, harness: 'codex', modelId: 'unknown' };
  assert.deepEqual(
    cap.orderCandidatesForProbe(
      [slow, unknown, fast],
      { role: 'writer' },
      {
        registry: { sources: [], dispatch: { probeTimeoutMs: 100 } },
        routeHealth: { paths: {} },
        capabilityEvidence: {},
      }
    ),
    [fast, unknown, slow]
  );
});

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
