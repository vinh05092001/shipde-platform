'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const health = require('../route-health');
const decisions = require('../decisions');
const { candidateKey } = require('../candidates');

const now = Date.parse('2026-10-17T09:17:46.055Z');
const route = { id: 'gateway-fixture', accountId: 'account-fixture' };
const candidate = {
  harness: 'opencode',
  accessPath: 'cli',
  gateway: route.id,
  upstream: 'vendor',
  accountId: route.accountId,
  modelId: 'vendor/model',
};
candidate.candidateKey = candidateKey(candidate);

for (const writer of [false, true]) {
  test('unknown probe remains eligible next round and logs raw result, writer=' + writer, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-unknown-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = { version: 1, paths: {}, events: [] };
    const options = {
      now,
      decisionDir: dir,
      routeHealth: store,
      persistRouteHealth: false,
      workItemId: 'A',
    };
    if (writer) health.rememberProbe(candidate, { ok: false }, options);
    else health.recordResult(store, candidate.modelId, route, { ok: false }, now, options);
    const record = health.getPathRecord(store, candidate.modelId, route);
    assert.equal(health.isEligible(store, candidate.modelId, route, now), true);
    assert.equal(health.isSelectable(store, candidate.modelId, route, now), true);
    assert.equal(health.probeCooldown(candidate, options), null);
    assert.notEqual(record.status, 'UNAVAILABLE_NOW');
    assert.ok(record.probeCause);
    const raw = decisions.readDecisionsSafe({ dir, now }).find((r) => r.probeResult);
    assert.ok(raw, 'missing cause retains a raw diagnostic');
    assert.equal(raw.probeResult.ok, false);
    assert.equal(raw.probeResult.status, null);
    assert.equal(raw.probeResult.body, '');
    assert.equal(raw.workItemId, 'A');
  });
}

test('unknown diagnostic redacts before truncating and real 451 keeps its geo block', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-raw-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = { version: 1, paths: {}, events: [] };
  const secret = 'fixture-private-value';
  const options = {
    now,
    decisionDir: dir,
    env: { FIXTURE_API_KEY: secret },
    routeHealth: store,
    persistRouteHealth: false,
  };
  health.rememberProbe(candidate, { ok: false, body: secret + ' detail '.repeat(1000) }, options);
  const raw = decisions.readDecisionsSafe({ dir, now }).find((r) => r.probeResult);
  assert.ok(raw);
  assert.ok(raw.probeResult.body.length < 1000);
  assert.ok(!JSON.stringify(raw).includes(secret));
  health.rememberProbe(candidate, { ok: false, status: 451, body: 'Region unavailable' }, options);
  const record = health.getPathRecord(store, candidate.modelId, route);
  assert.equal(record.status, 'GEO_BLOCKED');
  assert.equal(record.probeCause, 'GEO_BLOCKED');
  assert.equal(health.isEligible(store, candidate.modelId, route, now), false);
  assert.match(health.probeCooldown(candidate, options), /GEO_BLOCKED/);
});

test('versioned cause-less live record can be probed again before its former backoff', () => {
  const store = { version: 1, paths: {}, events: [] };
  store.paths[health.healthKey(candidate.modelId, route)] = {
    modelId: candidate.modelId,
    routeId: route,
    status: 'UNAVAILABLE_NOW',
    httpStatus: 0,
    failures: 1,
    classifierVersion: 2,
    lastCheckedAt: new Date(now).toISOString(),
    nextCheckAt: new Date(now + health.probeCooldownMs('PROBE_NO_RESPONSE')).toISOString(),
  };
  assert.equal(health.isEligible(store, candidate.modelId, route, now), true);
  assert.equal(health.isSelectable(store, candidate.modelId, route, now), true);
  assert.equal(health.isDue(store, candidate.modelId, route, now), true);
});

