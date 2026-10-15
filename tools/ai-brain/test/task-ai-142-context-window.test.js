'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { modelMeta, probeSource } = require('../source-discovery');
const sourcesApi = require('../sources');
const intakeApi = require('../intake');
const candidatesApi = require('../candidates');
const cliApi = require('../cli');
const harnessApi = require('../harness');

test('TASK-AI-142: modelMeta extracts contextWindow and maxOutputTokens from /models body', () => {
  const fakeBody = {
    data: [
      {
        id: 'kr/gemini-2.5-pro',
        context_length: 128000,
        max_completion_tokens: 8192,
      },
      {
        id: 'kr/claude-3-5-sonnet',
        context_window: 200000,
        max_completion_tokens: 4096,
      },
      {
        id: 'kr/deepseek-v3',
        max_context_length: 64000,
      },
      {
        id: 'kr/string-int-model',
        context_length: '32768',
        max_completion_tokens: '2048',
      },
      {
        id: 'kr/model-no-context',
      },
      {
        id: 'kr/model-negative-context',
        context_length: -100,
      },
      {
        id: 'kr/model-zero-context',
        context_length: 0,
      },
      {
        id: 'kr/model-float-context',
        context_length: 128000.5,
      },
      {
        id: 'kr/model-string-invalid-context',
        context_length: 'not-a-number',
      },
      {
        id: 'kr/model-bool-context',
        context_length: true,
      },
      {
        id: 'kr/model-array-context',
        context_length: [128000],
      },
    ],
  };

  const meta = modelMeta(fakeBody);

  assert.equal(meta['kr/gemini-2.5-pro'].contextWindow, 128000);
  assert.equal(meta['kr/gemini-2.5-pro'].maxOutputTokens, 8192);
  assert.equal(meta['kr/gemini-2.5-pro'].contextSource, 'provider-models-endpoint');

  assert.equal(meta['kr/claude-3-5-sonnet'].contextWindow, 200000);
  assert.equal(meta['kr/claude-3-5-sonnet'].maxOutputTokens, 4096);
  assert.equal(meta['kr/claude-3-5-sonnet'].contextSource, 'provider-models-endpoint');

  assert.equal(meta['kr/deepseek-v3'].contextWindow, 64000);
  assert.equal(meta['kr/deepseek-v3'].maxOutputTokens, undefined);

  assert.equal(meta['kr/string-int-model'].contextWindow, 32768);
  assert.equal(meta['kr/string-int-model'].maxOutputTokens, 2048);

  assert.equal(meta['kr/model-no-context'].contextWindow, undefined);
  assert.equal(meta['kr/model-negative-context'].contextWindow, undefined);
  assert.equal(meta['kr/model-zero-context'].contextWindow, undefined);
  assert.equal(meta['kr/model-float-context'].contextWindow, undefined);
  assert.equal(meta['kr/model-string-invalid-context'].contextWindow, undefined);
  assert.equal(meta['kr/model-bool-context'].contextWindow, undefined);
  assert.equal(meta['kr/model-array-context'].contextWindow, undefined);
});

test('TASK-AI-142: probeSource retains modelMeta parallel to models array', async () => {
  const fakeBody = {
    data: [
      { id: 'kr/gemini-2.5-pro', context_length: 128000, max_completion_tokens: 8192 },
      { id: 'kr/unverified-model' },
    ],
  };

  const source = {
    id: '9router',
    name: '9Router',
    endpoint: 'http://127.0.0.1:20128/v1',
    models: [],
    credential: { type: 'env', name: 'NINEROUTER_API_KEY' },
  };

  const probed = await probeSource(source, {
    env: { NINEROUTER_API_KEY: 'test-key' },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => fakeBody,
    }),
  });

  assert.equal(probed.status, 'available');
  assert.deepEqual(probed.models, ['kr/gemini-2.5-pro', 'kr/unverified-model']);
  assert.ok(probed.modelMeta);
  assert.equal(probed.modelMeta['kr/gemini-2.5-pro'].contextWindow, 128000);
  assert.equal(probed.modelMeta['kr/gemini-2.5-pro'].maxOutputTokens, 8192);
  assert.equal(probed.modelMeta['kr/unverified-model'].contextWindow, undefined);
});

