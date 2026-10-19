'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const capabilityProbe = require('../capability-probe');

test('TASK-AI-142: strong candidate with prior 90 is probed first ahead of weak candidates from large source', async (t) => {
  const weakCandidates = Array.from({ length: 50 }, (_, i) => ({
    harness: 'opencode-direct',
    accessPath: 'direct',
    gateway: 'source-weak',
    upstream: 'source-weak',
    sourceId: 'source-weak',
    source: 'source-weak',
    accountId: 'acc-weak',
    modelId: `source-weak/weak-model-${i}`,
    capabilities: {},
  }));

  const strongCandidate = {
    harness: 'opencode-direct',
    accessPath: 'direct',
    gateway: 'source-strong',
    upstream: 'source-strong',
    sourceId: 'source-strong',
    source: 'source-strong',
    accountId: 'acc-strong',
    modelId: 'source-strong/strong-model-90',
    capabilities: {},
  };

  // 50 weak models first, strong model at index 50
  const candidates = [...weakCandidates, strongCandidate];

  const priorsFixture = {
    ranking: [
      {
        canonical: 'strong-model-90',
        codingTier: 'T1',
        reviewTier: 'T1',
        benchmarks: {
          aaCodingIndex: 90,
          aaAgenticIndex: 90,
          intelligenceIndex: 90,
        },
        sources: [{ retrievedAt: new Date().toISOString() }],
      },
    ],
  };

  const registry = {
    sources: [
      {
        id: 'source-weak',
        kind: 'model-source',
        endpoint: 'https://weak.api/v1',
        credential: { env: 'TEST_KEY' },
      },
      {
        id: 'source-strong',
        kind: 'model-source',
        endpoint: 'https://strong.api/v1',
        credential: { env: 'TEST_KEY' },
      },
    ],
    dispatch: {
      probeRoundRobinBatch: 1,
      probeTimeoutMs: 1000,
      schemaProbeBudgetMs: 3000,
    },
  };

  let clock = 1_000_000;
  t.mock.method(Date, 'now', () => clock);

  const probedModels = [];
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    probedModels.push(body.model);
    clock += 1000; // Each probe consumes 1000ms; budget is 3000ms (3 probes max)
    const nonceMatch = String(body.messages?.[0]?.content || '').match(/nonce ([a-f0-9]+)/);
    const nonce = nonceMatch ? nonceMatch[1] : 'nonce';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'capability_probe',
                    arguments: JSON.stringify({ nonce }),
                  },
                },
              ],
            },
          },
        ],
      }),
    };
  };

  const store = { paths: {} };

  await capabilityProbe.probeCapabilities(
    candidates,
    { role: 'writer', requiredCapabilities: ['tools'] },
    {
      registry,
      priors: priorsFixture,
      fetch: mockFetch,
      env: { TEST_KEY: 'secret' },
      schemaProbeBudgetMs: 3000,
      routeHealth: store,
      httpRoute: (c) => ({
        endpoint: c.sourceId === 'source-strong' ? 'https://strong.api/v1' : 'https://weak.api/v1',
        accessPath: 'direct',
        apiKeyEnv: 'TEST_KEY',
        modelId: c.modelId.split('/').pop(),
      }),
    }
  );

  // Requirement 1 & 2: Strong model must be probed within the 3-probe budget
  assert.equal(
    probedModels.length,
    3,
    'Budget must allow exactly 3 probes before budget exhaustion'
  );
  assert.ok(
    probedModels.includes('strong-model-90'),
    'strong-model-90 with prior 90 must be probed within 3-probe budget'
  );
  assert.equal(
    strongCandidate.capabilities.tools,
    true,
    'strong-model-90 must have verified tools capability'
  );

  // Requirement 3: Candidates unprobed due to budget exhaustion remain unverified (not failed / no cooldown)
  const unprobedWeak = weakCandidates.find(
    (c) => !probedModels.includes(c.modelId.split('/').pop())
  );
  assert.ok(unprobedWeak, 'There must be unprobed candidates');
  assert.equal(
    unprobedWeak.capabilities.tools,
    undefined,
    'Unprobed candidate capability must remain undefined/unverified'
  );
  assert.equal(
    unprobedWeak.capabilityEvidence.tools.unverified,
    true,
    'Unprobed candidate must have unverified: true'
  );
  assert.equal(
    unprobedWeak.capabilityEvidence.tools.reason,
    'WRITER_SCHEMA_NOT_VERIFIED_BUDGET',
    'Unprobed candidate reason must be WRITER_SCHEMA_NOT_VERIFIED_BUDGET'
  );

  // No error or cooldown in store for unprobed candidate
  const routeHealth = require('../route-health');
  assert.equal(
    routeHealth.probeCooldown(unprobedWeak, { routeHealth: store }),
    null,
    'Unprobed candidate must not have a probe cooldown recorded'
  );
});

