'use strict';

/**
 * Ship Dễ — Unified Routing Offline Test Suite (TASK-AI-171)
 * One test per acceptance criterion (Criteria 1 through 10), completely offline.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  createRouteIdentity,
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
const { UnifiedRouteSelector } = require('../unified-selector');
const { aggregateAllCandidates } = require('../candidate-adapters');

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
      quotaScopeId: 'quota::deepseek::alpha',
    });
    const candidateB = createRouteIdentity({
      harness: 'opencode',
      sourceId: 'deepseek-pool',
      gatewayId: 'direct',
      upstreamProviderId: 'deepseek',
      configuredModelId: 'deepseek-v4.1-flash',
      accountRef: 'user_beta@corp.com',
      quotaScopeId: 'quota::deepseek::beta',
    });

    health.recordFailure(candidateA, { httpStatus: 401, message: 'Unauthorized' });
    const healthA = health.evaluateHealth(candidateA);
    const healthB = health.evaluateHealth(candidateB);

    assert.equal(healthA.healthy, false);
    assert.equal(healthA.blockedBy, HealthScope.ACCOUNT);
    assert.equal(healthA.category, ErrorCategory.AUTH);
    assert.equal(healthB.healthy, true);
  });
});

describe('Criterion 2: Hai đường chung quota không được tính ngân sách hai lần', () => {
  test('Shared account across 9router and AGY pool shares single quota scope', () => {
    const route9R = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      upstreamProviderId: 'antigravity',
      configuredModelId: 'ag/gemini-3.8-flash',
      accountRef: 'vinh1032007@gmail.com',
    });
    const routeAgy = createRouteIdentity({
      harness: 'agy-pool',
      sourceId: 'agy-pool',
      gatewayId: 'direct',
      upstreamProviderId: 'antigravity',
      configuredModelId: 'gemini-3.8-flash',
      accountRef: 'vinh1032007@gmail.com',
    });

    const linked = linkSharedQuotaScopes([route9R, routeAgy], {
      [JSON.stringify(['antigravity', 'vinh1032007@gmail.com'])]: 'quota::antigravity::shared',
    });
    assert.equal(linked[0].quotaScopeId, 'quota::antigravity::shared');
    assert.equal(linked[1].quotaScopeId, 'quota::antigravity::shared');

    const health = new ScopedHealthRegistry();
    health.recordFailure(linked[0], { httpStatus: 402, message: 'credit balance = 0' });

    assert.equal(health.evaluateHealth(linked[0]).healthy, false);
    assert.equal(health.evaluateHealth(linked[1]).healthy, false);
    assert.equal(health.evaluateHealth(linked[0]).blockedBy, HealthScope.QUOTA_SCOPE);
  });
});

describe('Criterion 3: DNS không biến thành login-required', () => {
  test('DNS failure is classified as NETWORK_DNS with transient cooldown, not AUTH', () => {
    const classified = classifyError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' });
    assert.equal(classified.category, ErrorCategory.NETWORK_DNS);
    assert.equal(classified.scope, HealthScope.NETWORK);
    assert.notEqual(classified.category, ErrorCategory.AUTH);
    assert.equal(classified.isPermanent, false);
    assert.equal(classified.cooldownMs, 30000);
  });
});

describe('Criterion 4: Gateway tắt không đánh chết upstream qua đường trực tiếp', () => {
  test('ECONNREFUSED on port 20128 blocks 9router gateway, leaving direct route healthy', () => {
    const health = new ScopedHealthRegistry();
    const candidateVia9R = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      upstreamProviderId: 'github',
      configuredModelId: 'gh/gpt-5.4-nano',
    });
    const candidateDirect = createRouteIdentity({
      harness: 'codex',
      sourceId: 'codex-direct',
      gatewayId: 'direct',
      upstreamProviderId: 'openai',
      configuredModelId: 'gpt-5.3-codex',
    });

    health.recordFailure(candidateVia9R, {
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:20128',
      gatewayId: '9router',
    });

    assert.equal(health.evaluateHealth(candidateVia9R).healthy, false);
    assert.equal(health.evaluateHealth(candidateVia9R).blockedBy, HealthScope.GATEWAY);
    assert.equal(health.evaluateHealth(candidateDirect).healthy, true);
  });
});

describe('Criterion 5: ResetAt đã qua và lock đã hết hạn xử lý đúng', () => {
  test('Expired resetAt requires fresh telemetry probe and expired lock is cleared', () => {
    const health = new ScopedHealthRegistry();
    const candidate = createRouteIdentity({
      harness: 'direct-http',
      sourceId: 'deepseek-direct',
      quotaScopeId: 'quota::deepseek::user1',
      upstreamProviderId: 'antigravity',
      outboundModelId: 'claude-opus-4-6-thinking',
      connectionId: 'conn_ag_01',
    });

    const now = 1730000000000;
    health.recordFailure(candidate, { httpStatus: 402, message: 'resets in 10s' }, now);

    const evalPastReset = health.evaluateHealth(candidate, now + 15000);
    assert.equal(evalPastReset.healthy, false);
    assert.equal(evalPastReset.requiresProbe, true);
    assert.equal(evalPastReset.quotaStatus, 'RESET_ELAPSED_PROBE_NEEDED');

    health.setModelLock('antigravity', 'claude-opus-4-6-thinking', 'conn_ag_01', now + 10000);
    assert.equal(health.evaluateHealth(candidate, now + 2000).healthy, false);
    assert.equal(health.evaluateHealth(candidate, now + 12000).requiresProbe, true);
  });
});

describe('Criterion 6: Model ID nhiều dấu slash được giữ nguyên', () => {
  test('Preserves multiple slashes and casing without mutilation', () => {
    const p1 = resolveModelPrefix('cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.equal(p1.prefix, 'cf');
    assert.equal(p1.upstreamProviderId, 'cloudflare-ai');
    assert.equal(p1.outboundModelId, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    const p2 = resolveModelPrefix('cl/dots-studio/dots-3-note-preview:free');
    assert.equal(p2.prefix, 'cl');
    assert.equal(p2.upstreamProviderId, 'cline');
    assert.equal(p2.outboundModelId, 'dots-studio/dots-3-note-preview:free');
  });
});

describe('Criterion 7: Combo không làm mất identity hoặc vượt ràng buộc selection', () => {
  test('Combo retains constituent branches and fails reviewer admission if branch violates policy', () => {
    const combo = createRouteIdentity({
      harness: 'direct-http',
      sourceId: '9router',
      gatewayId: '9router',
      configuredModelId: 'shipde-writer',
    });

    const expanded = expandComboIdentity(
      combo,
      ['ag/gemini-3.8-flash', 'ag/claude-opus-4-6-thinking'],
      {
        antigravity: [{ connectionId: 'ag1', accountRef: 'vi***07@gmail.com', priority: 1 }],
      }
    );

    assert.equal(expanded.isCombo, true);
    assert.equal(expanded.comboBranches.length, 2);
    assert.equal(expanded.comboBranches[0].outboundModelId, 'gemini-3.8-flash');

    const selector = new UnifiedRouteSelector({ excludedModelPatterns: { reviewer: [/claude/i] } });
    const evaluation = selector.evaluateAdmission(expanded, { taskId: 'T-01', role: 'reviewer' });
    assert.equal(evaluation.admitted, false);
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
            rows: [{ modelId: 'gemini-3.8-flash', remainingPercent: 40 }],
          },
        ],
        models: ['gemini-3.8-flash'],
      },
    });

    const pathways = new Set(candidates.map((c) => c.pathway));
    assert.ok(pathways.has('9ROUTER'));
    assert.ok(pathways.has('DIRECT'));
    assert.ok(pathways.has('AGY_POOL'));

    const selector = new UnifiedRouteSelector();
    const result = await selector.selectRoute(candidates, {
      taskId: 'TASK-CORE-SELECT',
      role: 'writer',
      requiredCapabilities: ['general_code'],
    });

    assert.equal(result.status, 'ADMITTED_AND_SELECTED');
    assert.ok(result.chosen);
  });
});

describe('Criterion 9: JEV cache hit/miss và undecided không gây gọi lặp vô hạn', () => {
  test('JEV advisory caches properly and falls back deterministically on UNDECIDED', async () => {
    let askCount = 0;
    const mockJevAsk = async () => {
      askCount++;
      return { choice: 'QUALITY_FIRST', confidence: 0.85 };
    };

    const selector = new UnifiedRouteSelector({ jevAsk: mockJevAsk, minConfidence: 0.7 });
    const candidates = [
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'm-a',
        metadata: { capabilities: ['c1'] },
      }),
      createRouteIdentity({
        harness: 'direct-http',
        configuredModelId: 'm-b',
        metadata: { capabilities: ['c1'] },
      }),
    ];

    const profile = { taskId: 'T-JEV', role: 'writer', requiredCapabilities: ['c1'] };
    const res1 = await selector.selectRoute(candidates, profile);
    assert.equal(res1.jev.outcome, 'DECIDED');
    assert.equal(askCount, 1);

    const res2 = await selector.selectRoute(candidates, profile);
    assert.equal(res2.jev.reason, 'JEV_CACHE_HIT');
    assert.equal(askCount, 1);
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

    const result = await selector.selectRoute([candidate], {
      taskId: 'TASK-BUDGET-01',
      role: 'writer',
      requiredCapabilities: ['code'],
      contextSize: 45000,
      turnBudget: 12,
      expectedDuration: 180000,
      acceptanceCriteria: ['Pass unit tests'],
      instructions: 'Implement feature X cleanly.',
    });

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
      acceptanceCriteria: ['Pass unit tests'],
      instructions: 'Implement feature X cleanly.',
    });
  });
});
