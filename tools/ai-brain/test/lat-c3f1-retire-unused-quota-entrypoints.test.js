'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const health = require('../route-health');
const quota = require('../quota-scan');

test('retired quota and route-health entry points stay off the module exports', () => {
  assert.equal(health.getAccountRecord, undefined);
  assert.equal(health.runDueCli, undefined);
  assert.equal(quota.scanSourceQuotas, undefined);
  assert.equal(quota.scanTargetsForSource, undefined);
  assert.equal(typeof health.healthKey, 'function');
  assert.equal(typeof quota.loadQuotaState, 'function');
  assert.equal(typeof quota.scanAllQuotas, 'function');
});
