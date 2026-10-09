'use strict';

/**
 * Ship Dễ — TASK-AI-130: The Controller discovers every model the agy pool
 * offers and selects among them by evidence, with no hard-coded model.
 *
 * Acceptance criteria verification:
 *   AC-R01: Model list is discovered, never hard-coded; cached and resilient to failure.
 *   AC-R02: Capabilities and contextWindow inherited from catalogue entry for same backend model.
 *   AC-R03: Quota family mapping: gemini-* -> gemini, claude-* and gpt-* -> claude-gpt;
 *           candidates excluded when account family quota is 0% or account is AUTH_FAILED.
 *   AC-R04: Ranking among discovered models uses evidence/quality/proof-floor logic only.
 *   AC-R05: TASK-AI-126 gating unchanged; candidates.test.js stays passing.
 *   AC-R06: 6 sub-cases:
 *           1. Discovered list with gemini-3.8-flash-high & claude-opus-4-6-thinking produces candidates for both on agy01..agy07.
 *           2. Gemini-family 0% account still offers its Claude model.
 *           3. AUTH_FAILED accounts are excluded.
 *           4. Unknown model is rejected with CAPABILITY_MISSING.
 *           5. Failed discovery keeps last good list with a warning, never falls back to hard-coded ID.
 *           6. Grep-level proof that no agy model id literal remains in sources.json or candidates.js.
 */

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../agy-pool-runtime');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');
const routing = require('../routing');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function tmpDir(prefix) {
  const upstreamDir = path.join(REPO_ROOT, '.upstream-tmp');
  fs.mkdirSync(upstreamDir, { recursive: true });
  return fs.mkdtempSync(path.join(upstreamDir, prefix));
}

let tempHome;

beforeEach(() => {
  tempHome = tmpDir('task-ai-130-home-');
  mock.method(os, 'homedir', () => tempHome);
  pool.resetPoolDiscoveryCache();
});

afterEach(() => {
  mock.restoreAll();
  pool.resetPoolDiscoveryCache();
});

