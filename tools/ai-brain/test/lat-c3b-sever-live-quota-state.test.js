'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const candidatesApi = require('../candidates');
const quotaScan = require('../quota-scan');
const routeHealth = require('../route-health');

const BRAIN_DIR = path.resolve(__dirname, '..');

test('Lat C-3b: live annotateCandidates callers pass loadQuotaState: false so stale stored quota is never read', () => {
  for (const rel of ['orchestrate.js', 'planning-services.js']) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, rel), 'utf8');
    assert.match(
      src,
      /annotateCandidates\([\s\S]*?loadQuotaState:\s*false/,
      `${rel} must pass loadQuotaState: false to annotateCandidates`
    );
  }
});

test('Lat C-3b: annotateCandidates with loadQuotaState: false and no routeHealth never calls quota-scan or route-health', (t) => {
  let quotaCalls = 0;
  let healthCalls = 0;
  t.mock.method(quotaScan, 'loadQuotaState', () => {
    quotaCalls += 1;
    return { scopes: {} };
  });
  t.mock.method(routeHealth, 'healthKey', () => {
    healthCalls += 1;
    return 'k';
  });

  const cands = [
    {
      harness: 'opencode-direct',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: '9router',
      accountId: '9router',
      quotaScope: '9router',
      modelId: 'vinh',
    },
  ];
  const out = candidatesApi.annotateCandidates(
    cands,
    {},
    { now: Date.now(), loadQuotaState: false }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].routeStatus.health, 'UNKNOWN');
  assert.equal(out[0].routeStatus.quota, 'UNKNOWN');
  assert.equal(quotaCalls, 0, 'quota-scan.loadQuotaState must not be called');
  assert.equal(healthCalls, 0, 'route-health.healthKey must not be called');
});