test('TASK-AI-142: intake buildCatalogue carries modelMeta from sources into catalogue', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-cat-meta-'));
  const sourcesDir = path.join(root, 'tools', 'ai-brain', 'data');
  fs.mkdirSync(sourcesDir, { recursive: true });

  fs.writeFileSync(
    path.join(sourcesDir, 'sources.json'),
    JSON.stringify(
      {
        version: 1,
        sources: [
          {
            id: 'discovered-provider',
            endpoint: 'http://127.0.0.1:9999/v1',
            status: 'available',
            credential: { type: 'env', name: 'DISCOVERED_API_KEY' },
            models: ['dp/model-with-context', 'dp/model-without-context'],
            modelMeta: {
              'dp/model-with-context': {
                contextWindow: 65536,
                maxOutputTokens: 4096,
                contextSource: 'provider-models-endpoint',
              },
              'dp/model-without-context': {
                contextWindow: undefined,
                contextSource: 'provider-models-endpoint',
              },
            },
          },
        ],
      },
      null,
      2
    )
  );

  const cat = await intakeApi.buildCatalogue({
    root,
    read9routerModels: async () => ({
      ok: true,
      models: ['kr/gemini-2.5-pro', 'kr/unverified'],
      modelMeta: {
        'kr/gemini-2.5-pro': {
          contextWindow: 128000,
          maxOutputTokens: 8192,
          contextSource: 'provider-models-endpoint',
        },
        'kr/unverified': {
          contextWindow: undefined,
          contextSource: 'provider-models-endpoint',
        },
      },
    }),
    readAgyModels: async () => ({ ok: true, models: [] }),
    readEvidenceModels: async () => ({ ok: true, models: [] }),
  });

  assert.ok(Array.isArray(cat.models));
  assert.ok(cat.models.includes('kr/gemini-2.5-pro'));
  assert.ok(cat.models.includes('dp/model-with-context'));

  assert.ok(cat.modelMeta);
  assert.equal(cat.modelMeta['kr/gemini-2.5-pro'].contextWindow, 128000);
  assert.equal(cat.modelMeta['dp/model-with-context'].contextWindow, 65536);
  assert.equal(cat.modelMeta['kr/unverified'].contextWindow, undefined);

  assert.ok(Array.isArray(cat.candidates));
  const candWithCtx = cat.candidates.find((c) => c.modelId === 'kr/gemini-2.5-pro');
  assert.ok(candWithCtx);
  assert.equal(candWithCtx.contextWindow, 128000);

  const candNoCtx = cat.candidates.find((c) => c.modelId === 'kr/unverified');
  assert.ok(candNoCtx);
  assert.equal(candNoCtx.contextWindow, undefined);

  fs.rmSync(root, { recursive: true, force: true });
});

test('TASK-AI-142: gatewayAccountCandidates carries contextWindow from catalogue or modelMeta', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: '9router',
        kind: 'router',
        endpoint: 'http://127.0.0.1:20128/v1',
        accessPath: 'http://127.0.0.1:20128/v1',
        servesModels: true,
        modelMeta: {
          'kr/gemini-2.5-pro': {
            contextWindow: 128000,
            maxOutputTokens: 8192,
            contextSource: 'provider-models-endpoint',
          },
        },
      },
      {
        id: 'kr',
        kind: 'model-source',
        reachedVia: '9router',
        servesModels: true,
      },
    ],
    dispatch: {
      providers: {
        kr: { harness: 'hermes' },
      },
    },
  };

  const accounts = [{ id: 'acc-1', provider: 'kr', enabled: true }];
  const catalogue = [
    {
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/gemini-2.5-pro',
      contextWindow: 128000,
    },
    {
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/unverified-model',
    },
  ];

  const cands = candidatesApi.gatewayAccountCandidates({
    registry: fakeRegistry,
    accounts,
    catalogue,
  });

  const verified = cands.find((c) => c.modelId === 'kr/gemini-2.5-pro');
  assert.ok(verified, 'kr/gemini-2.5-pro must be generated');
  assert.equal(verified.contextWindow, 128000);
  assert.equal(verified.capabilities.contextWindow, 128000);

  const unverified = cands.find((c) => c.modelId === 'kr/unverified-model');
  assert.ok(unverified, 'kr/unverified-model must be generated');
  assert.equal(unverified.contextWindow, undefined);
});

