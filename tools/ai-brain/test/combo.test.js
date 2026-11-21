'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { comboCandidate } = require('../combo');

const registry = (dispatch, sources) => ({
  sources: sources || [
    { id: 'rt', kind: 'router', endpoint: 'http://router.test/v1', credential: { env: 'RT_KEY' } },
  ],
  dispatch: dispatch || {
    nineRouterWriterCombo: 'team',
    nineRouterWriterComboLimits: { contextWindow: 1000, maxOutputTokens: 100 },
  },
});

test('combo candidate is built only from registry data', () => {
  const { candidate, error } = comboCandidate({
    registry: registry(),
    env: { RT_KEY: 'test-not-a-key' },
  });
  assert.strictEqual(error, undefined);
  assert.strictEqual(candidate.candidateKey, 'combo::http://router.test/v1::team');
  assert.strictEqual(candidate.model, 'team');
  assert.strictEqual(candidate.source, 'rt');
  assert.strictEqual(candidate.apiKeyEnv, 'RT_KEY');
  assert.strictEqual(candidate.contextWindow, 1000);
  assert.strictEqual(candidate.maxOutputTokens, 100);
  assert.strictEqual(candidate.blocked, undefined);
});

test('missing credential env marks the combo blocked without reading any value', () => {
  const { candidate } = comboCandidate({ registry: registry(), env: {} });
  assert.strictEqual(candidate.blocked, true);
  assert.strictEqual(candidate.blockReason, 'CREDENTIAL_ENV_MISSING');
});

test('missing combo name or router source returns an error instead of a guess', () => {
  assert.match(comboCandidate({ registry: registry({}), env: {} }).error, /COMBO_NOT_CONFIGURED/);
  assert.match(
    comboCandidate({ registry: registry(undefined, []), env: {} }).error,
    /COMBO_ROUTER_MISSING/
  );
});
