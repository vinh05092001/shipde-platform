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

test('TASK-AI-142 H3: chat refreshes empty provider metadata before Codex assembly and exposes ranks beyond ten', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-chat-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexDir = path.join(root, '.codex');
  fs.mkdirSync(codexDir);
  fs.writeFileSync(path.join(codexDir, 'auth.json'), '{}');
  fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model = "gpt-6-luna"');
  const registry = {
    sources: [
      {
        id: '9router',
        endpoint: 'http://fixture/v1',
        credential: { type: 'env', env: 'FIXTURE_KEY', name: 'FIXTURE_KEY' },
      },
    ],
  };
  let fetched = false;
  const log = console.log;
  console.log = () => {};
  t.after(() => {
    console.log = log;
  });
  const stronger = Array.from({ length: 11 }, (_, i) => ({
    harness: 'hermes',
    accessPath: 'http://fixture/v1',
    gateway: '9router',
    upstream: 'fixture',
    accountId: 'fixture',
    quotaScope: 'fixture',
    modelId: `strong-${i}`,
    quality: 85,
    contextWindow: 64000,
  }));
  const wrapped = await hermesSessionApi.chatCommand(
    { rootDir: root, homeDir: root, reselect: true, dryRun: true, skipDecisionLog: true },
    {
      sources: { loadSources: () => registry },
      fetchModels: async () => {
        fetched = true;
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gh/gpt-6-luna', capabilities: { contextWindow: 1050000 } },
              { id: 'cl/openai/gpt-6-luna', capabilities: { contextWindow: 1050000 } },
            ],
          }),
        };
      },
      readDiscoveryCatalogue: () => ({ candidates: [] }),
      assembleForDispatch: () => {
        assert.ok(fetched);
        return stronger;
      },
      accountList: [],
      evidenceData: [],
      priorsData: { ranking: stronger.map((c) => ({ model: c.modelId, score: 85 })) },
      routeHealth: { version: 1, paths: {}, events: [] },
    }
  );
  assert.ok(wrapped.result, wrapped.error?.message);
  const { result } = wrapped;
  assert.equal(result.status, 'dry_run');
  assert.ok(result.modelRanking.findIndex((m) => m.modelId === 'gpt-6-luna') >= 10);
  assert.ok(!result.rejected.some((r) => r.candidateKey.includes('openai-codex')));
  assert.equal(registry.sources[0].modelMeta, undefined);
});

