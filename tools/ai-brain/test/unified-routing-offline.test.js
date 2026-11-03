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
  UNKNOWN,
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
    assert.equal(evaluation.admitted, false, 'Combo containing Claude branch must fail admission for reviewer role');
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
        connections: [{ connectionId: 'c1', provider: 'antigravity', accountRef: 'u1', enabled: true }],
      },
      agy: {
        lanes: [{ laneId: 'agy01', accountRef: 'lane1@corp.com', quotaExhausted: false, rows: [{ modelId: 'gemini-3.8-flash', remainingPercent: 40 }] }],
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
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'model-a', metadata: { capabilities: ['c1'] } }),
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'model-b', metadata: { capabilities: ['c1'] } }),
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
    assert.ok(emptyResult.unconnectedSources.length >= 3, 'Must report unconnected reasons for all 3 pathways');
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

    assert.equal(evaluation.admitted, false, 'Candidate with unknown cost must NOT pass cost ceiling');
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

    assert.equal(scoring.totalScore, 0, 'Unproven candidate without metadata must score 0, never boosted by name');
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
    health.recordFailure(candidate, { httpStatus: 402, message: 'Quota exceeded resets in 5s' }, now);
    // 2. Set an active model lock for 30 seconds
    health.setModelLock('antigravity', 'gemini-3.8-flash', 'conn_ag_01', now + 30000);

    // Evaluate after quota reset elapsed (10s later), but while lock is still active
    const evalAt10s = health.evaluateHealth(candidate, now + 10000);
    assert.equal(evalAt10s.healthy, false, 'Must be blocked by active model lock despite quota reset elapsed');
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
        { connectionId: 'ag_conn_1', provider: 'antigravity', accountRef: 'ag_user_1', enabled: true },
        { connectionId: 'ag_conn_2', provider: 'antigravity', accountRef: 'ag_user_2', enabled: true },
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
        connections: [{ connectionId: 'c_shared', provider: 'antigravity', accountRef: 'shared@google.com', enabled: true }],
      },
      direct: { sources: [] },
      agy: {
        lanes: [{ laneId: 'agy01', accountRef: 'shared@google.com', quotaExhausted: false, rows: [{ modelId: 'gemini-3.8-flash', remainingPercent: 40 }] }],
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

    assert.equal(parsed.quotaScopeId, 'quota::deepseek::alpha', 'Quota scope with :: must not split incorrectly');
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
    const evalResult = selector.evaluateAdmission(comboExpanded, { requiredCapabilities: ['code'] });

    assert.equal(evalResult.admitted, false, 'Combo must be rejected when all branches are exhausted');
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
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'm1', metadata: { capabilities: ['code'] } }),
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'm2', metadata: { capabilities: ['code'] } }),
    ];

    const result = await selector.selectRoute(candidates, { taskId: 'T1', role: 'writer', requiredCapabilities: ['code'] });

    assert.equal(result.jev.outcome, 'UNDECIDED');
    assert.equal(result.jev.reason, 'IDENTITY_PROHIBITED');
    assert.equal(result.weightProfileUsed, 'BALANCED', 'Must fall back to deterministic role profile');
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
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'm1', metadata: { capabilities: ['code'] } }),
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'm2', metadata: { capabilities: ['code'] } }),
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'm3', metadata: { capabilities: ['code'] } }),
    ];

    // Call 1
    await selector.selectRoute(candidates, { taskId: 'TASK-C1', instructions: 'Inst A', requiredCapabilities: ['code'] });
    assert.equal(callCount, 1);

    // Call 2 with DIFFERENT instructions: MUST NOT use cached advice
    await selector.selectRoute(candidates, { taskId: 'TASK-C1', instructions: 'Inst B (CHANGED)', requiredCapabilities: ['code'] });
    assert.equal(callCount, 2, 'Changed task instructions must trigger fresh advisory question');

    // Call 3 with health registry state change (m1 fails, m2 and m3 still admitted): MUST NOT use cached advice
    selector.healthRegistry.recordFailure(candidates[0], { httpStatus: 500, message: 'Internal error' });
    await selector.selectRoute(candidates, { taskId: 'TASK-C1', instructions: 'Inst A', requiredCapabilities: ['code'] });
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

    assert.equal(result.budgetContract.tokenBudget, 8000, 'Explicit tokenBudget must win over contextSize');
  });

  test('Production bridge selectOptimalRoute is exported from routing.js', () => {
    const routingApi = require('../routing');
    assert.equal(typeof routingApi.selectOptimalRoute, 'function', 'routing.js must export selectOptimalRoute');
    assert.equal(typeof routingApi.UnifiedRouteSelector, 'function', 'routing.js must export UnifiedRouteSelector');
  });
});
const regressionRoute = (overrides = {}) => createRouteIdentity({
  harness: 'direct-http', sourceId: 'regression', gatewayId: 'direct',
  upstreamProviderId: 'provider-a', accountRef: 'account-a', connectionId: 'connection-a',
  configuredModelId: 'model-a', outboundModelId: 'model-a',
  metadata: { capabilities: ['general_code'], estimatedCostUsd: 1, qualityScore: 70 },
  ...overrides,
});

