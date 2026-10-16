'use strict';

/**
 * Ship Dễ — TASK-AI-142: Model capabilities derivation and no fake 200k on 9Router.
 *
 * Problem:
 * Account "ninerouter" in seed-accounts.js declared blanket capabilities:
 * { jsonSchema: true, tools: true, contextWindow: 200000 }.
 * Because candidate generation copied acc.capabilities directly onto candidates,
 * every model routed through 9Router inherited 200k context window and tool
 * capabilities, regardless of the model's actual specifications.
 * E.g., Groq GPT-OSS 120b (context 131k / 8k TPM limit) falsely inherited
 * a 200k context window and bypassed the writer's minimum context filter,
 * causing infinite 413 request loops.
 *
 * Fix:
 * 1. Remove blanket capabilities from account "ninerouter" in seed-accounts.js.
 * 2. In candidates.js, derive capabilities per-model from modelMeta / catalogue,
 *    never inheriting blanket gateway account capabilities.
 * 3. Verify Groq 120b does not inherit 200k context.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');

describe('TASK-AI-142: per-model capabilities derivation and no fake 200k', () => {
  test('seed-accounts.js does not declare blanket 200k contextWindow on ninerouter account', () => {
    const seedAccountsPath = path.join(__dirname, '..', 'seed-accounts.js');
    const content = fs.readFileSync(seedAccountsPath, 'utf8');

    // Parse ACCOUNTS from seed-accounts.js
    const match = content.match(/id:\s*['"]ninerouter['"][\s\S]*?capabilities:\s*(\{[^}]*\})/);
    assert.ok(match, 'ninerouter account definition must exist in seed-accounts.js');

    // Blanket 200000 must NOT be in ninerouter capabilities
    assert.ok(
      !match[1].includes('200000'),
      'ninerouter account must not declare blanket contextWindow: 200000'
    );
  });

  test('Groq 120b does not inherit 200k context from gateway account', () => {
    const registry = sourcesApi.loadSources();
    const routerSource = registry.sources.find((s) => s.id === '9router');
    assert.ok(routerSource, '9router source must exist');

    // Attach real modelMeta for Groq 120b (131072 context window)
    const testRegistry = JSON.parse(JSON.stringify(registry));
    const testRouter = testRegistry.sources.find((s) => s.id === '9router');
    testRouter.modelMeta = {
      'groq/gpt-oss-120b': {
        contextWindow: 131072,
        maxOutputTokens: 8192,
      },
    };

    const accounts = [
      {
        id: 'ninerouter',
        provider: 'oc',
        // Even if an injected account has fake blanket capabilities:
        capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
      },
    ];

    const catalogue = [
      {
        gateway: '9router',
        upstream: 'groq',
        modelId: 'groq/gpt-oss-120b',
      },
      {
        gateway: '9router',
        upstream: 'other',
        modelId: 'other/unverified-model',
      },
    ];

    const result = candidatesApi.generateCandidates({
      registry: testRegistry,
      accounts,
      catalogue,
    });

    const groqCandidate = result.find(
      (c) => c.gateway === '9router' && c.modelId.includes('gpt-oss-120b')
    );
    assert.ok(groqCandidate, 'Groq 120b candidate must be generated');

    // Groq 120b must carry its verified 131k context, NEVER 200k!
    assert.notEqual(
      groqCandidate.contextWindow,
      200000,
      'Groq 120b must not inherit 200k contextWindow'
    );
    assert.notEqual(
      groqCandidate.capabilities?.contextWindow,
      200000,
      'Groq 120b capabilities must not have 200k contextWindow'
    );
    assert.equal(
      groqCandidate.contextWindow,
      131072,
      'Groq 120b must carry verified 131072 contextWindow from modelMeta'
    );

    // Unverified model must NOT have 200k context
    const unverifiedCand = result.find(
      (c) => c.gateway === '9router' && c.modelId.includes('unverified-model')
    );
    if (unverifiedCand) {
      assert.notEqual(
        unverifiedCand.contextWindow,
        200000,
        'unverified model must not inherit 200k contextWindow'
      );
      assert.equal(
        unverifiedCand.contextWindow,
        undefined,
        'unverified model contextWindow must be undefined'
      );
    }
  });

  test('OpenCode router candidates derive contextWindow per model from modelMeta or catalogue', () => {
    const registry = sourcesApi.loadSources();
    const testRegistry = JSON.parse(JSON.stringify(registry));
    const testRouter = testRegistry.sources.find((s) => s.id === '9router');
    testRouter.modelMeta = {
      'cl/openai/gpt-6-astra': {
        contextWindow: 1000000,
      },
    };

    const accounts = [
      {
        id: 'ninerouter',
        provider: 'oc',
        capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
      },
    ];

    const openCodeIds = ['ninerouter/cl/openai/gpt-6-astra', 'ninerouter/ocz/big-pickle'];

    const result = candidatesApi.generateCandidates({
      registry: testRegistry,
      accounts,
      openCodeIds,
    });

    const astraCand = result.find(
      (c) => c.harness === 'opencode' && c.modelId.includes('gpt-6-astra')
    );
    assert.ok(astraCand, 'Astra candidate must be generated');
    assert.equal(
      astraCand.contextWindow,
      1000000,
      'Astra candidate must carry 1M context from modelMeta'
    );

    const pickleCand = result.find(
      (c) => c.harness === 'opencode' && c.modelId.includes('big-pickle')
    );
    if (pickleCand) {
      assert.notEqual(
        pickleCand.contextWindow,
        200000,
        'big-pickle must not inherit blanket 200k from ninerouter account'
      );
    }
  });
});
