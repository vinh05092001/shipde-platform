'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const health = require('../route-health');
const { classifyProbeFailure } = require('../route-probe');
const { candidateKey } = require('../discovery/identity');

function candidate(modelId, overrides = {}) {
  const c = {
    harness: 'hermes',
    accessPath: 'https://gateway.example/v1',
    gateway: 'test-gateway',
    upstream: 'test-provider',
    accountId: 'test-account',
    quotaScope: 'test-account',
    modelId,
    contextWindow: 128000,
    quality: 99,
    ...overrides,
  };
  c.candidateKey = candidateKey(c);
  return c;
}

test('status 0 without response classifies as TIMEOUT or PROBE_NO_RESPONSE, not ROUTE_UNAVAILABLE', () => {
  // Timeout indicators
  assert.equal(classifyProbeFailure({ status: 0, body: 'Request timeout' }), 'TIMEOUT');
  assert.equal(classifyProbeFailure({ status: 0, body: 'Probe request timed out' }), 'TIMEOUT');

  // Transient network glitches / no response
  assert.equal(
    classifyProbeFailure({ status: 0, body: 'Probe request failed' }),
    'PROBE_NO_RESPONSE'
  );
  assert.equal(
    classifyProbeFailure({ status: 0, body: 'connect ECONNREFUSED' }),
    'PROBE_NO_RESPONSE'
  );
  assert.equal(classifyProbeFailure({ status: 0, body: 'socket hang up' }), 'PROBE_NO_RESPONSE');
  assert.equal(classifyProbeFailure({ status: 0 }), 'PROBE_NO_RESPONSE');
});

test('probeCooldownMs assigns short cooldown (<=0.5h) to ROUTE_UNAVAILABLE, TIMEOUT, and PROBE_NO_RESPONSE', () => {
  const halfHourMs = 0.5 * 3600000;
  assert.equal(health.probeCooldownMs('ROUTE_UNAVAILABLE'), halfHourMs);
  assert.equal(health.probeCooldownMs('TIMEOUT'), halfHourMs);
  assert.equal(health.probeCooldownMs('PROBE_NO_RESPONSE'), halfHourMs);

  // Permanent non-existent models retain 24h
  const dayMs = 24 * 3600000;
  assert.equal(health.probeCooldownMs('HTTP_404'), dayMs);
  assert.equal(health.probeCooldownMs('ALIAS_MISMATCH'), dayMs);
});

test('confirmed timeout cools down only the specific model for 30m, never killing the entire provider', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-transient-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'health.json');
  const now = 1000000;
  const options = { routeHealthFile: file, now };

  const candA = candidate('fixture-provider/model-alpha');
  const candB = candidate('fixture-provider/model-beta');

  // A confirmed timeout retains the existing transient cooldown; cause-less failures have separate regressions.
  health.rememberProbe(candA, { ok: false, status: 0, body: 'Request timeout' }, options);

  // Candidate A is cooled down for at most 0.5 hours (30 min)
  const cdAActive = health.probeCooldown(candA, { ...options, now: now + 15 * 60 * 1000 });
  assert.ok(cdAActive, 'Candidate A should be in cooldown during the 30m window');
  assert.match(cdAActive, /PROBE_NO_RESPONSE|TIMEOUT/);

  // After 30 minutes, Candidate A cooldown must expire (not 24 hours!)
  const cdAExpired = health.probeCooldown(candA, { ...options, now: now + 31 * 60 * 1000 });
  assert.equal(cdAExpired, null, 'Candidate A cooldown must expire after 30 minutes');

  // Sibling Candidate B under same provider/gateway must NOT be cooled down
  const cdB = health.probeCooldown(candB, options);
  assert.equal(cdB, null, 'Candidate B must remain unblocked; provider must not be killed');

  // Store must not have any provider-level lock
  const store = health.loadStore(file);
  assert.equal(
    health.getProviderRecord(store, candA.gateway, 'fixture-provider'),
    null,
    'No provider-level record should be set for status 0 failure'
  );
});

test('status 0 with provider-like error body does not kill the entire provider', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-transient-prov-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'health.json');
  const now = 1000000;
  const options = { routeHealthFile: file, now };

  const candA = candidate('fixture-provider/model-alpha');
  const candB = candidate('fixture-provider/model-beta');

  // Even if body mentions "No active credentials for provider", status === 0 means no HTTP response was received
  health.rememberProbe(
    candA,
    { ok: false, status: 0, body: 'No active credentials for provider: fixture-provider' },
    options
  );

  // Candidate B must remain eligible
  assert.equal(health.probeCooldown(candB, options), null);
  const store = health.loadStore(file);
  assert.equal(health.getProviderRecord(store, candA.gateway, 'fixture-provider'), null);
});
