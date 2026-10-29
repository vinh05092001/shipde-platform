'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  scanScope,
  scanAllQuotas,
  classifyQuotaResponse,
  loadQuotaState,
  saveQuotaState,
  isScopeBlocked,
  getQuotaScopeState,
  scanAllFullRoutes,
} = require('../quota-scan');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-scan-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('classifyQuotaResponse maps HTTP codes and body hints to canonical status codes and extracts retryAfter', () => {
  // 200 OK
  const okRes = classifyQuotaResponse(
    200,
    '{"id":"chatcmpl-1","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}',
    new Map()
  );
  assert.equal(okRes.code, 'OK');
  assert.equal(okRes.status, 200);

  // 200 without completion evidence is not OK; a 200 error envelope is classified by its body
  assert.equal(classifyQuotaResponse(200, '{"id":"chatcmpl-1"}', new Map()).code, 'UNVERIFIED');
  assert.equal(classifyQuotaResponse(200, '', new Map()).code, 'UNVERIFIED');
  assert.equal(
    classifyQuotaResponse(200, '{"error":{"message":"insufficient_quota"}}', new Map()).code,
    'QUOTA'
  );

  // 402 QUOTA
  const quotaRes = classifyQuotaResponse(402, 'Payment Required: Insufficient balance', new Map());
  assert.equal(quotaRes.code, 'QUOTA');
  assert.equal(quotaRes.status, 402);

  // 400 with balance insufficient body
  const bodyQuota = classifyQuotaResponse(
    400,
    JSON.stringify({ error: { message: 'balance is insufficient, please recharge your account' } }),
    new Map()
  );
  assert.equal(bodyQuota.code, 'QUOTA');

  // 401 AUTH
  const authRes = classifyQuotaResponse(401, 'Unauthorized: Invalid API key', new Map());
  assert.equal(authRes.code, 'AUTH');

  // 451 REGION
  const regRes = classifyQuotaResponse(
    451,
    'Unavailable for legal reasons: Region not supported',
    new Map()
  );
  assert.equal(regRes.code, 'REGION');

  // 429 RATE with retry-after header in seconds
  const headers = new Map([['retry-after', '120']]);
  const rateRes = classifyQuotaResponse(429, 'Rate limit exceeded', headers, 1000000);
  assert.equal(rateRes.code, 'RATE');
  assert.equal(rateRes.retryAfter, 1000000 + 120 * 1000);

  // 503 NO_CHANNEL
  const chanRes = classifyQuotaResponse(503, 'upstream no channel available for model', new Map());
  assert.equal(chanRes.code, 'NO_CHANNEL');
});

test('quota-scan splits 9Router by upstream prefix using /v1/models and 1-token /v1/chat/completions', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');

  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, method: opts?.method, body: opts?.body ? JSON.parse(opts.body) : null });

    // Models endpoint for 9router
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          data: [
            { id: 'cl/claude-3-5-sonnet' },
            { id: 'cl/claude-3-haiku' },
            { id: 'kr/deepseek-v3' },
            { id: 'ocz/glm-4' },
            { id: 'ag/gemini-2.5-pro' },
          ],
        }),
        text: async () => '',
      };
    }

    // Chat completions endpoint
    if (url.endsWith('/chat/completions')) {
      const model = opts.body ? JSON.parse(opts.body).model : '';
      if (model.startsWith('cl/')) {
        // cl has exhausted quota
        return {
          ok: false,
          status: 402,
          headers: new Map(),
          text: async () => JSON.stringify({ error: 'balance is insufficient' }),
        };
      }
      if (model.startsWith('kr/')) {
        // kr is OK
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
        };
      }
      if (model.startsWith('ocz/')) {
        // ocz is AUTH error
        return {
          ok: false,
          status: 401,
          headers: new Map(),
          text: async () => JSON.stringify({ error: 'invalid api key' }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    }

    throw new Error(`Unexpected url: ${url}`);
  };

  const registry = {
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        endpoint: 'http://127.0.0.1:20128/v1',
        credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
      },
      {
        id: 'bai',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://api.b.ai/v1',
        models: ['b.ai/g2'],
        credential: { type: 'api-key', env: 'BAI_API_KEY' },
      },
    ],
  };

  const env = { NINEROUTER_API_KEY: 'test-9r-key', BAI_API_KEY: 'test-bai-key' };

  const result = await scanAllQuotas({
    registry,
    env,
    fetch: fakeFetch,
    quotaStateFile: quotaFile,
    now: 1700000000000,
  });

  assert.equal(fs.existsSync(quotaFile), true);
  const saved = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));

  // 9router should be split into 4 separate scopes: cl, kr, ocz, ag
  assert.equal(saved.scopes['9router::cl'].code, 'QUOTA');
  assert.equal(saved.scopes['9router::cl'].model, 'cl/claude-3-5-sonnet');
  assert.equal(saved.scopes['9router::kr'].code, 'OK');
  assert.equal(saved.scopes['9router::ocz'].code, 'AUTH');
  assert.equal(saved.scopes['9router::ag'].code, 'OK');

  // Verify all requests used the configured dispatch.quotaScanMaxTokens
  const configuredMaxTokens = require('../sources.json').dispatch.quotaScanMaxTokens;
  const completionCalls = calls.filter((c) => c.url.endsWith('/chat/completions'));
  for (const c of completionCalls) {
    assert.equal(c.body.max_tokens, configuredMaxTokens);
  }
});