describe('Review 50c26d7 regressions', () => {
  test('F01: missing discovery never reads fixtures or invents pool connections', () => {
    const fs = require('node:fs');
    const originalExists = fs.existsSync;
    const originalRead = fs.readFileSync;
    const reads = [];
    try {
      // Simulate a machine where only the repository test catalog exists.
      fs.existsSync = (p) => { reads.push(String(p)); return String(p).includes('fixtures'); };
      fs.readFileSync = () => JSON.stringify(['ag/fixture-only']);
      assert.equal(load9RouterCandidates({ connections: [] }).candidates.length, 0);
      assert.equal(reads.some((p) => p.includes('fixtures')), false);
    } finally {
      fs.existsSync = originalExists;
      fs.readFileSync = originalRead;
    }
    const empty = load9RouterCandidates({ catalog: ['ag/live-model'], connections: [] });
    assert.equal(empty.candidates.length, 0);
    assert.equal(empty.unconnected[0].reason, 'NO_ENABLED_CONNECTIONS_DISCOVERED');
  });

  test('F02: provider and allowlist must both match', () => {
    const result = load9RouterCandidates({
      catalog: ['ag/allowed', 'ag/denied'],
      connections: [
        { provider: 'antigravity', connectionId: 'right', modelAllowlist: ['ag/allowed'] },
        { provider: 'github', connectionId: 'wrong', modelAllowlist: ['ag/allowed'] },
      ],
    });
    assert.deepEqual(result.candidates.map((c) => [c.connectionId, c.configuredModelId]), [['right', 'ag/allowed']]);
  });

  test('F03: all adapters preserve live evidence without inventing capabilities', () => {
    const evidence = { capabilities: ['supplied-capability'], estimatedCostUsd: 0.25,
      qualityScore: 83, latencyScore: 41, costScore: 66, pricing: { input: 0.1 } };
    const results = [
      load9RouterCandidates({ catalog: [{ id: 'ag/live', ...evidence }],
        connections: [{ provider: 'antigravity', connectionId: 'c' }] }),
      loadDirectProviderCandidates({ sources: [{ id: 's', accountRef: 'a', models: [{ id: 'live', ...evidence }] }], skipMissingCredentials: false }),
      loadAgyPoolCandidates({ models: [{ id: 'live', ...evidence }],
        lanes: [{ laneId: 'lane', rows: [{ modelId: 'live', remainingPercent: 10 }] }] }),
    ];
    const selector = new UnifiedRouteSelector();
    const combo = expandComboIdentity(regressionRoute(), [{ id: 'ag/live', ...evidence }]);
    assert.equal(combo.comboBranches[0].metadata.estimatedCostUsd, evidence.estimatedCostUsd);
    assert.equal(combo.comboBranches[0].metadata.qualityScore, evidence.qualityScore);
    for (const { candidates } of results) {
      assert.equal(candidates.length, 1);
      for (const [key, value] of Object.entries(evidence)) assert.deepEqual(candidates[0].metadata[key], value);
      assert.equal(selector.evaluateAdmission(candidates[0], { requiredCapabilities: ['large_context_64k'] }).admitted, false);
      assert.equal(selector.evaluateAdmission(candidates[0], { costCeiling: 0.5 }).admitted, true);
      assert.equal(selector.scoreCandidate(candidates[0], {}, WEIGHT_PROFILES.BALANCED).breakdown.qualityScore, 83);
    }
    const unknowns = [
      load9RouterCandidates({ catalog: ['ag/live'], connections: [{ provider: 'antigravity', connectionId: 'c' }] }),
      loadDirectProviderCandidates({ sources: [{ id: 's', accountRef: 'a', models: ['live'] }], skipMissingCredentials: false }),
      loadAgyPoolCandidates({ models: ['live'], lanes: [{ laneId: 'lane', rows: [{ modelId: 'live', remainingPercent: 10 }] }] }),
    ];
    for (const { candidates } of unknowns) {
      assert.deepEqual(candidates[0].metadata.capabilities, []);
      assert.equal(selector.evaluateAdmission(candidates[0], { requiredCapabilities: ['general_code'] }).admitted, false);
      assert.equal(candidates[0].metadata.estimatedCostUsd, undefined);
    }
  });

  test('F04: AGY admits only models with positive quota on that lane', () => {
    const result = loadAgyPoolCandidates({ models: ['open', 'exhausted', 'unknown'], lanes: [
      { laneId: 'lane-a', rows: [{ modelId: 'open', remainingPercent: 20 }, { modelId: 'exhausted', remainingPercent: 0 }] },
      { laneId: 'lane-b', rows: [{ modelId: 'open', remainingPercent: 0 }, { modelId: 'exhausted', remainingPercent: 80 }] },
    ] });
    assert.deepEqual(result.candidates.map((c) => [c.accountRef, c.configuredModelId]), [['lane-a', 'open'], ['lane-b', 'exhausted']]);
    assert.ok(result.unconnected.some((r) => r.reason === 'AGY_MODEL_QUOTA_UNKNOWN'));
    assert.ok(result.unconnected.some((r) => r.reason === 'AGY_MODEL_QUOTA_EXHAUSTED'));
    const windows = loadAgyPoolCandidates({ models: [{ id: 'scoped', quotaFamily: 'discovered-family' }],
      lanes: [{ laneId: 'lane', rows: [
        { family: 'discovered-family', remainingPercent: 50 },
        { family: 'discovered-family', remainingPercent: 0 },
      ] }] });
    assert.equal(windows.candidates.length, 0, 'every quota window must permit the model');
  });

  test('F05: model-not-found is isolated to the failing account', () => {
    const health = new ScopedHealthRegistry();
    const a = regressionRoute();
    const b = regressionRoute({ accountRef: 'account-b' });
    health.recordFailure(a, { httpStatus: 404, message: 'model not found' });
    assert.equal(health.evaluateHealth(a).healthy, false);
    assert.equal(health.evaluateHealth(b).healthy, true);
    assert.equal(health.evaluateHealth(regressionRoute({ connectionId: 'another-path' })).healthy, false);
  });

  test('F06: same email at different providers isolates auth and automatic quotas', () => {
    const health = new ScopedHealthRegistry();
    const a = regressionRoute({ accountRef: 'same@example.invalid' });
    const b = regressionRoute({ upstreamProviderId: 'provider-b', accountRef: 'same@example.invalid' });
    const aOtherPath = regressionRoute({ accountRef: a.accountRef, sourceId: 'other', quotaScopeId: 'another-scope' });
    const linked = linkSharedQuotaScopes([a, b, aOtherPath]);
    assert.equal(linked[0].quotaScopeId, linked[2].quotaScopeId);
    assert.notEqual(linked[0].quotaScopeId, linked[1].quotaScopeId);
    health.recordFailure(linked[0], { httpStatus: 401, message: 'unauthorized' });
    assert.equal(health.evaluateHealth(linked[1]).healthy, true);
    assert.equal(health.evaluateHealth(linked[2]).healthy, false);
    health.recordFailure(linked[0], { httpStatus: 402, message: 'credit exhausted' });
    assert.equal(health.evaluateHealth(regressionRoute({ upstreamProviderId: 'provider-b', quotaScopeId: linked[0].quotaScopeId })).healthy, true);
    assert.equal(health.evaluateHealth(linked[1]).healthy, true);
  });

  test('F07: combo rejects any exhausted or over-ceiling executable branch', async () => {
    const health = new ScopedHealthRegistry();
    const selector = new UnifiedRouteSelector({ healthRegistry: health });
    const good = regressionRoute();
    const bad = regressionRoute({ accountRef: 'bad', quotaScopeId: 'bad-quota' });
    const combo = regressionRoute({ isCombo: true, comboBranches: [good, bad] });
    health.recordFailure(bad, { httpStatus: 402, message: 'credit exhausted' });
    assert.equal((await selector.selectRoute([combo], {})).status, 'BLOCKED');
    const expensive = regressionRoute({ metadata: { estimatedCostUsd: 3 } });
    const priceyCombo = regressionRoute({ isCombo: true, comboBranches: [good, expensive] });
    assert.equal(selector.evaluateAdmission(priceyCombo, { costCeiling: 2 }).admitted, false);
    const affordable = regressionRoute({ isCombo: true, comboBranches: [good] });
    assert.equal(selector.evaluateAdmission(affordable, { costCeiling: 2 }).admitted, true);
    const unknown = regressionRoute({ metadata: {} });
    assert.equal(selector.evaluateAdmission(regressionRoute({ isCombo: true, comboBranches: [good, unknown] }), { costCeiling: 2 }).admitted, false);
  });

  test('F08: convenience wrapper preserves context fallback and deadline', async () => {
    const base = { candidates: [regressionRoute()], contextSize: 123, deadlineMs: 456 };
    const result = await selectOptimalRoute(base);
    assert.equal(result.budgetContract.tokenBudget, 123);
    assert.equal(result.budgetContract.deadlineMs, 456);
    assert.equal((await selectOptimalRoute({ ...base, tokenBudget: 0 })).budgetContract.tokenBudget, 0);
  });

  test('F09: convenience calls retain default health state across selections', async () => {
    const { SHARED_HEALTH_REGISTRY } = require('../unified-selector');
    const route = regressionRoute({ accountRef: 'F09-only', configuredModelId: 'F09' });
    assert.equal((await selectOptimalRoute({ candidates: [route] })).status, 'ADMITTED_AND_SELECTED');
    SHARED_HEALTH_REGISTRY.recordFailure(route, { message: 'getaddrinfo ENOTFOUND regression.invalid' });
    try {
      assert.equal((await selectOptimalRoute({ candidates: [route] })).status, 'BLOCKED');
    } finally {
      SHARED_HEALTH_REGISTRY.routes.delete(route.candidateKey);
    }
  });

  test('F10: Claude allowed by default; caller role policy covers single and combo routes', () => {
    const claude = regressionRoute({ configuredModelId: 'claude-sonnet', outboundModelId: 'claude-sonnet' });
    const combo = regressionRoute({ isCombo: true, comboBranches: [regressionRoute(), claude] });
    for (const role of ['writer', 'repair', 'reviewer', 'security-review']) {
      assert.equal(new UnifiedRouteSelector().evaluateAdmission(claude, { role }).admitted, true);
      assert.equal(new UnifiedRouteSelector().evaluateAdmission(combo, { role }).admitted, true);
      const selector = new UnifiedRouteSelector({ excludedModelPatterns: { [role]: [/claude/gi] } });
      assert.equal(selector.evaluateAdmission(claude, { role }).admitted, false);
      assert.equal(selector.evaluateAdmission(combo, { role }).admitted, false);
      assert.equal(selector.evaluateAdmission(combo, { role }).admitted, false);
      assert.equal(selector.evaluateAdmission(claude, { role: 'researcher' }).admitted, true);
    }
  });

  test('F11: adjacent colon and percent components round-trip without collisions', () => {
    const a = regressionRoute({ accountRef: 'x:', quotaScopeId: ':y', sourceId: '%3A::\u241f' });
    const b = regressionRoute({ accountRef: 'x', quotaScopeId: '::y', sourceId: a.sourceId });
    assert.notEqual(a.candidateKey, b.candidateKey);
    for (const route of [a, b]) {
      const parsed = parseRouteIdentity(route.candidateKey);
      assert.equal(parsed.accountRef, route.accountRef);
      assert.equal(parsed.quotaScopeId, route.quotaScopeId);
      assert.equal(parsed.sourceId, route.sourceId);
      assert.equal(parsed.candidateKey, route.candidateKey);
    }
  });

  test('F12: DNS cooldown blocks only failed route and expires on classified time', () => {
    const health = new ScopedHealthRegistry();
    const route = regressionRoute();
    const now = Date.now();
    const failure = health.recordFailure(route, { message: 'getaddrinfo ENOTFOUND regression.invalid' }, now);
    assert.equal(failure.scope, HealthScope.NETWORK);
    assert.equal(health.evaluateHealth(route, now + 1).healthy, false);
    assert.equal(health.evaluateHealth(regressionRoute({ connectionId: 'other' }), now + 1).healthy, true);
    assert.equal(health.evaluateHealth(route, failure.resetsAt + 1).healthy, true);
  });

  test('F13: advisory cache varies with evidence and deadline and caches exceptions', async () => {
    let calls = 0;
    const selector = new UnifiedRouteSelector({ jevCache: new Map(), jevAsk: async () => { calls++; throw new Error('offline failure'); } });
    const routes = [regressionRoute(), regressionRoute({ accountRef: 'second' })];
    const profile = { deadlineMs: 10 };
    const first = await selector.selectRoute(routes, profile);
    const repeated = await selector.selectRoute(routes, profile);
    assert.equal(first.jev.outcome, 'ERROR');
    assert.equal(repeated.jev.reason, 'JEV_CACHE_HIT');
    assert.equal(calls, 1);
    await selector.selectRoute(routes, { deadlineMs: 11 });
    assert.equal(calls, 2);
    const changed = regressionRoute({ metadata: { qualityScore: 99, estimatedCostUsd: 2 } });
    await selector.selectRoute([changed, routes[1]], profile);
    assert.equal(calls, 3);
  });

  test('F14: zero ceiling accepts only known zero-cost routes', () => {
    const selector = new UnifiedRouteSelector();
    for (const cost of [3, undefined, null, UNKNOWN]) {
      assert.equal(selector.evaluateAdmission(regressionRoute({ metadata: { estimatedCostUsd: cost } }), { costCeiling: 0 }).admitted, false);
    }
    const free = regressionRoute({ metadata: { estimatedCostUsd: 0 } });
    assert.equal(selector.evaluateAdmission(free, { costCeiling: 0 }).admitted, true);
    assert.equal(selector.evaluateAdmission(regressionRoute(), { costCeiling: null }).admitted, true);
  });
});