describe('TASK-AI-130: agy-pool discovery and evidence selection', () => {
  test('AC-R06.1: discovered list with gemini-3.8-flash-high and claude-opus-4-6-thinking produces candidates for both on agy01..agy07', () => {
    const runsDir = tmpDir('task-ai-130-runs1-');

    // agy01..agy07 have 100% quota in both families
    for (let i = 1; i <= 7; i++) {
      const acc = `agy${String(i).padStart(2, '0')}`;
      const dir = path.join(runsDir, acc);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'out.txt'),
        JSON.stringify({
          groups: [
            {
              id: 'gemini',
              models: ['gemini-3.8-flash-high'],
              weekly: { remaining: 1.0 },
            },
            {
              id: 'claude-gpt',
              models: ['claude-opus-4-6-thinking'],
              weekly: { remaining: 1.0 },
            },
          ],
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'ok' }), 'utf8');
    }

    // agy08..agy10 are AUTH_FAILED
    for (let i = 8; i <= 10; i++) {
      const acc = `agy${String(i).padStart(2, '0')}`;
      const dir = path.join(runsDir, acc);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'result.json'),
        JSON.stringify({ state: 'login-required', reason: 'AUTH_FAILED' }),
        'utf8'
      );
    }

    const catalogue = [
      {
        modelId: 'ag/gemini-3.8-flash-high',
        capabilities: { jsonSchema: true },
        contextWindow: 1000000,
      },
      {
        modelId: 'ag/claude-opus-4-6-thinking',
        capabilities: { jsonSchema: true },
        contextWindow: 200000,
      },
    ];

    // Real discovery via fake CLI spawn (never injected opts.models)
    const fakeSpawn = () => ({
      status: 0,
      stdout:
        'Fetching available models...\n' +
        '# Header comment line\n' +
        'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n' +
        'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n' +
        'junk line with spaces\n',
      stderr: '',
    });

    const generated = candidatesApi.generateCandidates({
      fakeRunsDir: runsDir,
      catalogue,
      spawnSync: fakeSpawn,
      refresh: true,
    });

    const poolCands = generated.filter((c) => c.harness === 'agy-pool');
    assert.equal(poolCands.length, 14, '7 accounts * 2 models = 14 candidates');

    const accounts = [...new Set(poolCands.map((c) => c.accountId))].sort();
    assert.deepEqual(
      accounts,
      ['agy01', 'agy02', 'agy03', 'agy04', 'agy05', 'agy06', 'agy07'],
      'candidates exist only for agy01..agy07'
    );

    for (const c of poolCands) {
      assert.equal(c.upstream, 'antigravity');
      assert.equal(c.source, 'agy-pool');
      assert.equal(c.harness, 'agy-pool');
      assert.equal(c.capabilities.jsonSchema, true, 'inherits jsonSchema from catalogue');
      assert.equal(c.capabilities.tools, true, 'inherits tools from harness source');
      if (c.modelId === 'gemini-3.8-flash-high') {
        assert.equal(c.quotaScope, `${c.accountId}:gemini`);
        assert.equal(c.contextWindow, 1000000);
      } else if (c.modelId === 'claude-opus-4-6-thinking') {
        assert.equal(c.quotaScope, `${c.accountId}:claude-gpt`);
        assert.equal(c.contextWindow, 200000);
      } else {
        assert.fail(`unexpected model ${c.modelId}`);
      }
    }

    // Role author.foundation requires { jsonSchema: true, tools: true, minContext: 200000 }
    const profile = {
      taskId: 'TASK-AI-130-FOUNDATION',
      role: 'author.foundation',
      requiredCapabilities: ['jsonSchema', 'tools'],
      contextSize: 200000,
      proofFloor: 'NONE',
    };
    const assessment = {
      weightProfile: 'BALANCED',
      weights: { latency: 34, quality: 33, cost: 33 },
    };
    const rankResult = routing.rankForProfile(poolCands, profile, assessment, {
      now: Date.now(),
      evidenceData: {},
    });
    assert.ok(rankResult.chosen, 'candidate successfully chosen');
    assert.ok(
      !rankResult.rejected.some((r) => r.reasonCode.startsWith('CAPABILITY_MISSING')),
      'no candidate rejected with CAPABILITY_MISSING'
    );
    assert.ok(
      !rankResult.rejected.some((r) => r.reasonCode === 'CONTEXT_TOO_SMALL'),
      'no candidate rejected with CONTEXT_TOO_SMALL'
    );
  });

  test('AC-R06.2: Gemini-family 0% account still offers its Claude model', () => {
    const runsDir = tmpDir('task-ai-130-runs2-');
    const dir = path.join(runsDir, 'agy01');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'out.txt'),
      JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-3.8-flash-high'],
            weekly: { remaining: 0 },
          },
          {
            id: 'claude-gpt',
            models: ['claude-opus-4-6-thinking'],
            weekly: { remaining: 0.8 },
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'ok' }), 'utf8');

    const catalogue = [
      {
        modelId: 'ag/gemini-3.8-flash-high',
        capabilities: { jsonSchema: true },
        contextWindow: 1000000,
      },
      {
        modelId: 'ag/claude-opus-4-6-thinking',
        capabilities: { jsonSchema: true },
        contextWindow: 200000,
      },
    ];

    const models = ['gemini-3.8-flash-high', 'claude-opus-4-6-thinking'];
    const generated = candidatesApi.generateCandidates({
      fakeRunsDir: runsDir,
      catalogue,
      models,
    });

    const agy01Cands = generated.filter((c) => c.harness === 'agy-pool' && c.accountId === 'agy01');
    assert.equal(agy01Cands.length, 1, 'only Claude model is offered');
    assert.equal(agy01Cands[0].modelId, 'claude-opus-4-6-thinking');
    assert.equal(agy01Cands[0].quotaScope, 'agy01:claude-gpt');
    assert.equal(
      generated.some((c) => c.accountId === 'agy01' && c.modelId.includes('gemini')),
      false,
      'Gemini candidate is excluded due to 0% quota'
    );
  });

  test('AC-R06.3: AUTH_FAILED accounts are excluded', () => {
    const runsDir = tmpDir('task-ai-130-runs3-');

    // agy01 is valid
    const dir01 = path.join(runsDir, 'agy01');
    fs.mkdirSync(dir01, { recursive: true });
    fs.writeFileSync(
      path.join(dir01, 'out.txt'),
      JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-3.8-flash-high'],
            weekly: { remaining: 0.5 },
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir01, 'result.json'), JSON.stringify({ state: 'ok' }), 'utf8');

    // agy08 has state login-required
    const dir08 = path.join(runsDir, 'agy08');
    fs.mkdirSync(dir08, { recursive: true });
    fs.writeFileSync(
      path.join(dir08, 'result.json'),
      JSON.stringify({ state: 'login-required' }),
      'utf8'
    );

    // agy09 has reason AUTH_FAILED
    const dir09 = path.join(runsDir, 'agy09');
    fs.mkdirSync(dir09, { recursive: true });
    fs.writeFileSync(
      path.join(dir09, 'result.json'),
      JSON.stringify({ state: 'error', reason: 'AUTH_FAILED' }),
      'utf8'
    );

    // agy10 has state.json with AUTH_FAILED
    const dir10 = path.join(runsDir, 'agy10');
    fs.mkdirSync(dir10, { recursive: true });
    fs.writeFileSync(
      path.join(dir10, 'state.json'),
      JSON.stringify({ result: { state: 'login-required' } }),
      'utf8'
    );

    const catalogue = [
      {
        modelId: 'ag/gemini-3.8-flash-high',
        capabilities: { jsonSchema: true },
        contextWindow: 1000000,
      },
    ];

    const models = ['gemini-3.8-flash-high'];
    const generated = candidatesApi.generateCandidates({
      fakeRunsDir: runsDir,
      catalogue,
      models,
    });

    const poolCands = generated.filter((c) => c.harness === 'agy-pool');
    assert.ok(poolCands.length > 0, 'agy01 produces candidates');
    assert.equal(
      poolCands.every((c) => c.accountId === 'agy01'),
      true,
      'all agy-pool candidates belong to agy01'
    );
    assert.equal(
      generated.some((c) => ['agy08', 'agy09', 'agy10'].includes(c.accountId)),
      false,
      'AUTH_FAILED accounts agy08..agy10 are excluded'
    );
  });

  test('AC-R06.4: an unknown model is rejected with CAPABILITY_MISSING', () => {
    const runsDir = tmpDir('task-ai-130-runs4-');
    const dir01 = path.join(runsDir, 'agy01');
    fs.mkdirSync(dir01, { recursive: true });
    fs.writeFileSync(
      path.join(dir01, 'out.txt'),
      JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-unknown-v99'],
            weekly: { remaining: 1.0 },
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir01, 'result.json'), JSON.stringify({ state: 'ok' }), 'utf8');

    // Catalogue has NO entry for gemini-unknown-v99
    const catalogue = [
      {
        modelId: 'ag/gemini-3.8-flash-high',
        capabilities: { jsonSchema: true },
        contextWindow: 1000000,
      },
    ];

    const models = ['gemini-unknown-v99'];
    const generated = candidatesApi.generateCandidates({
      fakeRunsDir: runsDir,
      catalogue,
      models,
    });

    const unknownCand = generated.find(
      (c) => c.harness === 'agy-pool' && c.modelId === 'gemini-unknown-v99'
    );
    assert.ok(unknownCand, 'candidate generated for unknown model');
    assert.deepEqual(
      unknownCand.capabilities,
      {},
      'unknown model has empty capabilities (never hard-coded true)'
    );

    const profile = {
      taskId: 'TASK-AI-130-UNKNOWN',
      role: 'author.foundation',
      requiredCapabilities: ['jsonSchema', 'tools'],
      contextSize: 200000,
      proofFloor: 'NONE',
    };
    const assessment = {
      weightProfile: 'BALANCED',
      weights: { latency: 34, quality: 33, cost: 33 },
    };
    const rankResult = routing.rankForProfile([unknownCand], profile, assessment, {
      now: Date.now(),
      evidenceData: {},
    });

    assert.equal(rankResult.chosen, null, 'unknown candidate cannot be chosen');
    const rejection = rankResult.rejected.find(
      (r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema'
    );
    assert.ok(rejection, 'unknown model is rejected with CAPABILITY_MISSING:jsonSchema');
  });

  test('AC-R06.5: a failed discovery keeps the last good list with a warning', () => {
    pool.resetPoolDiscoveryCache();

    // 1. Initial successful discovery via CLI
    const fakeSpawnGood = () => ({
      status: 0,
      stdout:
        'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n',
      stderr: '',
    });
    const first = pool.discoverPoolModels({ spawnSync: fakeSpawnGood, refresh: true });
    assert.deepEqual(first, ['claude-opus-4-6-thinking', 'gemini-3.8-flash-high']);
    assert.equal(pool.getLastDiscoveryWarning(), null);

    // 2. Discovery fails (CLI fails and no catalogue available) -> keeps last good list with warning
    const fakeSpawnBad = () => ({
      status: 1,
      stdout: '',
      stderr: 'connection refused',
    });
    const second = pool.discoverPoolModels({
      spawnSync: fakeSpawnBad,
      refresh: true,
      catalogue: [],
      catalogueFile: path.join(tempHome, 'nonexistent.jsonl'),
    });
    assert.deepEqual(
      second,
      ['claude-opus-4-6-thinking', 'gemini-3.8-flash-high'],
      'returns last good model list'
    );
    assert.match(
      pool.getLastDiscoveryWarning(),
      /agy discovery failed; keeping last good model list/
    );

    // 3. Discovery fails with no cache -> returns empty, never hard-coded model
    pool.resetPoolDiscoveryCache();
    const third = pool.discoverPoolModels({
      spawnSync: fakeSpawnBad,
      catalogue: [],
      catalogueFile: path.join(tempHome, 'nonexistent.jsonl'),
      cacheFile: path.join(tempHome, 'nonexistent-cache.json'),
      refresh: true,
    });
    assert.deepEqual(third, [], 'empty array returned when discovery fails with no cache');
    assert.match(pool.getLastDiscoveryWarning(), /no models available/);
    assert.equal(third.includes('gemini-3.1-pro-low'), false, 'never falls back to hard-coded ID');
  });

  test('AC-R06.6: grep-level proof that no agy model id literal remains in sources.json or candidates.js', () => {
    const sourcesPath = path.join(__dirname, '..', 'sources.json');
    const sourcesText = fs.readFileSync(sourcesPath, 'utf8');
    assert.equal(
      sourcesText.includes('gemini-3.1-pro-low'),
      false,
      'gemini-3.1-pro-low absent from sources.json'
    );
    assert.equal(
      sourcesText.includes('gemini-3.8-flash-high'),
      false,
      'gemini-3.8-flash-high absent from sources.json'
    );
    assert.equal(
      sourcesText.includes('claude-opus-4-6-thinking'),
      false,
      'claude-opus-4-6-thinking absent from sources.json'
    );

    const registry = sourcesApi.loadSources({ file: sourcesPath });
    const agySource = registry.sources.find((s) => s.id === 'agy-pool');
    assert.ok(agySource, 'agy-pool source exists');
    assert.equal(agySource.models, undefined, 'agy-pool has no hard-coded models array');
    assert.deepEqual(
      agySource.capabilities,
      { tools: true },
      'agy-pool records harness tools capability'
    );

    const candidatesPath = path.join(__dirname, '..', 'candidates.js');
    const candidatesText = fs.readFileSync(candidatesPath, 'utf8');
    assert.equal(
      candidatesText.includes('gemini-3.1-pro-low'),
      false,
      'gemini-3.1-pro-low absent from candidates.js'
    );
    assert.equal(
      candidatesText.includes('gemini-3.8-flash-high'),
      false,
      'gemini-3.8-flash-high absent from candidates.js'
    );
    assert.equal(
      candidatesText.includes('claude-opus-4-6-thinking'),
      false,
      'claude-opus-4-6-thinking absent from candidates.js'
    );
    assert.equal(
      candidatesText.includes('isAgyPool'),
      false,
      'isAgyPool branch removed from candidates.js'
    );
  });

  test('P2-1: capabilities only from catalogue entry for same model id, never from account rows', () => {
    const runsDir = tmpDir('task-ai-130-p2-1-');
    const dir01 = path.join(runsDir, 'agy01');
    fs.mkdirSync(dir01, { recursive: true });
    fs.writeFileSync(
      path.join(dir01, 'out.txt'),
      JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-custom-native-99'],
            weekly: { remaining: 1.0 },
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir01, 'result.json'), JSON.stringify({ state: 'ok' }), 'utf8');

    // Catalogue has NO entry for gemini-custom-native-99
    const catalogue = [];

    // An agy-native account declares the model and carries capabilities
    const accounts = [
      {
        id: 'agy-native-a',
        provider: 'antigravity',
        models: ['gemini-custom-native-99'],
        capabilities: { jsonSchema: true, tools: true },
        contextWindow: 500000,
      },
    ];

    const generated = candidatesApi.generateCandidates({
      fakeRunsDir: runsDir,
      catalogue,
      accounts,
      models: ['gemini-custom-native-99'],
    });

    const poolCand = generated.find(
      (c) => c.harness === 'agy-pool' && c.modelId === 'gemini-custom-native-99'
    );
    assert.ok(poolCand, 'candidate generated');
    assert.deepEqual(
      poolCand.capabilities,
      {},
      'capabilities must NOT come from agy-native-a account row'
    );
    assert.equal(
      poolCand.contextWindow,
      undefined,
      'contextWindow must NOT come from agy-native-a account row'
    );

    const profile = {
      taskId: 'TASK-AI-130-P2-1',
      role: 'author.foundation',
      requiredCapabilities: ['jsonSchema', 'tools'],
      contextSize: 200000,
      proofFloor: 'NONE',
    };
    const rankResult = routing.rankForProfile(
      [poolCand],
      profile,
      {
        weightProfile: 'BALANCED',
        weights: { latency: 34, quality: 33, cost: 33 },
      },
      {
        now: Date.now(),
        evidenceData: {},
      }
    );
    assert.equal(rankResult.chosen, null);
    assert.ok(
      rankResult.rejected.some((r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema'),
      'rejected with CAPABILITY_MISSING:jsonSchema because account row cannot supply capabilities'
    );
  });

  test('P2-2: never force tools true and never let harness override an explicit false (effective = model AND harness)', () => {
    const runsDir = tmpDir('task-ai-130-p2-2-');
    const dir01 = path.join(runsDir, 'agy01');
    fs.mkdirSync(dir01, { recursive: true });
    fs.writeFileSync(
      path.join(dir01, 'out.txt'),
      JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-no-tools', 'gemini-has-tools', 'gemini-plain'],
            weekly: { remaining: 1.0 },
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir01, 'result.json'), JSON.stringify({ state: 'ok' }), 'utf8');

    const catalogue = [
      {
        modelId: 'ag/gemini-no-tools',
        capabilities: { jsonSchema: true, tools: false },
        contextWindow: 100000,
      },
      {
        modelId: 'ag/gemini-has-tools',
        capabilities: { jsonSchema: true, tools: true },
        contextWindow: 100000,
      },
      {
        modelId: 'ag/gemini-plain',
        capabilities: { jsonSchema: true },
        contextWindow: 100000,
      },
    ];

    // Standard registry where agy-pool has { tools: true }
    const generated = candidatesApi.generateCandidates({
      fakeRunsDir: runsDir,
      catalogue,
      models: ['gemini-no-tools', 'gemini-has-tools'],
    });

    const candNoTools = generated.find(
      (c) => c.harness === 'agy-pool' && c.modelId === 'gemini-no-tools'
    );
    assert.ok(candNoTools);
    assert.equal(
      candNoTools.capabilities.tools,
      false,
      'explicit tools: false from catalogue must not be overridden to true by harness'
    );
    assert.equal(candNoTools.capabilities.jsonSchema, true);

    const candHasTools = generated.find(
      (c) => c.harness === 'agy-pool' && c.modelId === 'gemini-has-tools'
    );
    assert.ok(candHasTools);
    assert.equal(
      candHasTools.capabilities.tools,
      true,
      'tools: true when both model and harness allow tools'
    );

    // Custom registry where agy-pool lacks capabilities
    const customRegistry = {
      sources: [
        {
          id: 'agy-pool',
          kind: 'agent-cli',
          harness: 'agy-pool',
          accounts: ['agy01'],
        },
      ],
    };
    const candWithoutHarnessTools = candidatesApi
      .generateCandidates({
        registry: customRegistry,
        fakeRunsDir: runsDir,
        catalogue,
        models: ['gemini-plain'],
      })
      .find((c) => c.harness === 'agy-pool' && c.modelId === 'gemini-plain');

    assert.ok(candWithoutHarnessTools);
    assert.equal(
      candWithoutHarnessTools.capabilities.tools,
      undefined,
      'tools is never forced true when sources.json lacks the block'
    );
  });

  test('P3: discoverPool: false really disables model discovery', () => {
    const registry = sourcesApi.loadSources();
    const result = candidatesApi.generateCandidates({
      registry,
      discoverPool: false,
      openCodeIds: [],
    });
    const agyCands = result.filter((c) => c.harness === 'agy-pool');
    assert.equal(
      agyCands.length,
      0,
      'no agy-pool candidates when discoverPool is false and no models passed'
    );

    const discovered = pool.discoverPoolModels({ discoverPool: false });
    assert.deepEqual(discovered, [], 'discoverPoolModels returns [] when discoverPool is false');
  });

  test('P3: AUTH_FAILED and missing-quota exclusion with default runtime dir', () => {
    const runsDir = tmpDir('task-ai-130-default-runs-');

    // agy01: ok with valid quota
    const dir01 = path.join(runsDir, 'agy01');
    fs.mkdirSync(dir01, { recursive: true });
    fs.writeFileSync(
      path.join(dir01, 'out.txt'),
      JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-3.8-flash-high'],
            weekly: { remaining: 0.9 },
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir01, 'result.json'), JSON.stringify({ state: 'ok' }), 'utf8');

    // agy08: login-required
    const dir08 = path.join(runsDir, 'agy08');
    fs.mkdirSync(dir08, { recursive: true });
    fs.writeFileSync(
      path.join(dir08, 'result.json'),
      JSON.stringify({ state: 'login-required' }),
      'utf8'
    );

    // agy09: empty dir (missing result and out.txt)
    const dir09 = path.join(runsDir, 'agy09');
    fs.mkdirSync(dir09, { recursive: true });

    // Mock pool.runsDir to simulate default runtime directory pointing to runsDir
    mock.method(pool, 'runsDir', () => runsDir);

    const catalogue = [
      {
        modelId: 'ag/gemini-3.8-flash-high',
        capabilities: { jsonSchema: true },
        contextWindow: 1000000,
      },
    ];

    const generated = candidatesApi.generateCandidates({
      catalogue,
      models: ['gemini-3.8-flash-high'],
    });

    const poolCands = generated.filter((c) => c.harness === 'agy-pool');
    assert.ok(poolCands.length > 0, 'agy01 is included');
    assert.ok(
      poolCands.every((c) => c.accountId === 'agy01'),
      'only agy01 is usable'
    );
    assert.equal(
      generated.some((c) => c.accountId === 'agy08' || c.accountId === 'agy09'),
      false,
      'AUTH_FAILED and missing accounts are excluded under default runtime dir'
    );
  });

  test('P3: discovery cache and warning wired into Controller path', () => {
    const cacheDir = tmpDir('task-ai-130-cache-test-');
    const cacheFile = path.join(cacheDir, 'agy-pool-cache.json');
    pool.resetPoolDiscoveryCache();

    // 1. Initial discovery writes to cacheFile
    const fakeSpawn = () => ({
      status: 0,
      stdout: 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n',
      stderr: '',
    });
    const discovered = pool.discoverPoolModels({
      spawnSync: fakeSpawn,
      cacheFile,
      refresh: true,
    });
    assert.deepEqual(discovered, ['gemini-3.8-flash-high']);
    assert.equal(fs.existsSync(cacheFile), true, 'cache file written to disk');

    // 2. Failure loads from cacheFile and sets warning
    pool.resetPoolDiscoveryCache();
    const badSpawn = () => ({ status: 1, stdout: '', stderr: 'down' });
    const loaded = pool.discoverPoolModels({
      spawnSync: badSpawn,
      catalogue: [],
      catalogueFile: path.join(cacheDir, 'nonexistent.jsonl'),
      cacheFile,
      refresh: true,
    });
    assert.deepEqual(loaded, ['gemini-3.8-flash-high'], 'loaded from disk cache');
    assert.match(pool.getLastDiscoveryWarning(), /keeping last good model list/);

    // 3. Controller path (runOrchestration defaults)
    const orch = require('../orchestrate');
    const logDefaults = orch.buildDefaults();
    assert.ok(Array.isArray(logDefaults.warnings));
    assert.equal(logDefaults.discoveryWarning, null);
  });

  test('parseCliModels rejects junk lines and extracts valid model IDs', () => {
    const raw = [
      'Fetching available models...',
      '# Comment line',
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
      'ok',
      'junk with spaces',
      '=== header ===',
      '--- separator ---',
      '',
    ].join('\n');
    const parsed = pool.parseCliModels(raw);
    assert.deepEqual(parsed, ['claude-opus-4-6-thinking', 'gemini-3.8-flash-high']);
  });
});