test('TASK-AI-142: assembleForDispatch propagates contextWindow and keeps unverified models undefined', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        modelMeta: {
          'kr/gemini-2.5-pro': {
            contextWindow: 128000,
            maxOutputTokens: 8192,
            contextSource: 'provider-models-endpoint',
          },
          'kr/small-context': {
            contextWindow: 16000,
            contextSource: 'provider-models-endpoint',
          },
          'kr/no-context-model': {
            contextWindow: undefined,
            contextSource: 'provider-models-endpoint',
          },
        },
      },
      {
        id: 'kr',
        kind: 'model-source',
        reachedVia: '9router',
        servesModels: true,
      },
    ],
    dispatch: {
      providers: {
        kr: { harness: 'hermes' },
      },
    },
  };

  const accounts = [{ id: 'acc-1', provider: 'kr', enabled: true }];
  const discoveryCat = {
    candidates: [
      {
        gateway: '9router',
        upstream: 'kr',
        accountId: 'acc-1',
        modelId: 'kr/gemini-2.5-pro',
        base: 'gemini-2.5-pro',
      },
      {
        gateway: '9router',
        upstream: 'kr',
        accountId: 'acc-1',
        modelId: 'kr/small-context',
        base: 'small-context',
      },
      {
        gateway: '9router',
        upstream: 'kr',
        accountId: 'acc-1',
        modelId: 'kr/no-context-model',
        base: 'no-context-model',
      },
    ],
  };

  const candidates = cliApi.assembleForDispatch(discoveryCat, accounts, fakeRegistry, {
    requireRouteHealth: false,
    allowUnprobedCandidates: true,
  });

  const verified = candidates.find((c) => c.modelId === 'kr/gemini-2.5-pro');
  assert.ok(verified, 'Verified model candidate must exist');
  assert.equal(verified.contextWindow, 128000);
  assert.equal(harnessApi.contextRefusal('hermes', verified.contextWindow), null);

  const small = candidates.find((c) => c.modelId === 'kr/small-context');
  assert.ok(small, 'Small context model must exist');
  assert.equal(small.contextWindow, 16000);
  assert.ok(harnessApi.contextRefusal('hermes', small.contextWindow).includes('CONTEXT_TOO_SMALL'));

  const unverified = candidates.find((c) => c.modelId === 'kr/no-context-model');
  assert.ok(unverified, 'Unverified model candidate must exist');
  assert.equal(unverified.contextWindow, undefined);
  assert.ok(
    harnessApi
      .contextRefusal('hermes', unverified.contextWindow)
      .includes('CONTEXT_WINDOW_UNVERIFIED')
  );
});

test('TASK-AI-142: sources.js does not widen configured model list on id collision, only attaches modelMeta', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-collision-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const staticSourcesFile = path.join(dataDir, 'static-sources.json');
  const discoveredFile = path.join(dataDir, 'discovered-sources.json');

  fs.writeFileSync(
    staticSourcesFile,
    JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'configured-provider',
          kind: 'model-source',
          endpoint: 'http://127.0.0.1:8000/v1',
          models: ['model-a'],
          modelMeta: { 'model-a': { contextWindow: 32000 } },
        },
      ],
    })
  );

  fs.writeFileSync(
    discoveredFile,
    JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'configured-provider',
          kind: 'model-source',
          endpoint: 'http://127.0.0.1:8000/v1',
          models: ['model-a', 'unroutable-discovered-model-b'],
          modelMeta: {
            'model-a': { contextWindow: 32000 },
            'unroutable-discovered-model-b': { contextWindow: 64000 },
          },
        },
      ],
    })
  );

  const res = sourcesApi.loadSources({
    file: staticSourcesFile,
    discoveredFile,
  });

  const src = res.sources.find((s) => s.id === 'configured-provider');
  assert.ok(src);
  // Must NOT widen configured models array!
  assert.deepEqual(src.models, ['model-a']);
  // But attaches modelMeta:
  assert.equal(src.modelMeta['unroutable-discovered-model-b']?.contextWindow, 64000);

  fs.rmSync(root, { recursive: true, force: true });
});