test('TASK-AI-142 P1: invalid or missing probeRoundRobinBatch throws fail-closed error instead of hanging', () => {
  const candidates = [
    { modelId: 'source-a/model-1', sourceId: 'source-a' },
    { modelId: 'source-b/model-2', sourceId: 'source-b' },
  ];

  // 1. Invalid in options.dispatchConfig
  assert.throws(() => {
    capabilityProbe.orderCandidatesForProbe(
      candidates,
      { role: 'writer' },
      {
        dispatchConfig: { probeRoundRobinBatch: 0 },
      }
    );
  }, /DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer/);

  // 2. Missing (undefined) in dispatchConfig
  assert.throws(() => {
    capabilityProbe.orderCandidatesForProbe(
      candidates,
      { role: 'writer' },
      {
        dispatchConfig: { probeRoundRobinBatch: undefined },
      }
    );
  }, /DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer/);

  // 3. Negative in dispatchConfig
  assert.throws(() => {
    capabilityProbe.orderCandidatesForProbe(
      candidates,
      { role: 'writer' },
      {
        dispatchConfig: { probeRoundRobinBatch: -1 },
      }
    );
  }, /DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer/);

  // 4. Invalid in options.probeRoundRobinBatch
  assert.throws(() => {
    capabilityProbe.orderCandidatesForProbe(
      candidates,
      { role: 'writer' },
      {
        probeRoundRobinBatch: 0,
      }
    );
  }, /DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer/);

  // 5. Invalid in registry.dispatch
  assert.throws(() => {
    capabilityProbe.orderCandidatesForProbe(
      candidates,
      { role: 'writer' },
      {
        registry: { dispatch: { probeRoundRobinBatch: 0 } },
      }
    );
  }, /DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer/);

  // 6. NaN in options.probeRoundRobinBatch
  assert.throws(() => {
    capabilityProbe.orderCandidatesForProbe(
      candidates,
      { role: 'writer' },
      {
        probeRoundRobinBatch: NaN,
      }
    );
  }, /DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer/);

  // 7. Non-numeric string in options.probeRoundRobinBatch
  assert.throws(() => {
    capabilityProbe.orderCandidatesForProbe(
      candidates,
      { role: 'writer' },
      {
        probeRoundRobinBatch: 'invalid',
      }
    );
  }, /DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer/);
});

test('TASK-AI-142 P2: round-robin interleaves across sources with batch size and sorts prior-descending inside source', () => {
  const cands = [
    { modelId: 'source-a/model-a1', sourceId: 'source-a' },
    { modelId: 'source-a/model-a2', sourceId: 'source-a' },
    { modelId: 'source-a/model-a3', sourceId: 'source-a' },
    { modelId: 'source-b/model-b1', sourceId: 'source-b' },
    { modelId: 'source-b/model-b2', sourceId: 'source-b' },
    { modelId: 'source-b/model-b3', sourceId: 'source-b' },
  ];
  // Priors:
  // source-a: a1=95, a2=70, a3=85 -> descending inside a: a1 (95), a3 (85), a2 (70)
  // source-b: b1=90, b2=80, b3=60 -> descending inside b: b1 (90), b2 (80), b3 (60)
  // Top of a is 95, top of b is 90 -> sorted sources: source-a first, then source-b
  const priors = {
    ranking: [
      { canonical: 'model-a1', codingTier: 'T1', benchmarks: { aaCodingIndex: 95 } },
      { canonical: 'model-a2', codingTier: 'T1', benchmarks: { aaCodingIndex: 70 } },
      { canonical: 'model-a3', codingTier: 'T1', benchmarks: { aaCodingIndex: 85 } },
      { canonical: 'model-b1', codingTier: 'T1', benchmarks: { aaCodingIndex: 90 } },
      { canonical: 'model-b2', codingTier: 'T1', benchmarks: { aaCodingIndex: 80 } },
      { canonical: 'model-b3', codingTier: 'T1', benchmarks: { aaCodingIndex: 60 } },
    ],
  };

  // With batchSize = 1: a1, b1, a3, b2, a2, b3
  const orderedBatch1 = capabilityProbe.orderCandidatesForProbe(
    cands,
    { role: 'writer' },
    {
      priors,
      probeRoundRobinBatch: 1,
    }
  );
  assert.deepEqual(
    orderedBatch1.map((c) => c.modelId),
    [
      'source-a/model-a1',
      'source-b/model-b1',
      'source-a/model-a3',
      'source-b/model-b2',
      'source-a/model-a2',
      'source-b/model-b3',
    ]
  );

  // With batchSize = 2: a1, a3, b1, b2, a2, b3
  const orderedBatch2 = capabilityProbe.orderCandidatesForProbe(
    cands,
    { role: 'writer' },
    {
      priors,
      probeRoundRobinBatch: 2,
    }
  );
  assert.deepEqual(
    orderedBatch2.map((c) => c.modelId),
    [
      'source-a/model-a1',
      'source-a/model-a3',
      'source-b/model-b1',
      'source-b/model-b2',
      'source-a/model-a2',
      'source-b/model-b3',
    ]
  );
});

