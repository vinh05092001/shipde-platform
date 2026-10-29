'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const routing = require('../routing');
const probeOrder = require('../probe-order');
const quotaScan = require('../quota-scan');
const { candidateKey } = require('../discovery/identity');

test('TASK-AI-142: UNSCOPED CLI route with high prior ranks below OK+COMPLETION route with lower prior', () => {
  const now = Date.now();
  const maxAgeMs = 86400000;
  const dispatchConfig = {
    routeEvidenceMaxAgeMs: maxAgeMs,
    probeTimeoutMs: 8000,
  };
  const registry = {
    sources: [
      {
        id: 'claude-code',
        kind: 'agent-cli',
        harness: 'paseo',
        accessPath: 'cli',
        servesModels: true,
      },
      {
        id: '9router',
        kind: 'router',
        harness: 'paseo',
        endpoint: 'http://127.0.0.1:20128/v1',
        servesModels: true,
      },
    ],
    dispatch: dispatchConfig,
  };

  const unscopedCli = {
    harness: 'paseo',
    accessPath: 'cli',
    gateway: 'claude-code',
    source: 'claude-code',
    upstream: 'claude-code',
    accountId: 'claude-native-b',
    quotaScope: 'claude-native-b',
    modelId: 'claude-opus-test',
    quality: 95,
    capabilities: { tools: true, jsonSchema: true, contextWindow: 200000 },
    evidence: [],
  };
  unscopedCli.candidateKey = candidateKey(unscopedCli);

  const okCompletion = {
    harness: 'paseo',
    accessPath: '9router',
    gateway: '9router',
    source: '9router',
    upstream: 'shipde-writer',
    accountId: '9router-key',
    quotaScope: 'shipde-writer',
    modelId: 'shipde-writer',
    quality: 60,
    capabilities: { tools: true, jsonSchema: true, contextWindow: 200000 },
    evidence: [],
  };
  okCompletion.candidateKey = candidateKey(okCompletion);

  const quotaState = {
    updatedAt: new Date(now).toISOString(),
    scopes: {
      'claude-native-b': {
        source: 'claude-code',
        scope: 'claude-native-b',
        code: 'UNSCOPED',
        reason: 'NO_CHEAP_CHECK',
        at: new Date(now - 1000).toISOString(),
      },
      'shipde-writer': {
        source: '9router',
        scope: 'shipde-writer',
        upstream: '9router',
        model: 'shipde-writer',
        code: 'OK',
        status: 200,
        reason: 'OK',
        evidence: 'COMPLETION',
        at: new Date(now - 1000).toISOString(),
      },
      '9router::shipde-writer': {
        source: '9router',
        scope: 'shipde-writer',
        upstream: '9router',
        model: 'shipde-writer',
        code: 'OK',
        status: 200,
        reason: 'OK',
        evidence: 'COMPLETION',
        at: new Date(now - 1000).toISOString(),
      },
    },
  };

  const priors = [
    { canonical: 'claude-opus-test', score: 95, liveBench: 95 },
    { canonical: 'shipde-writer', score: 60, liveBench: 60 },
  ];

  const profile = {
    taskId: 'TASK-FIXTURE',
    role: 'writer',
    complexity: 'standard',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    contextSize: 64000,
    qualityFloor: 50,
    costCeiling: 1000000,
  };

  const assessment = {
    weightProfile: 'BALANCED',
    weights: { quality: 50, latency: 25, cost: 25 },
  };

  const context = {
    now,
    registry,
    dispatchConfig,
    priors,
    quotaState,
    loadQuotaState: false,
    evidenceData: { combinations: [] },
  };

  // 1. In rankForProfile: OK+COMPLETION route ranks first despite lower prior score
  const rankResult = routing.rankForProfile(
    [unscopedCli, okCompletion],
    profile,
    assessment,
    context
  );
  assert.equal(
    rankResult.chosen,
    okCompletion.candidateKey,
    'OK+COMPLETION route must be chosen over UNSCOPED route'
  );
  assert.equal(
    rankResult.ranking[0].candidateKey,
    okCompletion.candidateKey,
    'OK+COMPLETION route must be rank 1'
  );
  assert.equal(
    rankResult.ranking[1].candidateKey,
    unscopedCli.candidateKey,
    'UNSCOPED route must rank below fresh OK'
  );

  // 2. In preferKnownGood: probe order prioritizes fresh OK+COMPLETION route
  const rawRanking = [
    { candidateKey: unscopedCli.candidateKey, score: 95 },
    { candidateKey: okCompletion.candidateKey, score: 60 },
  ];
  const probeResult = probeOrder.preferKnownGood(
    { chosen: unscopedCli.candidateKey, ranking: rawRanking },
    [unscopedCli, okCompletion],
    {
      now,
      registry,
      dispatchConfig,
      quotaState,
      evidenceData: { combinations: [] },
      routeHealth: { paths: {} },
    }
  );
  assert.equal(
    probeResult.chosen,
    okCompletion.candidateKey,
    'probe order must choose OK+COMPLETION candidate'
  );
  assert.equal(
    probeResult.ranking[0].candidateKey,
    okCompletion.candidateKey,
    'probe order must rank OK+COMPLETION first'
  );
});