test('TASK-AI-142 H3: codex context fallback uses minimum same-model provider metadata and refuses missing evidence', async () => {
  const homeDir = path.join(os.tmpdir(), 'codex-provider-context-test');
  const authPath = path.join(homeDir, '.codex', 'auth.json');
  const configPath = path.join(homeDir, '.codex', 'config.toml');
  const deps = {
    fs: {
      existsSync: (p) => p === authPath || p === configPath,
      readFileSync: (p) => {
        assert.equal(p, configPath, 'auth tokens must never be read');
        return 'model = "gpt-6-luna"';
      },
    },
    registry: {
      sources: [
        { id: '9router', endpoint: 'http://fixture/v1', modelMeta: {} },
        { id: 'other', modelMeta: { 'openai/gpt-6-luna': { contextWindow: 900000 } } },
      ],
    },
    fetchModels: async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gh/gpt-6-luna', capabilities: { contextWindow: 1050000 } },
          { id: 'cl/openai/gpt-6-luna', capabilities: { contextWindow: 1000000 } },
          { id: 'gh/gpt-6-astra', capabilities: { contextWindow: 32000 } },
        ],
      }),
    }),
  };
  const options = { homeDir, skipDecisionLog: true, includeOpenAiCodex: true };
  const refreshed = await hermesSessionApi.refreshReasoningContext(options, deps);
  const candidates = hermesSessionApi.assembleOpenAiCodexCandidates(options, refreshed);
  assert.equal(candidates[0].contextWindow, 900000);
  assert.equal(candidates[0].capabilities.contextWindow, 900000);
  assert.equal(
    hermesSessionApi.resolveHermesContextWindow(
      'gpt-6-luna',
      { ...options, candidate: { accessPath: 'openai-codex' } },
      {
        ...refreshed,
        registry: { sources: [refreshed.registry.sources[0]] },
      }
    ),
    1000000
  );
  const selection = hermesSessionApi.selectReasoningCandidate(options, {
    ...refreshed,
    candidateList: [],
    priorsData: { ranking: [{ model: 'gpt-6-luna', score: 85 }] },
    routeHealth: { version: 1, paths: {}, events: [] },
  });
  assert.equal(selection.candidate.provider, 'openai-codex');
  assert.equal(selection.candidate.contextWindow, 900000);

  const missing = hermesSessionApi.selectReasoningCandidate(options, {
    ...deps,
    candidateList: [],
    registry: {
      sources: [
        {
          id: 'other',
          modelMeta: {
            'gh/gpt-6-astra': { contextWindow: 1050000 },
            'gh/gpt-6-luna': { contextWindow: true },
            'cl/openai/gpt-6-luna': { contextWindow: -1 },
            'openai/gpt-6-luna': { contextWindow: 128000.5 },
          },
        },
      ],
    },
    priorsData: { ranking: [{ model: 'gpt-6-luna', score: 85, contextWindow: 1050000 }] },
    routeHealth: { version: 1, paths: {}, events: [] },
  });
  // An unreported window no longer excludes the route; it is never invented.
  assert.ok(missing.candidate);
  assert.equal(missing.candidate.contextWindow, undefined);
});

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
    priorsData: require('../priors').loadPriors(
      path.join(__dirname, 'fixtures', 'priors-20261013.json')
    ),
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
    homeDir: root, // hermetic: no host Codex login joins the pool
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

