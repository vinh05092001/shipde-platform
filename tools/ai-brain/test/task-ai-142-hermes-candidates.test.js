'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const candidatesApi = require('../candidates');
const cliApi = require('../cli');
const hermesSessionApi = require('../hermes-session');
const harnessApi = require('../harness');

test('TASK-AI-142 H3: router source with modelMeta yields hermes candidates with contextWindow from that source', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'opencode-provider-mock-router-options',
        kind: 'model-source',
        endpoint: 'http://127.0.0.1:40128/v1',
        credential: { type: 'env', name: 'ROUTER_API_KEY' },
        gateway: 'mock-router',
        modelMeta: {
          'kimchi/glm-5.3-flash': {
            contextWindow: 1048576,
            maxOutputTokens: 131072,
            contextSource: 'provider-models-endpoint',
          },
          'kimchi/kimi-k3': {
            contextWindow: 262144,
            maxOutputTokens: 60000,
            contextSource: 'provider-models-endpoint',
          },
        },
      },
    ],
  };

  const candidates = candidatesApi.generateCandidates({
    harness: 'hermes',
    registry: fakeRegistry,
  });

  assert.equal(candidates.length, 2, 'Must yield exactly 2 candidates without duplicates');

  const flash = candidates.find((c) => c.modelId === 'kimchi/glm-5.3-flash');
  assert.ok(flash, 'Candidate for kimchi/glm-5.3-flash must exist');
  assert.equal(flash.harness, 'hermes');
  assert.equal(flash.gateway, 'mock-router');
  assert.equal(flash.accessPath, 'http://127.0.0.1:40128/v1');
  assert.equal(flash.sourceId, 'opencode-provider-mock-router-options');
  assert.equal(flash.accountId, 'opencode-provider-mock-router-options');
  assert.notEqual(flash.accountId, '*');
  assert.equal(flash.contextWindow, 1048576);
  assert.equal(flash.maxOutputTokens, 131072);
  assert.equal(flash.capabilities.contextWindow, 1048576);

  const k3 = candidates.find((c) => c.modelId === 'kimchi/kimi-k3');
  assert.ok(k3, 'Candidate for kimchi/kimi-k3 must exist');
  assert.equal(k3.harness, 'hermes');
  assert.equal(k3.gateway, 'mock-router');
  assert.equal(k3.accountId, 'opencode-provider-mock-router-options');
  assert.notEqual(k3.accountId, '*');
  assert.equal(k3.contextWindow, 262144);
  assert.equal(k3.maxOutputTokens, 60000);
});

test('TASK-AI-142 H3: source without meta stays CONTEXT_WINDOW_UNVERIFIED', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'opencode-provider-tokenharbor-options',
        kind: 'model-source',
        endpoint: 'https://tokenharbor.ai/v1',
        credential: { type: 'env', name: 'TOKENHARBOR_API_KEY' },
        models: ['thb/unverified-model'],
      },
    ],
  };

  const candidates = candidatesApi.generateCandidates({
    harness: 'hermes',
    registry: fakeRegistry,
  });

  const cand = candidates.find((c) => c.modelId === 'thb/unverified-model');
  assert.ok(cand, 'Candidate must exist');
  assert.equal(cand.contextWindow, undefined);

  // In hermes gate, undefined contextWindow refuses as CONTEXT_WINDOW_UNVERIFIED
  const refusal = harnessApi.contextRefusal('hermes', cand.contextWindow);
  assert.ok(refusal, 'Refusal must be returned');
  assert.match(refusal, /CONTEXT_WINDOW_UNVERIFIED/);

  // When selected in selectReasoningCandidate, it is rejected for CONTEXT_WINDOW_UNVERIFIED
  const selection = hermesSessionApi.selectReasoningCandidate(
    { skipDecisionLog: true },
    {
      candidates: [cand],
      registry: fakeRegistry,
      priorsData: { ranking: [] },
    }
  );
  assert.equal(selection.chosen, null);
  assert.equal(selection.refused, 'NO_REASONING_CANDIDATE');
  assert.ok(
    selection.reason.includes('CONTEXT_WINDOW_UNVERIFIED'),
    `Reason must mention CONTEXT_WINDOW_UNVERIFIED: ${selection.reason}`
  );
});

