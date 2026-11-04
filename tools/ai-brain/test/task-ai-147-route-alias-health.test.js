'use strict';

// TASK-AI-147: OpenCode names 9Router models with the registry alias prefix
// (ninerouter/<upstream>/<model>), while probes and discovery record the same
// route as <upstream>/<model> on route 9router. Both must reach one health
// record, or every live router model is refused for missing route health.
const test = require('node:test');
const assert = require('node:assert');
const routeHealth = require('../route-health');

function storeWith(modelId) {
  const store = { paths: {}, events: [] };
  routeHealth.recordResult(store, modelId, '9router', { ok: true }, Date.parse('2026-11-04T12:00:00Z'));
  return store;
}

test('alias-prefixed OpenCode id finds the record a probe wrote', () => {
  const store = storeWith('rc/zai-org/GLM-5.3');
  const rec = routeHealth.getPathRecord(store, 'ninerouter/rc/zai-org/GLM-5.3', '9router');
  assert.strictEqual(rec && rec.status, 'AVAILABLE');
});

test('route-id prefix is still stripped', () => {
  const store = storeWith('rc/zai-org/GLM-5.3');
  const rec = routeHealth.getPathRecord(store, '9router/rc/zai-org/GLM-5.3', '9router');
  assert.strictEqual(rec && rec.status, 'AVAILABLE');
});

test('an alias of a different route is not stripped', () => {
  const store = storeWith('rc/zai-org/GLM-5.3');
  const rec = routeHealth.getPathRecord(store, 'requesty/rc/zai-org/GLM-5.3', '9router');
  assert.strictEqual(rec, undefined);
});