test('TASK-AI-142 H3: source without meta stays unverified yet eligible', () => {
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
  assert.ok(selection.candidate, 'unknown context stays eligible');
  assert.equal(selection.candidate.contextWindow, undefined);
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

test('TASK-AI-142 H3: openai-codex candidate appears only when ~/.codex/auth.json exists, and auth.json is never read', () => {
  const fakeHome = path.join(os.tmpdir(), 'codex-mock-auth-test');
  const authPath = path.join(fakeHome, '.codex', 'auth.json');
  let authReadAttempted = false;

  const mockFs = {
    existsSync: (p) => p === authPath,
    readFileSync: (p) => {
      if (p.includes('auth.json')) {
        authReadAttempted = true;
        throw new Error('SECURITY VIOLATION: auth.json must never be read!');
      }
      return '';
    },
    mkdirSync: () => {},
    writeFileSync: () => {},
  };

  // 1. Without auth.json existing
  const mockFsNoAuth = {
    existsSync: () => false,
    readFileSync: () => '',
  };
  const emptyCandidates = hermesSessionApi.assembleOpenAiCodexCandidates(
    { homeDir: fakeHome },
    { fs: mockFsNoAuth }
  );
  assert.equal(emptyCandidates.length, 0, 'No candidate when auth.json does not exist');

  // 2. With auth.json existing
  const candidates = hermesSessionApi.assembleOpenAiCodexCandidates(
    { homeDir: fakeHome },
    { fs: mockFs }
  );
  assert.equal(authReadAttempted, false, 'auth.json was never read');
  assert.equal(candidates.length, 1, 'Exactly 1 candidate assembled for default model');
  const cand = candidates[0];
  assert.equal(cand.gateway, 'openai-codex');
  assert.equal(cand.provider, 'openai-codex');
  assert.equal(cand.upstream, 'openai');
  assert.equal(cand.accountId, 'codex');
  assert.equal(cand.quotaGroup, 'codex-chatgpt');
  assert.equal(cand.quotaScope, 'codex-chatgpt');
  assert.equal(cand.modelId, 'gpt-6.1-sol');
  assert.equal(cand.accessPath, 'openai-codex');
  assert.equal(
    cand.candidateKey,
    'hermes::openai-codex::openai-codex::openai::codex::codex-chatgpt::gpt-6.1-sol'
  );
});

test('TASK-AI-142 H3: models read from ~/.codex/config.toml "model" if present, else default gpt-6.1-sol', () => {
  const fakeHome = path.join(os.tmpdir(), 'codex-mock-models-test');
  const authPath = path.join(fakeHome, '.codex', 'auth.json');
  const configPath = path.join(fakeHome, '.codex', 'config.toml');

  // Single model in config.toml
  const mockFsSingle = {
    existsSync: (p) => p === authPath || p === configPath,
    readFileSync: (p) => (p === configPath ? 'model = "gpt-5-6-sol"\n' : ''),
  };
  const cSingle = hermesSessionApi.assembleOpenAiCodexCandidates(
    { homeDir: fakeHome },
    { fs: mockFsSingle }
  );
  assert.equal(cSingle.length, 1);
  assert.equal(cSingle[0].modelId, 'gpt-5-6-sol');

  // Array of models in config.toml
  const mockFsArray = {
    existsSync: (p) => p === authPath || p === configPath,
    readFileSync: (p) => (p === configPath ? 'model = ["gpt-5-6-sol", "gpt-6.1-sol"]\n' : ''),
  };
  const cArray = hermesSessionApi.assembleOpenAiCodexCandidates(
    { homeDir: fakeHome },
    { fs: mockFsArray }
  );
  assert.equal(cArray.length, 2);
  assert.deepEqual(
    cArray.map((c) => c.modelId),
    ['gpt-5-6-sol', 'gpt-6.1-sol']
  );

  // Missing config.toml defaults to gpt-6.1-sol
  const mockFsMissing = {
    existsSync: (p) => p === authPath,
    readFileSync: () => '',
  };
  const cMissing = hermesSessionApi.assembleOpenAiCodexCandidates(
    { homeDir: fakeHome },
    { fs: mockFsMissing }
  );
  assert.equal(cMissing.length, 1);
  assert.equal(cMissing[0].modelId, 'gpt-6.1-sol');
});

test('TASK-AI-142 H3: context window unknown without documented source in hermes catalogue stays eligible and is not invented', () => {
  const fakeHome = path.join(os.tmpdir(), 'codex-context-test');
  const authPath = path.join(fakeHome, '.codex', 'auth.json');
  const mockFs = {
    existsSync: (p) => p === authPath,
    readFileSync: () => '',
  };

  // Undocumented context window: candidate has undefined contextWindow
  const candidates = hermesSessionApi.assembleOpenAiCodexCandidates(
    { homeDir: fakeHome },
    { fs: mockFs }
  );
  assert.equal(candidates[0].contextWindow, undefined);

  // When selected in selectReasoningCandidate, it is refused as CONTEXT_WINDOW_UNVERIFIED
  const selection = hermesSessionApi.selectReasoningCandidate(
    { skipDecisionLog: true, homeDir: fakeHome, includeOpenAiCodex: true },
    {
      fs: mockFs,
      candidateList: candidates,
      registry: { sources: [] },
      priorsData: { ranking: [] },
    }
  );
  assert.ok(selection.candidate, 'unknown context stays eligible');
  assert.equal(selection.candidate.contextWindow, undefined);

  // When documented in hermes model catalogue, verified context window is attached
  const documentedCandidates = hermesSessionApi.assembleOpenAiCodexCandidates(
    {
      homeDir: fakeHome,
      hermesModelCatalogue: {
        'gpt-6.1-sol': { contextWindow: 128000 },
      },
    },
    { fs: mockFs }
  );
  assert.equal(documentedCandidates[0].contextWindow, 128000);
});

test('TASK-AI-142 H3: quotaGroup "codex-chatgpt" is reflected in ranking, chosenRoute, and decision records', () => {
  const fakeHome = path.join(os.tmpdir(), 'codex-quotagroup-test');
  const authPath = path.join(fakeHome, '.codex', 'auth.json');
  const mockFs = {
    existsSync: (p) => p === authPath,
    readFileSync: () => '',
  };

  const documentedCandidates = hermesSessionApi.assembleOpenAiCodexCandidates(
    {
      homeDir: fakeHome,
      hermesModelCatalogue: {
        'gpt-6.1-sol': { contextWindow: 128000 },
      },
    },
    { fs: mockFs }
  );

  const selection = hermesSessionApi.selectReasoningCandidate(
    { skipDecisionLog: true, homeDir: fakeHome, qualityFloor: 0 },
    {
      fs: mockFs,
      candidateList: documentedCandidates,
      registry: { sources: [] },
      priorsData: { ranking: [{ model: 'gpt-6.1-sol', score: 85 }] },
      routeHealth: { version: 1, paths: {}, events: [] },
    }
  );

  assert.equal(selection.candidate.quotaGroup, 'codex-chatgpt');
  assert.equal(selection.chosenRoute.quotaGroup, 'codex-chatgpt');
  assert.equal(selection.decisionRecord.candidates[0].quotaGroup, 'codex-chatgpt');
  assert.equal(selection.ranking[0].quotaGroup, 'codex-chatgpt');
});

test('TASK-AI-142 H3: writeProvidersConfig and buildHermesArgv emit provider openai-codex', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-providers-cfg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const candidate = {
    harness: 'hermes',
    gateway: 'openai-codex',
    provider: 'openai-codex',
    upstream: 'openai',
    accountId: 'codex',
    quotaScope: 'codex-chatgpt',
    quotaGroup: 'codex-chatgpt',
    modelId: 'gpt-6.1-sol',
    contextWindow: 128000,
    candidateKey: 'hermes::openai-codex::openai-codex::openai::codex::codex-chatgpt::gpt-6.1-sol',
  };

  const cfgRes = hermesSessionApi.writeProvidersConfig(candidate, { rootDir: root });
  assert.equal(cfgRes.providerName, 'openai-codex');
  assert.equal(cfgRes.modelId, 'gpt-6.1-sol');
  assert.equal(cfgRes.baseUrl, null);
  assert.equal(cfgRes.apiKeyEnv, null);

  const written = fs.readFileSync(cfgRes.configPath, 'utf8');
  assert.match(written, /provider:\s*"openai-codex"/);
  assert.match(written, /default:\s*"gpt-6.1-sol"/);
  assert.equal(written.includes('key_env'), false, 'Built-in provider must not write key_env');
  assert.equal(
    written.includes('custom_providers'),
    false,
    'Built-in provider must not write custom_providers'
  );

  const argv = hermesSessionApi.buildHermesArgv(candidate, { sessionId: 'ses_123' });
  assert.ok(argv.includes('--provider'));
  assert.equal(argv[argv.indexOf('--provider') + 1], 'openai-codex');
  assert.ok(argv.includes('-m'));
  assert.equal(argv[argv.indexOf('-m') + 1], 'gpt-6.1-sol');
  assert.ok(argv.includes('--continue'));
  assert.equal(argv[argv.indexOf('--continue') + 1], 'ses_123');
});

test('TASK-AI-142 H3: probe skips HTTP probe for openai-codex by default, and a failure (rate limit) falls through to next candidate', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-probe-failover-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const fakeHome = path.join(root, 'home');
  const authPath = path.join(fakeHome, '.codex', 'auth.json');
  fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
  fs.writeFileSync(authPath, '{}', 'utf8');

  const codexCand = {
    harness: 'hermes',
    accessPath: 'openai-codex',
    gateway: 'openai-codex',
    provider: 'openai-codex',
    upstream: 'openai',
    accountId: 'codex',
    quotaScope: 'codex-chatgpt',
    quotaGroup: 'codex-chatgpt',
    modelId: 'gpt-6.1-sol',
    quality: 95,
    contextWindow: 128000,
    capabilities: { contextWindow: 128000 },
    candidateKey: 'hermes::openai-codex::openai-codex::openai::codex::codex-chatgpt::gpt-6.1-sol',
  };

  const fallbackCand = {
    harness: 'hermes',
    accessPath: 'https://fallback.example/v1',
    gateway: 'fixture',
    upstream: 'fb',
    accountId: 'account-fb',
    quotaScope: 'account-fb',
    modelId: 'fallback-model',
    quality: 80,
    contextWindow: 64000,
    capabilities: { contextWindow: 64000 },
    candidateKey:
      'hermes::https://fallback.example/v1::fixture::fb::account-fb::account-fb::fallback-model',
  };

  const registry = {
    sources: [
      {
        id: 'fixture',
        endpoint: 'https://fallback.example/v1',
        credential: { type: 'api-key', env: 'FB_KEY' },
        modelMeta: { 'fallback-model': { contextWindow: 64000 } },
      },
    ],
  };

  const probed = [];
  const spawned = [];
  const deps = {
    candidateList: [codexCand, fallbackCand],
    registry,
    evidenceData: {},
    priorsData: { ranking: [] },
    routeHealth: { version: 1, paths: {}, events: [] },
    probe: async (c) => {
      probed.push(c.candidateKey);
      if (c.gateway === 'openai-codex') {
        return { ok: false, status: 429, body: 'Rate limit exceeded' };
      }
      return { ok: true, status: 200 };
    },
    spawn: async (_cmd, args) => {
      spawned.push(args);
      return { exitCode: 0 };
    },
  };

  const options = {
    rootDir: root,
    skipDecisionLog: true,
    homeDir: fakeHome,
    qualityFloor: 0,
    probe: true,
    env: { FB_KEY: 'test-key' },
  };

  await hermesSessionApi.launchHermesSession(options, deps);

  // Probe tried openai-codex first, failed with 429, then probed fallbackCand
  assert.equal(probed[0], codexCand.candidateKey);
  assert.equal(probed[1], fallbackCand.candidateKey);

  // Spawn launched with fallback-model, having fallen through from openai-codex
  assert.equal(spawned.length, 1);
  assert.ok(
    spawned[0].includes('fallback-model'),
    'Fallback model must be launched after rate limit'
  );
});