test('TASK-AI-142 P2: preflightHttp skips probing after budget deadline and marks unverified without cooldown', async (t) => {
  const candidates = [
    {
      harness: 'opencode-direct',
      accessPath: 'direct',
      sourceId: 'src-1',
      accountId: 'acc-1',
      modelId: 'src-1/model-1',
      capabilities: {},
    },
    {
      harness: 'opencode-direct',
      accessPath: 'direct',
      sourceId: 'src-2',
      accountId: 'acc-2',
      modelId: 'src-2/model-2',
      capabilities: {},
    },
  ];

  let clock = 1000;
  t.mock.method(Date, 'now', () => clock);

  let preflightsCalled = 0;
  let probesCalled = 0;

  const mockRouteProbe = {
    probeRoute: async () => {
      preflightsCalled++;
      return { ok: true, status: 200, body: 'ok' };
    },
  };

  const mockFetch = async (_url, init) => {
    probesCalled++;
    clock += 5000; // Exceeds 4000ms budget
    const body = JSON.parse(init.body);
    const nonceMatch = String(body.messages?.[0]?.content || '').match(/nonce ([a-f0-9]+)/);
    const nonce = nonceMatch ? nonceMatch[1] : 'nonce';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'capability_probe', arguments: JSON.stringify({ nonce }) },
                },
              ],
            },
          },
        ],
      }),
    };
  };

  const store = { paths: {} };

  await capabilityProbe.probeCapabilities(
    candidates,
    { role: 'writer', requiredCapabilities: ['tools'] },
    {
      preflightHttp: true,
      routeProbe: mockRouteProbe.probeRoute,
      fetch: mockFetch,
      schemaProbeBudgetMs: 4000,
      routeHealth: store,
      env: { TEST_KEY: 'secret' },
      httpRoute: (c) => ({
        endpoint: 'https://test.api/v1',
        accessPath: 'direct',
        apiKeyEnv: 'TEST_KEY',
        modelId: c.modelId.split('/').pop(),
      }),
    }
  );

  // First candidate had preflight and probe
  assert.equal(preflightsCalled, 1, 'First candidate preflight should run');
  assert.equal(probesCalled, 1, 'First candidate probe should run');
  assert.equal(candidates[0].capabilities.tools, true);

  // Second candidate skipped preflight and probe due to budget deadline
  assert.equal(candidates[1].capabilities.tools, undefined);
  assert.equal(candidates[1].capabilityEvidence.tools.unverified, true);
  assert.equal(candidates[1].capabilityEvidence.tools.reason, 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET');

  const routeHealth = require('../route-health');
  assert.equal(
    routeHealth.probeCooldown(candidates[1], { routeHealth: store }),
    null,
    'Candidate skipped due to budget exhaustion must not have cooldown'
  );
});

test('TASK-AI-142 P3: probeCapabilities threads priors/ranking.priors snapshot into ordering', async () => {
  const candidates = [
    {
      harness: 'opencode-direct',
      accessPath: 'direct',
      sourceId: 'src-low',
      accountId: 'acc-low',
      modelId: 'src-low/low-prior',
      capabilities: {},
    },
    {
      harness: 'opencode-direct',
      accessPath: 'direct',
      sourceId: 'src-high',
      accountId: 'acc-high',
      modelId: 'src-high/high-prior',
      capabilities: {},
    },
  ];

  const rankingSnapshot = {
    priors: {
      ranking: [
        { canonical: 'high-prior', codingTier: 'T1', benchmarks: { aaCodingIndex: 99 } },
        { canonical: 'low-prior', codingTier: 'T1', benchmarks: { aaCodingIndex: 50 } },
      ],
    },
  };

  const probedOrder = [];
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    probedOrder.push(body.model);
    const nonceMatch = String(body.messages?.[0]?.content || '').match(/nonce ([a-f0-9]+)/);
    const nonce = nonceMatch ? nonceMatch[1] : 'nonce';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: '1',
                  type: 'function',
                  function: { name: 'capability_probe', arguments: JSON.stringify({ nonce }) },
                },
              ],
            },
          },
        ],
      }),
    };
  };

  await capabilityProbe.probeCapabilities(
    candidates,
    { role: 'writer', requiredCapabilities: ['tools'] },
    {
      ranking: rankingSnapshot,
      fetch: mockFetch,
      schemaProbeBudgetMs: 10000,
      env: { TEST_KEY: 'secret' },
      httpRoute: (c) => ({
        endpoint: 'https://test.api/v1',
        accessPath: 'direct',
        apiKeyEnv: 'TEST_KEY',
        modelId: c.modelId.split('/').pop(),
      }),
    }
  );

  assert.deepEqual(
    probedOrder,
    ['high-prior', 'low-prior'],
    'high-prior model should be probed first when ranking.priors is threaded'
  );
});
