'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const routeHealth = require('../route-health');
const routeProbe = require('../route-probe');

test('VIỆC 3: Legacy TIMEOUT record without classifierVersion is eligible for re-probing', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const store = {
    version: 1,
    paths: {
      'cl/claude-3-5-sonnet|9router@*': {
        modelId: 'cl/claude-3-5-sonnet',
        normalizedModelId: 'claude-3-5-sonnet',
        routeId: { id: '9router', accountId: '*' },
        status: 'UNAVAILABLE_NOW',
        probeCause: 'PROBE_FAILED TIMEOUT',
        failures: 1,
        lastCheckedAt: '2026-10-17T03:00:00Z',
        nextCheckAt: '2026-10-18T03:00:00Z',
        // Note: NO classifierVersion
      },
    },
    events: [],
  };

  const candidate = {
    modelId: 'cl/claude-3-5-sonnet',
    gateway: '9router',
    accountId: '*',
    upstream: 'cl',
    accessPath: 'https://api.9router.com/v1',
  };

  // Must be detected as legacy unverified
  const record = store.paths['cl/claude-3-5-sonnet|9router@*'];
  assert.equal(routeHealth.isLegacyUnverified(record), true, 'legacy TIMEOUT must be flagged unverified');

  // isEligible must allow re-probing
  const eligible = routeHealth.isEligible(store, candidate.modelId, { id: '9router', accountId: '*' }, now);
  assert.equal(eligible, true, 'legacy TIMEOUT must be eligible for re-probe');

  // orderProbeRoutes must place candidate in unknown (to be probed) rather than failed
  const ordered = routeHealth.orderProbeRoutes([candidate], { routeHealth: store, now });
  // The candidate should be probe-eligible in the unknown list, not locked out in failed
  assert.equal(ordered.length, 1);
  const isFailed = ordered[0] && routeHealth.isLegacyUnverified(record);
  assert.ok(isFailed, 'candidate must be eligible for re-probe');
});

test('VIỆC 3: Classified record with version and 451 remains GEO_BLOCKED', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const store = {
    version: 1,
    paths: {
      'cl/claude-3-5-sonnet|9router@*': {
        modelId: 'cl/claude-3-5-sonnet',
        normalizedModelId: 'claude-3-5-sonnet',
        routeId: { id: '9router', accountId: '*' },
        status: 'GEO_BLOCKED',
        httpStatus: 451,
        failures: 1,
        classifierVersion: 2,
        lastCheckedAt: '2026-10-17T07:00:00Z',
        nextCheckAt: '2026-10-18T07:00:00Z',
      },
    },
    events: [],
  };

  const candidate = {
    modelId: 'cl/claude-3-5-sonnet',
    gateway: '9router',
    accountId: '*',
    upstream: 'cl',
    accessPath: 'https://api.9router.com/v1',
  };

  const record = store.paths['cl/claude-3-5-sonnet|9router@*'];
  assert.equal(routeHealth.isLegacyUnverified(record), false, 'versioned 451 is NOT unverified');

  const eligible = routeHealth.isEligible(store, candidate.modelId, { id: '9router', accountId: '*' }, now);
  assert.equal(eligible, false, 'GEO_BLOCKED route must remain ineligible during cooldown');
});

test('VIỆC 3: Legacy record with genuine 451 GEO_BLOCKED remains GEO_BLOCKED even without version', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const store = {
    version: 1,
    paths: {
      'cl/claude-3-5-sonnet|9router@*': {
        modelId: 'cl/claude-3-5-sonnet',
        normalizedModelId: 'claude-3-5-sonnet',
        routeId: { id: '9router', accountId: '*' },
        status: 'GEO_BLOCKED',
        httpStatus: 451,
        failures: 1,
        lastCheckedAt: '2026-10-17T03:00:00Z',
        nextCheckAt: '2026-10-18T03:00:00Z',
      },
    },
    events: [],
  };

  const candidate = {
    modelId: 'cl/claude-3-5-sonnet',
    gateway: '9router',
    accountId: '*',
    upstream: 'cl',
    accessPath: 'https://api.9router.com/v1',
  };

  const record = store.paths['cl/claude-3-5-sonnet|9router@*'];
  assert.equal(routeHealth.isLegacyUnverified(record), false, 'genuine 451 is not unverified');

  const eligible = routeHealth.isEligible(store, candidate.modelId, { id: '9router', accountId: '*' }, now);
  assert.equal(eligible, false, 'legacy GEO_BLOCKED remains ineligible');
});

test('VIỆC 3: recordResult tags paths with classifierVersion', () => {
  const store = { version: 1, paths: {}, events: [] };
  const now = Date.parse('2026-10-17T12:00:00Z');

  routeHealth.recordResult(store, 'test-model', 'test-gw', { ok: false, status: 451, message: 'Geo block' }, now);

  const keys = Object.keys(store.paths);
  assert.equal(keys.length, 1);
  const entry = store.paths[keys[0]];
  assert.equal(entry.status, 'GEO_BLOCKED');
  assert.ok(entry.classifierVersion >= 2, 'recordResult must tag record with classifierVersion');
});

test('VIỆC 3: orderProbeRoutes orders legacy unverified ahead of genuine failed routes', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const store = {
    version: 1,
    paths: {
      'claude-3-5-sonnet|9router@*': {
        modelId: 'cl/claude-3-5-sonnet',
        normalizedModelId: 'claude-3-5-sonnet',
        routeId: { id: '9router', accountId: '*' },
        status: 'UNAVAILABLE_NOW',
        probeCause: 'PROBE_FAILED TIMEOUT',
        failures: 1,
        lastCheckedAt: '2026-10-17T03:00:00Z',
        nextCheckAt: '2026-10-18T03:00:00Z',
      },
      'gpt-4o|9router@*': {
        modelId: 'oa/gpt-4o',
        normalizedModelId: 'gpt-4o',
        routeId: { id: '9router', accountId: '*' },
        status: 'GEO_BLOCKED',
        httpStatus: 451,
        failures: 1,
        classifierVersion: 2,
        lastCheckedAt: '2026-10-17T07:00:00Z',
        nextCheckAt: '2026-10-18T07:00:00Z',
      },
    },
    events: [],
  };

  const candLegacy = {
    modelId: 'cl/claude-3-5-sonnet',
    gateway: '9router',
    accountId: '*',
  };
  const candFailed = {
    modelId: 'cl/gpt-4o',
    gateway: '9router',
    accountId: '*',
  };

  assert.equal(routeHealth.isSelectable(store, candLegacy.modelId, { id: '9router', accountId: '*' }, now), true);
  assert.equal(routeHealth.isSelectable(store, candFailed.modelId, { id: '9router', accountId: '*' }, now), false);

  const ordered = routeHealth.orderProbeRoutes([candFailed, candLegacy], { routeHealth: store, now });
  assert.equal(ordered.length, 2);
  // candLegacy should be in unknown, candFailed in failed -> candLegacy placed first!
  assert.equal(ordered[0].modelId, 'cl/claude-3-5-sonnet', 'legacy unverified must be prioritized in unknown');
  assert.equal(ordered[1].modelId, 'cl/gpt-4o', 'genuine 451 must be in failed');
});
