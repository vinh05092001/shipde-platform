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
