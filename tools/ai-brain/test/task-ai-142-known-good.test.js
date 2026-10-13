'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const health = require('../route-health');
const { candidateKey } = require('../discovery/identity');
const { preferKnownGood } = require('../probe-order');

test('known-good order preserves rank within groups and expires after 24h', () => {
  const now = Date.now();
  const candidates = ['unknown-high', 'live-low', 'unknown-low'].map((modelId) => {
    const c = { harness: 'opencode', modelId, gateway: 'fixture', accountId: 'a' };
    return { ...c, candidateKey: candidateKey(c) };
  });
  const store = { version: 1, paths: {}, events: [] };
  health.recordResult(
    store,
    'live-low',
    { id: 'fixture', accountId: 'a' },
    { ok: true, status: 200 },
    now
  );
  const rank = () => ({ chosen: candidates[0].candidateKey, ranking: [...candidates] });
  const result = preferKnownGood(rank(), candidates, { routeHealth: store, now });
  assert.equal(result.chosen, candidates[1].candidateKey);
  assert.deepEqual(result.ranking, [candidates[1], candidates[0], candidates[2]]);
  assert.match(result.reason, /PROBE_ORDER_KNOWN_GOOD/);
  assert.equal(
    preferKnownGood(rank(), candidates, { routeHealth: store, now: now + 24 * 3600000 + 1 }).chosen,
    candidates[0].candidateKey
  );
  const refused = { chosen: null, ranking: [] };
  assert.equal(preferKnownGood(refused, candidates, { routeHealth: store, now }).chosen, null);
});

test('intake discovered Codex CLI account needs CLI availability, not HTTP credential', () => {
  const { mergeDiscoveredSources } = require('../intake');
  const accounts = mergeDiscoveredSources(
    [],
    [{ id: 'codex', kind: 'agent-cli', status: 'available', models: ['fixture-model'] }]
  );
  assert.equal(accounts[0].enabled, true);
  const registry = {
    sources: [{ id: 'codex', kind: 'agent-cli', harness: 'codex', accessPath: 'cli' }],
  };
  const candidates = require('../candidates').generateCandidates({
    registry,
    accounts,
    catalogue: ['unrelated-http-model'],
  });
  assert.ok(candidates.some((c) => c.harness === 'codex' && c.modelId === 'fixture-model'));
  const c = candidates[0];
  c.candidateKey = candidateKey(c);
  const unknown = { ...c, harness: 'opencode', candidateKey: 'unknown' };
  assert.equal(
    preferKnownGood({ chosen: 'unknown', ranking: [unknown, c] }, [unknown, c], {
      routeHealth: { paths: {} },
    }).chosen,
    c.candidateKey
  );
  assert.equal(
    mergeDiscoveredSources(
      [],
      [{ id: 'codex', kind: 'agent-cli', status: 'unavailable', models: ['fixture-model'] }]
    )[0].enabled,
    false
  );
});

test('JSON-roundtripped failure causes serialize to reason strings', () => {
  const { classifyProbeFailure, failureReason } = require('../route-probe');
  const cause = JSON.parse(
    JSON.stringify(
      classifyProbeFailure({ status: 503, body: 'No active credentials for provider: fixture' })
    )
  );
  assert.equal(failureReason(cause), 'PROVIDER_UNAVAILABLE');
  assert.equal(failureReason({ reasonCode: { reason: 'TIMEOUT' } }), 'TIMEOUT');
});
