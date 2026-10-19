'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const probeOrder = require('../probe-order');
const candidatesApi = require('../candidates');
const capabilityProbe = require('../capability-probe');

test('TASK-AI-142 item 1: isolatedLaneRejected orders codex and agy-pool ahead of bulk opencode-direct candidates', () => {
  const rejected = [];
  const candidates = [];

  // Simulate 50 opencode-direct unprobed candidates
  for (let i = 0; i < 50; i++) {
    const key = `opencode-direct::https://aihubmix.com/v1::aihubmix::aihubmix::source-aihubmix::source-aihubmix::aihubmix/model-${i}`;
    candidates.push({ candidateKey: key, harness: 'opencode-direct' });
    rejected.push({ candidateKey: key, reason: 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET' });
  }

  // 1 codex and 2 agy-pool candidates at the end of rejected
  const codexKey = 'codex::cli::::codex::codex-cli::codex-cli::gpt-6.1-sol';
  candidates.push({ candidateKey: codexKey, harness: 'codex' });
  rejected.push({ candidateKey: codexKey, reason: 'WRITER_SCHEMA_CODEX_LAUNCH_FAILED' });

  const agyKey =
    'agy-pool::ShipDe\\ShipDe-agy01::::antigravity::agy01::agy01:gemini::gemini-3.8-flash-high';
  candidates.push({ candidateKey: agyKey, harness: 'agy-pool' });
  rejected.push({ candidateKey: agyKey, reason: 'WRITER_SCHEMA_POOL_POOL_TIMEOUT' });

  const rankingResult = { rejected, chosen: null, ranking: [] };
  probeOrder.preferKnownGood(rankingResult, candidates, { routeHealth: { paths: {} } });

  const top10 = rankingResult.isolatedLaneRejected.slice(0, 10);
  const harnessesInTop10 = top10.map((r) => r.candidateKey.split('::')[0]);

  assert.ok(harnessesInTop10.includes('codex'), 'isolatedLaneRejected top 10 must retain codex');
  assert.ok(
    harnessesInTop10.includes('agy-pool'),
    'isolatedLaneRejected top 10 must retain agy-pool'
  );
});

test('TASK-AI-142 item 2: orderCandidatesForProbe prioritizes live routes and prior work ahead of unprobed candidates', () => {
  const profile = { role: 'writer', requiredCapabilities: ['jsonSchema'] };
  const mockCandidates = [
    {
      harness: 'opencode-direct',
      modelId: 'dead-model',
      accountId: 'acc1',
      sourceId: 'src1',
      gateway: 'src1',
      source: 'src1',
    },
    {
      harness: 'codex',
      modelId: 'codex-model',
      accountId: 'codex-cli',
      sourceId: 'codex',
      gateway: 'codex',
      source: 'codex',
    },
    {
      harness: 'opencode-direct',
      modelId: 'live-model',
      accountId: 'acc2',
      sourceId: 'src2',
      gateway: 'src2',
      source: 'src2',
    },
  ];

  const store = {
    paths: {
      'live-model|src2@acc2': {
        routeId: 'src2',
        modelId: 'live-model',
        status: 'AVAILABLE',
        lastCheckedAt: new Date().toISOString(),
      },
    },
  };

  const ordered = capabilityProbe.orderCandidatesForProbe
    ? capabilityProbe.orderCandidatesForProbe(mockCandidates, profile, {
        registry: { sources: [{ id: 'src2', endpoint: 'https://live.api/v1' }] },
        routeHealth: store,
      })
    : mockCandidates;

  assert.equal(
    ordered[0].modelId,
    'live-model',
    'Live available route must be prioritized before unprobed candidates'
  );
});

test('TASK-AI-142 item 2: probeCapabilities short-circuits HTTP account on credit/quota exhaustion', async () => {
  const cands = [
    {
      candidateKey: 'opencode-direct::https://api.test/v1::src::src::acc::acc::src/model-1',
      harness: 'opencode-direct',
      modelId: 'src/model-1',
      accountId: 'acc',
      sourceId: 'src',
      source: 'src',
      gateway: 'src',
      upstream: 'src',
      blocked: false,
      credentialEnvMissing: false,
      capabilities: {},
    },
    {
      candidateKey: 'opencode-direct::https://api.test/v1::src::src::acc::acc::src/model-2',
      harness: 'opencode-direct',
      modelId: 'src/model-2',
      accountId: 'acc',
      sourceId: 'src',
      source: 'src',
      gateway: 'src',
      upstream: 'src',
      blocked: false,
      credentialEnvMissing: false,
      capabilities: {},
    },
  ];

  let networkCallCount = 0;
  const mockFetch = async () => {
    networkCallCount++;
    return {
      ok: false,
      status: 403,
      json: async () => ({
        error: { message: 'Your account balance is insufficient. Please recharge.' },
      }),
    };
  };

  const registry = {
    sources: [
      {
        id: 'src',
        kind: 'model-source',
        endpoint: 'https://api.test/v1',
        credential: { env: 'TEST_KEY' },
      },
    ],
  };

  await capabilityProbe.probeCapabilities(
    cands,
    { role: 'writer', requiredCapabilities: ['jsonSchema'] },
    {
      registry,
      fetch: mockFetch,
      env: { TEST_KEY: 'secret' },
      schemaProbeBudgetMs: 5000,
    }
  );

  assert.equal(
    networkCallCount,
    1,
    'Subsequent models on an exhausted HTTP account must be short-circuited after the first refusal'
  );
  assert.equal(cands[1].capabilityEvidence.jsonSchema.reason, 'UPSTREAM_CREDIT_OR_QUOTA');
});

test('TASK-AI-142 item 3: httpProof detects upstream gateway quota refusal inside HTTP 200 response', async () => {
  const candidate = {
    candidateKey:
      'opencode-direct::https://aihubmix.com/v1::aihubmix::aihubmix::source-aihubmix::source-aihubmix::aihubmix/qwen3.8-flash-free',
    harness: 'opencode-direct',
    modelId: 'aihubmix/qwen3.8-flash-free',
    accountId: 'source-aihubmix',
    sourceId: 'aihubmix',
    source: 'aihubmix',
    gateway: 'aihubmix',
    upstream: 'aihubmix',
    blocked: false,
    credentialEnvMissing: false,
    capabilities: {},
  };

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              'Sorry, to prevent abuse of free resources, accounts that have not been recharged can only try 10 times. You can increase the free quota after recharging; https://console.aihubmix.com/topup',
          },
        },
      ],
    }),
  });

  const registry = {
    sources: [
      {
        id: 'aihubmix',
        kind: 'model-source',
        endpoint: 'https://aihubmix.com/v1',
        credential: { env: 'AIHUBMIX_API_KEY' },
      },
    ],
  };

  await capabilityProbe.probeCapabilities(
    [candidate],
    { role: 'writer', requiredCapabilities: ['jsonSchema'] },
    {
      registry,
      fetch: mockFetch,
      env: { AIHUBMIX_API_KEY: 'secret' },
    }
  );

  assert.equal(
    candidate.capabilityEvidence.jsonSchema.reason,
    'UPSTREAM_CREDIT_OR_QUOTA',
    'Plain-text gateway recharge error must be classified as UPSTREAM_CREDIT_OR_QUOTA instead of WRITER_RESULT_INVALID_JSON'
  );
});