test('TASK-AI-142 H3: model in source A never gets context from source B', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'opencode-provider-source-a',
        kind: 'model-source',
        endpoint: 'https://api.source-a.com/v1',
        credential: { type: 'env', name: 'SOURCE_A_KEY' },
        models: ['shared/model-x'],
      },
      {
        id: 'opencode-provider-source-b',
        kind: 'model-source',
        endpoint: 'https://api.source-b.com/v1',
        credential: { type: 'env', name: 'SOURCE_B_KEY' },
        models: ['shared/model-x'],
        modelMeta: {
          'shared/model-x': {
            contextWindow: 65536,
            maxOutputTokens: 4096,
            contextSource: 'provider-models-endpoint',
          },
        },
      },
    ],
  };

  const candidates = candidatesApi.generateCandidates({
    harness: 'hermes',
    registry: fakeRegistry,
  });

  const candA = candidates.find(
    (c) => c.modelId === 'shared/model-x' && c.sourceId === 'opencode-provider-source-a'
  );
  const candB = candidates.find(
    (c) => c.modelId === 'shared/model-x' && c.sourceId === 'opencode-provider-source-b'
  );

  assert.ok(candA, 'Source A candidate must exist');
  assert.ok(candB, 'Source B candidate must exist');

  // Source A candidate must NOT inherit context from Source B
  assert.equal(candA.contextWindow, undefined);
  assert.equal(candA.sourceId, 'opencode-provider-source-a');

  // Source B candidate has its own context window
  assert.equal(candB.contextWindow, 65536);
  assert.equal(candB.maxOutputTokens, 4096);
  assert.equal(candB.sourceId, 'opencode-provider-source-b');

  // Resolving context for candidate A against registry returns null, never source B's meta
  const metaA = candidatesApi.resolveCandidateContextMeta(candA, fakeRegistry);
  assert.equal(metaA, null);

  const metaB = candidatesApi.resolveCandidateContextMeta(candB, fakeRegistry);
  assert.ok(metaB);
  assert.equal(metaB.contextWindow, 65536);
});

test('TASK-AI-142 H3: OpenAI-compatible sources (Cohere, TokenHarbor, B.AI, llmtr) yield hermes candidates with endpoints and env keys', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'opencode-provider-cohere-options',
        kind: 'model-source',
        endpoint: 'https://api.cohere.ai/compatibility/v1',
        credential: { type: 'env', name: 'COHERE_API_KEY' },
        modelMeta: {
          'c4ai-aya-expanse-32b': { contextWindow: 128000 },
        },
      },
      {
        id: 'opencode-provider-bai1-options',
        kind: 'model-source',
        endpoint: 'https://api.b.ai/v1',
        credential: { type: 'env', name: 'BAI_API_KEY' },
        modelMeta: {
          'bai/deepseek-v3': { contextWindow: 64000 },
        },
      },
      {
        id: 'llmtr',
        kind: 'model-source',
        endpoint: 'https://llmtr.com/v1',
        credential: { type: 'env', name: 'LLMTR_API_KEY' },
        modelMeta: {
          'llmtr/qwen-2.5-72b': { contextWindow: 32768 },
        },
      },
    ],
  };

  const candidates = candidatesApi.openAiCompatibleCandidates({
    registry: fakeRegistry,
    harness: 'hermes',
  });

  const cohere = candidates.find((c) => c.modelId === 'c4ai-aya-expanse-32b');
  assert.ok(cohere);
  assert.equal(cohere.contextWindow, 128000);
  assert.equal(cohere.accessPath, 'https://api.cohere.ai/compatibility/v1');

  const bai = candidates.find((c) => c.modelId === 'bai/deepseek-v3');
  assert.ok(bai);
  assert.equal(bai.contextWindow, 64000);
  assert.equal(bai.accessPath, 'https://api.b.ai/v1');

  const llmtr = candidates.find((c) => c.modelId === 'llmtr/qwen-2.5-72b');
  assert.ok(llmtr);
  assert.equal(llmtr.contextWindow, 32768);
  assert.equal(llmtr.accessPath, 'https://llmtr.com/v1');
});

