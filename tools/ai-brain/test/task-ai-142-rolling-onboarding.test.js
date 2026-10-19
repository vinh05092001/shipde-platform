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
});