test('credentialed HTTP intake refusal happens before fetch and retains the actual local error', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let fetches = 0;
  const result = await health.probeGatewayModel(candidate.modelId, route, {
    registry: {
      sources: [
        {
          id: route.id,
          endpoint: 'http://router.example/v1',
          credential: { env: 'FIXTURE_API_KEY' },
        },
      ],
    },
    fetch: async () => {
      fetches++;
      throw new Error('network forbidden');
    },
  });
  assert.equal(fetches, 0);
  assert.equal(result.status, 0);
  assert.match(result.error, /credentialed probe endpoint must use HTTPS/);
  const store = { version: 1, paths: {}, events: [] };
  health.recordResult(store, candidate.modelId, route, result, now, { decisionDir: dir });
  const raw = decisions.readDecisionsSafe({ dir, now }).find((r) => r.probeResult);
  assert.equal(raw?.probeResult.body, result.error);
  assert.equal(health.isSelectable(store, candidate.modelId, route, now), true);
});

for (const [status, body, cause] of [
  [401, 'unauthorized', 'AUTH_NEEDED'],
  [403, 'forbidden', 'UPSTREAM_FORBIDDEN'],
  [451, 'location blocked', 'GEO_BLOCKED'],
  [402, 'payment required', 'UPSTREAM_CREDIT_OR_QUOTA'],
  [429, 'quota', 'UPSTREAM_CREDIT_OR_QUOTA'],
  [404, '{"code":"model_not_found"}', 'ROUTE_UNAVAILABLE'],
]) {
  test('real HTTP refusal retains its existing cause and cooldown: ' + status, () => {
    const store = { version: 1, paths: {}, events: [] };
    const options = { routeHealth: store, persistRouteHealth: false, now };
    health.rememberProbe(candidate, { ok: false, status, body }, options);
    const record = health.getPathRecord(store, candidate.modelId, route);
    assert.equal(record.probeCause, cause);
    assert.equal(Date.parse(record.nextCheckAt), now + health.probeCooldownMs(cause));
    assert.equal(health.isEligible(store, candidate.modelId, route, now), false);
    assert.ok(health.probeCooldown(candidate, options));
  });
}

test('a credentialed probe to the local router on loopback is sent, not refused', async () => {
  // Live 17/10: 9router listens on http://127.0.0.1; the HTTPS guard refused
  // it before any request, so a route that answered 200 failed every probe.
  let fetches = 0;
  const previous = process.env.FIXTURE_LOOPBACK_KEY;
  process.env.FIXTURE_LOOPBACK_KEY = 'fixture-not-a-secret';
  try {
    const result = await health.probeGatewayModel(candidate.modelId, route, {
      registry: {
        sources: [
          {
            id: route.id,
            endpoint: 'http://127.0.0.1:65530/v1',
            credential: { env: 'FIXTURE_LOOPBACK_KEY' },
          },
        ],
      },
      fetch: async () => {
        fetches++;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(fetches, 1, 'the probe reached the local router');
    assert.doesNotMatch(String(result.error || ''), /must use HTTPS/);
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LOOPBACK_KEY;
    else process.env.FIXTURE_LOOPBACK_KEY = previous;
  }
});

test('every failed probe leaves its raw result and duration in the decision log', () => {
  // Live 17/10 run 7: routes that answered within seconds were recorded as
  // TIMEOUT and nothing showed what the probe had actually received.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-evidence-'));
  try {
    const store = { version: 1, paths: {}, events: [] };
    health.recordResult(
      store,
      candidate.modelId,
      route,
      { ok: false, status: 402, body: 'insufficient account funds', elapsedMs: 870 },
      now,
      { decisionDir: dir }
    );
    const raw = decisions.readDecisionsSafe({ dir, now }).find((r) => r.probeResult);
    assert.ok(raw, 'a decision with the probe result was written');
    assert.equal(raw.probeResult.status, 402);
    assert.equal(raw.probeResult.elapsedMs, 870);
    assert.match(raw.probeResult.body, /insufficient account funds/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
