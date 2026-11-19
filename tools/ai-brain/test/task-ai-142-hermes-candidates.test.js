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