test('isScopeBlocked and getQuotaScopeState identify blocked scopes until retryAfter expires', () => {
  const now = 1700000000000;
  const quotaState = {
    scopes: {
      '9router::cl': {
        source: '9router',
        scope: 'cl',
        code: 'QUOTA',
        at: now - 1000,
        retryAfter: now + 50000,
      },
      '9router::kr': {
        source: '9router',
        scope: 'kr',
        code: 'OK',
        at: now - 1000,
      },
      '9router::ocz': {
        source: '9router',
        scope: 'ocz',
        code: 'RATE',
        at: now - 1000,
        retryAfter: now - 500, // already expired!
      },
    },
  };

  const clCandidate = {
    gateway: '9router',
    upstream: 'cl',
    modelId: 'cl/claude-3-5-sonnet',
  };
  const krCandidate = {
    gateway: '9router',
    upstream: 'kr',
    modelId: 'kr/deepseek-v3',
  };
  const oczCandidate = {
    gateway: '9router',
    upstream: 'ocz',
    modelId: 'ocz/glm-4',
  };

  const clState = getQuotaScopeState(clCandidate, quotaState);
  assert.equal(clState.code, 'QUOTA');
  assert.equal(isScopeBlocked(clState, now), true);

  const krState = getQuotaScopeState(krCandidate, quotaState);
  assert.equal(krState.code, 'OK');
  assert.equal(isScopeBlocked(krState, now), false);

  const oczState = getQuotaScopeState(oczCandidate, quotaState);
  assert.equal(oczState.code, 'RATE');
  // ocz expired retryAfter -> should not be blocked
  assert.equal(isScopeBlocked(oczState, now), false);
});

