'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

test('refresh runs own CLI stages in order even after failure; no false success', async () => {
  const calls = [];
  const result = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(result.ok, false);
  assert.equal(result.stages[0].error, 'fetch failed');
});

test('freshness uses successful observation; absent, future and >48h refuse', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-fresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');
  const write = (lastSuccessfulAt) =>
    fs.writeFileSync(path.join(dir, 'freshness.json'), JSON.stringify({ lastSuccessfulAt }));
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);
  write('2026-11-03T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
});

test('failed or unobserved listings never remove a prior candidate', () => {
  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  for (const results of [{}, { provider: { status: 'unknown', catalogs: [] } }])
    assert.equal(reconcileRun({ ...base, results }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'enumerated', catalogs: [] } } })
      .transitions[0].state,
    'REMOVED'
  );
});

test('own live listing includes current account, each lane, and provider /models; secrets never leave adapter', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'test-private-value' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01', 'agy02'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-argon-high\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-opus-5-5-high\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(url, 'https://provider.invalid/v1/models');
      assert.equal(init.headers.authorization, 'Bearer test-private-value');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'DeepSeek-V4.1-Flash' }] }),
      };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4.1-Flash');
  assert.equal(output.results['agy01'].catalogs[0].account, 'agy01');
  assert.equal(output.results['agy-local'].catalogs[0].models[0], 'gemini-4-argon-high');
  assert.equal(commands.length, 3);
  assert.equal(JSON.stringify(output).includes('test-private-value'), false);
});

test('provider failed listing is unknown and never falls back to configured obsolete model', async () => {
  const output = await enumerateLiveSources({
    config: { provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { old: {} } } } },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=do-not-persist');
    },
  });
  assert.equal(output.results['opencode:p'].status, 'unknown');
  assert.deepEqual(output.results['opencode:p'].catalogs, []);
  assert.equal(JSON.stringify(output).includes('do-not-persist'), false);
});