test('TASK-AI-142 item 4: agy-pool candidates do not inherit tools by default and require probe evidence', async () => {
  const registry = {
    sources: [
      {
        id: 'agy-pool',
        kind: 'agent-cli',
        capabilities: { tools: true },
        writerEnabled: true,
        accounts: ['agy01'],
      },
    ],
  };

  const cands = candidatesApi.generateCandidates({
    registry,
    models: ['gemini-3.8-flash-high'],
    catalogue: [
      {
        id: 'gemini-3.8-flash-high',
        modelId: 'gemini-3.8-flash-high',
        upstream: 'antigravity',
      },
    ],
    accounts: [{ id: 'agy01', provider: 'agy-pool' }],
    externalWorkers: 'agy-pool',
    discoverPool: false,
  });

  const agy = cands.find((c) => c.harness === 'agy-pool');
  assert.ok(agy, 'agy-pool candidate must be generated');
  assert.equal(
    agy.capabilities.tools,
    undefined,
    'agy-pool candidate must not inherit tools capability by default without probe proof'
  );

  let probeCliCalled = false;
  await capabilityProbe.probeCapabilities(
    [agy],
    { role: 'writer', requiredCapabilities: ['tools'] },
    {
      registry,
      probeCli: async (_cand, cap) => {
        probeCliCalled = true;
        assert.equal(cap, 'tools');
        return { ok: true, verifiedToolCalls: 1 };
      },
      schemaProbeBudgetMs: 5000,
    }
  );

  assert.ok(probeCliCalled, 'probeCli must be executed to verify tools capability');
  assert.equal(
    agy.capabilities.tools,
    true,
    'agy-pool candidate must acquire tools capability only from probe proof'
  );
  assert.equal(agy.capabilityEvidence.tools.ok, true);
});

test('TASK-AI-142 item 5: writer selection succeeds when candidate has verified capability evidence', () => {
  const routing = require('../routing');
  const profile = {
    role: 'writer',
    requiredCapabilities: ['jsonSchema', 'tools'],
    resourceCeiling: 10,
    currentWorkload: 0,
  };
  const now = new Date().toISOString();
  const cand = {
    candidateKey:
      'agy-pool::ShipDe\\ShipDe-agy05::::antigravity::agy05::agy05:gemini::gemini-3.8-flash-high',
    harness: 'agy-pool',
    accessPath: 'ShipDe\\ShipDe-agy05',
    gateway: '',
    upstream: 'antigravity',
    accountId: 'agy05',
    quotaScope: 'agy05:gemini',
    modelId: 'gemini-3.8-flash-high',
    source: 'agy-pool',
    kind: 'agent-cli',
    capabilities: { jsonSchema: true, tools: true },
    capabilityEvidence: {
      jsonSchema: { ok: true, observedAt: now },
      tools: { ok: true, observedAt: now },
    },
    sharedQuota: 'unknown',
  };

  const outcome = routing.rankForProfile([cand], profile, {}, { priors: {} });
  assert.ok(
    outcome.chosen,
    'At least 1 writer must be chosen when capability evidence is verified'
  );
  assert.equal(outcome.chosen, cand.candidateKey);
});
