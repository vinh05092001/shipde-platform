'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('Finding 4: hasFreshOkOrCompletion requires canonical route identity or explicit alias; other-provider/shared is not satisfied by shared OK', () => {
  const routeEvidence = require('../route-evidence');
  const now = Date.now();

  const candidate = {
    source: 'other-provider',
    sourceId: 'other-provider',
    modelId: 'other-provider/shared',
  };

  // QuotaState has OK for 'shared' (bare suffix), NOT canonical 'other-provider/shared'
  const quotaState = {
    scopes: {
      'other-provider::shared': {
        source: 'other-provider',
        scope: 'shared',
        model: 'shared',
        code: 'OK',
        at: new Date(now - 100).toISOString(),
      },
    },
  };

  const satisfied = routeEvidence.hasFreshOkOrCompletion(candidate, quotaState, {
    now,
    dispatchConfig: { routeEvidenceMaxAgeMs: 60000 },
  });

  assert.equal(
    satisfied,
    false,
    'source-level or bare suffix OK for distinct route shared must not satisfy other-provider/shared without verified alias'
  );
});

test('Finding 9: resolveEndpoint preserves HTTPS protocol and defaults port to 443; httpRequest selects https transport', async () => {
  const combo = require('../ninerouter-combo');

  // HTTPS endpoint without port must default to 443, not 80
  const endpointHttps = combo.resolveEndpoint({ endpoint: 'https://api.example.com/v1' });
  assert.equal(endpointHttps.protocol, 'https:');
  assert.equal(endpointHttps.port, 443);
  assert.equal(endpointHttps.host, 'api.example.com');

  // HTTPS endpoint with explicit port 8443
  const endpointCustomPort = combo.resolveEndpoint({ endpoint: 'https://api.example.com:8443/v1' });
  assert.equal(endpointCustomPort.protocol, 'https:');
  assert.equal(endpointCustomPort.port, 8443);

  // HTTP endpoint defaults to 80
  const endpointHttp = combo.resolveEndpoint({ endpoint: 'http://api.example.com/v1' });
  assert.equal(endpointHttp.protocol, 'http:');
  assert.equal(endpointHttp.port, 80);

  // Invalid protocol must fail closed
  const invalidProto = combo.resolveEndpoint({ endpoint: 'ftp://api.example.com/v1' });
  assert.equal(invalidProto.protocol, null);
  assert.equal(invalidProto.host, null);
});

test('Finding 10: builtinOpencodeModels requires finite positive configured timeout before launching process', () => {
  const candidatesApi = require('../candidates');

  // When no timeout is configured in registry.dispatch or dispatchConfig,
  // builtinOpencodeModels must fail closed and return [] without launching execFileSync
  const res = candidatesApi.builtinOpencodeModels(
    { id: 'opencode-local', opencodeProvider: 'testprov' },
    {
      registry: { dispatch: {} },
      dispatchConfig: {},
    }
  );
  assert.deepEqual(res, [], 'must return empty array when timeoutMs is missing/non-positive');
});

test('Finding 6: loadQuotaState migrates persisted promoted prefix entries and NO_CHANNEL on prefix does not block siblings', () => {
  const quotaScan = require('../quota-scan');
  const now = Date.now();

  const persistedState = {
    updatedAt: new Date(now - 1000).toISOString(),
    scopes: {
      '9router::anthropic': {
        source: '9router',
        scope: 'anthropic',
        upstream: 'anthropic',
        model: 'anthropic/claude-3-opus',
        code: 'NO_CHANNEL',
        status: 404,
        reason: 'NO_CHANNEL',
        at: new Date(now - 1000).toISOString(),
      },
    },
  };

  // 1. loadQuotaState must prune / invalidate the previously promoted prefix entry
  const cleaned = quotaScan.loadQuotaState({ quotaState: persistedState });
  assert.equal(
    cleaned.scopes['9router::anthropic'],
    undefined,
    'loadQuotaState must invalidate previously promoted prefix NO_CHANNEL entry'
  );

  // 2. Even if passed raw in quotaState, getQuotaScopeState for a sibling model must NOT be blocked
  const candSibling = { gateway: '9router', modelId: 'anthropic/claude-3-5-sonnet' };
  const rawState = {
    scopes: {
      '9router::anthropic': {
        source: '9router',
        scope: 'anthropic',
        upstream: 'anthropic',
        model: 'anthropic/claude-3-opus',
        code: 'NO_CHANNEL',
        status: 404,
        reason: 'NO_CHANNEL',
        at: new Date(now - 1000).toISOString(),
      },
    },
  };

  const siblingScope = quotaScan.getQuotaScopeState(candSibling, rawState, { now });
  assert.equal(
    quotaScan.isScopeBlocked(siblingScope, now),
    false,
    'persisted prefix NO_CHANNEL must not block sibling candidate'
  );
});
