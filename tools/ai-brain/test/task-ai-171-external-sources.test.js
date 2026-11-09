'use strict';

/**
 * Ship Dễ — TASK-AI-171: External key sources (direct-http) in Controller decision.
 *
 * GOAL: Every source in sources.json with kind "model-source" whose credential env
 * var is set must produce candidates in dispatch output (or a recorded rejection reason),
 * and a chosen direct-http candidate launches through harness 'direct-http'
 * (harness.js:539 -> opencodeDirect) with the same source id + model id in argv.
 *
 * NOTE: As specified in ticket A2, candidates.js is owned by another concurrent worker
 * today. The drop point is inside candidates.js (lines 1383, 1733, 1803), so candidates.js
 * is not edited here. The expected candidate-generation behavior is described and skipped
 * with reason, while the direct-http launch wiring is verified directly.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');
const { getHarness } = require('../harness');

const FAKE_POP_ENV = 'TEST_SOURCE_POP_API_KEY';
const FAKE_EMPTY_ENV = 'TEST_SOURCE_EMPTY_API_KEY';
process.env[FAKE_POP_ENV] = 'test-not-a-key';
process.env[FAKE_EMPTY_ENV] = 'test-not-a-key';

const fakeRegistry = {
  sources: [
    {
      id: 'ext-source-pop',
      label: 'External Source Populated',
      kind: 'model-source',
      servesModels: true,
      harness: 'direct-http',
      accessPath: 'direct',
      endpoint: 'https://ext-pop.example.test/v1',
      credential: {
        type: 'api-key',
        env: FAKE_POP_ENV,
      },
    },
    {
      id: 'ext-source-empty',
      label: 'External Source Empty',
      kind: 'model-source',
      servesModels: true,
      harness: 'direct-http',
      accessPath: 'direct',
      endpoint: 'https://ext-empty.example.test/v1',
      credential: {
        type: 'api-key',
        env: FAKE_EMPTY_ENV,
      },
    },
  ],
  dispatch: {
    providers: {},
  },
};

const injectedCatalogue = [
  {
    modelId: 'sample-external-model-1',
    source: 'ext-source-pop',
    gateway: 'ext-source-pop',
  },
];

describe('TASK-AI-171: external key sources (direct-http) wiring', () => {
  test('direct-http harness maps to opencodeDirect and builds launch argv with source id + model id', () => {
    const adapter = getHarness('direct-http');
    assert.ok(adapter, 'direct-http harness adapter must exist');
    assert.equal(adapter.id, 'opencode-direct');

    const route = sourcesApi.dispatchRoute('ext-source-pop', fakeRegistry);
    assert.ok(route, 'dispatchRoute must resolve for valid model-source');
    assert.equal(route.harness, 'direct-http');

    const qualifiedModel = sourcesApi.qualifyModel('sample-external-model-1', route);
    assert.equal(qualifiedModel, 'ext-source-pop/sample-external-model-1');

    const tmpDir = os.tmpdir();
    const launchArgs = adapter.launch({
      isolatedWorker: true,
      cwd: tmpDir,
      model: qualifiedModel,
      prompt: 'task instruction',
      workItemId: 'TASK-AI-171',
    });

    assert.ok(Array.isArray(launchArgs), 'launchArgs must be an array');
    const modelFlagIdx = launchArgs.indexOf('--model');
    assert.ok(modelFlagIdx !== -1, 'argv must contain --model flag');
    assert.equal(
      launchArgs[modelFlagIdx + 1],
      'ext-source-pop/sample-external-model-1',
      'argv must contain exact source id + model id'
    );
  });

  test('both external sources appear in Controller decision as candidates or explicit rejections', () => {
    // Expected behavior once candidates.js is patched:
    // 1. ext-source-pop (with catalogue models) produces candidates with harness 'direct-http'
    // 2. ext-source-empty (servesModels empty) produces explicit rejection with MODELS_UNKNOWN_FOR_SOURCE
    const rejections = [];
    const candidates = candidatesApi.generateCandidates({
      registry: fakeRegistry,
      catalogue: injectedCatalogue,
      accounts: [],
      candidateGenerationRejections: rejections,
    });

    const popCandidate = candidates.find((c) => c.sourceId === 'ext-source-pop');
    assert.ok(popCandidate, 'populated source must produce a candidate');
    assert.equal(popCandidate.harness, 'direct-http', 'harness must be direct-http');
    assert.equal(popCandidate.sourceId, 'ext-source-pop');
    assert.equal(popCandidate.modelId, 'sample-external-model-1');

    const emptyRejected = rejections.some(
      (r) =>
        r.sourceId === 'ext-source-empty' &&
        (r.reasonCode === 'MODELS_UNKNOWN_FOR_SOURCE' || r.reasonCode === 'MODELS_UNKNOWN')
    );
    assert.ok(
      emptyRejected,
      'empty source must produce explicit MODELS_UNKNOWN_FOR_SOURCE rejection'
    );
  });

  test('catalogue rows matching source id or qualified prefix produce direct-http candidates with exact identity', () => {
    const multiCatalogue = [
      {
        modelId: 'ext-source-pop/model-with-prefix',
        source: 'ext-source-pop',
        contextWindow: 128000,
      },
      'ext-source-pop/string-entry-model',
      {
        modelId: 'foreign-model',
        source: 'foreign-source',
      },
      'unrelated-source/unrelated-model',
    ];

    const rejections = [];
    const candidates = candidatesApi.generateCandidates({
      registry: fakeRegistry,
      catalogue: multiCatalogue,
      accounts: [],
      candidateGenerationRejections: rejections,
    });

    const popCandidates = candidates.filter((c) => c.sourceId === 'ext-source-pop');
    assert.equal(popCandidates.length, 2, 'must emit exactly 2 candidates for ext-source-pop');
    assert.ok(
      popCandidates.every((c) => c.harness === 'direct-http'),
      'every candidate must have direct-http harness'
    );

    const modelIds = popCandidates.map((c) => c.modelId).sort();
    assert.deepEqual(
      modelIds,
      ['model-with-prefix', 'string-entry-model'],
      'model IDs must be wire IDs stripped of prefix'
    );

    const prefixedCand = popCandidates.find((c) => c.modelId === 'model-with-prefix');
    assert.equal(prefixedCand.contextWindow, 128000, 'must resolve contextWindow from catalogue');
    assert.ok(prefixedCand.accountId, 'must have derived credential accountId');

    // foreign models must not be attributed to ext-source-pop
    assert.equal(
      popCandidates.some((c) => c.modelId === 'foreign-model' || c.modelId === 'unrelated-model'),
      false,
      'unrelated models must not be emitted for ext-source-pop'
    );
  });
});
