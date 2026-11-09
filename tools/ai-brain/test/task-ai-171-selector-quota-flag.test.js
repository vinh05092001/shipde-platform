'use strict';

// TASK-AI-171 selector fix: a quota block measured at route assembly survives evidence annotation.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { annotateCandidates } = require('../candidates');

const lane = (over) => ({
  harness: 'agy-pool',
  accessPath: 'agy-pool',
  gateway: 'agy-pool',
  upstream: 'antigravity',
  accountId: 'agy-fixture',
  quotaScope: 'agy-fixture:family',
  modelId: 'fixture-model',
  ...over,
});

test('an assembled QUOTA_EXHAUSTED block is not cleared by evidence that finds no block', () => {
  const c = lane({ blocked: true, blockReason: 'QUOTA_EXHAUSTED', blockScope: 'account' });
  annotateCandidates([c], {}, { quotaState: null, routeHealth: null });
  assert.deepEqual([c.blocked, c.blockReason, c.blockScope], [true, 'QUOTA_EXHAUSTED', 'account']);
});

test('a route without an assembled quota block is still decided by evidence', () => {
  const c = lane({});
  annotateCandidates([c], {}, { quotaState: null, routeHealth: null });
  assert.notEqual(c.blockReason, 'QUOTA_EXHAUSTED');
});
