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
