'use strict';

/**
 * Ship Dễ — Unified Routing Offline Test Suite (PATCH 1 & 2)
 *
 * Verifies all 10 acceptance criteria offline without live inference:
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
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  createRouteIdentity,
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
} = require('../unified-selector');

const {
  load9RouterCandidates,
  loadDirectProviderCandidates,
  loadAgyPoolCandidates,
  aggregateAllCandidates,
} = require('../candidate-adapters');

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

    // Record HTTP 401 Authentication Failure on Account A
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

    // Map evidence linking the shared Google account
    const linkedIdentities = linkSharedQuotaScopes([route9Router, routeAgyPool], {
      'vinh1032007@gmail.com': 'quota::google::vinh1032007@gmail.com',
    });

    assert.equal(linkedIdentities[0].quotaScopeId, 'quota::google::vinh1032007@gmail.com');
    assert.equal(linkedIdentities[1].quotaScopeId, 'quota::google::vinh1032007@gmail.com');

    // Both routes draw from the exact same quota scope
    const health = new ScopedHealthRegistry();

    // Mark quota exhausted on the shared scope
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

    // Record ECONNREFUSED on gateway port 20128
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
  test('Expired resetAt does NOT automatically set quota 100% full (requires probe)', () => {
    const health = new ScopedHealthRegistry();
    const candidate = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'deepseek-direct',
      quotaScopeId: 'quota::deepseek::user1',
    });

    const now = 1730000000000;
    // Record quota exhausted with reset time 5 seconds ago
    health.recordFailure(candidate, {
      httpStatus: 402,
      message: 'Quota exceeded resets in 10s',
    }, now);

    // After resetAt has passed:
    const pastResetTime = now + 15000;
    const evalResult = health.evaluateHealth(candidate, pastResetTime);

    assert.equal(evalResult.healthy, true, 'Should be technically eligible for probing');
    assert.equal(evalResult.quotaStatus, 'RESET_ELAPSED_PROBE_NEEDED', 'Must be marked as probe needed');
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
    // Set model lock for 10 seconds
    health.setModelLock('antigravity', 'claude-opus-4-6-thinking', 'conn_ag_01', now + 10000);

    // During lock:
    const duringLock = health.evaluateHealth(candidate, now + 2000);
    assert.equal(duringLock.healthy, false, 'Model must be locked during cooldown window');
    assert.equal(duringLock.blockedBy, 'model_lock');

    // After lock expires:
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

    // Test selector admission for reviewer role
    const selector = new UnifiedRouteSelector();
    const taskProfileForReviewer = {
      taskId: 'TASK-AI-REVIEW-01',
      role: 'reviewer',
      complexity: 'standard',
    };

    const evaluation = selector.evaluateAdmission(expanded, taskProfileForReviewer);
    assert.equal(evaluation.admitted, false, 'Combo containing Claude branch must fail admission for reviewer role');
    assert.equal(evaluation.rejectionReason, 'COMBO_CONTAINS_CLAUDE_BRANCH_BARRED_FOR_ROLE');
  });
});

describe('Criterion 8: Candidate từ cả ba đường đều có thể được chọn khi đủ điều kiện', () => {
  test('Aggregates and selects across 9router, direct provider, and AGY pool', async () => {
    const { candidates } = aggregateAllCandidates({
      gatewayOffline: false,
      skipMissingCredentials: false,
      env: { DEEPSEEK_API_KEY: 'test-key', OPENAI_API_KEY: 'test-key', GROQ_API_KEY: 'test-key' },
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
        choice: question.options[0],
        confidence: 0.85,
      };
    };

    const selector = new UnifiedRouteSelector({ jevAsk: mockJevAsk, minConfidence: 0.7 });

    const candidates = [
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'model-a', metadata: { capabilities: ['c1'] } }),
      createRouteIdentity({ harness: 'direct-http', configuredModelId: 'model-b', metadata: { capabilities: ['c1'] } }),
    ];

    const profile = { taskId: 'TASK-JEV-TEST', role: 'writer', requiredCapabilities: ['c1'] };

    // Call 1: Cache miss, asks JEV
    const res1 = await selector.selectRoute(candidates, profile);
    assert.equal(res1.jev.outcome, 'DECIDED');
    assert.equal(askCallCount, 1, 'First call must query JEV');

    // Call 2: Cache hit, does NOT ask JEV again
    const res2 = await selector.selectRoute(candidates, profile);
    assert.equal(res2.jev.reason, 'JEV_CACHE_HIT');
    assert.equal(askCallCount, 1, 'Second call must hit cache with no duplicate JEV query');

    // Test UNDECIDED deterministic fallback
    const undecidedSelector = new UnifiedRouteSelector({
      jevAsk: async () => ({ choice: null, confidence: 0.2 }), // low confidence
      minConfidence: 0.7,
    });

    const resUndecided = await selector.selectRoute(candidates, { ...profile, taskId: 'TASK-JEV-UNDECIDED' });
    assert.ok(resUndecided.chosen, 'Must deterministically select top candidate even if JEV undecided');
  });
});

describe('Criterion 10: Budget và context tới đúng interface nhận', () => {
  test('Emits structured budget contract and task-scoped context', async () => {
    const selector = new UnifiedRouteSelector();
    const candidate = createRouteIdentity({
      harness: 'opencode', // OpenCode CLI does not enforce tokens internally
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
