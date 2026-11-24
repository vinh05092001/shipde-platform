'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveOpencodeModelLimits,
  getIsolatedLauncher,
  getFolderHash,
} = require('../isolation-launcher');
const { resolveLauncher } = require('../orchestrate/writer-loop');
const { repairRound } = require('../orchestrate/repair-round');
const { runOrchestration } = require('../orchestrate');
const supervisor = require('../supervisor');
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

  // 4. Partial modelMeta (context only) falls through to candidate output; invalid values ignored
  const partialLimits = resolveOpencodeModelLimits({
    selectedSource: {
      ...routerSource,
      modelMeta: { 'ninerouter/partial': { limit: { context: 200000, output: 'bad' } } },
    },
    pinnedModel: 'ninerouter/partial',
    isRouter: true,
    opts: { contextWindow: -5, maxOutputTokens: 6144 },
    dispatchConfig: null,
  });
  assert.deepEqual(partialLimits, { context: 200000, output: 6144 });

  // 4b. Partial modelMeta (context only) with no opts/dispatchConfig keeps historical 4096 for missing output
  const partialMissingOutput = resolveOpencodeModelLimits({
    selectedSource: {
      ...routerSource,
      modelMeta: { 'ninerouter/partial-only-ctx': { limit: { context: 200000 } } },
    },
    pinnedModel: 'ninerouter/partial-only-ctx',
    isRouter: true,
    opts: {},
    dispatchConfig: null,
  });
  assert.deepEqual(partialMissingOutput, { context: 200000, output: 4096 });

  // 5. Router source with invalid/missing modelMeta/opts/dispatchConfig preserves historical 32000/4096 fallback
  const missingRouterLimits = resolveOpencodeModelLimits({
    selectedSource: routerSource,
    pinnedModel: 'ninerouter/unknown',
    isRouter: true,
    opts: { contextWindow: Number.NaN, maxOutputTokens: 0 },
    dispatchConfig: null,
  });
  assert.deepEqual(missingRouterLimits, { context: 32000, output: 4096 });

  // 6. Non-router direct source without modelMeta/opts preserves legacy 32000/4096
  const nonRouterLimits = resolveOpencodeModelLimits({
    selectedSource: { id: 'custom', endpoint: 'http://127.0.0.1:1/v1' },
    pinnedModel: 'custom/model',
    isRouter: false,
    opts: {},
    dispatchConfig,
  });
  assert.deepEqual(nonRouterLimits, { context: 32000, output: 4096 });
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

test('Mutation C: getIsolatedLauncher() writes candidate/registry limits into worker opencode.json for both vinh combo and member', (t) => {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-opencode-limits-'));
  t.after(() => fs.rmSync(area, { recursive: true, force: true }));
  t.mock.method(os, 'tmpdir', () => area);
  const prevLocalAppData = process.env.LOCALAPPDATA;
  const prevKey = process.env.NINEROUTER_API_KEY;
  process.env.LOCALAPPDATA = area;
  process.env.NINEROUTER_API_KEY = 'test-not-a-key';
  t.after(() => {
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
    if (prevKey === undefined) delete process.env.NINEROUTER_API_KEY;
    else process.env.NINEROUTER_API_KEY = prevKey;
  });

  const host = path.join(area, 'host');
  const workerDir = path.join(area, 'worker');
  fs.mkdirSync(host, { recursive: true });
  fs.mkdirSync(workerDir, { recursive: true });
  const baseSha = 'a'.repeat(40);

  const verdictPath = path.join(host, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: host,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: getFolderHash(path.join(host, 'scripts/ai/isolation')),
      sid: 'fixture-sid',
      details: { boundary: 'PASS' },
    })
  );

  const realRm = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (target, options) => {
    if (path.resolve(String(target)) === path.resolve(workerDir)) return;
    return realRm(target, options);
  });
  t.mock.method(supervisor, 'withCleanGitEnv', (_dir, cb) => cb('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: baseSha }));
  t.mock.method(cp, 'spawnSync', (command, args) => {
    if (
      command === 'git' &&
      Array.isArray(args) &&
      args.some((a) => String(a).startsWith('refs/shipde/carry/'))
    ) {
      return { status: 1, stdout: '' };
    }
    if (command === 'powershell.exe') {
      const script = fs.readFileSync(args[args.length - 1], 'utf8');
      const nonce = script.match(/\$completionNonce = "([^"]+)"/)[1];
      const output = script.match(/\$output \| ConvertTo-Json.*Out-File "([^"]+)"/)[1];
      fs.writeFileSync(
        output,
        JSON.stringify({
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          completed: true,
          completionNonce: nonce,
        })
      );
      return { status: 0, stdout: 'ok' };
    }
    return { status: 0, stdout: baseSha };
  });

  const injectedRegistry = {
    dispatch: {
      nineRouterWriterComboLimits: { contextWindow: 96000, maxOutputTokens: 4096 },
    },
  };
  for (const [modelArg, modelKey, ctxWin, maxOut, expected] of [
    ['ninerouter/vinh', 'vinh', 64000, 2048, { context: 64000, output: 2048 }],
    [
      'ninerouter/rc/zai-org/GLM-5.3',
      'rc/zai-org/GLM-5.3',
      64000,
      2048,
      { context: 64000, output: 2048 },
    ],
    ['ninerouter/vinh', 'vinh', undefined, undefined, { context: 96000, output: 4096 }],
  ]) {
    const res = getIsolatedLauncher()(
      { id: 'opencode-direct', command: 'node' },
      ['run', '--model', modelArg, 'fix'],
      {
        cwd: host,
        workerRoot: workerDir,
        baseSha,
        verdictPath,
        decisionDir: path.join(area, 'decisions'),
        gateway: '9router',
        model: modelArg,
        registry: injectedRegistry,
        ...(ctxWin !== undefined ? { contextWindow: ctxWin } : {}),
        ...(maxOut !== undefined ? { maxOutputTokens: maxOut } : {}),
        getWorkerSid: () => 'fixture-sid',
        verifyBoundary: () => true,
        isolatedWorker: true,
      }
    );
    assert.equal(res.exitCode, 0);

    const opencodeCfg = JSON.parse(fs.readFileSync(path.join(workerDir, 'opencode.json'), 'utf8'));
    const modelEntry = opencodeCfg.provider.ninerouter.models[modelKey];
    assert.ok(modelEntry, `opencode.json must contain pinned entry for ${modelKey}`);
    assert.deepEqual(modelEntry.limit, expected);
  }
});