test('TASK-AI-142: poolAccountCandidates does not match foreign catalogue row sharing base', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'agy-pool',
        kind: 'agent-cli',
        capabilities: {},
      },
    ],
  };

  const catalogue = [
    {
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/claude-3-5-sonnet',
      base: 'claude-3-5-sonnet',
      capabilities: { foreignCapability: true },
      contextWindow: 200000,
    },
  ];

  const poolCandidates = candidatesApi.poolAccountCandidates({
    registry: fakeRegistry,
    catalogue,
    accounts: [
      {
        id: 'agy01',
        provider: 'antigravity',
        models: ['claude-3-5-sonnet'],
        enabled: true,
      },
    ],
    discoverPool: false,
    models: ['claude-3-5-sonnet'],
    allowUnprobedCandidates: true,
  });

  const cand = poolCandidates.find((c) => c.modelId === 'claude-3-5-sonnet');
  assert.ok(cand, 'Pool candidate must exist');
  // Foreign row from kr must NOT supply capabilities or contextWindow!
  assert.equal(cand.capabilities.foreignCapability, undefined);
  assert.equal(cand.contextWindow, undefined);
  assert.equal(cand.capabilities.contextWindow, undefined);
});

test('TASK-AI-142: resolveModelContextMeta does not inherit contextWindow across sources, prefixes, or base', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: '9router',
        kind: 'router',
        modelMeta: {
          'kr/gemini-2.5-pro': {
            contextWindow: undefined,
          },
        },
      },
      {
        id: 'other-source',
        kind: 'model-source',
        modelMeta: {
          'kr/gemini-2.5-pro': {
            contextWindow: 128000,
          },
          'gemini-2.5-pro': {
            contextWindow: 128000,
          },
          'ag/gemini-2.5-pro': {
            contextWindow: 128000,
          },
        },
      },
    ],
  };

  const discoveryCat = {
    candidates: [
      {
        gateway: '9router',
        upstream: 'kr',
        accountId: 'acc-1',
        modelId: 'kr/gemini-2.5-pro',
        base: 'gemini-2.5-pro',
      },
    ],
  };

  const candidates = cliApi.assembleForDispatch(
    discoveryCat,
    [{ id: 'acc-1', provider: 'kr', enabled: true }],
    fakeRegistry,
    {
      requireRouteHealth: false,
      allowUnprobedCandidates: true,
    }
  );

  const cand = candidates.find((c) => c.modelId === 'kr/gemini-2.5-pro');
  assert.ok(cand);
  // Must NOT inherit other-source's contextWindow!
  assert.equal(cand.contextWindow, undefined);
  assert.equal(cand.capabilities?.contextWindow, undefined);
});

test('TASK-AI-142: gatewayAccountCandidates rejects non-positive integer contextWindow (0, negative, float, string)', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: '9router',
        kind: 'router',
        endpoint: 'http://127.0.0.1:20128/v1',
        accessPath: 'http://127.0.0.1:20128/v1',
        servesModels: true,
        modelMeta: {
          'kr/zero-ctx': { contextWindow: 0 },
          'kr/neg-ctx': { contextWindow: -500 },
          'kr/float-ctx': { contextWindow: 128000.5 },
          'kr/str-ctx': { contextWindow: 'not-an-int' },
        },
      },
      {
        id: 'kr',
        kind: 'model-source',
        reachedVia: '9router',
        servesModels: true,
      },
    ],
    dispatch: {
      providers: {
        kr: { harness: 'hermes' },
      },
    },
  };

  const accounts = [{ id: 'acc-1', provider: 'kr', enabled: true }];
  const catalogue = [
    { gateway: '9router', upstream: 'kr', modelId: 'kr/zero-ctx', contextWindow: 0 },
    { gateway: '9router', upstream: 'kr', modelId: 'kr/neg-ctx', contextWindow: -500 },
    { gateway: '9router', upstream: 'kr', modelId: 'kr/float-ctx', contextWindow: 128000.5 },
    { gateway: '9router', upstream: 'kr', modelId: 'kr/str-ctx', contextWindow: 'not-an-int' },
  ];

  const cands = candidatesApi.gatewayAccountCandidates({
    registry: fakeRegistry,
    accounts,
    catalogue,
  });

  for (const modelId of ['kr/zero-ctx', 'kr/neg-ctx', 'kr/float-ctx', 'kr/str-ctx']) {
    const c = cands.find((x) => x.modelId === modelId);
    assert.ok(c, `${modelId} candidate must exist`);
    assert.equal(c.contextWindow, undefined, `${modelId} contextWindow must be undefined`);
    assert.equal(
      c.capabilities.contextWindow,
      undefined,
      `${modelId} capabilities.contextWindow must be undefined`
    );
  }
});