test('TASK-AI-142 H3: default wiring with injected homedir/registry/fetch includes openai-codex candidate on live path', async (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-live-default-test-'));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));
  const codexDir = path.join(tempHome, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'auth.json'), '{}');
  fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model = "gpt-6.1-sol"\n');

  let authRead = false;
  const injectedFs = {
    ...fs,
    readFileSync: (p, ...args) => {
      if (typeof p === 'string' && p.endsWith('auth.json')) {
        authRead = true;
        throw new Error('SECURITY: auth.json must never be read');
      }
      return fs.readFileSync(p, ...args);
    },
  };

  const registry = {
    sources: [
      {
        id: '9router',
        endpoint: 'http://fixture/v1',
        credential: { type: 'env', env: 'FIXTURE_KEY', name: 'FIXTURE_KEY' },
        modelMeta: {
          'gpt-6.1-sol': { contextWindow: 128000 },
        },
      },
    ],
  };

  const log = console.log;
  console.log = () => {};
  t.after(() => {
    console.log = log;
  });

  // Default wiring: no candidateList injected, default chatCommand args
  const resultWrap = await hermesSessionApi.chatCommand(
    {
      rootDir: tempHome,
      homeDir: tempHome,
      homedir: tempHome,
      reselect: true,
      dryRun: true,
      skipDecisionLog: true,
    },
    {
      fs: injectedFs,
      sources: { loadSources: () => registry },
      registry,
      fetchModels: async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      }),
      readDiscoveryCatalogue: () => ({ candidates: [] }),
      assembleForDispatch: () => [],
      accountList: [],
      evidenceData: [],
      priorsData: { ranking: [{ model: 'gpt-6.1-sol', score: 90 }] },
      routeHealth: { version: 1, paths: {}, events: [] },
    }
  );

  assert.equal(authRead, false, 'auth.json must not be read');
  assert.ok(resultWrap && resultWrap.result, 'chatCommand must return a result object');
  const r = resultWrap.result;
  assert.equal(r.status, 'dry_run');
  assert.ok(r.candidate, 'Candidate must be chosen');
  assert.equal(r.candidate.provider, 'openai-codex');
  assert.equal(r.candidate.quotaGroup, 'codex-chatgpt');
  assert.equal(r.candidate.contextWindow, 128000);
  assert.equal(r.candidate.capabilities?.contextWindow, 128000);
  assert.equal(r.chosenRoute.quotaGroup, 'codex-chatgpt');
  assert.ok(
    r.modelRanking.some(
      (m) =>
        m.modelId === 'gpt-6.1-sol' ||
        m.modelId === 'gpt-6-1-sol' ||
        hermesSessionApi.canonicalHermesModelId(m.modelId) === 'gpt-6-1-sol'
    ),
    'openai-codex model must appear in modelRanking'
  );
});