test('Mutation D: orchestrate writer job and repairRound job forward candidate contextWindow and maxOutputTokens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-limits-jobs-'));
  const registry = {
    dispatch: {
      nineRouterWriterCombo: 'vinh',
      comboSource: '9router',
      nineRouterWriterComboLimits: { contextWindow: 64000, maxOutputTokens: 2048 },
    },
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        harness: 'opencode-direct',
        endpoint: 'http://127.0.0.1:20128/v1',
        credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
      },
    ],
  };

  const writerJobs = [];
  await runOrchestration('limits writer job', {
    specs: [
      {
        id: 'TASK-AI-187',
        objective: 'Fix review-manifest CLI',
        allowedPaths: ['tools/ai-brain/review-manifest.js'],
        acceptanceCriteria: ['AC1 | ok'],
        verification: { command: 'echo ok' },
      },
    ],
    registry,
    env: { NINEROUTER_API_KEY: 'test-key' },
    decisionDir: dir,
    evidenceDir: dir,
    comboJevSelect: false,
    run: (job) => {
      writerJobs.push(job);
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  });
  assert.equal(writerJobs.length, 1);
  assert.equal(writerJobs[0].contextWindow, 64000);
  assert.equal(writerJobs[0].maxOutputTokens, 2048);

  const repairJobs = [];
  const candidate = {
    harness: 'opencode-direct',
    endpoint: 'http://127.0.0.1:20128/v1',
    gateway: '9router',
    source: '9router',
    upstream: '9router',
    accountId: '9router',
    quotaScope: '9router',
    modelId: 'vinh',
    combo: 'vinh',
    contextWindow: 64000,
    maxOutputTokens: 2048,
  };
  const runRepair = repairRound(
    {
      registry,
      env: { NINEROUTER_API_KEY: 'test-key' },
      decisionDir: dir,
      evidenceDir: dir,
      comboJevSelect: false,
      baseSha: 'b'.repeat(40),
      specs: [
        {
          id: 'TASK-AI-187',
          allowedPaths: ['tools/ai-brain/review-manifest.js'],
          acceptanceCriteria: ['AC1 | ok'],
          verification: { command: 'echo ok' },
        },
      ],
    },
    {
      id: 'TASK-AI-187',
      allowedPaths: ['tools/ai-brain/review-manifest.js'],
      verification: { command: 'echo ok' },
    },
    {
      candidateKey:
        'opencode-direct::http://127.0.0.1:20128/v1::9router::9router::9router::9router::vinh',
    },
    { goal: 'limits repair job', prompts: [], selections: [], launches: [] },
    { dir, now: Date.now(), runId: 'run-limits' },
    async (job) => {
      repairJobs.push(job);
      return { exitCode: 0, stdout: 'ok', stderr: '', workerSha: 'c'.repeat(40) };
    },
    dir,
    Date.now(),
    [candidate],
    {},
    registry,
    {}
  );
  await runRepair([{ id: 'F1', detail: 'fix' }], 'a'.repeat(40));
  assert.equal(repairJobs.length, 1);
  assert.equal(repairJobs[0].contextWindow, 64000);
  assert.equal(repairJobs[0].maxOutputTokens, 2048);
});
