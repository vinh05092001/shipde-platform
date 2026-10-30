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

test('Finding 9 & 12: resolveEndpoint preserves HTTPS protocol and defaults port to 443; httpRequest selects https transport and supports injection', async () => {
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

  // Exercise httpRequest with transport spies: verify HTTPS invokes https transport and never http transport
  function createMockTransport() {
    const calls = [];
    return {
      calls,
      request(options, callback) {
        calls.push(options);
        const req = {
          on() {
            return req;
          },
          write() {},
          end() {
            if (callback) {
              const res = {
                statusCode: 200,
                headers: {},
                on(evt, handler) {
                  if (evt === 'data') handler('{"ok":true}');
                  if (evt === 'end') handler();
                  return res;
                },
              };
              callback(res);
            }
          },
        };
        return req;
      },
    };
  }

  const mockHttp = createMockTransport();
  const mockHttps = createMockTransport();

  const httpsRes = await combo.httpRequest({
    endpoint: 'https://api.example.com/v1',
    path: '/v1/models',
    httpTransport: mockHttp,
    httpsTransport: mockHttps,
  });

  assert.equal(httpsRes.status, 200);
  assert.equal(mockHttps.calls.length, 1, 'HTTPS endpoint must invoke https transport');
  assert.equal(mockHttps.calls[0].protocol, 'https:');
  assert.equal(mockHttps.calls[0].port, 443);
  assert.equal(mockHttps.calls[0].hostname, 'api.example.com');
  assert.equal(mockHttp.calls.length, 0, 'HTTPS endpoint must never invoke HTTP transport');

  // HTTP endpoint must invoke http transport and never https transport
  const httpRes = await combo.httpRequest({
    endpoint: 'http://api.example.com/v1',
    path: '/v1/models',
    httpTransport: mockHttp,
    httpsTransport: mockHttps,
  });

  assert.equal(httpRes.status, 200);
  assert.equal(mockHttp.calls.length, 1, 'HTTP endpoint must invoke http transport');
  assert.equal(mockHttp.calls[0].protocol, 'http:');
  assert.equal(mockHttp.calls[0].port, 80);
  assert.equal(mockHttp.calls[0].hostname, 'api.example.com');
  assert.equal(mockHttps.calls.length, 1, 'HTTP endpoint must not invoke https transport again');

  // Direct transport injection
  const customTransport = createMockTransport();
  await combo.httpRequest({
    endpoint: 'https://api.example.com/v1',
    path: '/v1/models',
    transport: customTransport,
  });
  assert.equal(customTransport.calls.length, 1, 'injected transport must be used directly');
  assert.equal(customTransport.calls[0].protocol, 'https:');
});

test('Finding 10, 11 & 13: builtinOpencodeModels enforces positive deadline, field-level fallback, and prevents process launch on missing deadline', () => {
  const candidatesApi = require('../candidates');

  let launchCount = 0;
  const spyLauncher = () => {
    launchCount++;
    return 'testprov/model-a\ntestprov/model-b\n';
  };

  // 1. Missing deadline: launcher must NEVER be invoked (zero launches)
  launchCount = 0;
  const resMissing = candidatesApi.builtinOpencodeModels(
    { id: 'opencode-local', opencodeProvider: 'testprov' },
    {
      registry: { dispatch: {} },
      dispatchConfig: {},
      listOpencodeModels: spyLauncher,
    }
  );
  assert.deepEqual(resMissing, [], 'must return empty array when deadline is missing');
  assert.equal(launchCount, 0, 'launcher must NEVER be invoked when deadline is missing');

  // 2. Invalid deadlines: launcher must NEVER be invoked
  for (const invalidTimeout of [0, -100, NaN, 'invalid', null]) {
    launchCount = 0;
    const resInvalid = candidatesApi.builtinOpencodeModels(
      { id: 'opencode-local', opencodeProvider: 'testprov' },
      {
        registry: { dispatch: { opencodeModelsTimeoutMs: invalidTimeout } },
        dispatchConfig: {},
        listOpencodeModels: spyLauncher,
      }
    );
    assert.deepEqual(
      resInvalid,
      [],
      `must return empty array for invalid timeout ${invalidTimeout}`
    );
    assert.equal(
      launchCount,
      0,
      `launcher must NEVER be invoked for invalid timeout: ${invalidTimeout}`
    );
  }

  // 3. Positive configured-timeout control: launcher IS invoked and returns models
  launchCount = 0;
  const resPositive = candidatesApi.builtinOpencodeModels(
    { id: 'opencode-local', opencodeProvider: 'testprov' },
    {
      registry: { dispatch: { opencodeModelsTimeoutMs: 5000 } },
      listOpencodeModels: spyLauncher,
    }
  );
  assert.deepEqual(resPositive, ['model-a', 'model-b']);
  assert.equal(
    launchCount,
    1,
    'launcher must be invoked exactly once with positive timeout control'
  );

  // 4. Field-level fallback: registry.dispatch: {} with positive dispatchConfig.opencodeModelsTimeoutMs
  launchCount = 0;
  const resFallback = candidatesApi.builtinOpencodeModels(
    { id: 'opencode-local', opencodeProvider: 'testprov' },
    {
      registry: { dispatch: {} },
      dispatchConfig: { opencodeModelsTimeoutMs: 4000 },
      listOpencodeModels: spyLauncher,
    }
  );
  assert.deepEqual(resFallback, ['model-a', 'model-b']);
  assert.equal(
    launchCount,
    1,
    'field-level fallback to dispatchConfig.opencodeModelsTimeoutMs must invoke launcher'
  );

  // 5. Field-level fallback across modelsTimeoutMs and probeTimeoutMs
  launchCount = 0;
  const resModelsTimeout = candidatesApi.builtinOpencodeModels(
    { id: 'opencode-local', opencodeProvider: 'testprov' },
    {
      registry: { dispatch: {} },
      dispatchConfig: { modelsTimeoutMs: 3000 },
      listOpencodeModels: spyLauncher,
    }
  );
  assert.deepEqual(resModelsTimeout, ['model-a', 'model-b']);
  assert.equal(
    launchCount,
    1,
    'field-level fallback to dispatchConfig.modelsTimeoutMs must invoke launcher'
  );

  launchCount = 0;
  const resProbeTimeout = candidatesApi.builtinOpencodeModels(
    { id: 'opencode-local', opencodeProvider: 'testprov' },
    {
      registry: { dispatch: {} },
      dispatchConfig: { probeTimeoutMs: 2500 },
      listOpencodeModels: spyLauncher,
    }
  );
  assert.deepEqual(resProbeTimeout, ['model-a', 'model-b']);
  assert.equal(
    launchCount,
    1,
    'field-level fallback to dispatchConfig.probeTimeoutMs must invoke launcher'
  );
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
