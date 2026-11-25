'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const health = require('../route-health');

test('retired route fallback and refresh entry points stay off the module exports', () => {
  const retired = [
    'routeFallback',
    'routeFallbackDiscovered',
    'discoverModelPaths',
    'refreshCatalogueRoutes',
    'recheckDue',
    'recheckBeforeSelection',
    'refreshDueFile',
  ];
  for (const name of retired) assert.equal(typeof health[name], 'undefined', name);
  assert.equal(typeof health.probeGatewayModel, 'function');
  assert.equal(typeof health.isDue, 'function');
});