test('TASK-AI-142 H3: cross-source context borrow applies only to openai-codex candidates', () => {
  const fakeRegistry = {
    sources: [
      {
        id: 'opencode-provider-source-a',
        modelMeta: {},
      },
      {
        id: 'opencode-provider-source-b',
        modelMeta: {
          'shared/model-z': { contextWindow: 65536 },
        },
      },
    ],
  };

  // 1. Non-codex candidate / provider does NOT borrow from source B
  const nonCodex = hermesSessionApi.resolveHermesContextWindow(
    'shared/model-z',
    { provider: 'opencode-provider-source-a' },
    { registry: fakeRegistry }
  );
  assert.equal(
    nonCodex,
    undefined,
    'Non-codex provider must never borrow context from other sources'
  );

  const defaultNoProvider = hermesSessionApi.resolveHermesContextWindow(
    'shared/model-z',
    {},
    { registry: fakeRegistry }
  );
  assert.equal(
    defaultNoProvider,
    undefined,
    'Unspecified provider must not borrow context across sources'
  );

  const sharedFlags = {
    includeOpenAiCodex: true,
    isCodex: true,
    codexAuthPath: 'fixture-auth',
    codexConfigPath: 'fixture-config',
    provider: 'openai-codex',
    candidate: { provider: 'opencode-provider-source-a' },
  };
  assert.equal(
    hermesSessionApi.resolveHermesContextWindow('shared/model-z', sharedFlags, {
      ...sharedFlags,
      registry: fakeRegistry,
      hermesModelCatalogue: { 'shared/model-z': { contextWindow: 65536 } },
    }),
    65536
  );
  fakeRegistry.sources[0].modelMeta['shared/model-z'] = { contextWindow: 32768 };
  assert.equal(
    hermesSessionApi.resolveHermesContextWindow('shared/model-z', sharedFlags, {
      registry: fakeRegistry,
    }),
    32768
  );
  delete fakeRegistry.sources[0].modelMeta['shared/model-z'];
  assert.equal(
    hermesSessionApi.resolveHermesContextWindow('shared/model-z', sharedFlags, {
      registry: fakeRegistry,
    }),
    undefined,
    'Non-codex candidate must never borrow context from other sources'
  );
  assert.equal(
    hermesSessionApi.resolveHermesContextWindow(
      'shared/model-z',
      { candidate: { provider: 'opencode-provider-source-a' } },
      { registry: fakeRegistry }
    ),
    undefined,
    'Non-codex candidate must never take a context value from another provider source'
  );

  // 2. openai-codex candidate DOES borrow conservative minimum
  const codex = hermesSessionApi.resolveHermesContextWindow(
    'shared/model-z',
    { provider: 'openai-codex' },
    { registry: fakeRegistry }
  );
  assert.equal(codex, 65536, 'openai-codex candidate must borrow context from registry sources');

  // 3. codex-app-server alone is not openai-codex evidence
  const appServer = hermesSessionApi.resolveHermesContextWindow(
    'shared/model-z',
    { provider: 'codex-app-server' },
    { registry: fakeRegistry }
  );
  assert.equal(
    appServer,
    undefined,
    'codex-app-server provider alone must not borrow context from registry sources'
  );
});