describe('Review dd2dad3 regressions (7 findings)', () => {
  test('R01 (Finding 1): AGY discovery with string models matches family quota and does not reject healthy lanes', () => {
    const pool = loadAgyPoolCandidates({
      models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      lanes: [
        {
          laneId: 'lane-alpha',
          rows: [
            { family: 'gemini', remainingPercent: 80, windowMinutes: 60 }
          ],
        }
      ]
    });
    assert.equal(pool.candidates.length, 2);
    assert.equal(pool.unconnected.length, 0);
    assert.equal(pool.candidates[0].configuredModelId, 'gemini-2.5-flash');
    assert.equal(pool.candidates[1].configuredModelId, 'gemini-2.5-pro');
  });

  test('R02 (Finding 2): AGY quota scope is keyed per lane and model family so Gemini exhaustion does not block Claude/GPT', () => {
    const health = new ScopedHealthRegistry();
    const pool = loadAgyPoolCandidates({
      models: ['gemini-2.5-flash', 'claude-3-7-sonnet'],
      lanes: [
        {
          laneId: 'lane-alpha',
          rows: [
            { family: 'gemini', remainingPercent: 50, windowMinutes: 60 },
            { family: 'claude-gpt', remainingPercent: 90, windowMinutes: 60 }
          ]
        }
      ]
    });
    assert.equal(pool.candidates.length, 2);
    const geminiCandidate = pool.candidates.find(c => c.configuredModelId === 'gemini-2.5-flash');
    const claudeCandidate = pool.candidates.find(c => c.configuredModelId === 'claude-3-7-sonnet');
    assert.ok(geminiCandidate.quotaScopeId.includes('gemini'));
    assert.ok(claudeCandidate.quotaScopeId.includes('claude-gpt'));
    assert.notEqual(geminiCandidate.quotaScopeId, claudeCandidate.quotaScopeId);

    // Record quota exhaustion for Gemini candidate
    health.recordFailure(geminiCandidate, { message: 'insufficient_quota' });
    assert.equal(health.evaluateHealth(geminiCandidate).healthy, false);
    // Claude candidate on the same lane remains healthy
    assert.equal(health.evaluateHealth(claudeCandidate).healthy, true);
  });

  test('R03 (Finding 3): Combo with multiple candidate accounts is unhealthy when all accounts fail auth', () => {
    const health = new ScopedHealthRegistry();
    const selector = new UnifiedRouteSelector({ healthRegistry: health });

    const branchA = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'src-9router',
      gatewayId: '9router',
      upstreamProviderId: 'anthropic',
      configuredModelId: 'claude-3-5-sonnet',
      accountRef: UNKNOWN,
      connectionId: UNKNOWN,
      metadata: {
        candidateAccounts: [
          { accountRef: 'acc1@corp.com', connectionId: 'conn-1', quotaScopeId: 'quota::anthropic::acc1' },
          { accountRef: 'acc2@corp.com', connectionId: 'conn-2', quotaScopeId: 'quota::anthropic::acc2' }
        ]
      }
    });

    const combo = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'src-9router',
      gatewayId: '9router',
      upstreamProviderId: 'combo',
      configuredModelId: 'combo/fast',
      accountRef: UNKNOWN,
      isCombo: true,
      comboBranches: [branchA]
    });

    assert.equal(health.evaluateHealth(branchA).healthy, true);
    assert.equal(selector.evaluateAdmission(combo).admitted, true);

    // Record permanent 401 failure on first account
    health.recordFailure(
      { accountRef: 'acc1@corp.com', connectionId: 'conn-1', upstreamProviderId: 'anthropic', quotaScopeId: 'quota::anthropic::acc1' },
      { status: 401, message: 'unauthorized' }
    );
    // acc2 is still healthy, so branchA should still be healthy
    assert.equal(health.evaluateHealth(branchA).healthy, true);

    // Record permanent 401 failure on second account
    health.recordFailure(
      { accountRef: 'acc2@corp.com', connectionId: 'conn-2', upstreamProviderId: 'anthropic', quotaScopeId: 'quota::anthropic::acc2' },
      { status: 401, message: 'unauthorized' }
    );
    // Now ALL executable candidate accounts for branchA have permanent 401 failures -> branchA becomes unhealthy
    assert.equal(health.evaluateHealth(branchA).healthy, false);
    assert.equal(selector.evaluateAdmission(combo).admitted, false);
  });

  test('R04 (Finding 4): AGY lane identity reads real email and leaves UNKNOWN when missing, never using laneId', () => {
    const pool = loadAgyPoolCandidates({
      models: ['gemini-2.5-flash'],
      lanes: [
        { laneId: 'lane-with-email', rows: [{ family: 'gemini', remainingPercent: 100 }] },
        { laneId: 'lane-no-email', rows: [{ family: 'gemini', remainingPercent: 100 }] }
      ],
      readLaneIdentity: (laneId) => {
        if (laneId === 'lane-with-email') return { label: 'realuser@gmail.com' };
        return { label: laneId };
      }
    });

    const candidate1 = pool.candidates.find(c => c.connectionId === 'lane-with-email');
    const candidate2 = pool.candidates.find(c => c.connectionId === 'lane-no-email');

    assert.equal(candidate1.accountRef, 'realuser@gmail.com');
    assert.equal(candidate1.metadata.realAccountRef, 'realuser@gmail.com');
    assert.equal(candidate2.accountRef, 'lane-no-email');
    assert.equal(candidate2.metadata.realAccountRef, UNKNOWN);

    // candidate1 links with 9router route sharing real email, candidate2 does not link with laneId
    const nineRouterRoute = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      upstreamProviderId: 'antigravity',
      accountRef: 'realuser@gmail.com',
      connectionId: 'conn-google-1',
      configuredModelId: 'gemini-2.5-flash'
    });
    const nineRouterFakeRoute = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      upstreamProviderId: 'antigravity',
      accountRef: 'lane-no-email',
      connectionId: 'conn-google-2',
      configuredModelId: 'gemini-2.5-flash'
    });

    const linked = linkSharedQuotaScopes([candidate1, candidate2, nineRouterRoute, nineRouterFakeRoute]);
    const linkedC1 = linked.find(c => c.connectionId === candidate1.connectionId);
    const linked9R = linked.find(c => c.connectionId === nineRouterRoute.connectionId);
    const linkedC2 = linked.find(c => c.connectionId === candidate2.connectionId);
    const linked9RFake = linked.find(c => c.connectionId === nineRouterFakeRoute.connectionId);

    assert.equal(linkedC1.quotaScopeId, linked9R.quotaScopeId);
    assert.notEqual(linkedC2.quotaScopeId, linked9RFake.quotaScopeId);
  });

  test('R05 (Finding 5): Shared PREFIX_PROVIDER_MAP maps cl -> cline and gcli -> grok-cli consistently', () => {
    assert.equal(resolveModelPrefix('cl/deepseek-chat').upstreamProviderId, 'cline');
    assert.equal(resolveModelPrefix('gcli/grok-2').upstreamProviderId, 'grok-cli');

    const loaded = load9RouterCandidates({
      catalog: ['cl/deepseek-chat', 'gcli/grok-2'],
      connections: [
        { connectionId: 'c-cline', provider: 'cline', accountRef: 'cl-user' },
        { connectionId: 'c-grok', provider: 'grok-cli', accountRef: 'grok-user' }
      ]
    });
    assert.equal(loaded.candidates.length, 2);
    assert.equal(loaded.candidates[0].upstreamProviderId, 'cline');
    assert.equal(loaded.candidates[1].upstreamProviderId, 'grok-cli');
  });

  test('R06 (Finding 6): Supplying explicit links does not suppress auto-detection for other shared accounts', () => {
    const routeOpenAI1 = regressionRoute({ upstreamProviderId: 'openai', accountRef: 'user1@corp.com', connectionId: 'c1' });
    const routeOpenAI2 = regressionRoute({ upstreamProviderId: 'openai', accountRef: 'user1@corp.com', connectionId: 'c2' });
    const routeDeepseek1 = regressionRoute({ upstreamProviderId: 'deepseek', accountRef: 'corp@deepseek.com', connectionId: 'd1' });
    const routeDeepseek2 = regressionRoute({ upstreamProviderId: 'deepseek', accountRef: 'corp@deepseek.com', connectionId: 'd2' });

    const explicitLinks = {
      [JSON.stringify(['openai', 'user1@corp.com'])]: 'explicit-shared-openai-quota'
    };

    const linked = linkSharedQuotaScopes([routeOpenAI1, routeOpenAI2, routeDeepseek1, routeDeepseek2], explicitLinks);
    const resO1 = linked.find(r => r.connectionId === routeOpenAI1.connectionId);
    const resO2 = linked.find(r => r.connectionId === routeOpenAI2.connectionId);
    const resD1 = linked.find(r => r.connectionId === routeDeepseek1.connectionId);
    const resD2 = linked.find(r => r.connectionId === routeDeepseek2.connectionId);

    assert.equal(resO1.quotaScopeId, 'explicit-shared-openai-quota');
    assert.equal(resO2.quotaScopeId, 'explicit-shared-openai-quota');
    assert.equal(resD1.quotaScopeId, resD2.quotaScopeId);
    assert.ok(resD1.quotaScopeId.includes('shared-quota::deepseek') || resD1.quotaScopeId.includes('quota::deepseek'));
  });

  test('R07 (Finding 7): Model lock keys prevent delimiter collision for (p, m, b::c) vs (p, m::b, c)', () => {
    const health = new ScopedHealthRegistry();
    const provider = 'test-prov';
    const now = Date.now();

    health.setModelLock(provider, 'm', 'b::c', now + 60000, 'testing');

    const route1 = regressionRoute({ upstreamProviderId: provider, configuredModelId: 'm', outboundModelId: 'm', connectionId: 'b::c' });
    const route2 = regressionRoute({ upstreamProviderId: provider, configuredModelId: 'm::b', outboundModelId: 'm::b', connectionId: 'c' });

    assert.equal(health.evaluateHealth(route1, now).healthy, false);
    assert.equal(health.evaluateHealth(route2, now).healthy, true);
  });
});