test('TASK-AI-142: assembleForDispatch does not mutate caller catalogue rows in place', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: '9router',
        kind: 'router',
        modelMeta: {
          'kr/gemini-2.5-pro': { contextWindow: 128000 },
        },
      },
    ],
  };

  const callerCatalogueRow = {
    gateway: '9router',
    upstream: 'kr',
    accountId: 'acc-1',
    modelId: 'kr/gemini-2.5-pro',
  };

  const discoveryCat = {
    candidates: [callerCatalogueRow],
  };

  const candidates = cliApi.assembleForDispatch(
    discoveryCat,
    [{ id: 'acc-1', provider: 'kr', enabled: true }],
    fakeRegistry,
    {
      requireRouteHealth: false,
      allowUnprobedCandidates: true,
    }
  );

  const cand = candidates.find((c) => c.modelId === 'kr/gemini-2.5-pro');
  assert.ok(cand);
  assert.equal(cand.contextWindow, 128000);

  // Caller input row must NOT be mutated!
  assert.equal(callerCatalogueRow.contextWindow, undefined);
  assert.equal(callerCatalogueRow.capabilities, undefined);
});

test('TASK-AI-142: live context refresh is source-scoped and feeds Hermes selection', async () => {
  const hermes = require('../hermes-session');
  const registry = {
    sources: [
      { id: 'router-a', endpoint: 'http://127.0.0.1:40128/v1', modelMeta: {} },
      { id: 'router-b', endpoint: 'http://127.0.0.1:40129/v1', models: [], modelMeta: {} },
    ],
  };
  const refreshed = await hermes.refreshReasoningContext(
    {},
    {
      registry,
      fetchModels: async (url) => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'cbai/deepseek-v4.1-flash',
              ...(url.includes(':40128/') ? { context_length: 1000000 } : {}),
            },
          ],
        }),
      }),
    }
  );
  const candidate = {
    sourceId: 'router-a',
    accessPath: registry.sources[0].endpoint,
    gateway: '9router',
    upstream: 'cbai',
    accountId: 'a',
    quotaScope: 'a',
    modelId: 'cbai/deepseek-v4.1-flash',
    harness: 'hermes',
  };
  assert.equal(
    candidatesApi.resolveCandidateContextMeta(candidate, refreshed.registry).contextWindow,
    1000000
  );
  assert.equal(
    candidatesApi.resolveCandidateContextMeta(
      { ...candidate, sourceId: 'router-b' },
      refreshed.registry
    ),
    null
  );
  assert.deepEqual(registry.sources[0].modelMeta, {}, 'refresh must not mutate registry');
  let observed;
  hermes.selectReasoningCandidate(
    { skipDecisionLog: true },
    {
      ...refreshed,
      candidates: [candidate],
      priorsData: { ranking: [] },
      candidatesApi: {
        ...candidatesApi,
        annotateCandidates: (rows) => {
          observed = rows;
          return [];
        },
      },
    }
  );
  assert.equal(observed[0].contextWindow, 1000000);
  const offline = await hermes.refreshReasoningContext(
    {},
    {
      registry: refreshed.registry,
      fetchModels: async () => {
        throw new Error('offline');
      },
    }
  );
  assert.equal(
    candidatesApi.resolveCandidateContextMeta(candidate, offline.registry).contextWindow,
    1000000
  );
  assert.equal(
    candidatesApi.resolveCandidateContextMeta(
      { ...candidate, sourceId: 'router-b' },
      offline.registry
    ),
    null
  );
});