test('TASK-AI-142 H3: fileExists, dirExists, and hasCodexAuth strictly reject on EPERM/EACCES with recorded reason', () => {
  hermesSessionApi.clearFsCheckReasons();
  const epermErr = new Error('EPERM: operation not permitted');
  epermErr.code = 'EPERM';
  const eaccesErr = new Error('EACCES: permission denied');
  eaccesErr.code = 'EACCES';

  const throwingFs = {
    existsSync: (p) => {
      if (String(p).includes('perm')) throw epermErr;
      if (String(p).includes('acces')) throw eaccesErr;
      return false;
    },
    statSync: (p) => {
      if (String(p).includes('perm')) throw epermErr;
      if (String(p).includes('acces')) throw eaccesErr;
      throw new Error('ENOENT');
    },
  };

  assert.equal(hermesSessionApi.fileExists('/fake/perm/auth.json', throwingFs), false);
  assert.equal(hermesSessionApi.fileExists('/fake/acces/auth.json', throwingFs), false);
  assert.equal(hermesSessionApi.dirExists('/fake/perm/.codex', throwingFs), false);
  assert.equal(hermesSessionApi.dirExists('/fake/acces/.codex', throwingFs), false);

  const reasons = hermesSessionApi.getFsCheckReasons();
  assert.ok(reasons.length >= 4, 'Reasons must be recorded for each EPERM/EACCES');
  assert.ok(reasons.some((r) => r.code === 'EPERM' && r.reason.includes('fileExists')));
  assert.ok(reasons.some((r) => r.code === 'EACCES' && r.reason.includes('dirExists')));

  // hasCodexAuth returns false strictly when auth.json throws EPERM/EACCES
  const hasAuth = hermesSessionApi.hasCodexAuth(
    { codexAuthPath: '/fake/perm/auth.json' },
    { fs: throwingFs }
  );
  assert.equal(hasAuth, false, 'hasCodexAuth must be false when auth.json fails with EPERM');
});

