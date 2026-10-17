'use strict';

/**
 * TASK-AI-142: Goal writer pool - candidate generation and capability probe starvation fix.
 *
 * Verifies:
 * 1. Direct sources (regolo, tencent, cohere, baseten, etc.) collect models from
 *    string catalogue items (with prefix), sourceModels with alias keys
 *    (opencode-provider-*-options, *-ai), and discovery catalogues.
 * 2. intake composeOrchestrateCommand passes --catalogue-sources.
 * 3. probeCapabilities prioritizes writer candidates (codex, agy-pool, opencode-direct)
 *    so they are probed before unranked router routes and not starved by deadline.
 * 4. Prior real work evidence (WORK_ITEM_PASS / combinations) satisfies jsonSchema capability
 *    without re-probing or burning budget.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { generateCandidates } = require('../candidates');
const { probeCapabilities } = require('../capability-probe');
const { composeOrchestrateCommand } = require('../intake');

describe('TASK-AI-142: Goal writer pool fixes', () => {
  test('direct source harvests models from string catalogue entries with provider prefix', () => {
    const registry = {
      version: 2,
      sources: [
        {
          id: 'regolo',
          kind: 'model-source',
          endpoint: 'https://api.regolo.ai/v1',
          credential: { type: 'api-key', env: 'REGOLO_API_KEY' },
          servesModels: true,
        },
      ],
    };
    const catalogue = ['regolo/gemma4-31b', 'other-vendor/model-z'];
    const candidates = generateCandidates({ registry, catalogue, accounts: [] });
    const regoloCands = candidates.filter(
      (c) => c.harness === 'opencode-direct' && c.source === 'regolo'
    );
    assert.equal(
      regoloCands.length,
      1,
      'must generate regolo opencode-direct candidate from string catalogue'
    );
    assert.equal(regoloCands[0].modelId, 'regolo/gemma4-31b');
  });

  test('direct source harvests models from sourceModels with alias keys', () => {
    const registry = {
      version: 2,
      sources: [
        {
          id: 'regolo',
          kind: 'model-source',
          endpoint: 'https://api.regolo.ai/v1',
          credential: { type: 'api-key', env: 'REGOLO_API_KEY' },
          servesModels: true,
        },
      ],
    };
    const sourceModels = {
      'opencode-provider-regolo-options': ['gemma4-31b', 'glm5.2'],
    };
    const candidates = generateCandidates({
      registry,
      catalogue: [],
      sourceModels,
      accounts: [],
    });
    const regoloCands = candidates.filter(
      (c) => c.harness === 'opencode-direct' && c.source === 'regolo'
    );
    assert.equal(regoloCands.length, 2, 'must harvest both models from alias key in sourceModels');
    const modelIds = regoloCands.map((c) => c.modelId).sort();
    assert.deepEqual(modelIds, ['regolo/gemma4-31b', 'regolo/glm5.2']);
  });

  test('intake composeOrchestrateCommand includes --catalogue-sources argument', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-intake-cmd-'));
    const res = composeOrchestrateCommand({
      root: 'C:\\tmp\\repo',
      runDir: tmpDir,
      baseSha: 'abc1234',
      repoRoot: 'C:\\tmp\\repo',
    });
    assert.ok(res.argv.includes('--catalogue-sources'), 'argv must contain --catalogue-sources');
    const idx = res.argv.indexOf('--catalogue-sources');
    assert.ok(
      res.argv[idx + 1].endsWith('catalogue-sources.json'),
      '--catalogue-sources must point to catalogue-sources.json'
    );
  });

  test('probeCapabilities prioritizes writer candidates ahead of unranked router routes to avoid budget starvation', async () => {
    const writerProfile = {
      role: 'writer',
      requiredCapabilities: ['jsonSchema'],
    };

    // Create 50 dummy router candidates followed by 1 codex writer candidate
    const dummyRouterCands = Array.from({ length: 50 }, (_, i) => ({
      harness: 'paseo',
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc1',
      quotaScope: 'acc1',
      modelId: `kr/dummy-model-${i}`,
      source: '9router',
      kind: 'agent-cli',
      capabilities: {},
    }));

    const codexWriterCand = {
      harness: 'codex',
      accessPath: 'cli',
      gateway: 'codex',
      upstream: 'codex',
      accountId: 'codex-cli',
      quotaScope: 'codex-cli',
      modelId: 'gpt-6.1-sol',
      source: 'codex',
      kind: 'agent-cli',
      capabilities: {},
    };

    const candidates = [...dummyRouterCands, codexWriterCand];

    let probedOrder = [];
    const fakeProbeCli = async (c, cap, remainingMs) => {
      probedOrder.push(c.harness);
      return { ok: true };
    };

    await probeCapabilities(candidates, writerProfile, {
      registry: { sources: [] },
      probeCli: fakeProbeCli,
      // Very small deadline budget to simulate starvation if ordered sequentially
      schemaProbeBudgetMs: 5000,
      deadline: Date.now() + 5000,
      allowNetwork: false,
    });

    assert.ok(probedOrder.includes('codex'), 'codex must be probed before budget exhaustion');
    assert.equal(
      probedOrder[0],
      'codex',
      'writer candidate (codex) must be probed first for writer profile'
    );
    assert.equal(codexWriterCand.capabilities.jsonSchema, true);
  });

  test('probeCapabilities reuses prior real work evidence (WORK_ITEM_PASS) without launching CLI', async () => {
    const writerProfile = {
      role: 'writer',
      requiredCapabilities: ['jsonSchema'],
    };

    const agyCand = {
      harness: 'agy-pool',
      accessPath: 'cli',
      gateway: 'antigravity',
      upstream: 'antigravity',
      accountId: 'agy01',
      quotaScope: 'agy01',
      modelId: 'gemini-3.8-flash-high',
      source: 'agy-pool',
      kind: 'agent-cli',
      capabilities: {},
    };

    let cliCalled = false;
    const fakeProbeCli = async () => {
      cliCalled = true;
      return { ok: true };
    };

    const capabilityEvidence = {
      combinations: [
        {
          harness: 'agy-pool',
          accountId: 'agy01',
          model: 'gemini-3.8-flash-high',
          evidence: [
            {
              status: 'passed',
              proofLevel: 'WORK_ITEM_PASS',
            },
          ],
        },
      ],
    };

    await probeCapabilities([agyCand], writerProfile, {
      registry: {
        sources: [
          {
            id: 'agy-pool',
            writerEnabled: true,
            allowWriter: true,
          },
        ],
      },
      capabilityEvidence,
      probeCli: fakeProbeCli,
      schemaProbeBudgetMs: 5000,
    });

    assert.equal(
      cliCalled,
      false,
      'probeCli must not be called when prior real work evidence exists'
    );
    assert.equal(
      agyCand.capabilities.jsonSchema,
      true,
      'jsonSchema must be verified from prior evidence'
    );
  });
});
