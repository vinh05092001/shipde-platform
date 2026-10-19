'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectNewSources,
  onboardSourceRolling,
  autoOnboardNewSources,
} = require('../rolling-onboard');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolling-onboard-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('TASK-AI-142 T8: rolling source onboarding', () => {
  test('detectNewSources identifies sources in registry with env keys that lack evidence', () => {
    const registry = {
      sources: [
        {
          id: 'existing-source',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'EXISTING_KEY' },
        },
        {
          id: 'new-source-with-key',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'NEW_KEY' },
        },
        {
          id: 'new-source-without-key',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'MISSING_KEY' },
        },
        {
          id: 'non-model-source',
          kind: 'tool',
          servesModels: false,
        },
      ],
    };

    const evidenceData = {
      combinations: [
        { source: 'existing-source', modelId: 'm1', evidence: [{ status: 'passed' }] },
      ],
    };

    const env = {
      EXISTING_KEY: 'secret1',
      NEW_KEY: 'secret2',
    };

    const detected = detectNewSources(registry, evidenceData, env);
    assert.equal(detected.length, 1);
    assert.equal(detected[0].id, 'new-source-with-key');
  });

  test('detectNewSources retries a source whose only prior evidence failed when its key is present', () => {
    const registry = {
      sources: [
        {
          id: 'retry-source',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'RETRY_SOURCE_KEY' },
        },
      ],
    };
    const evidenceData = {
      combinations: [
        {
          source: 'retry-source',
          modelId: 'fixture/retry-model',
          evidence: [{ status: 'failed', proofLevel: 'API_PASS' }],
        },
      ],
    };

    const detected = detectNewSources(registry, evidenceData, {
      RETRY_SOURCE_KEY: 'replacement-fixture-key',
    });

    assert.deepEqual(
      detected.map((source) => source.id),
      ['retry-source']
    );
  });

  test('onboardSourceRolling probes new source and records passing evidence and quota state', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const quotaFile = path.join(dir, 'quota-state.json');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const src = {
      id: 'mock-provider',
      kind: 'model-source',
      servesModels: true,
      endpoint: 'https://api.mockprovider.ai/v1',
      models: ['mockprovider/model-alpha'],
      credential: { env: 'MOCKPROVIDER_KEY' },
    };

    const evidenceData = { combinations: [] };
    const env = { MOCKPROVIDER_KEY: 'mock-secret-token' };

    let fetchCalled = false;
    const fakeFetch = async (url, opts) => {
      fetchCalled = true;
      assert.ok(url.includes('/chat/completions'));
      assert.equal(opts.headers.authorization, 'Bearer mock-secret-token');
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    };

    const result = await onboardSourceRolling(src, {
      evidenceData,
      evidenceDir,
      quotaStateFile: quotaFile,
      env,
      fetch: fakeFetch,
      now: 1700000000000,
    });

    assert.equal(fetchCalled, true);
    assert.equal(result.ok, true);
    assert.equal(result.sourceId, 'mock-provider');

    // Verify evidenceData was populated
    assert.equal(evidenceData.combinations.length, 1);
    const combo = evidenceData.combinations[0];
    assert.equal(combo.source, 'mock-provider');
    assert.equal(combo.modelId, 'mockprovider/model-alpha');
    assert.equal(combo.evidence[0].status, 'passed');

    // Verify quota state was saved
    assert.equal(fs.existsSync(quotaFile), true);
    const quota = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
    assert.equal(quota.scopes['mock-provider'].code, 'OK');
  });

  test('onboardSourceRolling rejects an HTTP 200 application error without API_PASS evidence', async (t) => {
    const dir = fixture(t);
    const evidenceData = { combinations: [] };
    const src = {
      id: 'application-error-source',
      kind: 'model-source',
      servesModels: true,
      endpoint: 'https://application-error.invalid/v1',
      models: ['fixture/application-error-model'],
      credential: { env: 'APPLICATION_ERROR_KEY' },
    };

    const result = await onboardSourceRolling(src, {
      evidenceData,
      evidenceDir: path.join(dir, 'evidence'),
      env: { APPLICATION_ERROR_KEY: 'fixture-credential' },
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ error: { code: 'route_unavailable' } }),
      }),
      persist: false,
      routeHealth: { version: 1, paths: {}, events: [] },
      now: 1700000000000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'APPLICATION_ERROR');
    assert.equal(evidenceData.combinations.length, 0);
  });

  test('end-to-end: adding a mock source into registry makes it appear in dispatch --dry-run without code changes', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const quotaFile = path.join(dir, 'quota-state.json');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const { dispatchCommand } = require('../cli');

    const registry = {
      sources: [
        {
          id: 'new-auto-source',
          kind: 'model-source',
          servesModels: true,
          endpoint: 'https://api.autosource.ai/v1',
          models: ['new-auto-source/great-model'],
          harness: 'direct-http',
          credential: { env: 'AUTO_SOURCE_KEY' },
        },
      ],
      dispatch: {
        decisionSampleCap: 2,
        decisionRetentionDays: 7,
        quotaScanIntervalMin: 60,
      },
    };

    const fakeFetch = async (url, opts) => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    });

    const env = { AUTO_SOURCE_KEY: 'test-auto-key' };

    // Run dry-run dispatch. The source is new, so it triggers auto-onboarding during the run
    const res = await dispatchCommand(
      { 'dry-run': true, task: 'TASK-ONBOARD-TEST' },
      {
        registry,
        env,
        fetch: fakeFetch,
        evidenceDir,
        quotaStateFile: quotaFile,
        now: 1700000000000,
      }
    );

    assert.ok(res, 'dispatchCommand must return a result');
    // The newly onboarded model should appear in ranking or candidates
    const allCandidates = (res.candidates || []).concat(res.ranking || []);
    const found = allCandidates.some(
      (c) =>
        c.source === 'new-auto-source' ||
        c.sourceId === 'new-auto-source' ||
        (c.modelId && c.modelId.includes('new-auto-source'))
    );
    assert.ok(found, 'Newly onboarded source model must appear in dispatch --dry-run');
  });

  test('normal live dispatch auto-onboards a new keyed source without a dependency flag', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const decisionDir = path.join(dir, 'decisions');
    const home = path.join(dir, 'home');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(decisionDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    const { dispatchCommand } = require('../cli');
    const defaultDispatch = require('../sources.json').dispatch;
    const registry = {
      sources: [
        {
          id: 'live-auto-source',
          kind: 'model-source',
          servesModels: true,
          endpoint: 'https://live-auto.invalid/v1',
          models: ['fixture/live-auto-model'],
          harness: 'direct-http',
          credential: { env: 'LIVE_AUTO_SOURCE_KEY' },
        },
      ],
      dispatch: { ...defaultDispatch, providers: {} },
    };
    const routeHealth = { version: 1, paths: {}, events: [] };
    let fetchCalls = 0;
    let launchCalls = 0;

    const result = await dispatchCommand(
      { execute: true, item: 'TASK-ROLLING-LIVE' },
      {
        registry,
        env: { LIVE_AUTO_SOURCE_KEY: 'live-fixture-credential' },
        fetch: async () => {
          fetchCalls += 1;
          return {
            ok: true,
            status: 200,
            headers: new Map(),
            text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
          };
        },
        evidenceDir,
        decisionDir,
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealth,
        routeHealthFile: path.join(dir, 'route-health.json'),
        home,
        storePath: path.join(dir, 'quota-store.json'),
        items: [
          {
            workItemId: 'TASK-ROLLING-LIVE',
            role: 'author.foundation',
            branch: 'fix/task-rolling-live',
          },
        ],
        run: () => {
          launchCalls += 1;
          return { exitCode: 0, stdout: '{"id":"fixture-session","status":"running"}' };
        },
        log: () => {},
        error: () => {},
        exit: () => {},
        now: 1700000000000,
      }
    );

    assert.equal(fetchCalls, 1);
    assert.equal(launchCalls, 1);
    assert.equal(result.exitCode, 0);
  });
});
