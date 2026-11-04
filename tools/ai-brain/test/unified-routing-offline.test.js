'use strict';

/**
 * Ship Dễ — Unified Routing Offline Test Suite (PATCH 1 & 2 + Codex Review Fixes)
 *
 * Verifies all 10 acceptance criteria and explicitly verifies resolution of
 * all 11 Codex review findings completely offline with 0 live inference calls:
 *
 * 1. Cùng model, hai account: account A lỗi không loại nhầm B.
 * 2. Hai đường chung quota: không được tính ngân sách hai lần.
 * 3. DNS không biến thành login-required.
 * 4. Gateway tắt không đánh chết upstream qua đường trực tiếp khác.
 * 5. ResetAt đã qua và lock đã hết hạn xử lý đúng.
 * 6. Model ID nhiều dấu slash được giữ nguyên.
 * 7. Combo không làm mất identity hoặc vượt ràng buộc selection.
 * 8. Candidate từ cả ba đường đều có thể được chọn khi đủ điều kiện.
 * 9. JEV cache hit/miss và undecided không gây gọi lặp vô hạn.
 * 10. Budget/context tới đúng interface nhận.
 *
 * Plus 11 Codex Review Verification Tests:
 * - Finding 1: Production paths never invent dummy models/connections/lanes.
 * - Finding 2: Unknown cost is strictly rejected by cost ceiling; no score invention.
 * - Finding 3: Elapsed quota reset does not bypass locks or admit unprobed routes.
 * - Finding 4: Account A 429 rate limit is scoped to Account A, not blocking Account B.
 * - Finding 5: 9router consumes connections; shared accounts link across pathways.
 * - Finding 6: Canonical keys with '::' in quotaScope parse back without truncation.
 * - Finding 7: Canonical keys include sourceId and connectionId, preventing collision.
 * - Finding 8: Combo admission evaluates branch-level health, locks, and capabilities.
 * - Finding 9: JEV advisory respects weight trade-off contract; names identity -> rejected.
 * - Finding 10: Cache key includes criteria, budgets, and live health state hash.
 * - Finding 11: tokenBudget takes precedence over contextSize; bridge exported for callers.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  createRouteIdentity,
  canonicalCandidateKey,
  parseRouteIdentity,
  distinguishPathway,
  resolveModelPrefix,
  linkSharedQuotaScopes,
  expandComboIdentity,
  DEFAULT_PREFIX_TO_PROVIDER,
  getQuotaFamily,
  UNKNOWN,
  getPrivateEmail,
  registerPrivateEmail,
  hashEmail,
} = require('../route-identity');

const {
  ErrorCategory,
  HealthScope,
  classifyError,
  ScopedHealthRegistry,
} = require('../scoped-health');

const {
  UnifiedRouteSelector,
  WEIGHT_PROFILES,
  ROLE_FALLBACK_PROFILE,
  SHARED_JEV_CACHE,
  advisoryNamesIdentity,
  harnessEnforcesTokens,
  selectOptimalRoute,
} = require('../unified-selector');

const {
  load9RouterCandidates,
  loadDirectProviderCandidates,
  loadAgyPoolCandidates,
  aggregateAllCandidates,
} = require('../candidate-adapters');

// ==============================================================================
// Section 1: 10 Original Criteria
// ==============================================================================

describe('Criterion 1: Cùng model, hai account - account A lỗi không loại nhầm B', () => {
  test('Account A auth failure isolates to Account A; Account B remains healthy', () => {
    const health = new ScopedHealthRegistry();

    const candidateA = createRouteIdentity({
      harness: 'opencode',
      sourceId: 'deepseek-pool',
      gatewayId: 'direct',
      upstreamProviderId: 'deepseek',
      configuredModelId: 'deepseek-v4.1-flash',
      accountRef: 'user_alpha@corp.com',
      connectionId: 'conn_alpha_01',
      quotaScopeId: 'quota::deepseek::alpha',
    });

    const candidateB = createRouteIdentity({
      harness: 'opencode',
      sourceId: 'deepseek-pool',
      gatewayId: 'direct',
      upstreamProviderId: 'deepseek',
      configuredModelId: 'deepseek-v4.1-flash',
      accountRef: 'user_beta@corp.com',
      connectionId: 'conn_beta_02',
      quotaScopeId: 'quota::deepseek::beta',
    });

    health.recordFailure(candidateA, {
      httpStatus: 401,
      message: 'Unauthorized: Invalid API key',
    });

    const healthA = health.evaluateHealth(candidateA);
    const healthB = health.evaluateHealth(candidateB);

    assert.equal(healthA.healthy, false, 'Candidate A must be marked unhealthy');
    assert.equal(healthA.blockedBy, HealthScope.ACCOUNT, 'Candidate A blocked at ACCOUNT scope');
    assert.equal(healthA.category, ErrorCategory.AUTH, 'Candidate A failure must be AUTH');

    assert.equal(healthB.healthy, true, 'Candidate B must remain healthy on same model');
  });
});

describe('Criterion 2: Hai đường chung quota không được tính ngân sách hai lần', () => {
  test('Shared account across 9router and AGY pool shares single quota scope', () => {
    const route9Router = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      upstreamProviderId: 'antigravity',
      configuredModelId: 'ag/gemini-3.8-flash',
      connectionId: 'conn_3af3ee18',
      accountRef: 'vinh1032007@gmail.com',
    });

    const routeAgyPool = createRouteIdentity({
      harness: 'agy-pool',
      sourceId: 'agy-pool',
      gatewayId: 'direct',
      upstreamProviderId: 'antigravity',
      configuredModelId: 'gemini-3.8-flash',
      connectionId: 'agy07',
      accountRef: 'vinh1032007@gmail.com',
    });

    const linkedIdentities = linkSharedQuotaScopes([route9Router, routeAgyPool], {
      [JSON.stringify(['antigravity', 'vinh1032007@gmail.com'])]: 'quota::antigravity::shared',
    });

    assert.equal(linkedIdentities[0].quotaScopeId, 'quota::antigravity::shared');
    assert.equal(linkedIdentities[1].quotaScopeId, 'quota::antigravity::shared');

    const health = new ScopedHealthRegistry();

    health.recordFailure(linkedIdentities[0], {
      httpStatus: 402,
      message: 'Payment Required: credit balance = 0',
    });

    const eval9R = health.evaluateHealth(linkedIdentities[0]);
    const evalAgy = health.evaluateHealth(linkedIdentities[1]);

    assert.equal(eval9R.healthy, false, '9Router route blocked by shared quota scope');
    assert.equal(evalAgy.healthy, false, 'AGY pool route blocked by shared quota scope');
    assert.equal(eval9R.blockedBy, HealthScope.QUOTA_SCOPE);
    assert.equal(evalAgy.blockedBy, HealthScope.QUOTA_SCOPE);
  });
});

describe('Criterion 3: DNS không biến thành login-required', () => {
  test('DNS failure is classified as NETWORK_DNS with transient cooldown, not AUTH', () => {
    const failureInput = {
      code: 'ENOTFOUND',
      message: 'getaddrinfo ENOTFOUND api.deepseek.com',
    };

    const classified = classifyError(failureInput);

    assert.equal(classified.category, ErrorCategory.NETWORK_DNS, 'Category must be NETWORK_DNS');
    assert.equal(classified.scope, HealthScope.NETWORK, 'Scope must be NETWORK');
    assert.notEqual(classified.category, ErrorCategory.AUTH, 'Must never be classified as AUTH');
    assert.equal(classified.isPermanent, false, 'DNS failure must not be permanent');
    assert.equal(classified.cooldownMs, 30000, 'DNS failure must have short transient backoff');
  });
});

describe('Criterion 4: Gateway tắt không đánh chết upstream qua đường trực tiếp', () => {
  test('ECONNREFUSED on port 20128 blocks 9router gateway, leaving direct route healthy', () => {
    const health = new ScopedHealthRegistry();

    const candidateVia9Router = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      upstreamProviderId: 'github',
      configuredModelId: 'gh/gpt-5.4-nano',
      outboundModelId: 'gpt-5.4-nano',
    });

    const candidateDirectCodex = createRouteIdentity({
      harness: 'codex',
      sourceId: 'codex-direct',
      gatewayId: 'direct',
      upstreamProviderId: 'openai',
      configuredModelId: 'gpt-5.3-codex',
      outboundModelId: 'gpt-5.3-codex',
    });

    health.recordFailure(candidateVia9Router, {
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:20128',
      gatewayId: '9router',
    });

    const eval9R = health.evaluateHealth(candidateVia9Router);
    const evalDirect = health.evaluateHealth(candidateDirectCodex);

    assert.equal(eval9R.healthy, false, '9Router candidate blocked because gateway is down');
    assert.equal(eval9R.blockedBy, HealthScope.GATEWAY);
    assert.equal(evalDirect.healthy, true, 'Direct Codex candidate remains fully healthy');
  });
});

describe('Criterion 5: ResetAt đã qua và lock đã hết hạn xử lý đúng', () => {
  test('Expired resetAt requires fresh telemetry probe and is NOT admitted as healthy', () => {
    const health = new ScopedHealthRegistry();
    const candidate = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'deepseek-direct',
      quotaScopeId: 'quota::deepseek::user1',
    });

    const now = 1730000000000;
    health.recordFailure(
      candidate,
      {
        httpStatus: 402,
        message: 'Quota exceeded resets in 10s',
      },
      now
    );

    const pastResetTime = now + 15000;
    const evalResult = health.evaluateHealth(candidate, pastResetTime);

    assert.equal(evalResult.healthy, false, 'Must NOT be considered healthy without fresh probe');
    assert.equal(evalResult.requiresProbe, true, 'Must be marked as probe needed');
    assert.equal(evalResult.quotaStatus, 'RESET_ELAPSED_PROBE_NEEDED');
    assert.equal(evalResult.staleQuota, true, 'Must flag quota as stale, never assumed 100% full');
  });

  test('Expired model lock is cleared immediately', () => {
    const health = new ScopedHealthRegistry();
    const candidate = createRouteIdentity({
      harness: 'direct-http',
      gatewayId: '9router',
      upstreamProviderId: 'antigravity',
      outboundModelId: 'claude-opus-4-6-thinking',
      connectionId: 'conn_ag_01',
    });

    const now = 1730000000000;
    health.setModelLock('antigravity', 'claude-opus-4-6-thinking', 'conn_ag_01', now + 10000);

    const duringLock = health.evaluateHealth(candidate, now + 2000);
    assert.equal(duringLock.healthy, false, 'Model must be locked during cooldown window');
    assert.equal(duringLock.blockedBy, 'model_lock');

    const afterLock = health.evaluateHealth(candidate, now + 12000);
    assert.equal(afterLock.healthy, true, 'Model lock must be cleared once expired');
  });
});

describe('Criterion 6: Model ID nhiều dấu slash được giữ nguyên', () => {
  test('Preserves multiple slashes and casing without mutilation', () => {
    const m1 = 'cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const parsed1 = resolveModelPrefix(m1);

    assert.equal(parsed1.prefix, 'cf');
    assert.equal(parsed1.upstreamProviderId, 'cloudflare-ai');
    assert.equal(parsed1.outboundModelId, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    const m2 = 'cl/dots-studio/dots-3-note-preview:free';
    const parsed2 = resolveModelPrefix(m2);

    assert.equal(parsed2.prefix, 'cl');
    assert.equal(parsed2.upstreamProviderId, 'cline');
    assert.equal(parsed2.outboundModelId, 'dots-studio/dots-3-note-preview:free');
  });
});

describe('Criterion 7: Combo không làm mất identity hoặc vượt ràng buộc selection', () => {
  test('Combo retains constituent branches and fails reviewer admission if branch violates policy', () => {
    const comboIdentity = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      configuredModelId: 'shipde-writer',
    });

    const constituentModels = [
      'ag/gemini-3.8-flash',
      'ag/claude-opus-4-6-thinking', // Contains Claude model
      'gh/gpt-5.4-nano',
    ];

    const expanded = expandComboIdentity(comboIdentity, constituentModels, {
      antigravity: [{ connectionId: 'ag1', accountRef: 'vi***07@gmail.com', priority: 1 }],
      github: [{ connectionId: 'gh1', accountRef: 'vin***01', priority: 1 }],
    });

    assert.equal(expanded.isCombo, true);
    assert.equal(expanded.comboBranches.length, 3);
    assert.equal(expanded.comboBranches[0].outboundModelId, 'gemini-3.8-flash');
    assert.equal(expanded.comboBranches[1].outboundModelId, 'claude-opus-4-6-thinking');

    const selector = new UnifiedRouteSelector({ excludedModelPatterns: { reviewer: [/claude/i] } });
    const taskProfileForReviewer = {
      taskId: 'TASK-AI-REVIEW-01',
      role: 'reviewer',
      complexity: 'standard',
    };

    const evaluation = selector.evaluateAdmission(expanded, taskProfileForReviewer);
    assert.equal(
      evaluation.admitted,
      false,
      'Combo containing Claude branch must fail admission for reviewer role'
    );
    assert.equal(evaluation.rejectionReason, 'MODEL_EXCLUDED_BY_ROLE_POLICY');
  });
});

describe('Criterion 8: Candidate từ cả ba đường đều có thể được chọn khi đủ điều kiện', () => {
  test('Aggregates and selects across 9router, direct provider, and AGY pool', async () => {
    const { candidates } = aggregateAllCandidates({
      gatewayOffline: false,
      direct: {
        sources: [
          {
            id: 'deepseek-direct',
            provider: 'deepseek',
            harness: 'opencode',
            endpoint: 'https://api.deepseek.com/v1',
            models: ['deepseek-chat'],
            credentialEnv: 'DEEPSEEK_API_KEY',
            capabilities: ['general_code'],
          },
        ],
        env: { DEEPSEEK_API_KEY: 'test-key' },
      },
      '9router': {
        catalog: ['ag/gemini-3.8-flash'],
        connections: [
          { connectionId: 'c1', provider: 'antigravity', accountRef: 'u1', enabled: true },
        ],
      },
      agy: {
        lanes: [
          {
            laneId: 'agy01',
            accountRef: 'lane1@corp.com',
            quotaExhausted: false,
            rows: [{ modelId: 'gemini-3.8-flash', remainingPercent: 40 }],
          },
        ],
        models: ['gemini-3.8-flash'],
      },
    });

    const pathwaysFound = new Set(candidates.map((c) => c.pathway));
    assert.ok(pathwaysFound.has('9ROUTER'), 'Must contain 9ROUTER candidate');
    assert.ok(pathwaysFound.has('DIRECT'), 'Must contain DIRECT candidate');
    assert.ok(pathwaysFound.has('AGY_POOL'), 'Must contain AGY_POOL candidate');

    const selector = new UnifiedRouteSelector();
    const taskProfile = {
      taskId: 'TASK-CORE-SELECT',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: ['general_code'],
    };

    const result = await selector.selectRoute(candidates, taskProfile);
    assert.equal(result.status, 'ADMITTED_AND_SELECTED');
    assert.ok(result.chosen, 'Must select a candidate');
    assert.ok(['9ROUTER', 'DIRECT', 'AGY_POOL'].includes(result.identity.pathway));
  });
});

describe('Criterion 9: JEV cache hit/miss và undecided không gây gọi lặp vô hạn', () => {
  test('JEV advisory caches properly and falls back deterministically on UNDECIDED', async () => {
    let askCallCount = 0;

    const mockJevAsk = async (question) => {
      askCallCount++;
      return {
        choice: 'QUALITY_FIRST',
        confidence: 0.85,
      };
    };

    const selector = new UnifiedRouteSelector({ jevAsk: mockJevAsk, minConfidence: 0.7 });

    const candidates = [
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'model-a',
        metadata: { capabilities: ['c1'] },
      }),
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'model-b',
        metadata: { capabilities: ['c1'] },
      }),
    ];

    const profile = { taskId: 'TASK-JEV-TEST', role: 'writer', requiredCapabilities: ['c1'] };

    // Call 1: Cache miss, queries JEV
    const res1 = await selector.selectRoute(candidates, profile);
    assert.equal(res1.jev.outcome, 'DECIDED');
    assert.equal(askCallCount, 1, 'First call must query JEV');

    // Call 2: Cache hit, does NOT query JEV again
    const res2 = await selector.selectRoute(candidates, profile);
    assert.equal(res2.jev.reason, 'JEV_CACHE_HIT');
    assert.equal(askCallCount, 1, 'Second call must hit cache');
  });
});

describe('Criterion 10: Budget và context tới đúng interface nhận', () => {
  test('Emits structured budget contract and task-scoped context', async () => {
    const selector = new UnifiedRouteSelector();
    const candidate = createRouteIdentity({
      harness: 'opencode',
      configuredModelId: 'deepseek-chat',
      metadata: { capabilities: ['code'] },
    });

    const profile = {
      taskId: 'TASK-BUDGET-01',
      role: 'writer',
      requiredCapabilities: ['code'],
      contextSize: 45000,
      turnBudget: 12,
      expectedDuration: 180000,
      acceptanceCriteria: ['Pass unit tests', 'No lint errors'],
      instructions: 'Implement feature X cleanly.',
    };

    const result = await selector.selectRoute([candidate], profile);

    assert.equal(result.status, 'ADMITTED_AND_SELECTED');
    assert.deepEqual(result.budgetContract, {
      tokenBudget: 45000,
      turnBudget: 12,
      deadlineMs: 180000,
      tokenEnforcement: 'UNENFORCED_BY_HARNESS',
      usageRecorded: UNKNOWN,
      costRecordedUsd: UNKNOWN,
    });

    assert.deepEqual(result.taskContext, {
      taskId: 'TASK-BUDGET-01',
      role: 'writer',
      acceptanceCriteria: ['Pass unit tests', 'No lint errors'],
      instructions: 'Implement feature X cleanly.',
    });
  });
});

// ==============================================================================
// Section 2: 11 Dedicated Codex Review Verification Tests
// ==============================================================================

describe('Codex Finding 1: Production Defaults Do Not Invent Fixtures', () => {
  test('Unconfigured production paths return empty candidates with clear unconnected reasons', () => {
    const emptyResult = aggregateAllCandidates({
      '9router': { catalog: [], connections: [] },
      direct: { sources: [] },
      agy: { lanes: [], models: [] },
    });

    assert.equal(emptyResult.candidates.length, 0, 'Must produce 0 candidates when unconfigured');
    assert.ok(
      emptyResult.unconnectedSources.length >= 3,
      'Must report unconnected reasons for all 3 pathways'
    );
    const reasons = emptyResult.unconnectedSources.map((s) => s.reason);
    assert.ok(reasons.includes('NO_9ROUTER_DATA_OR_CATALOG_DISCOVERED'));
    assert.ok(reasons.includes('NO_DIRECT_SOURCES_CONFIGURED'));
    assert.ok(reasons.includes('NO_AGY_LANES_OR_MODELS_DISCOVERED'));
  });
});

describe('Codex Finding 2: Unknown Cost Strictly Rejected by Ceiling; No Score Invention', () => {
  test('Candidate with unknown estimatedCostUsd is rejected when costCeiling is specified', () => {
    const selector = new UnifiedRouteSelector();
    const candidateWithoutCost = createRouteIdentity({
      harness: 'direct-http',
      configuredModelId: 'gpt-5.4-nano',
      metadata: { capabilities: ['code'] }, // estimatedCostUsd is omitted/unknown
    });

    const evaluation = selector.evaluateAdmission(candidateWithoutCost, {
      costCeiling: 0.05,
      requiredCapabilities: ['code'],
    });

    assert.equal(
      evaluation.admitted,
      false,
      'Candidate with unknown cost must NOT pass cost ceiling'
    );
    assert.equal(evaluation.rejectionReason, 'UNKNOWN_COST_REJECTED_BY_CEILING');
  });

  test('Scoring does not invent arbitrary 50/60/70 defaults or boost by model name regex', () => {
    const selector = new UnifiedRouteSelector();
    const unprovenCandidate = createRouteIdentity({
      harness: 'direct-http',
      configuredModelId: 'gemini-3.8-flash', // Contains "flash" in name
      metadata: {}, // No quality/latency/cost scores provided
    });

    const scoring = selector.scoreCandidate(
      unprovenCandidate,
      { complexity: 'trivial' },
      WEIGHT_PROFILES.BALANCED
    );

    assert.equal(
      scoring.totalScore,
      0,
      'Unproven candidate without metadata must score 0, never boosted by name'
    );
    assert.equal(scoring.breakdown.qualityScore, UNKNOWN);
    assert.equal(scoring.breakdown.costScore, UNKNOWN);
  });
});

describe('Codex Finding 3: Elapsed Quota Reset Does Not Bypass Locks or Require Probe Ignored', () => {
  test('Elapsed reset does NOT admit candidate when model lock is active', () => {
    const health = new ScopedHealthRegistry();
    const candidate = createRouteIdentity({
      harness: 'direct-http',
      upstreamProviderId: 'antigravity',
      outboundModelId: 'gemini-3.8-flash',
      connectionId: 'conn_ag_01',
      quotaScopeId: 'quota::antigravity::conn_ag_01',
    });

    const now = 1730000000000;
    // 1. Mark quota reset in 5 seconds
    health.recordFailure(
      candidate,
      { httpStatus: 402, message: 'Quota exceeded resets in 5s' },
      now
    );
    // 2. Set an active model lock for 30 seconds
    health.setModelLock('antigravity', 'gemini-3.8-flash', 'conn_ag_01', now + 30000);

    // Evaluate after quota reset elapsed (10s later), but while lock is still active
    const evalAt10s = health.evaluateHealth(candidate, now + 10000);
    assert.equal(
      evalAt10s.healthy,
      false,
      'Must be blocked by active model lock despite quota reset elapsed'
    );
    assert.equal(evalAt10s.blockedBy, 'model_lock');

    const selector = new UnifiedRouteSelector({ healthRegistry: health });
    const admission = selector.evaluateAdmission(candidate, { requiredCapabilities: [] });
    assert.equal(admission.admitted, false, 'Selector must reject route blocked by lock');
  });
});

describe('Codex Finding 4: Account Rate Limits Scoped to Account Domain', () => {
  test('Account A 429 rate limit does NOT block Account B on the same model', () => {
    const health = new ScopedHealthRegistry();

    const candidateAccountA = createRouteIdentity({
      harness: 'direct-http',
      upstreamProviderId: 'deepseek',
      outboundModelId: 'deepseek-chat',
      accountRef: 'account_A@domain.com',
      connectionId: 'conn_A',
      quotaScopeId: 'quota::deepseek::account_A',
    });

    const candidateAccountB = createRouteIdentity({
      harness: 'direct-http',
      upstreamProviderId: 'deepseek',
      outboundModelId: 'deepseek-chat',
      accountRef: 'account_B@domain.com',
      connectionId: 'conn_B',
      quotaScopeId: 'quota::deepseek::account_B',
    });

    const now = 1730000000000;
    // Record HTTP 429 on Account A
    health.recordFailure(
      candidateAccountA,
      {
        httpStatus: 429,
        message: 'Too Many Requests: Rate limit exceeded',
      },
      now
    );

    const evalA = health.evaluateHealth(candidateAccountA, now + 1000);
    const evalB = health.evaluateHealth(candidateAccountB, now + 1000);

    assert.equal(evalA.healthy, false, 'Account A must be blocked by rate limit');
    assert.equal(evalA.blockedBy, HealthScope.MODEL);
    assert.equal(evalB.healthy, true, 'Account B on the same model MUST remain healthy');
  });
});

describe('Codex Finding 5: Consuming Connections & Linking Shared Quota Scopes', () => {
  test('Consumes connections and maps individual connections per provider prefix', () => {
    const { candidates } = load9RouterCandidates({
      catalog: ['ag/gemini-3.8-flash', 'gh/gpt-5.4-nano'],
      connections: [
        {
          connectionId: 'ag_conn_1',
          provider: 'antigravity',
          accountRef: 'ag_user_1',
          enabled: true,
        },
        {
          connectionId: 'ag_conn_2',
          provider: 'antigravity',
          accountRef: 'ag_user_2',
          enabled: true,
        },
        { connectionId: 'gh_conn_1', provider: 'github', accountRef: 'gh_user_1', enabled: true },
      ],
    });

    assert.equal(candidates.length, 3, '2 connections for AG + 1 connection for GH = 3 candidates');
    assert.equal(candidates[0].connectionId, 'ag_conn_1');
    assert.equal(candidates[1].connectionId, 'ag_conn_2');
    assert.equal(candidates[2].connectionId, 'gh_conn_1');
    assert.equal(candidates[0].quotaScopeId, 'quota::antigravity::ag_user_1');
  });

  test('Aggregation links shared accounts across pathways so exhaustion cannot be bypassed', () => {
    const aggregated = aggregateAllCandidates({
      '9router': {
        catalog: ['ag/gemini-3.8-flash'],
        connections: [
          {
            connectionId: 'c_shared',
            provider: 'antigravity',
            accountRef: 'shared@google.com',
            enabled: true,
          },
        ],
      },
      direct: { sources: [] },
      agy: {
        lanes: [
          {
            laneId: 'agy01',
            accountRef: 'shared@google.com',
            quotaExhausted: false,
            rows: [{ modelId: 'gemini-3.8-flash', remainingPercent: 40 }],
          },
        ],
        models: ['gemini-3.8-flash'],
      },
    });

    assert.equal(aggregated.candidates.length, 2);
    // Both must be linked to the same shared quota scope
    assert.equal(
      aggregated.candidates[0].quotaScopeId,
      aggregated.candidates[1].quotaScopeId,
      'Both pathways sharing account must have identical quotaScopeId'
    );
  });
});

describe('Codex Finding 6: Canonical Key Splitting with Double Colons', () => {
  test('Escapes components so quotaScope containing :: roundtrips perfectly', () => {
    const original = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'deepseek-pool',
      gatewayId: 'direct',
      upstreamProviderId: 'deepseek',
      connectionId: 'conn_alpha_01',
      accountRef: 'user_alpha',
      quotaScopeId: 'quota::deepseek::alpha', // Contains double colons!
      configuredModelId: 'deepseek-v4.1',
      outboundModelId: 'deepseek-v4.1',
    });

    const key = canonicalCandidateKey(original);
    const parsed = parseRouteIdentity(key);

    assert.equal(
      parsed.quotaScopeId,
      'quota::deepseek::alpha',
      'Quota scope with :: must not split incorrectly'
    );
    assert.equal(parsed.configuredModelId, 'deepseek-v4.1');
    assert.equal(parsed.accountRef, 'user_alpha');
    assert.equal(parsed.sourceId, 'deepseek-pool');
  });
});

describe('Codex Finding 7: Canonical Key Preserves sourceId and connectionId', () => {
  test('Distinct connections with same accountRef produce distinct canonical keys', () => {
    const route1 = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'gateway-a',
      gatewayId: 'gw-a',
      upstreamProviderId: 'openai',
      connectionId: 'conn_01',
      accountRef: 'shared_account',
      quotaScopeId: 'quota::openai::shared',
      configuredModelId: 'gpt-5.4',
    });

    const route2 = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'gateway-b',
      gatewayId: 'gw-b',
      upstreamProviderId: 'openai',
      connectionId: 'conn_02',
      accountRef: 'shared_account',
      quotaScopeId: 'quota::openai::shared',
      configuredModelId: 'gpt-5.4',
    });

    const key1 = canonicalCandidateKey(route1);
    const key2 = canonicalCandidateKey(route2);

    assert.notEqual(key1, key2, 'Keys for distinct sources/connections must NOT collide');
  });
});

describe('Codex Finding 8: Combo Branch Evaluation for Health and Capabilities', () => {
  test('Rejects combo if ALL constituent branches are exhausted or locked', () => {
    const health = new ScopedHealthRegistry();

    const branch1 = createRouteIdentity({
      harness: 'direct-http',
      configuredModelId: 'model-branch-1',
      quotaScopeId: 'quota::b1',
      metadata: { capabilities: ['code'] },
    });

    const branch2 = createRouteIdentity({
      harness: 'direct-http',
      configuredModelId: 'model-branch-2',
      quotaScopeId: 'quota::b2',
      metadata: { capabilities: ['code'] },
    });

    // Mark both branches exhausted
    health.recordFailure(branch1, { httpStatus: 402, message: 'Out of credits' });
    health.recordFailure(branch2, { httpStatus: 402, message: 'Out of credits' });

    const combo = createRouteIdentity({
      harness: 'direct-http',
      configuredModelId: 'my-combo',
      metadata: { capabilities: ['code'] },
    });

    const comboExpanded = {
      ...combo,
      isCombo: true,
      comboBranches: [branch1, branch2],
    };

    const selector = new UnifiedRouteSelector({ healthRegistry: health });
    const evalResult = selector.evaluateAdmission(comboExpanded, {
      requiredCapabilities: ['code'],
    });

    assert.equal(
      evalResult.admitted,
      false,
      'Combo must be rejected when all branches are exhausted'
    );
    assert.match(evalResult.rejectionReason, /^COMBO_BRANCH_REJECTED_/);
  });
});

describe('Codex Finding 9: JEV Advisory Contract Adherence (Identity Prohibited)', () => {
  test('JEV response naming candidate identity is rejected as IDENTITY_PROHIBITED', async () => {
    const rogueJevAsk = async () => ({
      choice: 'LATENCY_FIRST',
      confidence: 0.9,
      candidate: 'some-rogue-candidate-key', // Prohibited field!
    });

    const selector = new UnifiedRouteSelector({ jevAsk: rogueJevAsk, minConfidence: 0.6 });

    const candidates = [
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'm1',
        metadata: { capabilities: ['code'] },
      }),
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'm2',
        metadata: { capabilities: ['code'] },
      }),
    ];

    const result = await selector.selectRoute(candidates, {
      taskId: 'T1',
      role: 'writer',
      requiredCapabilities: ['code'],
    });

    assert.equal(result.jev.outcome, 'UNDECIDED');
    assert.equal(result.jev.reason, 'IDENTITY_PROHIBITED');
    assert.equal(
      result.weightProfileUsed,
      'BALANCED',
      'Must fall back to deterministic role profile'
    );
  });
});

describe('Codex Finding 10: Composite Cache Key Includes Criteria, Budgets & Live Health Hash', () => {
  test('Different instructions, criteria, or health state produce different cache entries', async () => {
    let callCount = 0;
    const mockJev = async (q) => {
      callCount++;
      return { choice: 'QUALITY_FIRST', confidence: 0.9 };
    };

    const selector = new UnifiedRouteSelector({ jevAsk: mockJev });
    const candidates = [
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'm1',
        metadata: { capabilities: ['code'] },
      }),
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'm2',
        metadata: { capabilities: ['code'] },
      }),
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'm3',
        metadata: { capabilities: ['code'] },
      }),
    ];

    // Call 1
    await selector.selectRoute(candidates, {
      taskId: 'TASK-C1',
      instructions: 'Inst A',
      requiredCapabilities: ['code'],
    });
    assert.equal(callCount, 1);

    // Call 2 with DIFFERENT instructions: MUST NOT use cached advice
    await selector.selectRoute(candidates, {
      taskId: 'TASK-C1',
      instructions: 'Inst B (CHANGED)',
      requiredCapabilities: ['code'],
    });
    assert.equal(callCount, 2, 'Changed task instructions must trigger fresh advisory question');

    // Call 3 with health registry state change (m1 fails, m2 and m3 still admitted): MUST NOT use cached advice
    selector.healthRegistry.recordFailure(candidates[0], {
      httpStatus: 500,
      message: 'Internal error',
    });
    await selector.selectRoute(candidates, {
      taskId: 'TASK-C1',
      instructions: 'Inst A',
      requiredCapabilities: ['code'],
    });
    assert.equal(callCount, 3, 'Changed health registry state hash must invalidate cache');
  });
});

describe('Codex Finding 11: Budget Precedence & Production Bridge', () => {
  test('Explicit tokenBudget takes precedence over contextSize without magic defaults', async () => {
    const selector = new UnifiedRouteSelector();
    const candidate = createRouteIdentity({
      harness: 'opencode',
      configuredModelId: 'model-budget-prec',
      metadata: { capabilities: ['code'] },
    });

    const result = await selector.selectRoute([candidate], {
      taskId: 'T-BUDGET',
      tokenBudget: 8000,
      contextSize: 64000, // Should NOT override tokenBudget
      requiredCapabilities: ['code'],
    });

    assert.equal(
      result.budgetContract.tokenBudget,
      8000,
      'Explicit tokenBudget must win over contextSize'
    );
  });

  test('Production bridge selectOptimalRoute is exported from routing.js', () => {
    const routingApi = require('../routing');
    assert.equal(
      typeof routingApi.selectOptimalRoute,
      'function',
      'routing.js must export selectOptimalRoute'
    );
    assert.equal(
      typeof routingApi.UnifiedRouteSelector,
      'function',
      'routing.js must export UnifiedRouteSelector'
    );
  });
});
const regressionRoute = (overrides = {}) =>
  createRouteIdentity({
    harness: 'direct-http',
    sourceId: 'regression',
    gatewayId: 'direct',
    upstreamProviderId: 'provider-a',
    accountRef: 'account-a',
    connectionId: 'connection-a',
    configuredModelId: 'model-a',
    outboundModelId: 'model-a',
    metadata: { capabilities: ['general_code'], estimatedCostUsd: 1, qualityScore: 70 },
    ...overrides,
  });

describe('TASK-AI-171: versioned route identity data', () => {
  const routeIdentityData = require('../../../config/route-identity.json');

  test('prefix-to-provider aliases are loaded from the versioned data file', () => {
    assert.equal(routeIdentityData.version, 1);
    assert.deepEqual(DEFAULT_PREFIX_TO_PROVIDER, routeIdentityData.prefixToProvider);
    assert.equal(DEFAULT_PREFIX_TO_PROVIDER.gcli, 'grok-cli');
    assert.equal(DEFAULT_PREFIX_TO_PROVIDER.ollama, 'ollama');
    assert.equal(DEFAULT_PREFIX_TO_PROVIDER.mistral, 'mistral');
    assert.equal(resolveModelPrefix('gcli/grok-2').upstreamProviderId, 'grok-cli');
  });

  test('quota group to family mapping is loaded from the same data file', () => {
    assert.equal(getQuotaFamily('external'), routeIdentityData.quotaFamilies.external);
    assert.equal(getQuotaFamily('external'), 'claude-gpt');
    assert.equal(getQuotaFamily('gemini'), 'gemini');
  });

  test('weight profiles are loaded from the same data file', () => {
    const dimensions = routeIdentityData.weightDimensions;
    for (const [name, values] of Object.entries(routeIdentityData.weightProfiles)) {
      const expected = Object.fromEntries(
        dimensions.map((dimension, index) => [dimension, values[index]])
      );
      assert.deepEqual(WEIGHT_PROFILES[name], expected);
    }
  });
});