test('capability-probe and dispatch --dry-run skip candidates whose scope is in QUOTA, AUTH, or REGION', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');
  const now = 1700000000000;

  // Save quota state with cl in QUOTA and kr in OK
  saveQuotaState(
    {
      updatedAt: new Date(now).toISOString(),
      scopes: {
        '9router::cl': {
          source: '9router',
          scope: 'cl',
          upstream: 'cl',
          code: 'QUOTA',
          at: new Date(now).toISOString(),
        },
        '9router::kr': {
          source: '9router',
          scope: 'kr',
          upstream: 'kr',
          code: 'OK',
          at: new Date(now).toISOString(),
        },
      },
    },
    { quotaStateFile: quotaFile }
  );

  const registry = {
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        endpoint: 'http://127.0.0.1:20128/v1',
        modelPrefix: 'ninerouter/',
      },
      {
        id: 'xkiro',
        kind: 'model-source',
        servesModels: true,
        reachedVia: '9router',
        routerAlias: 'kr',
      },
    ],
    dispatch: {
      quotaScanIntervalMin: 60,
    },
  };

  const candidates = [
    {
      candidateKey: 'paseo::cl/claude-3-5-sonnet::acct-1',
      harness: 'paseo',
      gateway: '9router',
      upstream: 'cl',
      modelId: 'cl/claude-3-5-sonnet',
      score: 95,
      capabilities: { jsonSchema: true, tools: true },
    },
    {
      candidateKey: 'paseo::kr/deepseek-v3::acct-2',
      harness: 'paseo',
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/deepseek-v3',
      score: 85,
      capabilities: { jsonSchema: true, tools: true },
    },
  ];

  // In capability-probe, candidate in blocked scope must be skipped / refused with QUOTA
  const { probeCapabilities } = require('../capability-probe');
  const capabilityEvidence = {};
  await probeCapabilities(
    candidates,
    { requiredCapabilities: ['tools'] },
    {
      registry,
      quotaStateFile: quotaFile,
      capabilityEvidence,
      now,
    }
  );

  // cl/claude-3-5-sonnet must be marked blocked
  assert.equal(candidates[0].blocked, true);
  assert.ok(/QUOTA/.test(candidates[0].blockReason));

  // kr/deepseek-v3 must not be blocked by quota
  assert.equal(candidates[1].blocked || false, false);

  // In dispatch --dry-run, routing path must exclude the exhausted scope (cl) and choose kr
  const { dispatchCommand } = require('../cli');
  const dispatchRes = await dispatchCommand(
    { 'dry-run': true, root: dir, 'quota-state': quotaFile },
    {
      candidates: [
        {
          candidateKey: 'paseo::cl/claude-3-5-sonnet::acct-1',
          harness: 'paseo',
          gateway: '9router',
          upstream: 'cl',
          account: 'acct-1',
          accountId: 'acct-1',
          modelId: 'cl/claude-3-5-sonnet',
          score: 95,
          capabilities: { jsonSchema: true, tools: true },
          capabilityDeclarations: { jsonSchema: true, tools: true },
        },
        {
          candidateKey: 'paseo::kr/deepseek-v3::acct-2',
          harness: 'paseo',
          gateway: '9router',
          upstream: 'kr',
          account: 'acct-2',
          accountId: 'acct-2',
          modelId: 'kr/deepseek-v3',
          score: 85,
          capabilities: { jsonSchema: true, tools: true },
          capabilityDeclarations: { jsonSchema: true, tools: true },
        },
      ],
      items: [
        {
          workItemId: 'TASK-AI-142-DISPATCH',
          role: 'author.foundation',
          qualityFloor: 0,
        },
      ],
      accounts: [{ id: 'acct-1' }, { id: 'acct-2' }],
      registry,
      quotaStateFile: quotaFile,
      now,
      capabilitiesPrepared: true,
      log: () => {},
      exit: () => {},
    }
  );

  assert.equal(dispatchRes.exitCode, 0);
  assert.ok(
    dispatchRes.decision.chosen.includes('kr/deepseek-v3'),
    'Unblocked candidate kr must be chosen'
  );
  assert.ok(
    dispatchRes.decision.rejected.some(
      (r) => r.offeringId.includes('cl/claude-3-5-sonnet') && /QUOTA/.test(r.reason)
    ),
    'Exhausted scope cl must be in rejected with QUOTA reason'
  );
  assert.equal(
    dispatchRes.decision.candidates.some((c) => c.offeringId.includes('cl/claude-3-5-sonnet')),
    false,
    'Exhausted scope cl must not be in eligible candidate ranking'
  );
});