test('TASK-AI-142: 9router and compatible sources refresh nested context without inventing metadata', async () => {
  const { refreshReasoningContext } = require('../hermes-session');
  const sources = ['9router', 'other-compatible'].map((id, i) => ({
    id,
    endpoint: `http://127.0.0.1:${40128 + i}/v1`,
    servesModels: true,
  }));
  const result = await refreshReasoningContext(
    {},
    {
      registry: { sources },
      fetchModels: async () => ({
        ok: true,
        json: async () => ({
          data: [
            { id: 'nested', capabilities: { contextWindow: 1048576 } },
            { id: 'flat', context_length: 1000000 },
            { id: 'invalid', capabilities: { contextWindow: -1 } },
            { id: 'missing' },
          ],
        }),
      }),
    }
  );
  for (const source of result.registry.sources) {
    assert.equal(source.modelMeta.nested.contextWindow, 1048576);
    assert.equal(source.modelMeta.flat.contextWindow, 1000000);
    assert.equal(source.modelMeta.invalid.contextWindow, undefined);
    assert.equal(source.modelMeta.missing.contextWindow, undefined);
  }
});

test('TASK-AI-142: openai-codex context window takes conservative minimum of codex and provider evidence', () => {
  const hermes = require('../hermes-session');

  // (a) codex source 400000 + same-model provider 200000 -> 200000
  const registryA = {
    sources: [
      {
        id: 'openai-codex',
        modelMeta: {
          'gpt-6.1-sol': { contextWindow: 400000 },
        },
      },
      {
        id: 'provider-1',
        modelMeta: {
          'kr/gpt-6.1-sol': { contextWindow: 200000 },
        },
      },
    ],
  };
  const cwA = hermes.resolveHermesContextWindow(
    'gpt-6.1-sol',
    { provider: 'openai-codex' },
    { registry: registryA }
  );
  assert.equal(cwA, 200000);
  assert.equal(harnessApi.contextRefusal('hermes', cwA), null);

  // (b) codex source invalid ('abc') + provider 128000 -> 128000
  const registryB = {
    sources: [
      {
        id: 'openai-codex',
        modelMeta: {
          'gpt-6.1-sol': { contextWindow: 'abc' },
        },
      },
      {
        id: 'provider-1',
        modelMeta: {
          'kr/gpt-6.1-sol': { contextWindow: 128000 },
        },
      },
    ],
  };
  const cwB = hermes.resolveHermesContextWindow(
    'gpt-6.1-sol',
    { provider: 'openai-codex' },
    { registry: registryB }
  );
  assert.equal(cwB, 128000);
  assert.equal(harnessApi.contextRefusal('hermes', cwB), null);

  // (c) all invalid -> refused
  const registryC = {
    sources: [
      {
        id: 'openai-codex',
        modelMeta: {
          'gpt-6.1-sol': { contextWindow: 'abc' },
        },
      },
      {
        id: 'provider-1',
        modelMeta: {
          'kr/gpt-6.1-sol': { contextWindow: -500 },
        },
      },
    ],
  };
  const cwC = hermes.resolveHermesContextWindow(
    'gpt-6.1-sol',
    { provider: 'openai-codex' },
    { registry: registryC }
  );
  assert.equal(cwC, undefined);
  const refusal = harnessApi.contextRefusal('hermes', cwC);
  assert.ok(refusal && refusal.includes('CONTEXT_WINDOW_UNVERIFIED'));

  const candidate = {
    harness: 'hermes',
    accessPath: 'openai-codex',
    gateway: 'openai-codex',
    provider: 'openai-codex',
    modelId: 'gpt-6.1-sol',
    contextWindow: cwC,
  };
  const selection = hermes.selectReasoningCandidate(
    { skipDecisionLog: true, includeOpenAiCodex: true },
    {
      candidateList: [candidate],
      registry: registryC,
      priorsData: { ranking: [] },
    }
  );
  assert.equal(selection.chosen, null);
  assert.equal(selection.refused, 'NO_REASONING_CANDIDATE');
  assert.ok(selection.reason.includes('CONTEXT_WINDOW_UNVERIFIED'));
});
