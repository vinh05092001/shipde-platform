'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const sourcesDoc = require('../sources.json');
const sourcesApi = require('../sources');
const candidates = require('../candidates');
const quotaScan = require('../quota-scan');
const { ADAPTERS } = require('../discovery/adapters');

test('iteracompute source is declared with direct-http harness and dynamic model discovery', () => {
  const src = sourcesDoc.sources.find((s) => s.id === 'iteracompute');
  assert.ok(src, 'iteracompute source must exist in sources.json');
  assert.equal(src.kind, 'model-source');
  assert.equal(src.servesModels, true);
  assert.equal(src.harness, 'direct-http');
  assert.equal(src.accessPath, 'direct');
  assert.equal(src.endpoint, 'https://api.iteracompute.com/v1');
  assert.equal(src.credential?.type, 'api-key');
  assert.equal(src.credential?.env, 'ITERACOMPUTE_API_KEY');
  assert.equal(src.verify?.method, 'models-list');
  assert.equal(src.verify?.path, '/models');
  // Dynamic discovery invariant: no hardcoded model IDs in sources.json
  assert.equal(src.models, undefined, 'sources.json must not hardcode models for iteracompute');
});

test('discovery adapter enumerates models dynamically for iteracompute', async () => {
  const dynamicModelList = ['qwen/qwen3.8-27b', 'gemini/gemini-3.8-flash'];
  let receivedAuth = null;
  let receivedUrl = null;

  const server = http.createServer((req, res) => {
    receivedAuth = req.headers.authorization;
    receivedUrl = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: dynamicModelList.map((id) => ({ id, object: 'model' })),
      })
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const testSource = {
      id: 'iteracompute',
      kind: 'model-source',
      endpoint: `http://127.0.0.1:${port}/v1`,
      credential: { type: 'api-key', env: 'ITERACOMPUTE_API_KEY' },
      verify: { method: 'models-list', path: '/models' },
    };

    const ctx = {
      httpGet: (url, opts) =>
        require('../discovery/http').httpGetModels(url, {
          ...opts,
          env: { ITERACOMPUTE_API_KEY: 'test-secret-key' },
        }),
    };

    const enumFn = ADAPTERS['model-source']();
    const result = await enumFn(testSource, ctx);

    assert.equal(result.status, 'enumerated');
    assert.equal(receivedUrl, '/v1/models');
    assert.equal(receivedAuth, 'Bearer test-secret-key');
    assert.ok(result.catalogs.length > 0);
    assert.deepEqual(result.catalogs[0].models, dynamicModelList);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('candidates are generated with direct-http harness from dynamic discovery', () => {
  const registry = {
    version: 2,
    sources: [
      {
        id: 'iteracompute',
        kind: 'model-source',
        servesModels: true,
        harness: 'direct-http',
        accessPath: 'direct',
        endpoint: 'https://api.iteracompute.com/v1',
        credential: { type: 'api-key', env: 'ITERACOMPUTE_API_KEY' },
      },
    ],
    dispatch: {},
    retired: [],
  };

  const dynamicModels = ['qwen/qwen3.8-27b'];
  const generated = candidates.generateCandidates({
    registry,
    catalogue: dynamicModels,
    accounts: [{ id: 'iteracompute-acc', sourceId: 'iteracompute', models: dynamicModels }],
  });

  const c = generated.find(
    (x) => x.sourceId === 'iteracompute' && x.modelId === 'qwen/qwen3.8-27b'
  );
  assert.ok(c, 'candidate must be generated for iteracompute');
  assert.equal(c.harness, 'direct-http');
  assert.equal(c.accessPath, 'direct');
  assert.equal(c.upstream, 'iteracompute');
});

test('quota scope state distinguishes alive completion from blocked quota on iteracompute', () => {
  const mockQuotaState = {
    scopes: {
      iteracompute: {
        source: 'iteracompute',
        scope: 'iteracompute',
        code: 'OK',
        status: 200,
        model: 'qwen/qwen3.8-27b',
      },
      'iteracompute::qwen/qwen3.8-27b': {
        source: 'iteracompute',
        scope: 'qwen/qwen3.8-27b',
        code: 'OK',
        status: 200,
      },
      'iteracompute::minimax/minimax-m2.5': {
        source: 'iteracompute',
        scope: 'minimax/minimax-m2.5',
        code: 'QUOTA',
        status: 429,
      },
    },
  };

  const okState = quotaScan.getQuotaScopeState(
    { sourceId: 'iteracompute', modelId: 'qwen/qwen3.8-27b' },
    mockQuotaState
  );
  assert.equal(okState?.code, 'OK');
  assert.equal(quotaScan.isScopeBlocked(okState), false);

  const blockedState = quotaScan.getQuotaScopeState(
    { sourceId: 'iteracompute', modelId: 'minimax/minimax-m2.5' },
    mockQuotaState
  );
  assert.equal(blockedState?.code, 'QUOTA');
  assert.equal(quotaScan.isScopeBlocked(blockedState), true);
});
