'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const candidatesApi = require('../candidates');
const routing = require('../routing');

const FIXTURE_REGISTRY = {
  version: 1,
  sources: [
    {
      id: 'tencent-fixture',
      kind: 'model-source',
      endpoint: 'https://api.tokenhub.tencent.com/v1',
      models: ['hy4-preview', 'hy3'],
      credential: {
        type: 'api-key',
        env: 'FIXTURE_TENCENT_KEY',
      },
      enabled: true,
      servesModels: true,
      harness: 'http',
    },
  ],
  dispatch: {
    providers: {
      'tencent-fixture': {
        harness: 'http',
        accessPath: 'https://api.tokenhub.tencent.com/v1',
      },
    },
  },
};

const TEST_PROFILE = {
  taskId: 'TASK-AI-142-KEYS',
  role: 'writer',
  complexity: 'standard',
  requiredCapabilities: [],
  proofFloor: 'NONE',
  qualityFloor: 0,
  costCeiling: 100,
};

const TEST_ASSESSMENT = {
  jevOutcome: 'DECIDED',
  confidence: 'high',
  reasonCodes: ['TEST_OK'],
  weights: { quality: 34, latency: 33, cost: 33 },
};

test('VIỆC 2: Source with api-key credential binds to concrete accountId when env is present, avoiding WILDCARD_ACCOUNT', () => {
  const result = candidatesApi.generateCandidates({
    registry: FIXTURE_REGISTRY,
    accounts: [],
    catalogue: [],
    env: { FIXTURE_TENCENT_KEY: 'test-real-key-present' },
  });

  assert.ok(result.length > 0, 'candidates must be generated');
  for (const c of result) {
    assert.notEqual(c.accountId, '*', 'candidate must have concrete accountId, not wildcard');
    assert.match(c.accountId, /tencent-fixture/, 'accountId must derive from source id');
    assert.match(c.accountId, /fixture-tencent-key/, 'accountId must derive from env name');
  }

  // Routing must not reject with WILDCARD_ACCOUNT
  const ranked = routing.rankForProfile(result, TEST_PROFILE, TEST_ASSESSMENT, {
    headrooms: { default: 'open' },
  });

  const wildcardRejects = ranked.rejected.filter((r) => r.reasonCode === 'WILDCARD_ACCOUNT');
  assert.equal(wildcardRejects.length, 0, 'must not be rejected with WILDCARD_ACCOUNT');
});

test('VIỆC 2: Source with api-key credential rejects with CREDENTIAL_ENV_MISSING when env var is empty or missing', () => {
  const result = candidatesApi.generateCandidates({
    registry: FIXTURE_REGISTRY,
    accounts: [],
    catalogue: [],
    env: {}, // Missing key
  });

  assert.ok(result.length > 0, 'candidates generated for audit');
  for (const c of result) {
    assert.notEqual(c.accountId, '*', 'accountId must be concrete, not *');
  }

  const ranked = routing.rankForProfile(result, TEST_PROFILE, TEST_ASSESSMENT, {
    headrooms: { default: 'open' },
  });

  const envMissingRejects = ranked.rejected.filter(
    (r) => r.reasonCode === 'CREDENTIAL_ENV_MISSING'
  );
  assert.equal(
    envMissingRejects.length,
    result.length,
    'all candidates rejected with CREDENTIAL_ENV_MISSING'
  );

  const wildcardRejects = ranked.rejected.filter((r) => r.reasonCode === 'WILDCARD_ACCOUNT');
  assert.equal(wildcardRejects.length, 0, 'must not be rejected with WILDCARD_ACCOUNT');
});

test('VIỆC 2: Routing still rejects true wildcard candidates (*) with WILDCARD_ACCOUNT', () => {
  const rawWildcard = {
    harness: 'http',
    accessPath: 'custom',
    gateway: 'custom',
    upstream: 'custom',
    accountId: '*',
    quotaScope: 'custom',
    modelId: 'some-model',
  };

  const ranked = routing.rankForProfile([rawWildcard], TEST_PROFILE, TEST_ASSESSMENT, {
    headrooms: { default: 'open' },
  });

  assert.equal(ranked.rejected.length, 1);
  assert.equal(ranked.rejected[0].reasonCode, 'WILDCARD_ACCOUNT');
});