test('TASK-AI-142: scanCliLanes records UNSCOPED explicitly with reason for CLI lanes without cheap check', async () => {
  const now = Date.now();
  const quotaState = { scopes: {} };
  const accounts = [
    {
      id: 'claude-fixture',
      provider: 'claude-code',
      launch: { kind: 'cli', command: 'nonexistent-claude-binary-xyz' },
    },
    {
      id: 'agy-custom-acc',
      provider: 'antigravity',
      launch: { kind: 'cli', command: 'agy' },
    },
  ];

  await quotaScan.scanCliLanes(quotaState, {
    now,
    accounts,
    poolRuntime: { discoverAccounts: () => [], quotaReading: () => null },
    readUsage: () => {
      throw new Error('CLI_NOT_FOUND');
    },
  });

  const claudeEntry = quotaState.scopes['claude-fixture'];
  assert.ok(claudeEntry, 'claude-fixture must have a quota-state record');
  assert.equal(claudeEntry.code, 'UNSCOPED');
  assert.match(claudeEntry.reason, /NO_CHEAP_CHECK/);

  const agyEntry = quotaState.scopes['agy-custom-acc'];
  assert.ok(agyEntry, 'agy-custom-acc must have a quota-state record');
  assert.equal(agyEntry.code, 'UNSCOPED');
  assert.match(agyEntry.reason, /NO_CHEAP_CHECK/);
});

test('TASK-AI-142: hasFreshOkOrCompletion fails closed on missing maxAge, excludes stale OK, and isolates sibling models', () => {
  const routeEvidence = require('../route-evidence');
  const now = Date.now();

  const candidate = {
    source: '9router',
    sourceId: '9router',
    modelId: 'anthropic/claude-3-5-sonnet',
  };

  const quotaStateOk = {
    scopes: {
      '9router::anthropic/claude-3-5-sonnet': {
        source: '9router',
        scope: 'anthropic/claude-3-5-sonnet',
        model: 'anthropic/claude-3-5-sonnet',
        code: 'OK',
        at: new Date(now - 1000).toISOString(),
      },
    },
  };

  // 1. Missing routeEvidenceMaxAgeMs MUST fail closed (return false)
  const missingMaxAge = routeEvidence.hasFreshOkOrCompletion(candidate, quotaStateOk, {
    now,
    dispatchConfig: {},
  });
  assert.equal(
    missingMaxAge,
    false,
    'must fail closed when routeEvidenceMaxAgeMs is not configured'
  );

  // 2. Stale OK (older than routeEvidenceMaxAgeMs) MUST return false
  const stale = routeEvidence.hasFreshOkOrCompletion(candidate, quotaStateOk, {
    now,
    dispatchConfig: { routeEvidenceMaxAgeMs: 500 }, // record is 1000ms old
  });
  assert.equal(stale, false, 'must return false when OK record is older than maxAgeMs');

  // 3. Sibling model OK or blanket source-level OK must NOT satisfy candidate
  const siblingCandidate = {
    source: '9router',
    sourceId: '9router',
    modelId: 'anthropic/claude-3-opus',
  };
  const blanketSourceQuotaState = {
    scopes: {
      '9router': {
        source: '9router',
        scope: '9router',
        code: 'OK',
        at: new Date(now - 100).toISOString(),
      },
      '9router::anthropic/claude-3-5-sonnet': {
        source: '9router',
        scope: 'anthropic/claude-3-5-sonnet',
        model: 'anthropic/claude-3-5-sonnet',
        code: 'OK',
        at: new Date(now - 100).toISOString(),
      },
    },
  };
  const siblingOk = routeEvidence.hasFreshOkOrCompletion(
    siblingCandidate,
    blanketSourceQuotaState,
    {
      now,
      dispatchConfig: { routeEvidenceMaxAgeMs: 60000 },
    }
  );
  assert.equal(
    siblingOk,
    false,
    'sibling model must not be satisfied by blanket source OK or other model OK'
  );
});
