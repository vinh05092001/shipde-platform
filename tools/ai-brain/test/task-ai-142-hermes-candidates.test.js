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
const healthApi = require('../route-health');

test('TASK-AI-142 H3: ranked probe admission includes missing health, never failed or credential-less routes', () => {
  const registry = {
    sources: [
      {
        id: 'fixture-router',
        kind: 'router',
        endpoint: 'https://fixture.example/v1',
        credential: { type: 'env', name: 'FIXTURE_KEY' },
        modelMeta: Object.fromEntries(
          ['gh/strong', 'gh/dead', 'gh/weak'].map((model) => [model, { contextWindow: 64000 }])
        ),
      },
      {
        id: 'no-credential',
        kind: 'model-source',
        endpoint: 'https://none.example/v1',
        modelMeta: { 'gh/credential-less': { contextWindow: 64000 } },
      },
      {
        id: 'direct',
        kind: 'model-source',
        endpoint: 'https://direct.example/v1',
        credential: { type: 'api-key', env: 'DIRECT_KEY' },
        modelMeta: { 'gh/dead-direct': { contextWindow: 64000 } },
      },
      {
        id: 'parked',
        kind: 'model-source',
        endpoint: 'https://parked.example/v1',
        status: 'parked',
        credential: { type: 'env', name: 'PARKED_KEY' },
        modelMeta: { 'gh/parked': { contextWindow: 64000 } },
      },
    ],
    dispatch: { providers: { 'fixture-router': { harness: 'opencode' } } },
  };
  const accounts = [{ id: 'account', provider: 'fixture-router', enabled: true }];
  const discovery = {
    candidates: ['gh/strong', 'gh/dead', 'gh/weak'].map((modelId) => ({
      gateway: 'fixture-router',
      upstream: 'gh',
      accountId: 'account',
      modelId,
    })),
  };
  const routeHealth = { version: 1, paths: {}, events: [] };
  healthApi.recordResult(
    routeHealth,
    'gh/dead',
    { id: 'fixture-router', accountId: 'account' },
    { ok: false, status: 401 },
    1000
  );
  healthApi.recordResult(
    routeHealth,
    'gh/weak',
    { id: 'fixture-router', accountId: 'account' },
    { ok: true },
    1000
  );
  healthApi.recordResult(
    routeHealth,
    'gh/dead-direct',
    { id: 'direct', accountId: 'direct' },
    { ok: false, status: 401 },
    1000
  );
  const options = {
    harness: 'hermes',
    routeHealth,
    requireRouteHealth: true,
    offerings: [],
    registryAccounts: [],
  };
  const strict = cliApi.assembleForDispatch(discovery, accounts, registry, options);
  assert.ok(!strict.some((c) => c.modelId === 'gh/strong'));
  const admitted = cliApi.assembleForDispatch(discovery, accounts, registry, {
    ...options,
    allowMissingRouteHealth: true,
  });
  assert.ok(admitted.some((c) => c.harness === 'hermes' && c.modelId === 'gh/strong'));
  assert.ok(admitted.some((c) => c.modelId === 'gh/weak'));
  assert.ok(!admitted.some((c) => /dead|credential-less|parked/.test(c.modelId)));
  const gateway = candidatesApi.gatewayAccountCandidates({
    ...options,
    registry,
    accounts,
    catalogue: discovery.candidates,
    allowMissingRouteHealth: true,
  });
  assert.deepEqual(gateway.map((c) => c.modelId).sort(), ['gh/strong', 'gh/weak']);
  const selection = hermesSessionApi.selectReasoningCandidate(
    { skipDecisionLog: true },
    {
      registry,
      accountList: accounts,
      readDiscoveryCatalogue: () => discovery,
      routeHealth,
      evidenceData: {},
      priorsData: { ranking: [] },
      assembleForDispatch: (d, a, r, o) =>
        cliApi.assembleForDispatch(d, a, r, { ...o, offerings: [], registryAccounts: [] }),
      rankForProfile: (rows) => {
        assert.ok(rows.some((c) => c.modelId === 'gh/strong'));
        assert.ok(!rows.some((c) => c.modelId === 'gh/dead'));
        const ranked = rows
          .filter((c) => c.accountId === 'account')
          .sort(
            (a, b) => (a.modelId === 'gh/strong' ? -1 : 1) - (b.modelId === 'gh/strong' ? -1 : 1)
          );
        return { chosen: ranked[0].candidateKey, ranking: ranked, top3: ranked, rejected: [] };
      },
    }
  );
  assert.equal(selection.candidate.modelId, 'gh/strong');
  assert.equal(
    Object.keys(routeHealth.paths).length,
    3,
    'admission must not fabricate health records'
  );
});