test('preferKnownGood removes candidates in blocked quota scopes and records them in rejected', () => {
  const { preferKnownGood } = require('../probe-order');
  const now = 1700000000000;

  const quotaState = {
    scopes: {
      '9router::cl': {
        source: '9router',
        scope: 'cl',
        upstream: 'cl',
        code: 'QUOTA',
        at: new Date(now).toISOString(),
      },
      '9router::kr': {
        source: '9router',
        scope: 'kr',
        upstream: 'kr',
        code: 'OK',
        at: new Date(now).toISOString(),
      },
    },
  };

  const candidateCl = {
    candidateKey: 'paseo::cl/claude-3-5-sonnet::acct-1',
    harness: 'paseo',
    gateway: '9router',
    upstream: 'cl',
    modelId: 'cl/claude-3-5-sonnet',
    score: 95,
  };
  const candidateKr = {
    candidateKey: 'paseo::kr/deepseek-v3::acct-2',
    harness: 'paseo',
    gateway: '9router',
    upstream: 'kr',
    modelId: 'kr/deepseek-v3',
    score: 85,
  };

  const initialResult = {
    chosen: candidateCl.candidateKey,
    ranking: [candidateCl, candidateKr],
    rejected: [],
  };

  const filtered = preferKnownGood(initialResult, [candidateCl, candidateKr], {
    quotaState,
    now,
  });

  // cl was removed from ranking because its scope is in QUOTA
  assert.equal(filtered.ranking.length, 1);
  assert.equal(filtered.ranking[0].candidateKey, candidateKr.candidateKey);
  assert.equal(filtered.chosen, candidateKr.candidateKey);

  // cl is recorded in rejected
  const rejectedCl = filtered.rejected.find((r) => r.candidateKey === candidateCl.candidateKey);
  assert.ok(rejectedCl);
  assert.equal(rejectedCl.reasonCode, 'QUOTA_SCOPE_QUOTA');
});

test('cli.js quotaScanCommand runs scan and writes quota-state.json', async (t) => {
  const dir = fixture(t);
  const quotaFile = path.join(dir, 'quota-state.json');
  const { quotaScanCommand } = require('../cli');

  const registry = {
    sources: [
      {
        id: 'bai',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://api.b.ai/v1',
        models: ['b.ai/g2'],
      },
    ],
  };

  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
  });

  const res = await quotaScanCommand(
    { out: quotaFile },
    {
      registry,
      fetch: fakeFetch,
      quotaStateFile: quotaFile,
    }
  );

  assert.equal(fs.existsSync(quotaFile), true);
  assert.equal(res.count, 1);
  assert.equal(res.blockedCount, 0);
  const data = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
  assert.equal(data.scopes.bai.code, 'OK');
});

test('isCompletionBody and validateCompletion accept SSE stream chunk bodies with delta content and reasoning', () => {
  const { isCompletionBody, validateCompletion, classifyQuotaResponse } = require('../quota-scan');

  // SSE stream fixture with delta content across multiple data chunks
  const sseBody = [
    'data: {"id":"chatcmpl-sse-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
    'data: {"id":"chatcmpl-sse-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"o"}}]}',
    'data: {"id":"chatcmpl-sse-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"k"}}]}',
    'data: [DONE]',
  ].join('\n');

  assert.equal(isCompletionBody(sseBody), true);
  assert.deepEqual(validateCompletion(sseBody), { ok: true });

  const classified = classifyQuotaResponse(200, sseBody, new Map());
  assert.equal(classified.code, 'OK');
  assert.equal(classified.status, 200);

  // SSE stream with reasoning_content (e.g. thinking models)
  const sseReasoningBody = [
    'data: {"id":"chatcmpl-sse-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
    'data: {"id":"chatcmpl-sse-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"reasoning_content":"reasoning thought"}}]}',
    'data: [DONE]',
  ].join('\n');

  assert.equal(isCompletionBody(sseReasoningBody), true);
  assert.deepEqual(validateCompletion(sseReasoningBody), { ok: true });

  // Empty SSE stream without text content or tool call must be rejected
  const emptySseBody = [
    'data: {"id":"chatcmpl-sse-3","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
    'data: [DONE]',
  ].join('\n');

  assert.equal(isCompletionBody(emptySseBody), false);
  assert.equal(validateCompletion(emptySseBody).ok, false);
});

