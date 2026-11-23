'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOpencodeModelLimits } = require('../isolation-launcher');
const { resolveLauncher } = require('../orchestrate/writer-loop');
const sourcesApi = require('../sources');
const combo = require('../combo');
const comboJev = require('../combo-jev-select');

test('opencode limits resolve from modelMeta -> candidate opts -> nineRouterWriterComboLimits without hardcoded 32000/4096', () => {
  const reg = sourcesApi.loadSources();
  const dispatchConfig = reg.dispatch;
  assert.equal(dispatchConfig.nineRouterWriterComboLimits.contextWindow, 128000);
  assert.equal(dispatchConfig.nineRouterWriterComboLimits.maxOutputTokens, 8192);

  // 1. Combo candidate `vinh` gets 128000/8192 via candidate limits and/or dispatchConfig
  const comboCand = combo.comboCandidate({
    registry: reg,
    env: { NINEROUTER_API_KEY: 'k' },
  }).candidate;
  assert.equal(comboCand.contextWindow, 128000);
  assert.equal(comboCand.maxOutputTokens, 8192);

  const routerSource = reg.sources.find((s) => s.id === '9router');
  const comboLimits = resolveOpencodeModelLimits({
    selectedSource: routerSource,
    pinnedModel: 'ninerouter/vinh',
    isRouter: true,
    opts: { contextWindow: comboCand.contextWindow, maxOutputTokens: comboCand.maxOutputTokens },
    dispatchConfig,
  });
  assert.deepEqual(comboLimits, { context: 128000, output: 8192 });

  // 2. Combo member inherits 128000/8192 even if opts omitted (via dispatchConfig.nineRouterWriterComboLimits)
  const memberBuilt = comboJev.buildMemberCandidate(
    { modelId: 'rc/zai-org/GLM-5.3', base: 'glm-5.3', effort: null, score: 34, tier: 'T1' },
    { registry: reg, env: { NINEROUTER_API_KEY: 'k' } }
  ).candidate;
  assert.equal(memberBuilt.contextWindow, 128000);
  assert.equal(memberBuilt.maxOutputTokens, 8192);

  const memberLimits = resolveOpencodeModelLimits({
    selectedSource: routerSource,
    pinnedModel: 'ninerouter/rc/zai-org/GLM-5.3',
    isRouter: true,
    opts: {},
    dispatchConfig,
  });
  assert.deepEqual(memberLimits, { context: 128000, output: 8192 });

  // 3. Explicit modelMeta overrides candidate and dispatchConfig
  const metaLimits = resolveOpencodeModelLimits({
    selectedSource: {
      ...routerSource,
      modelMeta: { 'ninerouter/custom': { limit: { context: 200000, output: 16384 } } },
    },
    pinnedModel: 'ninerouter/custom',
    isRouter: true,
    opts: { contextWindow: 128000, maxOutputTokens: 8192 },
    dispatchConfig,
  });
  assert.deepEqual(metaLimits, { context: 200000, output: 16384 });

  // 4. Unknown non-router source with no modelMeta/opts returns nulls (never guesses 32000/4096)
  const unknownLimits = resolveOpencodeModelLimits({
    selectedSource: { id: 'custom', endpoint: 'http://127.0.0.1:1/v1' },
    pinnedModel: 'custom/model',
    isRouter: false,
    opts: {},
    dispatchConfig,
  });
  assert.deepEqual(unknownLimits, { context: null, output: null });
});

test('writer-loop forwards candidate contextWindow and maxOutputTokens to isolatedLauncher', () => {
  const captured = [];
  const launcher = resolveLauncher({ isolatedWorker: true }, (_adapter, _args, opts) => {
    captured.push(opts);
    return { exitCode: 0, stdout: 'ok', stderr: '' };
  });
  const res = launcher({
    harness: 'opencode-direct',
    isolatedWorker: true,
    gateway: '9router',
    endpoint: 'http://127.0.0.1:20128/v1',
    model: 'ninerouter/rc/zai-org/GLM-5.3',
    prompt: 'fix review-manifest',
    cwd: process.cwd(),
    baseSha: 'a'.repeat(40),
    branch: 'feat/task-ai-187',
    title: 'TASK-AI-187',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    labels: { workItem: 'TASK-AI-187', role: 'author.foundation' },
  });
  assert.equal(res.exitCode, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].contextWindow, 128000);
  assert.equal(captured[0].maxOutputTokens, 8192);
});