test('TASK-AI-142 H3: assembleCandidates and assembleForDispatch dedupe hermes candidates and keep verified contextWindow', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'opencode-provider-source-x',
        kind: 'model-source',
        endpoint: 'https://api.source-x.com/v1',
        credential: { type: 'env', name: 'SOURCE_X_KEY' },
        modelMeta: {
          'provider-x/model-1': {
            contextWindow: 131072,
            maxOutputTokens: 8192,
            contextSource: 'provider-models-endpoint',
          },
        },
      },
    ],
  };

  const generated = candidatesApi.generateCandidates({
    harness: 'hermes',
    registry: fakeRegistry,
  });

  // Exactly 1 candidate emitted
  assert.equal(generated.length, 1);
  assert.equal(generated[0].contextWindow, 131072);
  assert.equal(generated[0].accountId, 'opencode-provider-source-x');

  // assembleCandidates with this gateway candidate
  const assembled = cliApi.assembleCandidates(null, [], fakeRegistry, [], null, generated);

  assert.equal(assembled.length, 1, 'assembleCandidates must deduplicate to 1 entry');
  assert.equal(assembled[0].contextWindow, 131072, 'Must carry verified contextWindow');
  assert.equal(assembled[0].capabilities?.contextWindow, 131072);

  // assembleForDispatch for hermes
  const dispatched = cliApi.assembleForDispatch({ candidates: [] }, [], fakeRegistry, {
    harness: 'hermes',
    requireRouteHealth: false,
    allowUnprobedCandidates: true,
  });

  const matched = dispatched.filter((c) => c.modelId === 'provider-x/model-1');
  assert.equal(matched.length, 1, 'Dispatched pool must contain exactly 1 entry for this model');
  assert.equal(matched[0].contextWindow, 131072, 'Dispatched candidate retains verified window');
});

test('TASK-AI-142 H3: assembleCandidates keeps source-bound miss unverified (no cross-source fallback)', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'source-unverified',
        kind: 'model-source',
        endpoint: 'https://api.unverified.com/v1',
        credential: { type: 'env', name: 'UNVERIFIED_KEY' },
        models: ['shared/common-model'],
      },
      {
        id: 'source-with-meta',
        kind: 'model-source',
        endpoint: 'https://api.meta.com/v1',
        credential: { type: 'env', name: 'META_KEY' },
        models: ['shared/common-model'],
        modelMeta: {
          'shared/common-model': {
            contextWindow: 65536,
          },
        },
      },
    ],
  };

  const discoveryCat = {
    candidates: [
      {
        sourceId: 'source-unverified',
        sourceEndpoint: 'https://api.unverified.com/v1',
        modelId: 'shared/common-model',
        harness: 'hermes',
      },
    ],
  };

  const assembled = cliApi.assembleCandidates(discoveryCat, [], fakeRegistry, [], null, []);

  const cand = assembled.find((c) => c.sourceId === 'source-unverified');
  assert.ok(cand, 'Candidate for source-unverified must exist');
  // It must NOT borrow source-with-meta's contextWindow!
  assert.equal(cand.contextWindow, undefined, 'Source-bound miss must stay undefined');
  assert.equal(cand.capabilities?.contextWindow, undefined);
});

test('TASK-AI-142 H3: hermes candidates never receive accountId "*"', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'unbound-source',
        kind: 'model-source',
        endpoint: 'https://api.unbound.com/v1',
        credential: { type: 'env', name: 'UNBOUND_KEY' },
        models: ['unbound/model-1'],
        modelMeta: {
          'unbound/model-1': { contextWindow: 32000 },
        },
      },
    ],
  };

  const candidates = candidatesApi.generateCandidates({
    harness: 'hermes',
    registry: fakeRegistry,
    accounts: [], // No accounts bound
  });

  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.notEqual(c.accountId, '*', `Candidate ${c.candidateKey} must not have accountId '*'`);
    assert.equal(c.accountId, 'unbound-source', 'Unbound candidate uses source.id as accountId');
  }
});
