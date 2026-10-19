'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const capabilityProbe = require('../capability-probe');
const probeOrder = require('../probe-order');
const decisions = require('../decisions');

test('TASK-AI-142 trial 14: recentRouteSuccess requires exact harness/source identity and fresh live evidence', () => {
  const combinations = [
    {
      harness: 'paseo',
      gateway: '9router',
      upstream: 'gcli',
      accountId: 'acct-1',
      model: 'gcli/grok-4.7',
      evidence: [
        {
          status: 'passed',
          level: 1,
          proofLevel: 'API_PASS',
          observedAt: new Date().toISOString(),
        },
      ],
    },
    {
      harness: 'opencode',
      gateway: 'tencent',
      upstream: 'tencent',
      accountId: 'acct-tencent',
      model: 'tencent/hy4-preview',
      evidence: [
        {
          status: 'passed',
          level: 2,
          proofLevel: 'WORK_ITEM_PASS',
          observedAt: new Date().toISOString(),
        },
      ],
    },
  ];

  // Paseo candidate with matching passed combo
  const candPaseo = {
    ...combinations[0],
    harness: 'paseo',
    accountId: 'acct-1',
    modelId: 'gcli/grok-4.7',
  };
  assert.equal(
    probeOrder.recentRouteSuccess(candPaseo, { paths: {} }, { evidenceData: { combinations } }),
    true,
    'Paseo candidate with API_PASS must match recent route success'
  );

  // opencode-direct candidate matching opencode combo
  const candDirect = {
    ...combinations[1],
    harness: 'opencode-direct',
    accountId: 'acct-tencent',
    modelId: 'tencent/hy4-preview',
  };
  assert.equal(
    probeOrder.recentRouteSuccess(candDirect, { paths: {} }, { evidenceData: { combinations } }),
    false,
    'opencode-direct must not borrow proof from opencode'
  );

  // Candidate without evidence
  const candNoEv = {
    harness: 'opencode-direct',
    accountId: 'unknown',
    modelId: 'unknown/model',
  };
  assert.equal(
    probeOrder.recentRouteSuccess(candNoEv, { paths: {} }, { evidenceData: { combinations } }),
    false,
    'Candidate without matching evidence must not match recent route success'
  );

  // Pool candidate with WORK_ITEM_PASS matches hasPriorWorkPass
  const poolCombinations = [
    {
      harness: 'agy-pool',
      accountId: 'agy01',
      model: 'gemini-3.8-flash-high',
      evidence: [
        {
          status: 'passed',
          level: 3,
          proofLevel: 'WORK_ITEM_PASS',
          observedAt: new Date().toISOString(),
        },
      ],
    },
  ];
  assert.equal(
    capabilityProbe.hasPriorWorkPass(
      { harness: 'agy-pool', accountId: 'agy01', modelId: 'gemini-3.8-flash-high' },
      poolCombinations
    ),
    true,
    'agy-pool with WORK_ITEM_PASS matches hasPriorWorkPass'
  );
});

test('TASK-AI-142 trial 14: orderCandidatesForProbe orders observed fast probes before observed slow probes', () => {
  const profile = { role: 'writer', requiredCapabilities: ['tools'] };
  const candidates = [
    { harness: 'agy-pool', modelId: 'gemini-3.8-flash-high', accountId: 'agy01', elapsedMs: 700 },
    { harness: 'codex', modelId: 'gpt-6.1-sol', accountId: 'codex-cli', elapsedMs: 500 },
    {
      harness: 'opencode-direct',
      modelId: 'tencent/hy4-preview',
      accountId: 'acct-tencent',
      elapsedMs: 10,
    },
    { harness: 'direct-http', modelId: 'sovinfra/sovapi', accountId: 'acct-sov', elapsedMs: 20 },
    { harness: 'paseo', modelId: '9router/model-x', accountId: 'xkiro', elapsedMs: 900 },
    { harness: 'paseo', modelId: 'gcli/grok-4.7', accountId: 'acct-1' },
  ];

  const combinations = [
    {
      harness: 'paseo',
      accountId: 'acct-1',
      model: 'gcli/grok-4.7',
      evidence: [
        {
          status: 'passed',
          level: 1,
          proofLevel: 'API_PASS',
          observedAt: new Date().toISOString(),
        },
      ],
    },
  ];

  const ordered = capabilityProbe.orderCandidatesForProbe(candidates, profile, {
    capabilityEvidence: { combinations },
    registry: { sources: [{ id: 'agy-pool', writerEnabled: true }] },
    // Quality priors also order probes; none here, so only measured cost decides.
    priors: { ranking: [] },
  });

  // Fresh API availability first; API remains distinct from work proof.
  assert.equal(ordered[0].modelId, 'gcli/grok-4.7');
  // Measured durations, not harness names, determine the remaining order.
  assert.equal(ordered[1].harness, 'opencode-direct');
  assert.equal(ordered[2].harness, 'direct-http');
  // Slower observed probes follow.
  assert.equal(ordered[3].harness, 'codex');
  assert.equal(ordered[4].harness, 'agy-pool');
  // The slowest measured route is last.
  assert.equal(ordered[5].modelId, '9router/model-x');
});