test('TASK-AI-142 H3: persisted decision records reference full ranking files and dry-run output contains full modelRanking', (t) => {
  const decisionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-full-ranking-'));
  t.after(() => fs.rmSync(decisionDir, { recursive: true, force: true }));
  const stronger = Array.from({ length: 15 }, (_, i) => ({
    harness: 'hermes',
    accessPath: 'http://fixture/v1',
    gateway: '9router',
    upstream: 'fixture',
    accountId: 'fixture',
    quotaScope: 'fixture',
    modelId: `ranked-model-${String(i).padStart(2, '0')}`,
    quality: 90 - i,
    contextWindow: 64000,
  }));

  const selection = hermesSessionApi.selectReasoningCandidate(
    { dryRun: true, decisionDir, qualityFloor: 50 },
    {
      candidateList: stronger,
      priorsData: { ranking: stronger.map((c) => ({ model: c.modelId, score: c.quality })) },
      routeHealth: { version: 1, paths: {}, events: [] },
    }
  );

  // Dry-run return output has full ranking
  assert.equal(selection.modelRanking.length, 15, 'dryRun payload must have full modelRanking');
  assert.equal(selection.decisionRecord.modelRanking.length, stronger.length);
  assert.equal(selection.decisionRecord.candidates.length, stronger.length);
  const records = require('../decisions').readDecisions({ dir: decisionDir });
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(path.dirname(record.rankingFile), decisionDir);
  assert.equal(record.modelRankingCount, stronger.length);
  const ranking = JSON.parse(fs.readFileSync(record.rankingFile, 'utf8'));
  assert.deepEqual(ranking.modelRanking, selection.modelRanking);
  assert.deepEqual(ranking.candidates, selection.decisionRecord.candidates);
});