test('TASK-AI-142 H3: original harnesses converging on one Hermes key are ranked once', () => {
  const base = {
    accessPath: 'https://fixture.example/v1',
    gateway: 'fixture',
    upstream: 'gh',
    accountId: 'account',
    quotaScope: 'account',
    modelId: 'gh/strong',
    contextWindow: 64000,
  };
  let count;
  hermesSessionApi.selectReasoningCandidate(
    { skipDecisionLog: true },
    {
      candidateList: [
        { ...base, harness: 'opencode' },
        { ...base, harness: 'hermes' },
      ],
      registry: { sources: [] },
      accountList: [],
      evidenceData: {},
      priorsData: { ranking: [] },
      routeHealth: { version: 1, paths: {}, events: [] },
      rankForProfile: (rows) => {
        count = rows.length;
        return { chosen: rows[0].candidateKey, ranking: rows, top3: rows, rejected: [] };
      },
    }
  );
  assert.equal(count, 1);
});

test('TASK-AI-142 H3: production assembly probes an untested stronger model before a healthy weaker model', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ranked-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const models = ['cbai/deepseek-v4.1-flash', 'cl/openai/gpt-6-astra'];
  const registry = {
    sources: [
      {
        id: 'fixture',
        kind: 'router',
        endpoint: 'https://fixture.example/v1',
        credential: { type: 'api-key', env: 'FIXTURE_KEY' },
        modelMeta: Object.fromEntries(models.map((id) => [id, { contextWindow: 128000 }])),
      },
    ],
  };
  const accounts = [{ id: 'account', provider: 'fixture', enabled: true }];
  const routeHealth = { version: 1, paths: {}, events: [] };
  healthApi.recordResult(
    routeHealth,
    models[0],
    { id: 'fixture', accountId: 'account' },
    { ok: true },
    Date.now()
  );
  const probed = [];
  const spawned = [];
  const deps = {
    registry,
    accountList: accounts,
    readDiscoveryCatalogue: () => ({ candidates: [] }),
    routeHealth,
    evidenceData: {},
    priorsData: require('../priors').loadPriors(),
    assembleForDispatch: (d, a, r, o) =>
      cliApi.assembleForDispatch(d, a, r, { ...o, offerings: [], registryAccounts: [] }),
    probe: async (c) => {
      probed.push(c.modelId);
      return c.modelId === models[1]
        ? { ok: false, status: 404, body: 'model not found' }
        : { ok: true, status: 200 };
    },
    spawn: async (_command, args) => {
      spawned.push(args);
      return { exitCode: 0 };
    },
  };
  const options = {
    rootDir: root,
    skipDecisionLog: true,
    env: { FIXTURE_KEY: 'test-fixture-value' },
  };
  const selected = hermesSessionApi.selectReasoningCandidate(options, deps);
  assert.equal(selected.candidate.modelId, models[1]);
  assert.ok(selected.ranking[0].score > selected.ranking[1].score);
  await hermesSessionApi.launchHermesSession(options, deps);
  assert.deepEqual(probed, [models[1], models[0]]);
  assert.equal(spawned.length, 1, 'failed untested model must never launch');
  assert.ok(spawned[0].includes(models[0]));
  assert.equal(
    healthApi.getPathRecord(routeHealth, models[1], { id: 'fixture', accountId: 'account' }).status,
    'UNSUPPORTED'
  );
});

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

test('TASK-AI-142 H3: a CLI-only account candidate (no http endpoint) is never selected for Hermes', () => {
  const fakeRegistry = {
    version: 2,
    sources: [
      {
        id: 'router-a',
        kind: 'model-source',
        endpoint: 'http://127.0.0.1:40128/v1',
        credential: { type: 'env', name: 'ROUTER_A_KEY' },
        modelMeta: {
          'r/model-a': { contextWindow: 200000, contextSource: 'provider-models-endpoint' },
        },
      },
    ],
  };
  const http = candidatesApi
    .generateCandidates({ harness: 'hermes', registry: fakeRegistry })
    .find((c) => c.modelId === 'r/model-a');
  assert.ok(http, 'router candidate must exist');
  const cliOnly = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: '',
    upstream: 'antigravity',
    accountId: 'agy-native-a',
    quotaScope: 'agy-native-a',
    modelId: 'claude-opus-4-6-thinking',
    kind: 'agent-cli',
    contextWindow: 200000,
    capabilities: { contextWindow: 200000 },
  };
  const selection = hermesSessionApi.selectReasoningCandidate(
    { skipDecisionLog: true, qualityFloor: 0 },
    { candidates: [cliOnly], registry: fakeRegistry, priorsData: { ranking: [] } }
  );
  assert.equal(selection.chosen, null);
  assert.equal(selection.refused, 'NO_REASONING_CANDIDATE');
});