test('TASK-AI-142 trial 14: isolatedLaneRejected retains opencode-direct when agy-pool has bulk candidates', () => {
  const candidates = [];
  const rejected = [];

  // 1 codex candidate
  const codexKey = 'codex::cli::::codex::codex-cli::codex-cli::gpt-6.1-sol';
  candidates.push({ candidateKey: codexKey, harness: 'codex' });
  rejected.push({ candidateKey: codexKey, reason: 'WRITER_SCHEMA_CODEX_LAUNCH_FAILED' });

  // 80 agy-pool candidates (simulating trial 14)
  for (let i = 0; i < 80; i++) {
    const key = `agy-pool::ShipDe\\ShipDe-agy01::::antigravity::agy01::agy01:gemini::model-${i}`;
    candidates.push({ candidateKey: key, harness: 'agy-pool' });
    rejected.push({
      candidateKey: key,
      reason: i < 3 ? 'WRITER_SCHEMA_POOL_POOL_TIMEOUT' : 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET',
    });
  }

  // 50 opencode-direct candidates
  for (let i = 0; i < 50; i++) {
    const key = `opencode-direct::https://api.direct.com/v1::tencent::tencent::acct::acct::tencent/model-${i}`;
    candidates.push({ candidateKey: key, harness: 'opencode-direct' });
    rejected.push({ candidateKey: key, reason: 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET' });
  }

  const result = { rejected, chosen: null, ranking: [] };
  probeOrder.preferKnownGood(result, candidates, { routeHealth: { paths: {} } });

  const top10 = result.isolatedLaneRejected.slice(0, 10);
  const harnessesInTop10 = top10.map((r) => r.candidateKey.split('::')[0]);

  assert.ok(harnessesInTop10.includes('codex'), 'Top 10 must retain codex');
  assert.ok(harnessesInTop10.includes('agy-pool'), 'Top 10 must retain agy-pool');
  assert.ok(
    harnessesInTop10.includes('opencode-direct'),
    'Top 10 must retain opencode-direct even with 80 agy-pool candidates'
  );
});

test('TASK-AI-142 trial 14: capDecision preserves representative entries from all distinct harnesses and reasons in rejected', () => {
  const simulatedRejected = [
    // 50 paseo entries
    ...Array.from({ length: 50 }, (_, i) => ({
      candidateKey: `paseo::http://127.0.0.1:20128/v1::9router::route::xkiro::xkiro::model-${i}`,
      reasonCode: 'CAPABILITY_UNVERIFIED:tools',
    })),
    // 20 opencode entries
    ...Array.from({ length: 20 }, (_, i) => ({
      candidateKey: `opencode::cli::9router::upstream::ninerouter::ninerouter::ninerouter/model-${i}`,
      reasonCode: 'CAPABILITY_UNVERIFIED:tools',
    })),
    // 10 direct-http entries
    ...Array.from({ length: 10 }, (_, i) => ({
      candidateKey: `direct-http::direct::sovinfra::sovinfra::source-sovinfra::source-sovinfra::sovapi-${i}`,
      reasonCode: 'CAPABILITY_UNVERIFIED:tools',
    })),
    // 10 opencode-direct entries
    ...Array.from({ length: 10 }, (_, i) => ({
      candidateKey: `opencode-direct::https://api.pgsgrove.com/v1::pgsgrove::pgsgrove::acct::acct::model-${i}`,
      reasonCode: 'CAPABILITY_UNVERIFIED:tools',
    })),
    // 1 codex
    {
      candidateKey: 'codex::cli::::codex::codex-cli::codex-cli::gpt-6.1-sol',
      reasonCode: 'CAPABILITY_MISSING:tools',
    },
    // 5 agy-pool
    {
      candidateKey:
        'agy-pool::ShipDe\\ShipDe-agy01::::antigravity::agy01::agy01:gemini::gemini-3.8-flash-high',
      reasonCode: 'CAPABILITY_MISSING:tools',
    },
  ];

  const capped = decisions.capDecision({ rejected: simulatedRejected });
  assert.equal(capped.rejectedCount, simulatedRejected.length);
  assert.equal(capped.rejected.length, 10);

  const harnessesInSample = capped.rejected.map((r) => r.candidateKey.split('::')[0]);
  assert.ok(harnessesInSample.includes('paseo'), 'rejected sample must include paseo');
  assert.ok(harnessesInSample.includes('opencode'), 'rejected sample must include opencode');
  assert.ok(harnessesInSample.includes('direct-http'), 'rejected sample must include direct-http');
  assert.ok(
    harnessesInSample.includes('opencode-direct'),
    'rejected sample must include opencode-direct'
  );
  assert.ok(harnessesInSample.includes('codex'), 'rejected sample must include codex');
  assert.ok(harnessesInSample.includes('agy-pool'), 'rejected sample must include agy-pool');
});