test('TASK-AI-142 Finding 8: NO_CHANNEL stays model-scoped and does not block source scope or sibling models', () => {
  const now = Date.now();
  const sourceEntry = {
    source: 'src-a',
    scope: 'src-a',
    model: 'rep-model',
    code: 'NO_CHANNEL',
    status: 404,
    reason: 'NO_CHANNEL',
    at: new Date(now).toISOString(),
  };
  const modelEntry = {
    source: 'src-a',
    scope: 'model-fail',
    model: 'model-fail',
    code: 'NO_CHANNEL',
    status: 404,
    reason: 'NO_CHANNEL',
    at: new Date(now).toISOString(),
  };

  // Source-scoped NO_CHANNEL is NOT blocked (isScopeBlocked returns false)
  assert.equal(isScopeBlocked(sourceEntry, now), false);
  // Model-scoped NO_CHANNEL IS blocked (isScopeBlocked returns true)
  assert.equal(isScopeBlocked(modelEntry, now), true);

  const quotaState = {
    scopes: {
      'src-a': sourceEntry,
      'src-a::src-a': sourceEntry,
      'src-a::model-fail': modelEntry,
    },
  };

  const candFail = { gateway: 'src-a', modelId: 'model-fail' };
  const candSibling = { gateway: 'src-a', modelId: 'model-sibling' };

  // Candidate with failed model is blocked by its model-scoped entry
  const stateFail = getQuotaScopeState(candFail, quotaState, { now });
  assert.equal(stateFail?.code, 'NO_CHANNEL');
  assert.equal(isScopeBlocked(stateFail, now), true);

  // Sibling candidate on same source is NOT blocked
  const stateSibling = getQuotaScopeState(candSibling, quotaState, { now });
  assert.equal(isScopeBlocked(stateSibling, now), false);
});

test('TASK-AI-142 Finding 6: scanAllFullRoutes does not promote model failure to prefix or source scope', async () => {
  const quotaState = { scopes: {} };
  const now = Date.now();
  const registry = {
    sources: [
      {
        id: '9router',
        kind: 'router',
        harness: 'paseo',
        endpoint: 'http://127.0.0.1:20128/v1',
        credential: { env: 'TEST_KEY' },
        servesModels: true,
      },
    ],
    dispatch: {
      routeEvidenceMaxAgeMs: 60000,
      fullRouteScan: {
        timeoutMs: 1000,
        maxTokens: 5,
        concurrency: 1,
        nineRouterConcurrency: 1,
        nineRouterModelsTimeoutMs: 1000,
        gatewayModelsTimeoutMs: 1000,
        externalModelsTimeoutMs: 1000,
      },
    },
  };

  const fetchFn = async (url) => {
    if (url.includes('/models')) {
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'anthropic/claude-3-opus', owned_by: 'anthropic' }],
        }),
      };
    }
    // Probe fails with 404 NO_CHANNEL
    return {
      status: 404,
      ok: false,
      text: async () =>
        JSON.stringify({ error: { message: 'no channel available for this model' } }),
      headers: { get: () => null },
    };
  };

  const tmpLog = path.join(os.tmpdir(), `test-scan-${Date.now()}.jsonl`);
  try {
    await scanAllFullRoutes({
      quotaState,
      registry,
      jsonlFile: tmpLog,
      now,
      fetchFn,
      source: '9router',
      env: { TEST_KEY: 'mock-key' },
    });

    // 1. Model key must be recorded
    assert.ok(
      quotaState.scopes['9router::anthropic/claude-3-opus'],
      'exact model key must be recorded'
    );
    assert.equal(quotaState.scopes['9router::anthropic/claude-3-opus'].code, 'NO_CHANNEL');

    // 2. Prefix scope and source scope must NOT be stamped
    assert.equal(quotaState.scopes['9router::anthropic'], undefined, 'must not stamp prefix scope');
    assert.equal(quotaState.scopes['9router'], undefined, 'must not stamp blanket source scope');

    // 3. Sibling model must remain unblocked
    const candSibling = { gateway: '9router', modelId: 'anthropic/claude-3-5-sonnet' };
    const siblingScope = getQuotaScopeState(candSibling, quotaState, { now });
    assert.equal(
      isScopeBlocked(siblingScope, now),
      false,
      'sibling model must not be blocked by unscanned prefix'
    );
  } finally {
    try {
      fs.unlinkSync(tmpLog);
    } catch {}
  }
});
